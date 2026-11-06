import csv
import hashlib
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.csv_format import COLUMNS, IST, parse_timestamp
from app.ingestion import distance_m, load_dataset

SOURCE = Path(__file__).resolve().parents[2] / "data/tracks.csv"
SOURCE_HASH = "41924aa95b6c6e14e43b9e6120ec7d8efc38a6dd5c36d4ed8a84158f1d5b2568"
START = datetime(2026, 11, 2, 3, 30, tzinfo=timezone.utc)


def row(second=0, vessel="A", lat=13, lon=80, speed=1, heading=0):
    return [vessel, (START + timedelta(seconds=second)).isoformat(), lat, lon, speed, heading]


def write_csv(tmp_path, rows, columns=COLUMNS):
    path = tmp_path / "tracks.csv"
    with path.open("w", newline="") as output:
        writer = csv.writer(output)
        writer.writerow(columns)
        writer.writerows(rows)
    return path


@pytest.fixture(scope="module")
def dataset():
    return load_dataset(SOURCE)


def test_valid_schema_and_numeric_boundaries(tmp_path):
    data = load_dataset(write_csv(tmp_path, [row(lat=-90, lon=-180, speed=0, heading=0),
                                               row(1, lat=90, lon=180, speed=100, heading=360)]))
    assert data.vessel_ids == ["A"]
    assert data.bounds == {"south": -90, "north": 90, "west": -180, "east": 180}
    assert data.observation_at("A", START).speed_knots == 0
    assert data.observation_at("A", START + timedelta(seconds=1)).heading == 0


@pytest.mark.parametrize("columns", [COLUMNS[:-1], [*COLUMNS, "extra"],
                                     ["id", *COLUMNS[1:]], list(reversed(COLUMNS)),
                                     [*COLUMNS[:-1], "lat"]])
def test_rejects_schema_changes(tmp_path, columns):
    with pytest.raises(ValueError, match="CSV line 1: expected columns"):
        load_dataset(write_csv(tmp_path, [row()], columns))


@pytest.mark.parametrize("index,value,field", [
    (0, "", "track_id"), (0, " \t", "track_id"), (0, "T 001", "track_id"),
    (0, "T\x00", "track_id"), (1, "bad", "timestamp"), (1, "2026-11-02", "timestamp"),
    (1, "2026-11-02T03:30:00.1Z", "timestamp"),
    (1, "2026-11-02T03:30:00.0000001Z", "timestamp"),
    (1, "0001-01-01T00:00:00+05:30", "timestamp"),
    (1, "2026-11-02T09:00:00+05:60", "timestamp"),
    (1, "2026-11-02T09:00:00+00:99", "timestamp"),
    (1, "2026-11-02T09:00:00-00:60", "timestamp"),
    (1, "2026-11-02T09:00:00+24:00", "timestamp"),
    (2, -90.01, "lat"), (2, 90.01, "lat"), (3, -180.01, "lon"), (3, 180.01, "lon"),
    (4, -0.1, "speed_knots"), (5, -1, "heading"), (5, 360.1, "heading"),
    (2, "NaN", "lat"), (3, "inf", "lon"), (4, "-inf", "speed_knots"),
    (5, "NaN", "heading"), (4, "nope", "speed_knots"), (5, "", "heading"),
])
def test_rejects_invalid_row_with_line_and_field(tmp_path, index, value, field):
    invalid = row(1)
    invalid[index] = value
    with pytest.raises(ValueError, match=f"CSV line 3: {field}"):
        load_dataset(write_csv(tmp_path, [row(), invalid]))


@pytest.mark.parametrize("invalid", [[], row()[:-1], [*row(), "extra"]])
def test_rejects_wrong_row_length(tmp_path, invalid):
    with pytest.raises(ValueError, match="CSV line 3: expected 6 cells"):
        load_dataset(write_csv(tmp_path, [row(), invalid]))


def test_rejects_empty_and_broken_csv(tmp_path):
    path = write_csv(tmp_path, [])
    with pytest.raises(ValueError, match="no observations"):
        load_dataset(path)
    path.write_text(",".join(COLUMNS) + '\n"unclosed,quoted\n')
    with pytest.raises(ValueError, match="CSV line 2: malformed CSV"):
        load_dataset(path)


def test_timezone_equivalence_and_heading_alias_duplicates(tmp_path):
    aware = row(heading=360)
    naive = row(heading=0)
    naive[1] = "2026-11-02 09:00:00"
    data = load_dataset(write_csv(tmp_path, [aware, naive]))
    assert parse_timestamp(naive[1]) == START
    assert data.start == data.end == START
    assert data.record_count == 1
    assert data.heading_360_rows == 1
    assert data.discarded[0].reason == "normalized exact duplicate"
    assert data.observation_at("A", START.astimezone(IST)).heading == 0


def test_preserves_valid_heading_values(tmp_path):
    headings = [0, 0.1, 180, 359.9, 360]
    data = load_dataset(write_csv(tmp_path, [row(i, heading=h) for i, h in enumerate(headings)]))
    assert [obs.heading for obs in data.observations["A"].values()] == [0, 0.1, 180, 359.9, 0]


def test_sort_index_and_global_boundary_gaps(tmp_path):
    data = load_dataset(write_csv(tmp_path, [row(4), row(1, vessel="B"), row(0), row(2)]))
    assert data.vessel_ids == ["A", "B"]
    assert list(data.observations["A"]) == [START + timedelta(seconds=i) for i in [0, 2, 4]]
    assert [(g.first_missing, g.last_missing, g.missing_seconds) for g in data.gaps["B"]] == [
        (START, START, 1), (START + timedelta(seconds=2), START + timedelta(seconds=4), 3)]
    assert [g.missing_seconds for g in data.gaps["A"]] == [1, 1]
    assert data.observation_at("A", START + timedelta(seconds=1)) is None
    assert data.observation_at("A", START - timedelta(seconds=1)) is None
    assert data.observation_at("A", START + timedelta(seconds=0.5)) is None
    assert data.observation_at("unknown", START) is None
    with pytest.raises(ValueError, match="timezone-aware"):
        data.observation_at("A", START.replace(tzinfo=None))


def test_conflict_resolution_uses_complete_sequence_not_greedy_choice(tmp_path):
    # First candidate is closer to the start; second gives the shortest WHOLE path.
    rows = [row(0, lon=0), row(1, lat=13.0001, lon=0), row(1, lon=0.0002),
            row(2, lon=0.0003), row(2, lat=13.0001, lon=-0.0001), row(3, lon=0.0004)]
    data = load_dataset(write_csv(tmp_path, rows))
    assert [obs.lon for obs in data.observations["A"].values()] == [0, 0.0002, 0.0003, 0.0004]
    assert len(data.discarded) == 2


def test_conflict_resolution_does_not_depend_on_source_candidate_order(tmp_path):
    rows = [row(0), row(1, lon=81), row(1), row(2, lon=81), row(2), row(3)]
    for seed in range(4):
        shuffled = rows.copy()
        random.Random(seed).shuffle(shuffled)
        data = load_dataset(write_csv(tmp_path, shuffled))
        assert [obs.lon for obs in data.observations["A"].values()] == [80] * 4
        assert len(data.discarded) == 2
        assert all(d.observation.lon == 81 and "whole-interval" in d.reason for d in data.discarded)


def test_refuses_ambiguous_or_unanchored_conflicts(tmp_path):
    with pytest.raises(ValueError, match="ambiguous"):
        load_dataset(write_csv(tmp_path, [row(), row(1, lon=79.999), row(1, lon=80.001), row(2)]))
    with pytest.raises(ValueError, match="both sides"):
        load_dataset(write_csv(tmp_path, [row(), row(lon=81), row(1)]))
    # An observation across a gap cannot be used as an adjacent anchor.
    with pytest.raises(ValueError, match="both sides"):
        load_dataset(write_csv(tmp_path, [row(), row(2), row(2, lon=81), row(3)]))


def test_collinear_alternatives_with_equal_path_length_are_ambiguous(tmp_path):
    rows = [row(0, lon=0), row(1, lon=0), row(1, lon=0.0001),
            row(2, lon=0.0002), row(2, lon=-0.0001), row(3, lon=0.0003)]
    with pytest.raises(ValueError, match="ambiguous"):
        load_dataset(write_csv(tmp_path, rows))


def test_exact_duplicates_are_counted_and_reported(tmp_path):
    data = load_dataset(write_csv(tmp_path, [row(), row(), row()]))
    assert data.source_rows == 3
    assert data.record_count == 1
    assert [(d.observation.source_line, d.kept_line) for d in data.discarded] == [(3, 2), (4, 2)]
    assert all(d.reason == "normalized exact duplicate" for d in data.discarded)


def test_actual_dataset_reconciliation_integrity_and_gaps(dataset):
    assert hashlib.sha256(SOURCE.read_bytes()).hexdigest() == SOURCE_HASH
    assert (dataset.source_rows, len(dataset.vessel_ids), dataset.record_count) == (35820, 20, 35780)
    assert len(dataset.discarded) == 40
    assert dataset.source_rows == dataset.record_count + len(dataset.discarded)
    assert dataset.heading_360_rows == 11
    assert dataset.end - dataset.start == timedelta(seconds=1799)
    assert sum(g.missing_seconds for gaps in dataset.gaps.values() for g in gaps) == 220
    assert [(v, [(g.first_missing, g.last_missing, g.missing_seconds) for g in gaps])
            for v, gaps in dataset.gaps.items() if gaps] == [
        ("T012", [(START + timedelta(seconds=600), START + timedelta(seconds=639), 40)]),
        ("T015", [(START + timedelta(seconds=1200), START + timedelta(seconds=1379), 180)]),
    ]
    assert all(o.timestamp.tzinfo == timezone.utc and 0 <= o.heading < 360
               for track in dataset.observations.values() for o in track.values())


def test_t007_continuity_and_no_t012_reassignment(dataset):
    track = list(dataset.observations["T007"].values())[599:641]
    assert len(track) == 42
    assert max(distance_m(a, b) for a, b in zip(track, track[1:])) == 0
    assert all(d.observation.track_id == "T007" for d in dataset.discarded)
    assert dataset.discarded[0].observation.source_line == 12013
    assert dataset.discarded[-1].observation.source_line == 12793
    assert len(dataset.observations["T012"]) == 1760
    assert dataset.observation_at("T012", START + timedelta(seconds=600)) is None


def test_loading_does_not_modify_source_and_is_reproducible():
    original = SOURCE.read_bytes()
    first = load_dataset(SOURCE)
    second = load_dataset(SOURCE)
    assert first == second
    assert SOURCE.read_bytes() == original
