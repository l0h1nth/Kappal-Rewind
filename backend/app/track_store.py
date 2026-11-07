"""Two small read-only sources for the same replay frame builder."""

import math
from collections.abc import Sequence
from datetime import datetime, timedelta, timezone
from typing import Protocol

import duckdb

from app.catalog import StoredDataset, utc_instant
from app.datasets import MAX_SOURCE_ROWS
from app.ingestion import Dataset, Observation


class TrackStore(Protocol):
    dataset_id: str
    start: datetime
    end: datetime

    def get_metadata(self) -> dict: ...
    def get_window(self, start: datetime, end: datetime) -> Sequence[Observation]: ...


class MemoryTrackStore:
    dataset_id = "builtin"

    def __init__(self, dataset: Dataset):
        self.dataset = dataset
        self.start, self.end = dataset.start, dataset.end

    def get_metadata(self) -> dict:
        return {"dataset_id": self.dataset_id, "name": "Built-in assignment",
                "start": self.start.isoformat(), "end": self.end.isoformat(),
                "recording_seconds": int((self.end - self.start).total_seconds()) + 1,
                "vessel_count": len(self.dataset.observations), "vessel_ids": self.dataset.vessel_ids,
                "record_count": self.dataset.record_count, "bounds": self.dataset.bounds}

    def get_window(self, start: datetime, end: datetime) -> list[Observation]:
        rows = []
        for second in range(int((end - start).total_seconds()) + 1):
            instant = start + timedelta(seconds=second)
            rows.extend(track[instant] for track in self.dataset.observations.values() if instant in track)
        return rows


class ParquetTrackStore:
    def __init__(self, record: StoredDataset):
        self.dataset_id = record.metadata["dataset_id"]
        self.parquet = record.parquet
        self.start, self.end = utc_instant(record.metadata["start"]), utc_instant(record.metadata["end"])
        self._cache_key: tuple[datetime, datetime] | None = None
        self._cache: tuple[Observation, ...] = ()
        with self._connection() as connection:
            count, vessels, start, end, south, north, west, east, ids, unique, valid = connection.execute("""
                SELECT count(*), count(DISTINCT track_id),
                       CAST(min(timestamp) AT TIME ZONE 'UTC' AS VARCHAR),
                       CAST(max(timestamp) AT TIME ZONE 'UTC' AS VARCHAR),
                       min(lat), max(lat), min(lon), max(lon),
                       list(DISTINCT track_id ORDER BY track_id), count(DISTINCT (track_id, timestamp)),
                       bool_and(track_id IS NOT NULL AND timestamp IS NOT NULL AND
                           date_trunc('second', timestamp) = timestamp AND
                           lat IS NOT NULL AND lon IS NOT NULL AND speed_knots IS NOT NULL AND heading IS NOT NULL AND
                           isfinite(lat) AND isfinite(lon) AND isfinite(speed_knots) AND isfinite(heading) AND
                           speed_knots >= 0 AND heading >= 0 AND heading < 360)
                FROM read_parquet(?)
            """, [str(self.parquet)]).fetchone()
        if (not valid or not 1 <= count <= MAX_SOURCE_ROWS or count != record.metadata["accepted_row_count"] or
                unique != count or vessels != record.metadata["vessel_count"] or
                utc_instant(start + '+00:00') != self.start or utc_instant(end + '+00:00') != self.end or
                not all(isinstance(vessel, str) and vessel for vessel in ids) or
                not all(isinstance(n, (int, float)) and math.isfinite(n) for n in [south,north,west,east]) or
                not -90 <= south <= north <= 90 or not -180 <= west <= east <= 180):
            raise ValueError("Stored observations do not match recording metadata")
        self._metadata = {"dataset_id": self.dataset_id, "name": record.metadata["original_filename"],
                          "start": self.start.isoformat(), "end": self.end.isoformat(),
                          "recording_seconds": record.metadata["duration_seconds"],
                          "vessel_count": vessels, "vessel_ids": ids, "record_count": count,
                          "bounds": {"south": south, "north": north, "west": west, "east": east}}

    @staticmethod
    def _connection():
        return duckdb.connect(config={"threads": 1, "memory_limit": "128MB", "temp_directory": ""})

    def get_metadata(self) -> dict:
        return self._metadata

    def get_window(self, start: datetime, end: datetime) -> tuple[Observation, ...]:
        if start.tzinfo is None or end.tzinfo is None or not self.start <= start <= end <= self.end or end - start > timedelta(seconds=59):
            raise ValueError("Replay window must contain at most 60 recorded seconds within the recording")
        key = (start, end)
        if self._cache_key == key:
            return self._cache
        with self._connection() as connection:
            rows = connection.execute("""
                SELECT track_id, CAST(timestamp AT TIME ZONE 'UTC' AS VARCHAR),
                       lat, lon, speed_knots, heading, source_line
                FROM read_parquet(?) WHERE timestamp BETWEEN ? AND ?
                ORDER BY timestamp, track_id LIMIT ?
            """, [str(self.parquet), start, end, self._metadata["record_count"] + 1]).fetchall()
        if len(rows) > self._metadata["record_count"]:
            raise ValueError("Stored recording exceeds validated row count")
        observations = tuple(Observation(r[0], datetime.fromisoformat(r[1]).replace(tzinfo=timezone.utc), *r[2:]) for r in rows)
        for observation in observations:
            if (observation.timestamp.microsecond or
                    not all(math.isfinite(n) for n in (observation.lat, observation.lon, observation.speed_knots, observation.heading)) or
                    not -90 <= observation.lat <= 90 or not -180 <= observation.lon <= 180 or
                    observation.speed_knots < 0 or not 0 <= observation.heading < 360):
                raise ValueError("Invalid normalized observation in stored recording")
        self._cache_key, self._cache = key, observations  # Replace, never append history.
        return observations
