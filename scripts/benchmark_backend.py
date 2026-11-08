"""Serial I3 benchmarks in separate worker processes; no application uploads touched.

Example: .venv/bin/python scripts/benchmark_backend.py --scratch /tmp/i3 --label before
Repeat with --label after in the same scratch directory after an implementation change.
Linux VmHWM includes this worker's Python/native memory, not Nginx or OS page cache.
"""
import argparse
import ast
import csv
import hashlib
import inspect
import json
import platform
import subprocess
import sys
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from time import perf_counter
from zoneinfo import ZoneInfo

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / 'backend'))
from app.datasets import MAX_UPLOAD_BYTES, import_dataset, lookup_dataset
from app.ingestion import load_dataset
from app.replay import ReplaySession, build_frame
from app.track_store import MemoryTrackStore, ParquetTrackStore
import duckdb

CASES = {'original': (None, 20), '100k': (100_000, 50),
         '500k': (500_000, 250), '1m': (1_000_000, 500)}
START = datetime(2025, 1, 1, tzinfo=timezone.utc)


def hwm():
    return int(next(line.split()[1] for line in Path('/proc/self/status').read_text().splitlines()
                    if line.startswith('VmHWM:'))) / 1024


def timed(function):
    began = perf_counter()
    result = function()
    return result, (perf_counter() - began) * 1000


def synthetic(source, rows, vessels):
    with source.open('w', newline='', encoding='utf-8') as output:
        writer = csv.writer(output, lineterminator='\n')
        writer.writerow(['track_id', 'timestamp', 'lat', 'lon', 'speed_knots', 'heading'])
        for second in range(rows // vessels):
            stamp = (START + timedelta(seconds=second)).isoformat().replace('+00:00', 'Z')
            for index in range(vessels):
                # Parallel ~6-knot eastbound tracks; compact coordinates fit 50 MiB.
                writer.writerow([f'V{index:03}', stamp, f'{13 + index // 50 * .002:.5f}',
                                 f'{80 + index % 50 * .002 + second * .000028:.5f}', 6, 90])


def temporary_usage(root, stop, peaks):
    while not stop.is_set():
        logical = allocated = 0
        for staging in root.glob('.import-*'):
            for path in staging.rglob('*'):
                try:
                    if path.is_file():
                        stat = path.stat(); logical += stat.st_size; allocated += stat.st_blocks * 512
                except OSError:
                    pass
        peaks[0] = max(peaks[0], logical); peaks[1] = max(peaks[1], allocated)
        stop.wait(.02)


def window_sql():
    # Profile the production SQL text, not a separately guessed approximation.
    import app.track_store as module
    strings = [n.value for n in ast.walk(ast.parse(inspect.getsource(module)))
               if isinstance(n, ast.Constant) and isinstance(n.value, str)]
    return next(s for s in strings if 'ORDER BY timestamp, track_id LIMIT' in s)


def worker(scratch, label, case, repeat):
    rows, vessels = CASES[case]
    run = scratch / label / f'{case}-{repeat}'
    run.mkdir(parents=True, exist_ok=False)
    root = run / 'datasets'; root.mkdir()
    source = REPO / 'data/tracks.csv' if rows is None else run / 'source.csv'
    if rows is not None: synthetic(source, rows, vessels)
    assert source.stat().st_size <= MAX_UPLOAD_BYTES
    peaks = [0, 0]; stop = threading.Event()
    monitor = threading.Thread(target=temporary_usage, args=(root, stop, peaks), daemon=True)
    monitor.start()
    try:
        with source.open('rb') as upload:
            metadata, import_ms = timed(lambda: import_dataset(upload, source.name, root, ZoneInfo('Asia/Kolkata')))
    finally:
        stop.set(); monitor.join()
    import_hwm = hwm()
    record = lookup_dataset(root, metadata['dataset_id'])
    store, opening_ms = timed(lambda: ParquetTrackStore(record))
    last = metadata['duration_seconds'] - 1
    session = ReplaySession(last + 1, lambda: 0.0)
    first, first_ms = timed(lambda: build_frame(store, session))
    targets = [min(last, n) for n in [60, 500, 1200, last, 600, 639, 640, 1199, 1379, 1380, 100, 61]]
    query_ms = []; seek_ms = []
    for second in targets:
        end = store.start + timedelta(seconds=second)
        start = max(store.start, end - timedelta(seconds=59))
        _, ms = timed(lambda: store.get_window(start, end)); query_ms.append(ms)
        # Force an unrelated window before measuring immediate seek reconstruction.
        store.get_window(store.start, store.start)
        session.command({'type': 'seek', 'second': second})
        frame, ms = timed(lambda: build_frame(store, session)); seek_ms.append(ms)
    session.command({'type': 'seek', 'second': min(last, 300)})
    frame = build_frame(store, session)
    cached_ms = [timed(lambda: build_frame(store, session))[1] for _ in range(12)]
    exact_ms = [timed(lambda: store.get_window(max(store.start, store.start + timedelta(seconds=min(last,300)-59)),
                                             store.start + timedelta(seconds=min(last,300))))[1] for _ in range(12)]
    sequential_ms = []
    for second in range(301, min(last, 320) + 1):
        session.command({'type': 'seek', 'second': second})
        _, ms = timed(lambda: build_frame(store, session)); sequential_ms.append(ms)
    encode = lambda: json.dumps(frame, separators=(',', ':'), ensure_ascii=False).encode()
    payload, _ = timed(encode)
    json_ms = [timed(encode)[1] for _ in range(12)]
    connects = []
    for _ in range(12):
        def connect():
            with store._connection() as c: c.execute('SELECT 1').fetchone()
        connects.append(timed(connect)[1])
    end = store.start + timedelta(seconds=min(last, 1000)); start = max(store.start, end - timedelta(seconds=59))
    with store._connection() as c:
        plan = c.execute('EXPLAIN ANALYZE ' + window_sql(), [str(record.parquet), start, end, metadata['accepted_row_count']+1]).fetchall()
        groups = c.execute("SELECT row_group_id, row_group_num_rows, stats_min, stats_max FROM parquet_metadata(?) WHERE path_in_schema='timestamp'", [str(record.parquet)]).fetchall()
        parquet_rows = c.execute('SELECT count(*) FROM read_parquet(?)', [str(record.parquet)]).fetchone()[0]
    (run / 'query-plan.txt').write_text('\n'.join(str(r) for r in plan))
    # Sample original-data frame parity, including actual gaps and backward seeks.
    if case == 'original':
        memory = MemoryTrackStore(load_dataset(source))
        for second in targets:
            session.command({'type': 'seek', 'second': second})
            actual, expected = build_frame(store, session), build_frame(memory, session)
            actual.pop('dataset_id'); expected.pop('dataset_id'); assert actual == expected
    else:
        # Independent, full typed source/Parquet comparison, including physical line provenance.
        with TemporaryDirectory(prefix='.parity-', dir=run) as temporary, duckdb.connect(
                str(Path(temporary) / 'verify.duckdb'), config={'threads': 1, 'memory_limit': '128MB',
                    'temp_directory': str(Path(temporary) / 'spill'), 'preserve_insertion_order': False}) as c:
            c.execute("""CREATE TABLE expected AS SELECT *,
                date_diff('second', TIMESTAMPTZ '2025-01-01T00:00:00Z', timestamp) * ? +
                CAST(substr(track_id, 2) AS BIGINT) + 2 AS source_line
                FROM read_csv(?, header=true, auto_detect=false, columns={
                    'track_id':'VARCHAR','timestamp':'TIMESTAMPTZ','lat':'DOUBLE','lon':'DOUBLE',
                    'speed_knots':'DOUBLE','heading':'DOUBLE'})""",
                [vessels, str(source)])
            for left, right in [('expected', 'read_parquet(?)'), ('read_parquet(?)', 'expected')]:
                assert c.execute(f'SELECT count(*) FROM (SELECT * FROM {left} EXCEPT ALL SELECT * FROM {right})',
                                 [str(record.parquet)]).fetchone()[0] == 0
        assert metadata['accepted_row_count'] == rows and metadata['vessel_count'] == vessels
        assert len(frame['vessels']) == vessels and all(len(v['trail_segments'][0]) == 60 for v in frame['vessels'])
    assert parquet_rows == metadata['accepted_row_count'] and not list(root.glob('.import-*'))
    result = dict(case=case, repeat=repeat, source_rows=metadata['validation']['source_row_count'],
        accepted_rows=metadata['accepted_row_count'], vessels=vessels, csv_bytes=source.stat().st_size,
        input_sha256=hashlib.sha256(source.read_bytes()).hexdigest(), import_ms=import_ms,
        import_peak_rss_mib=import_hwm, all_phases_peak_rss_mib=hwm(),
        sampled_staging_peak_bytes=peaks[0], sampled_staging_allocated_peak_bytes=peaks[1],
        parquet_bytes=record.parquet.stat().st_size, opening_ms=opening_ms, first_frame_ms=first_ms,
        requested_window_ms=query_ms, seek_ms=seek_ms, cached_frame_ms=cached_ms,
        exact_cache_ms=exact_ms, sequential_frame_ms=sequential_ms, json_ms=json_ms,
        connection_ms=connects, payload_bytes=len(payload), row_groups=groups,
        dataset_id=store.dataset_id, parquet=str(record.parquet),
        cache_observations=len(store._cache))
    (run / 'result.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scratch', type=Path, required=True)
    parser.add_argument('--label', required=True)
    parser.add_argument('--repeats', type=int, default=3)
    parser.add_argument('--worker', choices=CASES)
    parser.add_argument('--repeat', type=int, default=0)
    args = parser.parse_args()
    scratch = args.scratch.resolve()
    if scratch == REPO or REPO in scratch.parents or scratch == Path('/'):
        parser.error('Use a dedicated scratch directory outside the repository/application volume')
    if not args.label.isidentifier() or not 1 <= args.repeats <= 10:
        parser.error('Use an identifier label and 1–10 repeats')
    if args.worker:
        worker(scratch, args.label, args.worker, args.repeat); return
    results = []
    for case in CASES:
        for repeat in range(args.repeats):
            process = subprocess.run([sys.executable, str(Path(__file__).resolve()), '--scratch', str(scratch),
                '--label', args.label, '--worker', case, '--repeat', str(repeat)], check=False, capture_output=True, text=True)
            if process.returncode:
                print(process.stderr, file=sys.stderr)
                process.check_returncode()
            result = json.loads(process.stdout); results.append(result)
            print(json.dumps({k: result[k] for k in ['case','repeat','import_ms','opening_ms','payload_bytes']}), flush=True)
    summary = dict(label=args.label, python=sys.version, duckdb=duckdb.__version__, platform=platform.platform(),
                   repeats=args.repeats, conditions='Serial fresh workers; normal filesystem cache, no OS cache eviction; 20ms visible staging samples; import excludes HTTP/Nginx spools', results=results)
    (scratch / args.label / 'results.json').write_text(json.dumps(summary, indent=2))


if __name__ == '__main__': main()
