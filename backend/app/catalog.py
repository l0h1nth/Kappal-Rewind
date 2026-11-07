"""Discover published E1 metadata in-place; no separate registry or observation loads."""

import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

DATASET_ID = re.compile(r"[0-9a-f]{32}")
MAX_METADATA_BYTES = 64 * 1024
COUNTS = ("source_row_count", "discarded_row_count", "exact_duplicate_rows",
          "conflicting_duplicate_rows", "heading_normalizations", "missing_observation_seconds",
          "gap_count", "naive_timestamp_rows", "offset_timestamp_rows")


@dataclass(frozen=True)
class StoredDataset:
    metadata: dict
    parquet: Path


def utc_instant(value: object) -> datetime:
    if not isinstance(value, str):
        raise ValueError("timestamp must be a string")
    instant = datetime.fromisoformat(value)
    if instant.tzinfo is None or instant.utcoffset() is None:
        raise ValueError("timestamp must have an offset")
    return instant.astimezone(timezone.utc)


def validate_metadata(raw: object, directory_id: str) -> dict:
    if not isinstance(raw, dict) or raw.get("dataset_id") != directory_id:
        raise ValueError("metadata ID does not match its published directory")
    filename = raw.get("original_filename")
    if not isinstance(filename, str) or not 1 <= len(filename) <= 255 or '/' in filename or '\\' in filename:
        raise ValueError("invalid display filename")
    for name in ("vessel_count", "accepted_row_count", "duration_seconds"):
        if type(raw.get(name)) is not int or raw[name] < 1:
            raise ValueError("invalid metadata count")
    start, end = utc_instant(raw.get("start")), utc_instant(raw.get("end"))
    if start.microsecond or end.microsecond or (end - start).total_seconds() != raw["duration_seconds"] - 1:
        raise ValueError("inconsistent recording times")
    summary = raw.get("validation")
    if not isinstance(summary, dict) or not isinstance(summary.get("naive_timezone"), str) or not summary["naive_timezone"]:
        raise ValueError("missing validation summary")
    if any(type(summary.get(name)) is not int or summary[name] < 0 for name in COUNTS):
        raise ValueError("invalid validation counts")
    if (raw["accepted_row_count"] + summary["discarded_row_count"] != summary["source_row_count"] or
            summary["exact_duplicate_rows"] + summary["conflicting_duplicate_rows"] != summary["discarded_row_count"] or
            summary["naive_timestamp_rows"] + summary["offset_timestamp_rows"] != summary["source_row_count"] or
            raw["vessel_count"] > raw["accepted_row_count"] or
            summary["heading_normalizations"] > summary["source_row_count"] or
            summary["missing_observation_seconds"] != raw["duration_seconds"] * raw["vessel_count"] - raw["accepted_row_count"]):
        raise ValueError("validation counts do not reconcile")
    imported = raw.get("imported_at")
    # E1 had no import timestamp. Preserve that absence instead of guessing from mtime.
    imported_at = utc_instant(imported).isoformat() if imported is not None else None
    return {"dataset_id": directory_id, "original_filename": filename, "imported_at": imported_at,
            "vessel_count": raw["vessel_count"], "accepted_row_count": raw["accepted_row_count"],
            "start": start.isoformat(), "end": end.isoformat(), "duration_seconds": raw["duration_seconds"],
            "validation": {"naive_timezone": summary["naive_timezone"], **{name: summary[name] for name in COUNTS}}}


def discover_datasets(root: Path) -> list[StoredDataset]:
    if not root.exists():
        return []
    records = []
    for directory in root.iterdir():
        try:
            if not DATASET_ID.fullmatch(directory.name) or directory.is_symlink() or not directory.is_dir():
                continue
            metadata_file, parquet = directory / "metadata.json", directory / "observations.parquet"
            if (metadata_file.is_symlink() or parquet.is_symlink() or not metadata_file.is_file() or
                    not parquet.is_file() or parquet.stat().st_size == 0):
                continue
            with metadata_file.open('rb') as source:
                content = source.read(MAX_METADATA_BYTES + 1)
            if len(content) > MAX_METADATA_BYTES:
                continue
            metadata = validate_metadata(json.loads(content), directory.name)
            records.append(StoredDataset(metadata, parquet))
        except (OSError, ValueError, OverflowError, RecursionError):
            continue  # One missing/corrupt entry cannot hide other published recordings.
    records.sort(key=lambda record: record.metadata["dataset_id"])
    records.sort(key=lambda record: (
        record.metadata["imported_at"] is not None,
        utc_instant(record.metadata["imported_at"]) if record.metadata["imported_at"] else datetime.min.replace(tzinfo=timezone.utc),
    ), reverse=True)
    return records
