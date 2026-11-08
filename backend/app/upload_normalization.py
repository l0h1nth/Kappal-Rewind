"""Disk-backed sorting/deduplication; shared Python row and anchored-block policy."""

import csv
from datetime import datetime, timezone
from itertools import groupby
from pathlib import Path
from tempfile import TemporaryDirectory

import duckdb

from app.ingestion import DatasetLimitError, Observation, ValidationCounts, iter_validated_rows, resolve_candidate_groups
from app.storage import COLUMNS, canonical_relation

FETCH_ROWS = 1024


def write_observation(writer, obs):
    writer.writerow((obs.track_id, obs.timestamp.isoformat(), obs.lat, obs.lon,
                     obs.speed_knots, obs.heading, obs.source_line))


def normalize_upload(source: Path, destination: Path, naive_timezone, max_rows: int,
                     max_conflict_candidates: int, check_cancel=lambda: None) -> dict:
    counts = ValidationCounts()
    with TemporaryDirectory(prefix='.normalize-', dir=destination.parent) as temporary:
        work = Path(temporary)
        canonical, accepted = work / 'validated.csv', work / 'accepted.csv'
        with canonical.open('w', newline='', encoding='utf-8') as output:
            writer = csv.writer(output)
            writer.writerow(COLUMNS.split(', '))
            for obs in iter_validated_rows(source, counts, naive_timezone=naive_timezone,
                                           max_rows=max_rows, check_cancel=check_cancel):
                write_observation(writer, obs)
        check_cancel()
        with duckdb.connect(str(work / 'staging.duckdb'), config={
            'threads': 1, 'memory_limit': '128MB', 'temp_directory': str(work / 'spill'),
            'max_temp_directory_size': '2GB', 'preserve_insertion_order': False,
        }) as connection:
            canonical_relation(connection, canonical).create('raw')
            check_cancel()
            connection.execute('''
                CREATE TABLE candidates AS SELECT * FROM raw QUALIFY
                row_number() OVER (PARTITION BY track_id, timestamp, lat, lon, speed_knots, heading
                                   ORDER BY source_line) = 1
            ''')
            exact = counts.source_rows - connection.execute('SELECT count(*) FROM candidates').fetchone()[0]
            check_cancel()
            connection.execute('''
                SELECT track_id, CAST(timestamp AT TIME ZONE 'UTC' AS VARCHAR),
                       lat, lon, speed_knots, heading, source_line
                FROM candidates ORDER BY track_id, timestamp, lat, lon, speed_knots, heading
            ''')

            def observations():
                while batch := connection.fetchmany(FETCH_ROWS):
                    check_cancel()
                    for r in batch:
                        yield Observation(r[0], datetime.fromisoformat(r[1]).replace(tzinfo=timezone.utc), *r[2:])

            conflicts = 0
            def discard(_other, _chosen):
                nonlocal conflicts
                conflicts += 1

            with accepted.open('w', newline='', encoding='utf-8') as output:
                writer = csv.writer(output)
                writer.writerow(COLUMNS.split(', '))
                for _, vessel_rows in groupby(observations(), key=lambda obs: obs.track_id):
                    def groups():
                        for _, rows in groupby(vessel_rows, key=lambda obs: obs.timestamp):
                            candidates = []
                            for obs in rows:
                                if len(candidates) >= max_conflict_candidates:
                                    raise DatasetLimitError(f'conflicting interval exceeds {max_conflict_candidates} candidates; split the recording')
                                candidates.append(obs)
                            yield candidates
                    for obs in resolve_candidate_groups(groups(), discard, max_conflict_candidates):
                        check_cancel()
                        write_observation(writer, obs)
            check_cancel()
            canonical_relation(connection, accepted).create('accepted')
            connection.sql('SELECT * FROM accepted ORDER BY timestamp, track_id').write_parquet(
                str(destination), compression='zstd', row_group_size=65536)
            check_cancel()
            verify_parquet(connection, destination)
            check_cancel()
            total, vessels, start, end = connection.execute('''
                SELECT count(*), count(DISTINCT track_id),
                       CAST(min(timestamp) AT TIME ZONE 'UTC' AS VARCHAR),
                       CAST(max(timestamp) AT TIME ZONE 'UTC' AS VARCHAR) FROM accepted
            ''').fetchone()
            start = datetime.fromisoformat(start).replace(tzinfo=timezone.utc)
            end = datetime.fromisoformat(end).replace(tzinfo=timezone.utc)
            duration = int((end - start).total_seconds()) + 1
            internal = connection.execute('''
                SELECT count(*) FROM (SELECT timestamp,
                  lag(timestamp) OVER (PARTITION BY track_id ORDER BY timestamp) AS previous FROM accepted)
                WHERE timestamp - previous > INTERVAL '1 second'
            ''').fetchone()[0]
            boundary = connection.execute('''
                SELECT sum(CAST(first > ? AS INTEGER) + CAST(last < ? AS INTEGER))
                FROM (SELECT min(timestamp) AS first, max(timestamp) AS last FROM accepted GROUP BY track_id)
            ''', [start, end]).fetchone()[0]
            return {
                'vessel_count': vessels, 'accepted_row_count': total,
                'start': start.isoformat(), 'end': end.isoformat(), 'duration_seconds': duration,
                'validation': {
                    'naive_timezone': naive_timezone.key, 'source_row_count': counts.source_rows,
                    'naive_timestamp_rows': counts.naive_timestamp_rows,
                    'offset_timestamp_rows': counts.source_rows - counts.naive_timestamp_rows,
                    'discarded_row_count': exact + conflicts, 'exact_duplicate_rows': exact,
                    'conflicting_duplicate_rows': conflicts, 'heading_normalizations': counts.heading_360_rows,
                    'missing_observation_seconds': duration * vessels - total, 'gap_count': internal + boundary,
                },
            }


def verify_parquet(connection, destination: Path) -> None:
    """Compare both multisets in SQL, including source lines; never fetch all rows."""
    mismatch = connection.execute('''
        WITH stored AS (SELECT * FROM read_parquet(?)), differences AS (
            (SELECT * FROM accepted EXCEPT ALL SELECT * FROM stored)
            UNION ALL (SELECT * FROM stored EXCEPT ALL SELECT * FROM accepted)
        ) SELECT 1 FROM differences LIMIT 1
    ''', [str(destination)]).fetchone()
    if mismatch:
        raise RuntimeError('Parquet read-back did not match normalized observations')
