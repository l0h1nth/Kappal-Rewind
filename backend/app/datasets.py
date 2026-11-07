"""Bounded CSV imports; published directories contain verified Parquet and metadata."""

import asyncio
import json
import os
import shutil
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import BinaryIO
from uuid import uuid4
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Query, Request
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile
from starlette.formparsers import MultiPartException, MultiPartParser

from app.ingestion import DatasetLimitError, load_dataset
from app.catalog import DATASET_ID, StoredDataset, discover_datasets
from app.storage import normalized_rows, preview_parquet, read_parquet, write_parquet

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_REQUEST_BYTES = 11 * 1024 * 1024  # Includes multipart boundaries/headers.
MAX_SOURCE_ROWS = 50_000
MAX_CONFLICT_CANDIDATES = 256  # Total across a contiguous conflicting block.
DEFAULT_UPLOAD_ROOT = Path(__file__).resolve().parents[2] / "uploads"
router = APIRouter()


class CompleteMultipartParser(MultiPartParser):
    """Require the terminal boundary; Starlette otherwise accepts truncated envelopes."""

    def __init__(self, request: Request):
        self.complete = False

        async def complete_stream():
            async for chunk in request.stream():
                yield chunk
            if not self.complete:
                # Raised inside parse(), which closes all opened upload spools.
                raise MultiPartException("Incomplete multipart upload; send the entire file again.")

        super().__init__(request.headers, complete_stream(), max_files=1, max_fields=0)

    def on_end(self) -> None:
        self.complete = True


@asynccontextmanager
async def upload_form(request: Request):
    try:
        form = await CompleteMultipartParser(request).parse()
    except MultiPartException as error:
        raise HTTPException(400, error.message) from error
    try:
        yield form
    finally:
        await form.close()


def configure_uploads(application) -> None:
    application.state.upload_root = Path(os.environ.get("UPLOAD_ROOT", DEFAULT_UPLOAD_ROOT))
    application.state.upload_timezone = ZoneInfo(os.environ.get("UPLOAD_NAIVE_TIMEZONE", "Asia/Kolkata"))
    application.state.upload_lock = asyncio.Lock()


def import_dataset(source: BinaryIO, filename: str, root: Path, naive_timezone: ZoneInfo) -> dict:
    root.mkdir(parents=True, exist_ok=True)
    dataset_id = uuid4().hex
    # Stage on the same filesystem so a single directory rename publishes both files.
    with TemporaryDirectory(prefix=".import-", dir=root) as temporary:
        staging = Path(temporary)
        csv_path = staging / "source.csv"
        with csv_path.open("wb") as output:
            shutil.copyfileobj(source, output, length=64 * 1024)
        dataset = load_dataset(csv_path, naive_timezone=naive_timezone,
                               max_rows=MAX_SOURCE_ROWS, max_conflict_candidates=MAX_CONFLICT_CANDIDATES)
        parquet = staging / "observations.parquet"
        write_parquet(dataset, parquet)
        if read_parquet(parquet) != normalized_rows(dataset):
            raise RuntimeError("Parquet read-back did not match normalized observations")
        exact = sum(d.reason == "normalized exact duplicate" for d in dataset.discarded)
        metadata = {
            "dataset_id": dataset_id, "original_filename": filename,
            "imported_at": datetime.now(timezone.utc).isoformat(),
            "vessel_count": len(dataset.observations), "accepted_row_count": dataset.record_count,
            "start": dataset.start.isoformat(), "end": dataset.end.isoformat(),
            "duration_seconds": int((dataset.end - dataset.start).total_seconds()) + 1,
            "validation": {
                "naive_timezone": naive_timezone.key,
                "naive_timestamp_rows": dataset.naive_timestamp_rows,
                "offset_timestamp_rows": dataset.source_rows - dataset.naive_timestamp_rows,
                "source_row_count": dataset.source_rows, "discarded_row_count": len(dataset.discarded),
                "exact_duplicate_rows": exact, "conflicting_duplicate_rows": len(dataset.discarded) - exact,
                "heading_normalizations": dataset.heading_360_rows,
                "missing_observation_seconds": sum(g.missing_seconds for gaps in dataset.gaps.values() for g in gaps),
                "gap_count": sum(len(gaps) for gaps in dataset.gaps.values()),
            },
        }
        (staging / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
        csv_path.unlink()  # Keep no raw CSV copy; Parquet contains accepted observations.
        staging.rename(root / dataset_id)
    return metadata


def published_datasets(root: Path) -> list[StoredDataset]:
    try:
        return discover_datasets(root)
    except OSError as error:
        raise HTTPException(503, "Recording library is unavailable. Try again later.") from error


def lookup_dataset(root: Path, dataset_id: str) -> StoredDataset:
    if not DATASET_ID.fullmatch(dataset_id):
        raise HTTPException(422, "Dataset ID must be 32 lowercase hexadecimal characters.")
    # Resolve only through discovered metadata; user input never becomes a file path.
    for record in published_datasets(root):
        if record.metadata["dataset_id"] == dataset_id:
            return record
    raise HTTPException(404, "Recording not found or its metadata is unavailable.")


@router.get("/api/datasets")
def list_datasets(request: Request):
    return [record.metadata for record in published_datasets(request.app.state.upload_root)]


@router.get("/api/datasets/{dataset_id}")
def dataset_details(dataset_id: str, request: Request):
    return lookup_dataset(request.app.state.upload_root, dataset_id).metadata


@router.get("/api/datasets/{dataset_id}/preview")
def dataset_preview(dataset_id: str, request: Request, limit: int = Query(default=20, ge=1, le=100)):
    record = lookup_dataset(request.app.state.upload_root, dataset_id)
    try:
        rows = preview_parquet(record.parquet, limit)
    except Exception as error:
        raise HTTPException(500, "Preview unavailable for this recording. Stored files were not changed.") from error
    return {"dataset_id": dataset_id, "rows": rows}


@router.post("/api/datasets", status_code=201)
async def upload_dataset(request: Request):
    if request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "multipart/form-data":
        raise HTTPException(415, "Send one CSV using multipart/form-data with a file field.")
    if request.app.state.upload_lock.locked():
        raise HTTPException(409, "Another import is running. Try again when it finishes.")
    async with request.app.state.upload_lock:
        async with upload_form(request) as form:
            upload = form.get("file")
            if len(form.multi_items()) != 1 or not isinstance(upload, UploadFile):
                raise HTTPException(422, "Exactly one CSV file field named 'file' is required.")
            # Display metadata only; neither the original name nor extension forms a storage path.
            filename = (upload.filename or "").replace("\\", "/").split("/")[-1]
            if not filename.lower().endswith(".csv") or len(filename) > 255:
                raise HTTPException(415, "Choose a CSV filename ending in .csv (at most 255 characters).")
            if not upload.size:
                raise HTTPException(422, "CSV file is empty.")
            if upload.size > MAX_UPLOAD_BYTES:
                raise HTTPException(413, "CSV exceeds the 10 MiB upload limit.")
            try:
                return await run_in_threadpool(import_dataset, upload.file, filename,
                                               request.app.state.upload_root, request.app.state.upload_timezone)
            except DatasetLimitError as error:
                raise HTTPException(413, str(error)) from error
            except UnicodeError as error:
                raise HTTPException(422, "CSV must be UTF-8 text.") from error
            except (ValueError, OverflowError) as error:
                raise HTTPException(422, str(error)) from error
            except Exception as error:
                # Do not expose filesystem paths or DuckDB diagnostics to the browser.
                raise HTTPException(500, "Dataset could not be stored. No dataset was published; try again.") from error
