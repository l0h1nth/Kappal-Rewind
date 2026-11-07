"""Validate once, normalize in memory, and index observed vessel positions."""

import csv
import math
from collections import defaultdict
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
    selected = {}
    index = 0
    while index < len(times):
        timestamp = times[index]
        if len(unique[timestamp]) == 1:
            selected[timestamp] = unique[timestamp][0]
            index += 1
            continue
        stop = index + 1
        while (stop < len(times) and times[stop] - times[stop - 1] == SECOND
               and len(unique[times[stop]]) > 1):
            stop += 1
        before = selected.get(times[index - 1]) if index and timestamp - times[index - 1] == SECOND else None
        after_group = unique[times[stop]] if stop < len(times) and times[stop] - times[stop - 1] == SECOND else []
        after = after_group[0] if len(after_group) == 1 else None
        if (max_conflict_candidates is not None and
                sum(len(unique[t]) for t in times[index:stop]) > max_conflict_candidates):
            raise DatasetLimitError(f"conflicting interval exceeds {max_conflict_candidates} candidates; split the recording")
        chosen = _resolve_block([unique[t] for t in times[index:stop]], before, after)
        for obs in chosen:
            selected[obs.timestamp] = obs
            for other in unique[obs.timestamp]:
                if other != obs:
                    discarded.append(DiscardedObservation(
                        other, obs.source_line, "discarded by anchored whole-interval geographic continuity",
                    ))
        index = stop
    return selected


def load_dataset(path: Path, *, naive_timezone: tzinfo = IST, max_rows: int | None = None,
                 max_conflict_candidates: int | None = None) -> Dataset:
    """Fail on the first invalid row or unresolved conflict; return no partial dataset."""
    grouped = defaultdict(lambda: defaultdict(list))
    source_rows = heading_360_rows = naive_timestamp_rows = 0
    with path.open(newline="", encoding="utf-8") as source:
        reader = csv.reader(source, strict=True)
        try:
            if next(reader, None) != COLUMNS:
                raise ValueError(f"CSV line 1: expected columns {COLUMNS}")
            while True:
                line = reader.line_num + 1
                row = next(reader, None)
                if row is None:
                    break
                if max_rows is not None and source_rows >= max_rows:
                    raise DatasetLimitError(f"CSV exceeds {max_rows} source rows; split the recording")
                obs = _parse_row(row, line, naive_timezone)
                source_rows += 1
                naive_timestamp_rows += not (row[1].endswith("Z") or row[1][-6:-5] in ("+", "-"))
                heading_360_rows += obs.heading == 360
                if obs.heading == 360:
                    obs = Observation(obs.track_id, obs.timestamp, obs.lat, obs.lon,
                                      obs.speed_knots, 0.0, obs.source_line)
                grouped[obs.track_id][obs.timestamp].append(obs)
        except csv.Error as error:
            raise ValueError(f"CSV line {reader.line_num}: malformed CSV: {error}") from error
    if not grouped:
        raise ValueError("CSV line 1: no observations")
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
    return Dataset(tracks, gaps, start, end, bounds, source_rows, heading_360_rows,
                   sorted(discarded, key=lambda entry: entry.observation.source_line), naive_timestamp_rows)
