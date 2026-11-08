"""E5a reproducible isolated import measurement; creates only synthetic test data.

Run each size in a fresh process to measure Linux VmHWM independently. The requested
scratch directory must be outside the application's real upload root.
"""

import argparse
import csv
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from time import perf_counter
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from app.datasets import import_dataset, lookup_dataset
from app.track_store import ParquetTrackStore


def peak_rss_mib():
    # /proc measures this executable's memory image; rusage can inherit launcher
    # high-water history across exec on this environment.
    return int(next(line.split()[1] for line in Path('/proc/self/status').read_text().splitlines()
                    if line.startswith('VmHWM:'))) / 1024


def measure(root: Path, rows: int):
    root.mkdir(parents=True, exist_ok=True)
    source = root / f'synthetic-{rows}.csv'
    start = datetime(2025, 1, 1, tzinfo=timezone.utc)
    with source.open('w', newline='') as output:
        writer = csv.writer(output)
        writer.writerow(['track_id', 'timestamp', 'lat', 'lon', 'speed_knots', 'heading'])
        for i in range(rows):
            writer.writerow(['A', (start + timedelta(seconds=i)).isoformat().replace('+00:00', 'Z'), 1, 2, 3, 0])
    began = perf_counter()
    with source.open('rb') as content:
        metadata = import_dataset(content, source.name, root / 'uploads', ZoneInfo('UTC'))
    duration = perf_counter() - began
    import_peak = peak_rss_mib()
    record = lookup_dataset(root / 'uploads', metadata['dataset_id'])
    began = perf_counter()
    store = ParquetTrackStore(record)
    metadata_seconds = perf_counter() - began
    windows = []
    for second in [min(100, rows - 1), rows - 1, min(20, rows - 1)]:
        end = start + timedelta(seconds=second)
        began = perf_counter()
        observations = store.get_window(max(start, end - timedelta(seconds=59)), end)
        windows.append(round((perf_counter() - began) * 1000, 3))
        assert len(observations) == min(second + 1, 60)
        assert all((o.lat, o.lon, o.speed_knots, o.heading) == (1, 2, 3, 0) for o in observations)
    print(json.dumps({'rows': rows, 'csv_bytes': source.stat().st_size,
                      'accepted': metadata['accepted_row_count'], 'import_seconds': round(duration, 3),
                      'import_peak_rss_mib': round(import_peak, 2),
                      'peak_rss_mib': round(peak_rss_mib(), 2),
                      'parquet_bytes': record.parquet.stat().st_size,
                      'replay_metadata_seconds': round(metadata_seconds, 3), 'window_ms': windows,
                      'dataset_id': metadata['dataset_id']}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scratch', type=Path, required=True)
    parser.add_argument('--rows', type=int, required=True, choices=[100_000, 500_000, 1_000_000])
    options = parser.parse_args()
    measure(options.scratch, options.rows)
