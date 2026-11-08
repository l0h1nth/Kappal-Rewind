"""Typed Parquet I/O through an embedded, connection-local DuckDB instance."""

import csv
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

import duckdb

from app.ingestion import Dataset

COLUMNS = "track_id, timestamp, lat, lon, speed_knots, heading, source_line"


def normalized_rows(dataset: Dataset) -> list[tuple]:
    return [(o.track_id, o.timestamp, o.lat, o.lon, o.speed_knots, o.heading, o.source_line)
            for track in dataset.observations.values() for o in track.values()]


def write_parquet(dataset: Dataset, destination: Path) -> None:
    # Canonical CSV bridges typed Python records to DuckDB without pandas/Arrow or
    # thousands of individual INSERTs. DuckDB never interprets the unvalidated upload.
    with TemporaryDirectory(prefix=".parquet-", dir=destination.parent) as directory:
        canonical = Path(directory) / "normalized.csv"
        with canonical.open("w", newline="", encoding="utf-8") as output:
            writer = csv.writer(output)
            writer.writerow(COLUMNS.split(", "))
            for row in normalized_rows(dataset):
                writer.writerow((row[0], row[1].isoformat(), *row[2:]))
        with duckdb.connect(config={"threads": 1, "memory_limit": "128MB",
                                    "temp_directory": directory}) as connection:
            canonical_relation(connection, canonical).write_parquet(str(destination), compression="zstd")


def canonical_relation(connection, source: Path):
    """Only validated canonical rows enter DuckDB; share the exact typed schema."""
    return connection.sql("""
        SELECT * FROM read_csv(?, header=true, auto_detect=false, buffer_size=4194304, max_line_size=1048576, columns={
            'track_id':'VARCHAR', 'timestamp':'TIMESTAMPTZ',
            'lat':'DOUBLE', 'lon':'DOUBLE', 'speed_knots':'DOUBLE',
            'heading':'DOUBLE', 'source_line':'BIGINT'})
    """, params=[str(source)])



def read_parquet(source: Path) -> list[tuple]:
    with duckdb.connect(config={"threads": 1, "memory_limit": "128MB"}) as connection:
        rows = connection.execute("""
            SELECT track_id, CAST(timestamp AT TIME ZONE 'UTC' AS VARCHAR),
                   lat, lon, speed_knots, heading, source_line
            FROM read_parquet(?) ORDER BY track_id, timestamp
        """, [str(source)]).fetchall()
    # SQL returns UTC wall times explicitly; this avoids DuckDB's optional pytz
    # dependency for Python TIMESTAMPTZ conversion. Parquet still stores UTC instants.
    return [(row[0], datetime.fromisoformat(row[1]).replace(tzinfo=timezone.utc), *row[2:])
            for row in rows]


def preview_parquet(source: Path, limit: int = 20) -> list[dict]:
    if type(limit) is not int or not 1 <= limit <= 100:
        raise ValueError("preview limit must be an integer from 1 to 100")
    with duckdb.connect(config={"threads": 1, "memory_limit": "128MB", "temp_directory": ""}) as connection:
        rows = connection.execute("""
            SELECT track_id, CAST(timestamp AT TIME ZONE 'UTC' AS VARCHAR),
                   lat, lon, speed_knots, heading
            FROM read_parquet(?) ORDER BY timestamp, track_id LIMIT ?
        """, [str(source), limit]).fetchall()
    return [{"track_id": row[0], "timestamp": datetime.fromisoformat(row[1]).replace(tzinfo=timezone.utc).isoformat(),
             "lat": row[2], "lon": row[3], "speed_knots": row[4], "heading": row[5]} for row in rows]
