import importlib.util
from datetime import datetime, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("audit_csv", ROOT / "scripts/audit_csv.py")
audit_csv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit_csv)


def test_naive_ist_matches_explicit_offset_and_utc():
    expected = datetime(2026, 11, 2, 3, 30, tzinfo=timezone.utc)
    for value in ["2026-11-02 09:00:00", "2026-11-02T09:00:00+05:30", "2026-11-02T03:30:00Z"]:
        assert audit_csv.parse_timestamp(value) == expected


def test_source_audit_regression():
    result = audit_csv.audit(ROOT / "data/tracks.csv")
    assert result["sha256"] == "41924aa95b6c6e14e43b9e6120ec7d8efc38a6dd5c36d4ed8a84158f1d5b2568"
    assert (result["rows"], result["vessels"], result["second_slots_inclusive"]) == (35820, 20, 1800)
    assert result["exact_duplicate_extras"] == 0
    assert result["duplicate_key_extras"] == 40
    assert all(d["track_id"] == "T007" and d["conflicting_fields"] for d in result["duplicates"])
    assert result["missing_vessel_seconds"] == 220
    assert [(g["track_id"], g["missing_seconds"]) for g in result["gaps"]] == [("T012", 40), ("T015", 180)]
    assert len(result["issues"]) == 11
    assert {i["issue"] for i in result["issues"]} == {"360 aliases north"}


def write_csv(tmp_path, body):
    path = tmp_path / "tracks.csv"
    path.write_text(",".join(audit_csv.COLUMNS) + "\n" + body)
    return path


def test_flags_invalid_values_and_preserves_input(tmp_path):
    path = write_csv(tmp_path, "T1,2026-11-02 09:00:00,91,NaN,-1,361\n")
    original = path.read_bytes()
    result = audit_csv.audit(path)
    assert {i["field"] for i in result["issues"]} == {"lat", "lon", "speed_knots", "heading"}
    assert path.read_bytes() == original


def test_boundary_gaps_duplicates_and_sort_order(tmp_path):
    path = write_csv(tmp_path,
        "A,2026-11-02 09:00:02,13,80,1,0\n"
        "B,2026-11-02 09:00:01,13,80,1,0\n"
        "A,2026-11-02 09:00:00,13,80,1,0\n"
        "A,2026-11-02 09:00:00,13,80,1,0\n")
    result = audit_csv.audit(path)
    assert result["exact_duplicate_extras"] == 1
    assert result["duplicate_key_extras"] == 1
    assert result["out_of_order_timestamps"] == 2
    assert result["missing_vessel_seconds"] == 3
    assert sum(g["missing_seconds"] for g in result["gaps"]) == 3


@pytest.mark.parametrize("body", ["", "T1,nonsense,13,80,1,0\n"])
def test_rejects_no_usable_observations(tmp_path, body):
    with pytest.raises(ValueError):
        audit_csv.audit(write_csv(tmp_path, body))


def test_reports_malformed_row(tmp_path):
    path = write_csv(tmp_path, "T1,2026-11-02 09:00:00,13,80,1,0\nT2,short\n")
    assert audit_csv.audit(path)["issues"] == [{"line": 3, "field": "row", "issue": "wrong field count"}]


def test_off_grid_observations_do_not_corrupt_second_counts(tmp_path):
    path = write_csv(tmp_path,
        "A,2026-11-02 09:00:00,13,80,1,0\n"
        "A,2026-11-02 09:00:00.5,13,80,1,0\n")
    result = audit_csv.audit(path)
    assert result["issues"] == [{"line": 3, "field": "timestamp", "issue": "off second grid"}]
    assert result["unique_vessel_seconds"] == 1
    assert result["missing_vessel_seconds"] == 0


def test_rejects_wrong_schema(tmp_path):
    path = tmp_path / "tracks.csv"
    path.write_text("wrong,columns\n1,2\n")
    with pytest.raises(ValueError, match="Expected columns"):
        audit_csv.audit(path)
