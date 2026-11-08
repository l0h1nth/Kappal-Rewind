"""Validate once, normalize in memory, and index observed vessel positions."""

import csv
import math
from collections import defaultdict
from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass, field
from datetime import datetime, timedelta, tzinfo
from pathlib import Path

from app.csv_format import COLUMNS, IST, parse_timestamp

SECOND = timedelta(seconds=1)


class DatasetLimitError(ValueError):
    """An import exceeds a configured resource limit, rather than invalid values."""


@dataclass(frozen=True)
class Observation:
    track_id: str
    timestamp: datetime
    lat: float
    lon: float
    speed_knots: float
    heading: float
    source_line: int = field(compare=False)


@dataclass(frozen=True)
class Gap:
    first_missing: datetime
    last_missing: datetime
    missing_seconds: int


@dataclass(frozen=True)
class DiscardedObservation:
    observation: Observation
    kept_line: int
    reason: str


@dataclass
class Dataset:
    # Dict insertion order is chronological; vessel IDs are sorted.
    observations: dict[str, dict[datetime, Observation]]
    gaps: dict[str, list[Gap]]
    start: datetime
    end: datetime
    bounds: dict[str, float]
    source_rows: int
    heading_360_rows: int
    discarded: list[DiscardedObservation]
    naive_timestamp_rows: int = 0

    @property
    def vessel_ids(self) -> list[str]:
        return list(self.observations)

    @property
    def record_count(self) -> int:
        return sum(len(track) for track in self.observations.values())

    def observation_at(self, track_id: str, timestamp: datetime) -> Observation | None:
        if timestamp.tzinfo is None or timestamp.utcoffset() is None:
            raise ValueError("observation_at requires a timezone-aware timestamp")
        # Exact lookup: absent, off-grid, unknown vessel and out-of-range return None.
        return self.observations.get(track_id, {}).get(timestamp)


def distance_m(left: Observation, right: Observation) -> float:
    """Great-circle distance, sufficient for continuity comparison (not navigation)."""
    lat1, lat2 = math.radians(left.lat), math.radians(right.lat)
    dlat = lat2 - lat1
    dlon = math.radians(right.lon - left.lon)
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * 6_371_000 * math.asin(math.sqrt(min(1.0, max(0.0, h))))


def _parse_row(row: list[str], line: int, naive_timezone: tzinfo = IST) -> Observation:
    def invalid(message: str):
        raise ValueError(f"CSV line {line}: {message}")

    if len(row) != len(COLUMNS):
        invalid(f"expected {len(COLUMNS)} cells, got {len(row)}")
    for name, value in zip(COLUMNS, row):
        if not value.strip():
            invalid(f"{name} is empty")
    vessel = row[0]
    if not vessel.isprintable() or any(c.isspace() for c in vessel):
        invalid("track_id must be printable and contain no whitespace")
    try:
        timestamp = parse_timestamp(row[1], naive_timezone=naive_timezone)
    except (ValueError, OverflowError) as error:
        invalid(f"timestamp: {error}")
    if timestamp.microsecond:
        invalid("timestamp is off the one-second UTC grid")
    numbers = []
    for name, text, low, high in zip(
        COLUMNS[2:], row[2:], [-90, -180, 0, 0], [90, 180, math.inf, 360]
    ):
        try:
            value = float(text)
        except ValueError:
            invalid(f"{name} must be numeric")
        if not math.isfinite(value) or not low <= value <= high:
            invalid(f"{name} must be finite and in [{low}, {high}]")
        numbers.append(value)
    return Observation(vessel, timestamp, *numbers, source_line=line)


def _resolve_block(
    groups: list[list[Observation]], before: Observation | None, after: Observation | None,
) -> list[Observation]:
    """Find the shortest complete path; keep two alternatives to detect ambiguity.

    This is a sequence decision, not a nearest-candidate decision per second.
    Require both adjacent anchors and a >1 metre advantage over the runner-up.
    Distance is a conservative heuristic, not proof of vessel identity.
    """
    first = groups[0][0]
    label = f"CSV line {first.source_line}: conflicting interval for {first.track_id}"
    if before is None or after is None:
        raise ValueError(f"{label} needs unambiguous adjacent observations on both sides")
    # Each state holds at most two best paths ending at one candidate.
    states = [[(distance_m(before, obs), [obs])] for obs in groups[0]]
    for candidates in groups[1:]:
        next_states = []
        for obs in candidates:
            choices = [(cost + distance_m(path[-1], obs), [*path, obs])
                       for alternatives in states for cost, path in alternatives]
            next_states.append(sorted(choices, key=lambda choice: choice[0])[:2])
        states = next_states
    complete = sorted(
        [(cost + distance_m(path[-1], after), path)
         for alternatives in states for cost, path in alternatives],
        key=lambda choice: choice[0],
    )
    if len(complete) > 1 and complete[1][0] - complete[0][0] <= 1.0:
        raise ValueError(f"{label} is ambiguous (sequence scores differ by at most 1 metre)")
    return complete[0][1]


def _resolve_track(groups: dict[datetime, list[Observation]], discarded: list,
                   max_conflict_candidates: int | None = None) -> dict:
    times = sorted(groups)
    unique = {}
    for timestamp in times:
        # Collapse normalized exact duplicates before evaluating conflicting positions.
        candidates = {}
        for obs in sorted(groups[timestamp], key=lambda item: item.source_line):
            if obs in candidates:
                discarded.append(DiscardedObservation(obs, candidates[obs].source_line, "normalized exact duplicate"))
            else:
                candidates[obs] = obs
        unique[timestamp] = sorted(candidates.values(), key=lambda o: (o.lat, o.lon, o.speed_knots, o.heading))
    def discarded_conflict(other, chosen):
        discarded.append(DiscardedObservation(other, chosen.source_line,
                         "discarded by anchored whole-interval geographic continuity"))
    return {obs.timestamp: obs for obs in resolve_candidate_groups(
        (unique[t] for t in times), discarded_conflict, max_conflict_candidates)}


def resolve_candidate_groups(groups: Iterable[list[Observation]], on_discard: Callable,
                             max_conflict_candidates: int | None = None) -> Iterator[Observation]:
    """Shared anchored policy over sorted, exact-deduplicated groups of ONE vessel.

    Only the current contiguous conflict block and its two anchors are retained.
    Callers bound group creation too, before accumulating an oversized group.
    """
    iterator = iter(groups)
    current = next(iterator, None)
    before = None
    while current is not None:
        if len(current) == 1:
            before = current[0]
            yield before
            current = next(iterator, None)
            continue
        block, candidates = [], 0
        first = current[0].timestamp
        left = before if before is not None and first - before.timestamp == SECOND else None
        while current is not None:
            block.append(current)
            candidates += len(current)
            if max_conflict_candidates is not None and candidates > max_conflict_candidates:
                raise DatasetLimitError(f"conflicting interval exceeds {max_conflict_candidates} candidates; split the recording")
            following = next(iterator, None)
            if following is None or len(following) == 1 or following[0].timestamp - current[0].timestamp != SECOND:
                break
            current = following
        right = (following[0] if following and len(following) == 1 and
                 following[0].timestamp - block[-1][0].timestamp == SECOND else None)
        chosen = _resolve_block(block, left, right)
        for group, obs in zip(block, chosen):
            yield obs
            for other in group:
                if other != obs:
                    on_discard(other, obs)
        before = chosen[-1]
        current = following


@dataclass
class ValidationCounts:
    source_rows: int = 0
    heading_360_rows: int = 0
    naive_timestamp_rows: int = 0


def iter_validated_rows(path: Path, counts: ValidationCounts, *, naive_timezone: tzinfo = IST,
                        max_rows: int | None = None, check_cancel: Callable = lambda: None) -> Iterator[Observation]:
    """The same strict CSV/row/time/heading validation for both storage paths."""
    with path.open(newline="", encoding="utf-8") as source:
        reader = csv.reader(source, strict=True)
        try:
            if next(reader, None) != COLUMNS:
                raise ValueError(f"CSV line 1: expected columns {COLUMNS}")
            while True:
                check_cancel()
                line = reader.line_num + 1
                row = next(reader, None)
                if row is None:
                    break
                if max_rows is not None and counts.source_rows >= max_rows:
                    raise DatasetLimitError(f"CSV exceeds {max_rows} source rows; split the recording")
                obs = _parse_row(row, line, naive_timezone)
                counts.source_rows += 1
                counts.naive_timestamp_rows += not (row[1].endswith("Z") or row[1][-6:-5] in ("+", "-"))
                counts.heading_360_rows += obs.heading == 360
                if obs.heading == 360:
                    obs = Observation(obs.track_id, obs.timestamp, obs.lat, obs.lon, obs.speed_knots, 0.0, obs.source_line)
                yield obs
        except csv.Error as error:
            raise ValueError(f"CSV line {reader.line_num}: malformed CSV: {error}") from error
    if not counts.source_rows:
        raise ValueError("CSV line 1: no observations")


def load_dataset(path: Path, *, naive_timezone: tzinfo = IST, max_rows: int | None = None,
                 max_conflict_candidates: int | None = None) -> Dataset:
    """Fail on the first invalid row or unresolved conflict; return no partial dataset."""
    grouped = defaultdict(lambda: defaultdict(list))
    counts = ValidationCounts()
    for obs in iter_validated_rows(path, counts, naive_timezone=naive_timezone, max_rows=max_rows):
        grouped[obs.track_id][obs.timestamp].append(obs)
    discarded = []
    tracks = {vessel: _resolve_track(grouped[vessel], discarded, max_conflict_candidates) for vessel in sorted(grouped)}
    start = min(next(iter(track)) for track in tracks.values())
    end = max(next(reversed(track)) for track in tracks.values())
    gaps = {}
    for vessel, track in tracks.items():
        times = list(track)
        gaps[vessel] = []
        if times[0] > start:
            gaps[vessel].append(Gap(start, times[0] - SECOND, int((times[0] - start).total_seconds())))
        gaps[vessel].extend(Gap(left + SECOND, right - SECOND, int((right - left).total_seconds()) - 1)
                            for left, right in zip(times, times[1:]) if right - left > SECOND)
        if times[-1] < end:
            gaps[vessel].append(Gap(times[-1] + SECOND, end, int((end - times[-1]).total_seconds())))
    accepted = [obs for track in tracks.values() for obs in track.values()]
    bounds = {"south": min(o.lat for o in accepted), "north": max(o.lat for o in accepted),
              "west": min(o.lon for o in accepted), "east": max(o.lon for o in accepted)}
    return Dataset(tracks, gaps, start, end, bounds, counts.source_rows, counts.heading_360_rows,
                   sorted(discarded, key=lambda entry: entry.observation.source_line), counts.naive_timestamp_rows)
