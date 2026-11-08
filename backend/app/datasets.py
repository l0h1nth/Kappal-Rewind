"""Bounded CSV imports; published directories contain verified Parquet and metadata."""

import asyncio
import json
import os
import threading
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import BinaryIO
from uuid import uuid4
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Query, Request
from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse
from starlette.datastructures import UploadFile
from starlette.formparsers import MultiPartException, MultiPartParser

from app.ingestion import DatasetLimitError
from app.catalog import DATASET_ID, StoredDataset, discover_datasets
from app.storage import preview_parquet
from app.upload_normalization import normalize_upload

MAX_UPLOAD_BYTES = 50 * 1024 * 1024
MAX_REQUEST_BYTES = 55 * 1024 * 1024  # Includes multipart boundaries/headers.
MAX_SOURCE_ROWS = 1_000_000
MAX_CONFLICT_CANDIDATES = 256  # Total across a contiguous conflicting block.
DEFAULT_UPLOAD_ROOT = Path(__file__).resolve().parents[2] / "uploads"
router = APIRouter()


class UploadSizeError(MultiPartException):
    pass


class ImportCancelled(Exception):
    pass


class CompleteMultipartParser(MultiPartParser):
    """Require the terminal boundary; Starlette otherwise accepts truncated envelopes."""

    def __init__(self, request: Request):
        self.complete = False
        self.file_bytes = 0
        self.byte_limit = request.app.state.upload_max_bytes

        async def complete_stream():
            async for chunk in request.stream():
                yield chunk
            if not self.complete:
                # Raised inside parse(), which closes all opened upload spools.
                raise MultiPartException("Incomplete multipart upload; send the entire file again.")

        super().__init__(request.headers, complete_stream(), max_files=1, max_fields=0)

    def on_part_data(self, data: bytes, start: int, end: int) -> None:
        if self._current_part.file is not None:
            self.file_bytes += end - start
            if self.file_bytes > self.byte_limit:
                raise UploadSizeError(f"CSV exceeds the {self.byte_limit:,}-byte upload limit.")
        super().on_part_data(data, start, end)

    def on_end(self) -> None:
        self.complete = True


@asynccontextmanager
async def upload_form(request: Request):
    parser = CompleteMultipartParser(request)
    try:
        form = await parser.parse()
    except UploadSizeError as error:
        raise HTTPException(413, error.message) from error
    except MultiPartException as error:
        raise HTTPException(400, error.message) from error
    except BaseException:
        # Starlette closes spools on multipart errors; cancellation/disconnect also
        # needs cleanup when parsing did not produce a FormData context yet.
        for spool in parser._files_to_close_on_error:
            spool.close()
        raise
    try:
        yield form
    finally:
        await form.close()


def configure_uploads(application) -> None:
    application.state.upload_root = Path(os.environ.get("UPLOAD_ROOT", DEFAULT_UPLOAD_ROOT))
    application.state.upload_timezone = ZoneInfo(os.environ.get("UPLOAD_NAIVE_TIMEZONE", "Asia/Kolkata"))
    application.state.upload_lock = asyncio.Lock()
    for name, default in [('upload_max_bytes', MAX_UPLOAD_BYTES), ('upload_max_rows', MAX_SOURCE_ROWS)]:
        value = int(os.environ.get(name.upper(), default))
        if not 1 <= value <= default:
            raise ValueError(f'{name.upper()} must be between 1 and {default}')
        setattr(application.state, name, value)


def import_dataset(source: BinaryIO, filename: str, root: Path, naive_timezone: ZoneInfo, *,
                   max_bytes: int | None = None, max_rows: int | None = None,
                   cancel: threading.Event | None = None) -> dict:
    max_bytes = MAX_UPLOAD_BYTES if max_bytes is None else max_bytes
    max_rows = MAX_SOURCE_ROWS if max_rows is None else max_rows
    def check_cancel():
        if cancel is not None and cancel.is_set():
            raise ImportCancelled('Import cancelled before publication')
    root.mkdir(parents=True, exist_ok=True)
    dataset_id = uuid4().hex
    with TemporaryDirectory(prefix=".import-", dir=root) as temporary:
        staging = Path(temporary)
        csv_path = staging / "source.csv"
        size = 0
        with csv_path.open("wb") as output:
            while chunk := source.read(64 * 1024):
                check_cancel()
                size += len(chunk)
                if size > max_bytes:
                    raise DatasetLimitError(f'CSV exceeds the {max_bytes:,}-byte upload limit.')
                output.write(chunk)
        summary = normalize_upload(csv_path, staging / 'observations.parquet', naive_timezone,
                                   max_rows, MAX_CONFLICT_CANDIDATES, check_cancel)
        metadata = {"dataset_id": dataset_id, "original_filename": filename,
                    "imported_at": datetime.now(timezone.utc).isoformat(), **summary}
        (staging / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
        csv_path.unlink()
        check_cancel()
        staging.rename(root / dataset_id)
    return metadata


async def run_import(request: Request, upload: UploadFile, filename: str):
    cancel = threading.Event()
    task = asyncio.create_task(run_in_threadpool(
        import_dataset, upload.file, filename, request.app.state.upload_root, request.app.state.upload_timezone,
        max_bytes=request.app.state.upload_max_bytes, max_rows=request.app.state.upload_max_rows, cancel=cancel))
    async def watch_disconnect():
        while True:
            message = await request.receive()
            if message['type'] == 'http.disconnect':
                cancel.set()
                return

    monitor = asyncio.create_task(watch_disconnect())
    try:
        return await asyncio.shield(task)
    except asyncio.CancelledError:
        cancel.set()
        # Keep the lock and upload spool alive until the worker has removed staging.
        while not task.done():
            try:
                await asyncio.shield(task)
            except asyncio.CancelledError:
                continue
            except Exception:
                break
        if not task.cancelled():
            task.exception()
        raise
    finally:
        monitor.cancel()
        await asyncio.gather(monitor, return_exceptions=True)


@router.get('/api/upload-limits')
def upload_limits(request: Request):
    return {'max_bytes': request.app.state.upload_max_bytes, 'max_rows': request.app.state.upload_max_rows}


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
            if upload.size > request.app.state.upload_max_bytes:
                raise HTTPException(413, "CSV exceeds the configured file size limit.")
            try:
                return await run_import(request, upload, filename)
            except ImportCancelled as error:
                raise HTTPException(400, 'Upload disconnected; the unfinished import was cancelled.') from error
            except DatasetLimitError as error:
                raise HTTPException(413, str(error)) from error
            except UnicodeError as error:
                raise HTTPException(422, "CSV must be UTF-8 text.") from error
            except (ValueError, OverflowError) as error:
                raise HTTPException(422, str(error)) from error
            except Exception as error:
                # Do not expose filesystem paths or DuckDB diagnostics to the browser.
                raise HTTPException(500, "Dataset could not be stored. No dataset was published; try again.") from error


@router.delete("/api/datasets/{dataset_id}")
async def delete_dataset(dataset_id: str, request: Request):
    # Import here because lifecycle operations reuse this module's trusted lookup.
    from app.dataset_lifecycle import CleanupPendingError

    try:
        await request.app.state.dataset_lifecycle.delete(request.app.state.upload_root, dataset_id)
    except HTTPException:
        raise
    except CleanupPendingError:
        return JSONResponse(status_code=500, content={
            "detail": "Recording was removed from the library, but disk cleanup is incomplete. Ask the administrator to finish cleanup.",
            "removed_from_library": True,
        })
    except Exception as error:
        raise HTTPException(500, "Recording could not be deleted. Refresh the library and try again; stored files were not removed.") from error
    return {"dataset_id": dataset_id, "deleted": True}
