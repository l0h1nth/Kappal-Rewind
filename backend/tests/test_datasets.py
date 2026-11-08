import asyncio
import json
from datetime import datetime, timezone

import httpx
import pytest

import app.datasets as uploads
from app.ingestion import load_dataset
from app.main import create_app
from app.storage import normalized_rows, read_parquet
from test_ingestion import SOURCE, row, write_csv


@pytest.fixture
def environment(tmp_path, monkeypatch):
    root = tmp_path / 'uploads'
    monkeypatch.setenv('UPLOAD_ROOT', str(root))
    monkeypatch.setenv('UPLOAD_NAIVE_TIMEZONE', 'Asia/Kolkata')
    return create_app(SOURCE), root


def request(environment, content, filename='recording.csv'):
    app, _ = environment
    async def check():
        async with app.router.lifespan_context(app):
            original = app.state.dataset
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
                before = (await client.get('/api/meta')).json()
                response = await client.post('/api/datasets', files={'file': (filename, content, 'text/csv')})
                assert (await client.get('/api/meta')).json() == before
                assert app.state.dataset is original
                return response
    return asyncio.run(check())


def tiny_csv(tmp_path):
    return write_csv(tmp_path, [row(0, vessel='CUSTOM', heading=360), row(2, vessel='CUSTOM')]).read_bytes()


def test_original_upload_full_parquet_equality_and_metadata(environment):
    response = request(environment, SOURCE.read_bytes())
    assert response.status_code == 201, response.text
    body = response.json()
    assert body['accepted_row_count'] == 35780 and body['vessel_count'] == 20 and body['duration_seconds'] == 1800
    summary = body['validation']
    assert (summary['source_row_count'], summary['discarded_row_count']) == (35820, 40)
    assert summary['conflicting_duplicate_rows'] == 40 and summary['heading_normalizations'] == 11
    assert summary['missing_observation_seconds'] == 220 and summary['gap_count'] == 2
    assert summary['naive_timestamp_rows'] == 17960 and summary['offset_timestamp_rows'] == 17860
    stored = environment[1] / body['dataset_id']
    assert sorted(p.name for p in stored.iterdir()) == ['metadata.json', 'observations.parquet']
    assert json.loads((stored / 'metadata.json').read_text()) == body
    assert read_parquet(stored / 'observations.parquet') == normalized_rows(load_dataset(SOURCE))


def test_arbitrary_recording_duplicates_gaps_and_timezone(environment, tmp_path, monkeypatch):
    monkeypatch.setenv('UPLOAD_NAIVE_TIMEZONE', 'UTC')
    rows = [row(0, vessel='SHIP-X', heading=360), row(0, vessel='SHIP-X', heading=0), row(2, vessel='SHIP-X')]
    rows[0][1], rows[1][1], rows[2][1] = '2025-04-10 12:00:00', '2025-04-10T14:00:00+02:00', '2025-04-10T12:00:02Z'
    response = request(environment, write_csv(tmp_path, rows).read_bytes())
    assert response.status_code == 201, response.text
    body = response.json()
    assert body['vessel_count'] == 1 and body['duration_seconds'] == 3 and body['accepted_row_count'] == 2
    assert body['start'] == '2025-04-10T12:00:00+00:00'
    assert body['validation']['naive_timezone'] == 'UTC' and body['validation']['exact_duplicate_rows'] == 1
    assert body['validation']['missing_observation_seconds'] == 1
    stored = read_parquet(environment[1] / body['dataset_id'] / 'observations.parquet')
    assert stored[0][:2] == ('SHIP-X', datetime(2025, 4, 10, 12, tzinfo=timezone.utc))
    assert stored[0][5] == 0


@pytest.mark.parametrize('body,name,status,detail', [
    (b'wrong,header\n', 'bad.csv', 422, 'columns'), (b'\xff', 'bad.csv', 422, 'UTF-8'),
    (b'', 'empty.csv', 422, 'empty'), (b'hello', 'photo.png', 415, '.csv'),
])
def test_reject_invalid_upload_without_files(environment, body, name, status, detail):
    response = request(environment, body, name)
    assert response.status_code == status and detail in response.json()['detail']
    assert not environment[1].exists() or not list(environment[1].iterdir())


@pytest.mark.parametrize('index,value', [(2, 'NaN'), (3, 181), (4, -1), (5, 361), (1, 'bad'), (0, '')])
def test_invalid_cells_clean_up(environment, tmp_path, index, value):
    bad = row()
    bad[index] = value
    response = request(environment, write_csv(tmp_path, [bad]).read_bytes())
    assert response.status_code == 422 and 'CSV line 2' in response.json()['detail']
    assert not list(environment[1].iterdir())


def test_duplicate_filenames_use_unique_server_paths(environment, tmp_path):
    content = tiny_csv(tmp_path)
    first, second = (request(environment, content, '../../same.csv').json() for _ in range(2))
    assert first['dataset_id'] != second['dataset_id']
    assert first['original_filename'] == second['original_filename'] == 'same.csv'
    assert {p.name for p in environment[1].iterdir()} == {first['dataset_id'], second['dataset_id']}


@pytest.mark.parametrize('failure', ['write', 'verify', 'metadata', 'publish'])
def test_storage_failures_never_publish_partial_data(environment, tmp_path, monkeypatch, failure):
    def fail(*args, **kwargs):
        raise OSError('private/internal/path')
    if failure == 'write':
        monkeypatch.setattr('app.upload_normalization.canonical_relation', fail)
    elif failure == 'verify':
        from app.upload_normalization import verify_parquet
        def corrupt_and_verify(connection, path):
            connection.sql('SELECT * FROM accepted LIMIT 0').write_parquet(str(path))
            verify_parquet(connection, path)
        monkeypatch.setattr('app.upload_normalization.verify_parquet', corrupt_and_verify)
    elif failure == 'metadata':
        monkeypatch.setattr(uploads.Path, 'write_text', fail)
    else:
        monkeypatch.setattr(uploads.Path, 'rename', fail)
    response = request(environment, tiny_csv(tmp_path))
    assert response.status_code == 500 and 'private' not in response.text
    assert not list(environment[1].iterdir())


def test_file_and_row_limits_clean_up(environment, tmp_path, monkeypatch):
    content = tiny_csv(tmp_path)
    monkeypatch.setattr(uploads, 'MAX_UPLOAD_BYTES', len(content) - 1)
    assert request(environment, content).status_code == 413 and not environment[1].exists()
    monkeypatch.setattr(uploads, 'MAX_UPLOAD_BYTES', len(content))
    monkeypatch.setattr(uploads, 'MAX_SOURCE_ROWS', 1)
    assert request(environment, content).status_code == 413 and not list(environment[1].iterdir())
    monkeypatch.setattr(uploads, 'MAX_SOURCE_ROWS', 2)
    assert request(environment, content).status_code == 201


def test_conflict_work_limit_and_unanchored_conflict(environment, tmp_path, monkeypatch):
    rows = [row(0), row(1), row(1, lon=81), row(2), row(2, lon=81), row(3)]
    monkeypatch.setattr(uploads, 'MAX_CONFLICT_CANDIDATES', 3)
    response = request(environment, write_csv(tmp_path, rows).read_bytes())
    assert response.status_code == 413 and 'candidates' in response.text and not list(environment[1].iterdir())
    monkeypatch.setattr(uploads, 'MAX_CONFLICT_CANDIDATES', 256)
    response = request(environment, write_csv(tmp_path, [row(0), row(0, lon=81)]).read_bytes())
    assert response.status_code == 422 and 'both sides' in response.text and not list(environment[1].iterdir())


@pytest.mark.parametrize('stamp', ['2026-11-01 01:30:00', '2026-03-08 02:30:00'])
def test_dst_naive_times_require_offset(environment, tmp_path, monkeypatch, stamp):
    monkeypatch.setenv('UPLOAD_NAIVE_TIMEZONE', 'America/New_York')
    data = row()
    data[1] = stamp
    response = request(environment, write_csv(tmp_path, [data]).read_bytes())
    assert response.status_code == 422 and 'explicit offset' in response.text and not list(environment[1].iterdir())
    data[1] = stamp.replace(' ', 'T') + '-05:00'
    assert request(environment, write_csv(tmp_path, [data]).read_bytes()).status_code == 201


@pytest.mark.parametrize('stamp', ['0001-01-01T00:00:00Z', '9999-12-31T23:59:59Z'])
def test_boundary_dates_do_not_overflow_gaps(environment, tmp_path, stamp):
    data = row()
    data[1] = stamp
    response = request(environment, write_csv(tmp_path, [data]).read_bytes())
    assert response.status_code == 201, response.text
    assert response.json()['validation']['missing_observation_seconds'] == 0


def test_multipart_validation_request_limit_and_busy_import(environment, tmp_path, monkeypatch):
    app, root = environment
    content = tiny_csv(tmp_path)
    monkeypatch.setattr('app.main.MAX_REQUEST_BYTES', 1024)
    # Middleware is configured at create_app time; retain the same test upload root.
    app = create_app(SOURCE)
    async def check():
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
                assert (await client.post('/api/datasets', content=b'not multipart')).status_code == 415
                assert (await client.post('/api/datasets', files={'other': ('a.csv', content)})).status_code == 422
                assert (await client.post('/api/datasets', files=[('file', ('a.csv', content)), ('file', ('b.csv', content))])).status_code == 400
                assert (await client.post('/api/datasets', content=b'broken', headers={'content-type': 'multipart/form-data'})).status_code == 400
                assert (await client.post('/api/datasets', files={'file': ('a.csv', b'x' * 1025)})).status_code == 413
                async def chunks():
                    yield b'--x\r\nContent-Disposition: form-data; name="file"; filename="a.csv"\r\n\r\n'
                    yield b'x' * 1025
                    yield b'\r\n--x--\r\n'
                response = await client.post('/api/datasets', content=chunks(), headers={'content-type': 'multipart/form-data; boundary=x'})
                assert response.status_code == 413  # No Content-Length to trust.
                async with app.state.upload_lock:
                    assert (await client.post('/api/datasets', files={'file': ('a.csv', content)})).status_code == 409
                assert (await client.post('/api/datasets', files={'file': ('a.csv', content)})).status_code == 201
                assert len(list(root.iterdir())) == 1
    asyncio.run(check())


def test_truncated_envelope_after_complete_csv_is_rejected_and_spools_close(environment, tmp_path, monkeypatch):
    import starlette.formparsers as parsers
    files = []
    original = parsers.SpooledTemporaryFile
    def tracked(*args, **kwargs):
        file = original(*args, **kwargs)
        files.append(file)
        return file
    monkeypatch.setattr(parsers, 'SpooledTemporaryFile', tracked)
    app, root = environment
    body = (b'--x\r\nContent-Disposition: form-data; name="file"; filename="a.csv"\r\n\r\n'
            + tiny_csv(tmp_path) + b'\r\n--x\r\n')
    async def check():
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
                response = await client.post('/api/datasets', content=body,
                                             headers={'content-type': 'multipart/form-data; boundary=x'})
                assert response.status_code == 400 and 'Incomplete' in response.text
                assert files and all(file.closed for file in files)
                assert not root.exists()
    asyncio.run(check())
