import asyncio
import csv
import io
import threading
from datetime import timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import duckdb
import httpx
import pytest

import app.datasets as uploads
from app.main import create_app
from app.storage import normalized_rows, read_parquet
from app.ingestion import load_dataset
from app.replay import ReplaySession, build_frame
from app.track_store import ParquetTrackStore
from test_ingestion import SOURCE, START, row, write_csv
from test_replay import FakeClock


def synthetic(path: Path, rows: int, target_bytes=None):
    # Generator/writer never constructs a complete recording in Python memory.
    base_size = 48 + 32 * rows
    padding, extra = divmod((target_bytes or base_size) - base_size, rows)
    assert padding >= 0
    with path.open('w', newline='') as output:
        writer = csv.writer(output)
        writer.writerow(['track_id', 'timestamp', 'lat', 'lon', 'speed_knots', 'heading'])
        for i in range(rows):
            timestamp = (START + timedelta(seconds=i)).isoformat().replace('+00:00', 'Z')
            writer.writerow(['A', timestamp, '1' + ' ' * (padding + (i < extra)), 2, 3, 0])
    assert path.stat().st_size == (target_bytes or base_size)
    return path


@pytest.mark.parametrize('rows', [100_000, 500_000, 1_000_000])
def test_large_recordings_preserve_every_value_and_replay_boundaries(tmp_path, rows):
    source = synthetic(tmp_path / 'source.csv', rows)
    root = tmp_path / 'uploads'
    with source.open('rb') as file:
        metadata = uploads.import_dataset(file, 'large.csv', root, ZoneInfo('UTC'))
    assert metadata['validation']['source_row_count'] == metadata['accepted_row_count'] == rows
    assert metadata['duration_seconds'] == rows and metadata['validation']['gap_count'] == 0
    record = uploads.lookup_dataset(root, metadata['dataset_id'])
    with duckdb.connect() as connection:
        count, bad = connection.execute('''
          SELECT count(*), count(*) FILTER (WHERE track_id != 'A' OR lat != 1 OR lon != 2
            OR speed_knots != 3 OR heading != 0 OR source_line < 2
            OR timestamp != ? + (source_line - 2) * INTERVAL '1 second') FROM read_parquet(?)
        ''', [START, str(record.parquet)]).fetchone()
        assert count == rows and bad == 0
    store = ParquetTrackStore(record)
    session = ReplaySession(rows, FakeClock())
    for second in [600, 20, rows - 1, 0]:
        session.command({'type': 'seek', 'second': second})
        frame = build_frame(store, session)
        assert frame['second'] == second and frame['vessels'][0]['lat'] == 1
        assert len(frame['vessels'][0]['trail_segments'][0]) == min(60, second + 1)
    assert sorted(p.name for p in record.parquet.parent.iterdir()) == ['metadata.json', 'observations.parquet']


def test_one_million_and_one_rows_rejected_without_publication(tmp_path):
    source = synthetic(tmp_path / 'source.csv', 1_000_001)
    with source.open('rb') as file, pytest.raises(uploads.DatasetLimitError, match='1000000 source rows'):
        uploads.import_dataset(file, 'too-many.csv', tmp_path / 'uploads', ZoneInfo('UTC'))
    assert not list((tmp_path / 'uploads').iterdir())


def test_exact_fifty_mib_file_accepted_and_next_byte_rejected(tmp_path):
    source = synthetic(tmp_path / 'boundary.csv', 100_000, uploads.MAX_UPLOAD_BYTES)
    with source.open('rb') as file:
        metadata = uploads.import_dataset(file, source.name, tmp_path / 'uploads', ZoneInfo('UTC'))
    assert metadata['accepted_row_count'] == 100_000
    with source.open('ab') as file: file.write(b' ')
    with source.open('rb') as file, pytest.raises(uploads.DatasetLimitError, match='byte upload limit'):
        uploads.import_dataset(file, source.name, tmp_path / 'uploads', ZoneInfo('UTC'))
    assert [p.name for p in (tmp_path / 'uploads').iterdir()] == [metadata['dataset_id']]


@pytest.mark.parametrize('fetch_rows', [1, 3, 1024])
def test_conflict_sequences_and_exact_copies_cross_batches(tmp_path, monkeypatch, fetch_rows):
    monkeypatch.setattr('app.upload_normalization.FETCH_ROWS', fetch_rows)
    rows = [row(i) for i in range(2100)]
    rows += [row(i, lon=81) for i in range(1010, 1050)] + [row(1024, heading=360)]
    # Unsorted input must not decide which path wins.
    source = write_csv(tmp_path, list(reversed(rows)))
    old = load_dataset(source)
    with source.open('rb') as file:
        metadata = uploads.import_dataset(file, source.name, tmp_path / 'uploads', ZoneInfo('UTC'))
    stored = read_parquet(tmp_path / 'uploads' / metadata['dataset_id'] / 'observations.parquet')
    assert stored == normalized_rows(old)
    assert [r[-1] for r in stored] == [r[-1] for r in normalized_rows(old)]
    assert metadata['validation']['conflicting_duplicate_rows'] == 40
    assert metadata['validation']['exact_duplicate_rows'] == 1


def test_bounded_source_reads_and_physical_csv_error_lines(tmp_path):
    class Guarded(io.BytesIO):
        def read(self, size=-1):
            assert 0 < size <= 64 * 1024
            return super().read(size)
    source = write_csv(tmp_path, [row(lat='1\n'), row(1, speed='bad')])
    with pytest.raises(ValueError, match='CSV line 4: speed_knots'):
        uploads.import_dataset(Guarded(source.read_bytes()), 'bad.csv', tmp_path / 'uploads', ZoneInfo('UTC'))
    assert not list((tmp_path / 'uploads').iterdir())


def test_configured_limits_are_exposed_and_enforced_while_streaming(tmp_path, monkeypatch):
    content = write_csv(tmp_path, [row()]).read_bytes()
    monkeypatch.setenv('UPLOAD_ROOT', str(tmp_path / 'uploads'))
    monkeypatch.setenv('UPLOAD_MAX_BYTES', str(len(content)))
    monkeypatch.setenv('UPLOAD_MAX_ROWS', '1')
    app = create_app(SOURCE)
    async def check():
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
                assert (await client.get('/api/upload-limits')).json() == {'max_bytes': len(content), 'max_rows': 1}
                async def stream(extra):
                    yield b'--x\r\nContent-Disposition: form-data; name="file"; filename="a.csv"\r\n\r\n'
                    for start in range(0, len(content), 7): yield content[start:start+7]
                    if extra: yield b' '
                    yield b'\r\n--x--\r\n'
                headers = {'content-type': 'multipart/form-data; boundary=x'}
                assert (await client.post('/api/datasets', content=stream(True), headers=headers)).status_code == 413
                assert not (tmp_path / 'uploads').exists()
                assert (await client.post('/api/datasets', content=stream(False), headers=headers)).status_code == 201
    asyncio.run(check())


def test_cancelled_worker_finishes_cleanup_before_unlocking_and_closing_spool(tmp_path, monkeypatch):
    started = threading.Event()
    def blocked(*args):
        check_cancel = args[-1]
        started.set()
        for _ in range(1000):
            check_cancel()
            threading.Event().wait(.005)
        raise AssertionError('cancellation was not observed')
    monkeypatch.setattr(uploads, 'normalize_upload', blocked)
    monkeypatch.setenv('UPLOAD_ROOT', str(tmp_path / 'uploads'))
    app = create_app(SOURCE)
    content = write_csv(tmp_path, [row()]).read_bytes()
    async def check():
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
                task = asyncio.create_task(client.post('/api/datasets', files={'file': ('a.csv', content)}))
                assert await asyncio.to_thread(started.wait, 3)
                assert app.state.upload_lock.locked()
                task.cancel()
                with pytest.raises(asyncio.CancelledError): await task
                assert not app.state.upload_lock.locked() and not list((tmp_path / 'uploads').iterdir())
    asyncio.run(check())


def test_cancelled_multipart_parse_closes_spools(tmp_path, monkeypatch):
    import starlette.formparsers as parsers
    files = []
    original = parsers.SpooledTemporaryFile
    def tracked(*args, **kwargs):
        file = original(*args, **kwargs); files.append(file); return file
    monkeypatch.setattr(parsers, 'SpooledTemporaryFile', tracked)
    monkeypatch.setenv('UPLOAD_ROOT', str(tmp_path / 'uploads'))
    app = create_app(SOURCE)
    async def check():
        began, never = asyncio.Event(), asyncio.Event()
        async def chunks():
            yield b'--x\r\nContent-Disposition: form-data; name="file"; filename="a.csv"\r\n\r\ncontent'
            began.set(); await never.wait()
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
                task = asyncio.create_task(client.post('/api/datasets', content=chunks(), headers={'content-type': 'multipart/form-data; boundary=x'}))
                await began.wait(); task.cancel()
                with pytest.raises(asyncio.CancelledError): await task
                assert files and all(f.closed for f in files) and not app.state.upload_lock.locked()
    asyncio.run(check())


def test_disconnect_after_body_cancels_processing_and_cleans_staging(tmp_path, monkeypatch):
    started = threading.Event()
    def blocked(*args):
        started.set()
        for _ in range(1000):
            args[-1]()
            threading.Event().wait(.005)
        raise AssertionError('Disconnect was not observed')
    monkeypatch.setattr(uploads, 'normalize_upload', blocked)
    monkeypatch.setenv('UPLOAD_ROOT', str(tmp_path / 'uploads'))
    app = create_app(SOURCE)
    content = write_csv(tmp_path, [row()]).read_bytes()
    body = b'--x\r\nContent-Disposition: form-data; name="file"; filename="a.csv"\r\n\r\n' + content + b'\r\n--x--\r\n'
    async def check():
        incoming, outgoing = asyncio.Queue(), []
        async def send(message): outgoing.append(message)
        scope = {'type': 'http', 'asgi': {'version': '3.0'}, 'http_version': '1.1',
                 'method': 'POST', 'scheme': 'http', 'path': '/api/datasets', 'raw_path': b'/api/datasets',
                 'root_path': '', 'query_string': b'', 'server': ('test', 80), 'client': ('test', 1),
                 'headers': [(b'content-type', b'multipart/form-data; boundary=x')]}
        async with app.router.lifespan_context(app):
            task = asyncio.create_task(app(scope, incoming.get, send))
            await incoming.put({'type': 'http.request', 'body': body, 'more_body': False})
            assert await asyncio.to_thread(started.wait, 3)
            await incoming.put({'type': 'http.disconnect'})
            await asyncio.wait_for(task, 3)
            assert outgoing[0]['status'] == 400
            assert not list((tmp_path / 'uploads').iterdir()) and not app.state.upload_lock.locked()
    asyncio.run(check())
