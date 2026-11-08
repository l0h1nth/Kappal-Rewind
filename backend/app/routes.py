"""Exact, bounded selected-vessel inspection geometry; independent of replay frames."""

import math
from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from threading import Lock

from fastapi import HTTPException

from app.datasets import lookup_dataset
from app.track_store import ParquetTrackStore

MAX_ROUTE_POINTS = 20_000
MAX_CACHED_ROUTES = 8
MAX_ROUTE_SEGMENTS = 512
MAX_ROUTE_STEP_METRES = 100  # Same conservative discontinuity guard as visual motion.


def continuous(left, right):
    if right[0] - left[0] != timedelta(seconds=1) or abs(right[2] - left[2]) > 180:
        return False
    a, b = math.radians(left[1]), math.radians(right[1])
    hav = math.sin((b - a) / 2) ** 2 + math.cos(a) * math.cos(b) * math.sin(math.radians(right[2] - left[2]) / 2) ** 2
    return 2 * 6_371_000 * math.asin(math.sqrt(min(1, hav))) <= MAX_ROUTE_STEP_METRES


def route_geometry(rows, dataset_id, vessel_id):
    if len(rows) > MAX_ROUTE_POINTS:
        raise HTTPException(422, f"Full route exceeds the {MAX_ROUTE_POINTS:,}-position display limit. Playback and recent trails remain available.")
    if not rows:
        raise HTTPException(404, "Vessel not found in this recording.")
    segments = []
    previous = None
    for row in rows:
        instant, lat, lon = row
        if (instant.tzinfo is None or instant.microsecond or
                not math.isfinite(lat) or not math.isfinite(lon) or
                not -90 <= lat <= 90 or not -180 <= lon <= 180 or
                previous is not None and instant <= previous[0]):
            raise ValueError("Invalid normalized route")
        if previous is None or not continuous(previous, row):
            if len(segments) >= MAX_ROUTE_SEGMENTS:
                raise HTTPException(422, f"Full route exceeds the {MAX_ROUTE_SEGMENTS}-segment display limit because of gaps or jumps. Playback and recent trails remain available.")
            segments.append([])
        segments[-1].append([lat, lon])
        previous = row
    return {"dataset_id": dataset_id, "vessel_id": vessel_id,
            "start": rows[0][0].isoformat(), "end": rows[-1][0].isoformat(),
            "point_count": len(rows), "max_points": MAX_ROUTE_POINTS,
            "simplified": False, "segments": segments}


class RouteCache:
    """Eight immutable bounded routes per process. Validate catalog before every hit.

    A lock coalesces concurrent misses; queries run in the HTTP worker pool, never
    the replay event loop. Cache entries cannot hold open files or reserve deletion.
    """

    def __init__(self):
        self.entries = OrderedDict()
        self.lock = Lock()

    def get(self, application, dataset_id, vessel_id):
        if not vessel_id or not vessel_id.isprintable() or any(c.isspace() for c in vessel_id):
            raise HTTPException(422, "Vessel ID must be printable and contain no whitespace.")
        if dataset_id == 'builtin':
            key = (dataset_id, vessel_id)
            track = application.state.dataset.observations.get(vessel_id, {})
        else:
            record = lookup_dataset(application.state.upload_root, dataset_id)
            stat = record.parquet.stat()
            key = (dataset_id, vessel_id, stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns)
        with self.lock:
            if key in self.entries:
                self.entries.move_to_end(key)
                return self.entries[key]
            if dataset_id == 'builtin':
                if len(track) > MAX_ROUTE_POINTS:
                    raise HTTPException(422, f"Full route exceeds the {MAX_ROUTE_POINTS:,}-position display limit. Playback and recent trails remain available.")
                rows = [(o.timestamp, o.lat, o.lon) for o in sorted(track.values(), key=lambda o: o.timestamp)]
            else:
                # Predicate/projection pushdown; never construct a whole-recording
                # TrackStore or transfer more than cap+1 rows into Python.
                with ParquetTrackStore._connection() as connection:
                    raw = connection.execute("""
                        SELECT CAST(timestamp AT TIME ZONE 'UTC' AS VARCHAR), lat, lon
                        FROM read_parquet(?) WHERE track_id = ? ORDER BY timestamp LIMIT ?
                    """, [str(record.parquet), vessel_id, MAX_ROUTE_POINTS + 1]).fetchall()
                rows = [(datetime.fromisoformat(t).replace(tzinfo=timezone.utc), lat, lon) for t, lat, lon in raw]
            result = route_geometry(rows, dataset_id, vessel_id)
            self.entries[key] = result
            while len(self.entries) > MAX_CACHED_ROUTES:
                self.entries.popitem(last=False)
            return result
