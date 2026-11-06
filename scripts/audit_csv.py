"""Read-only CSV audit. Run from the repository root; no third-party packages."""

import argparse
import csv
import hashlib
import json
import math
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.csv_format import COLUMNS, parse_timestamp


def audit(path: Path) -> dict:
    with path.open(newline="", encoding="utf-8") as source:
        reader = csv.DictReader(source)
        if reader.fieldnames != COLUMNS:
            raise ValueError(f"Expected columns {COLUMNS}; got {reader.fieldnames}")
        rows = list(reader)
    if not rows:
        raise ValueError("CSV has no observations")

    issues = []
    formats = Counter()
    counts = Counter()
    exact = Counter()
    observations = defaultdict(list)
    ranges = defaultdict(list)
    times_by_vessel = defaultdict(set)
    out_of_order = 0
    previous = None
    for line, row in enumerate(rows, start=2):
        if None in row or any(value is None for value in row.values()):
            issues.append({"line": line, "field": "row", "issue": "wrong field count"})
            continue
        exact[tuple(row.values())] += 1
        counts[row["track_id"]] += 1
        for field, value in row.items():
            if not value.strip():
                issues.append({"line": line, "field": field, "issue": "blank"})
        try:
            timestamp = parse_timestamp(row["timestamp"])
            naive = datetime.fromisoformat(row["timestamp"]).tzinfo is None
            formats["naive_assumed_IST" if naive else "offset_aware"] += 1
            if timestamp.microsecond:
                issues.append({"line": line, "field": "timestamp", "issue": "off second grid"})
            else:
                # Only on-grid observations can contribute to vessel-second totals.
                observations[row["track_id"], timestamp].append((line, row))
                times_by_vessel[row["track_id"]].add(timestamp)
            if previous is not None and timestamp < previous:
                out_of_order += 1
            previous = timestamp
        except (ValueError, OverflowError):
            issues.append({"line": line, "field": "timestamp", "issue": "invalid"})
        for field, low, high in [
            ("lat", -90, 90), ("lon", -180, 180),
            ("speed_knots", 0, math.inf), ("heading", 0, 360),
        ]:
            try:
                value = float(row[field])
                if not math.isfinite(value) or not low <= value <= high:
                    raise ValueError()
                ranges[field].append(value)
                if field == "heading" and value == 360:
                    issues.append({"line": line, "field": field, "issue": "360 aliases north"})
            except ValueError:
                issues.append({"line": line, "field": field, "issue": "invalid"})

    if not observations:
        raise ValueError("CSV has no usable on-second timestamps")
    start = min(t for _, t in observations)
    end = max(t for _, t in observations)
    slots = int((end - start).total_seconds()) + 1
    duplicates = []
    for (vessel, timestamp), group in sorted(observations.items()):
        if len(group) > 1:
            fields = [field for field in COLUMNS[2:]
                      if len({row[field] for _, row in group}) > 1]
            duplicates.append({"track_id": vessel, "timestamp": timestamp.isoformat(),
                               "lines": [line for line, _ in group],
                               "conflicting_fields": fields})
    gaps = []
    for vessel, times in sorted(times_by_vessel.items()):
        ordered = sorted(times)
        # Global boundaries also expose missing first/last observations.
        bounds = [start - timedelta(seconds=1), *ordered, end + timedelta(seconds=1)]
        for left, right in zip(bounds, bounds[1:]):
            missing = int((right - left).total_seconds()) - 1
            if missing > 0:
                gaps.append({"track_id": vessel,
                             "first_missing": (left + timedelta(seconds=1)).isoformat(),
                             "last_missing": (right - timedelta(seconds=1)).isoformat(),
                             "missing_seconds": missing})
    return {
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "rows": len(rows), "vessels": len(counts), "rows_per_vessel": dict(sorted(counts.items())),
        "timestamp_formats": dict(formats), "start_utc": start.isoformat(),
        "end_utc": end.isoformat(), "second_slots_inclusive": slots,
        "exact_duplicate_extras": sum(n - 1 for n in exact.values()),
        "duplicate_key_extras": sum(len(x["lines"]) - 1 for x in duplicates),
        "unique_vessel_seconds": len(observations),
        "missing_vessel_seconds": len(counts) * slots - len(observations),
        "out_of_order_timestamps": out_of_order,
        "ranges": {field: [min(values), max(values)] for field, values in ranges.items()},
        "issues": issues, "duplicates": duplicates, "gaps": gaps,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path, nargs="?", default=Path(__file__).resolve().parents[1] / "data/tracks.csv")
    args = parser.parse_args()
    try:
        print(json.dumps(audit(args.path), indent=2))
    except (ValueError, OSError) as error:
        parser.exit(1, f"Audit failed: {error}\n")
