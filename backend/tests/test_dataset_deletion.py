import asyncio
import os
import threading

import httpx
import pytest

import app.dataset_lifecycle as lifecycle
from app.main import create_app
from test_catalog import library, run, upload
from test_ingestion import SOURCE, row, write_csv
from test_replay_socket import SocketClient
from test_track_store import SelectedClient, recording


def test_delete_exact_id_preserves_duplicate_filename_and_builtin(library, tmp_path):
    content = write_csv(tmp_path, [row()]).read_bytes()

    async def check(client):
        first, second = await upload(client, content), await upload(client, content)
        keep = library[0] / second['dataset_id'] / 'observations.parquet'
        before = keep.read_bytes()
        url = '/api/datasets/' + first['dataset_id']
        result = await client.delete(url)
        assert result.status_code == 200 and result.json() == {'dataset_id': first['dataset_id'], 'deleted': True}
        assert not (library[0] / first['dataset_id']).exists()
        assert keep.read_bytes() == before
        assert [m['dataset_id'] for m in (await client.get('/api/datasets')).json()] == [second['dataset_id']]
        for suffix in ['', '/preview']:
            assert (await client.get(url + suffix)).status_code == 404
        assert (await client.delete(url)).status_code == 404
        assert not list(library[0].glob('.delete-*'))
        assert (await client.get('/api/meta')).json()['record_count'] == 35780

    run(library, check)
    # Reopening the application re-discovers disk, rather than restoring a registry.
    async def restart(client):
        assert len((await client.get('/api/datasets')).json()) == 1
    run((library[0], create_app(SOURCE)), restart)


@pytest.mark.parametrize('dataset_id,status', [('builtin', 403), ('a' * 32, 404), ('bad', 422),
                                            ('A' * 32, 422), ('a' * 31, 422), ('%2e%2e%2ftracks.csv', 404)])
def test_protected_unknown_and_invalid_ids(library, dataset_id, status):
    async def check(client):
        response = await client.delete('/api/datasets/' + dataset_id)
        assert response.status_code == status and str(library[0]) not in response.text
        assert (await client.get('/api/meta')).json()['record_count'] == 35780
    run(library, check)


@pytest.mark.parametrize('damage', ['missing', 'corrupt', 'symlink_file', 'symlink_directory', 'unexpected_child'])
def test_untrusted_layout_is_never_deleted(library, tmp_path, damage):
    async def check(client):
        meta = await upload(client, write_csv(tmp_path, [row()]).read_bytes())
        directory = library[0] / meta['dataset_id']
        metadata = directory / 'metadata.json'
        outside = tmp_path / 'outside'
        if damage == 'missing': metadata.unlink()
        elif damage == 'corrupt': metadata.write_text('invalid')
        elif damage == 'symlink_file':
            metadata.rename(outside)
            metadata.symlink_to(outside)
        elif damage == 'symlink_directory':
            directory.rename(outside)
            directory.symlink_to(outside, target_is_directory=True)
        else:
            (directory / 'unrelated.txt').write_text('keep')
        before = {p.relative_to(tmp_path): p.read_bytes() for p in tmp_path.rglob('*') if p.is_file()}
        result = await client.delete('/api/datasets/' + meta['dataset_id'])
        assert result.status_code == (500 if damage == 'unexpected_child' else 404)
        assert str(tmp_path) not in result.text
        assert {p.relative_to(tmp_path): p.read_bytes() for p in tmp_path.rglob('*') if p.is_file()} == before
    run(library, check)


@pytest.mark.parametrize('stage', ['rename', 'parquet', 'metadata', 'rmdir'])
def test_partial_failure_is_hidden_and_recoverable(library, tmp_path, monkeypatch, stage):
    async def check(client):
        meta = await upload(client, write_csv(tmp_path, [row()]).read_bytes())
        rename, unlink, rmdir = os.rename, os.unlink, os.rmdir
        def fail_rename(*args, **kwargs):
            raise PermissionError('/private/internal/path')
        def fail_unlink(path, *args, **kwargs):
            if path == ('observations.parquet' if stage == 'parquet' else 'metadata.json'):
                raise PermissionError('/private/internal/path')
            return unlink(path, *args, **kwargs)
        def fail_rmdir(path, *args, **kwargs):
            if str(path).startswith('.delete-'):
                raise PermissionError('/private/internal/path')
            return rmdir(path, *args, **kwargs)
        with monkeypatch.context() as patch:
            if stage == 'rename': patch.setattr(lifecycle.os, 'rename', fail_rename)
            elif stage == 'rmdir': patch.setattr(lifecycle.os, 'rmdir', fail_rmdir)
            else: patch.setattr(lifecycle.os, 'unlink', fail_unlink)
            result = await client.delete('/api/datasets/' + meta['dataset_id'])
        assert result.status_code == 500 and '/private' not in result.text
        listed = (await client.get('/api/datasets')).json()
        if stage == 'rename':
            assert len(listed) == 1 and not list(library[0].glob('.delete-*'))
            assert (await client.delete('/api/datasets/' + meta['dataset_id'])).status_code == 200
        else:
            assert result.json()['removed_from_library'] is True and listed == []
            hidden = list(library[0].glob('.delete-*'))
            assert len(hidden) == 1 and not (library[0] / meta['dataset_id']).exists()
            assert (await client.delete('/api/datasets/' + meta['dataset_id'])).status_code == 404
            # Explicit recovery only in temporary test storage; never restore to catalog.
            for file in hidden[0].iterdir(): file.unlink()
            hidden[0].rmdir()
        assert not library[1].state.dataset_lifecycle.deleting
    run(library, check)


def test_multiple_paused_sessions_disconnect_switch_and_other_dataset_isolation(tmp_path, monkeypatch):
    root, first, _, _ = recording(tmp_path)
    _, second, _, _ = recording(tmp_path, [row()], 'same.csv')
    monkeypatch.setenv('UPLOAD_ROOT', str(root))
    app = create_app(SOURCE)

    async def check():
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
                url = '/api/datasets/' + first['dataset_id']
                async with SelectedClient(app, second['dataset_id']) as other:
                    await other.receive()
                    one = await SelectedClient(app, first['dataset_id']).__aenter__()
                    two = await SelectedClient(app, first['dataset_id']).__aenter__()
                    assert not (await one.receive())['playing'] and not (await two.receive())['playing']
                    assert (await client.delete(url)).status_code == 409
                    await one.__aexit__()
                    assert (await client.delete(url)).status_code == 409
                    await two.__aexit__()
                    async with SocketClient(app) as builtin:
                        assert (await builtin.receive())['dataset_id'] == 'builtin'
                        assert (await client.delete(url)).status_code == 200
                        await builtin.send({'type': 'seek', 'second': 640})
                        assert (await builtin.receive())['second'] == 640
                    await other.send({'type': 'reset'})
                    assert (await other.receive())['dataset_id'] == second['dataset_id']
                    assert (await client.delete('/api/datasets/' + second['dataset_id'])).status_code == 409
                assert not app.state.dataset_lifecycle.references
    asyncio.run(check())


@pytest.mark.parametrize('failure', ['cancel', 'corrupt', 'send'])
def test_failed_and_cancelled_sessions_release_references(tmp_path, monkeypatch, failure):
    root, meta, _, store = recording(tmp_path)
    monkeypatch.setenv('UPLOAD_ROOT', str(root))
    app = create_app(SOURCE)
    if failure == 'corrupt': store.parquet.write_bytes(b'bad parquet')

    async def check():
        async with app.router.lifespan_context(app):
            client = SelectedClient(app, meta['dataset_id'])
            if failure == 'send':
                async def broken(event):
                    if event['type'] == 'websocket.send': raise OSError('client gone')
                    await original(event)
                original = client.outgoing.put
                client.outgoing.put = broken
            await client.__aenter__()
            if failure == 'cancel':
                await client.receive()
                client.task.cancel()
                with pytest.raises(asyncio.CancelledError): await client.task
            else:
                await asyncio.wait_for(client.task, timeout=3)
            assert not app.state.dataset_lifecycle.references
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as http:
                assert (await http.delete('/api/datasets/' + meta['dataset_id'])).status_code == 200
    asyncio.run(check())


@pytest.mark.parametrize('cancel_http', [False, True])
def test_delete_reservation_blocks_open_and_duplicate_delete_until_worker_finishes(tmp_path, monkeypatch, cancel_http):
    root, meta, _, _ = recording(tmp_path)
    monkeypatch.setenv('UPLOAD_ROOT', str(root))
    app = create_app(SOURCE)
    started, release = threading.Event(), threading.Event()
    original = lifecycle.delete_stored_dataset
    def blocked(*args):
        started.set()
        assert release.wait(5)
        original(*args)
    monkeypatch.setattr(lifecycle, 'delete_stored_dataset', blocked)

    async def check():
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as http:
                url = '/api/datasets/' + meta['dataset_id']
                deleting = asyncio.create_task(http.delete(url))
                try:
                    assert await asyncio.to_thread(started.wait, 2)
                    if cancel_http:
                        deleting.cancel()
                        with pytest.raises(asyncio.CancelledError): await deleting
                    assert (await http.delete(url)).status_code == 409
                    rejected = await SelectedClient(app, meta['dataset_id']).__aenter__()
                    assert (await rejected.receive())['type'] == 'error'
                    await rejected.task
                    assert not app.state.dataset_lifecycle.references
                    assert meta['dataset_id'] in app.state.dataset_lifecycle.deleting
                finally:
                    release.set()
                if not cancel_http: assert (await deleting).status_code == 200
                await app.state.dataset_lifecycle.finish_pending()
                assert not app.state.dataset_lifecycle.deleting
                assert (await http.get('/api/datasets')).json() == []
    asyncio.run(check())


@pytest.mark.parametrize('cancel_open', [False, True])
def test_opening_session_reserves_before_store_initialization_and_releases_on_failure(tmp_path, monkeypatch, cancel_open):
    import app.main as main
    root, meta, _, _ = recording(tmp_path)
    monkeypatch.setenv('UPLOAD_ROOT', str(root))
    app = create_app(SOURCE)
    started, release = threading.Event(), threading.Event()

    def blocked(*args):
        started.set()
        assert release.wait(5)
        raise ValueError('constructor failed')

    monkeypatch.setattr(main, 'select_track_store', blocked)

    async def check():
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as http:
                client = SelectedClient(app, meta['dataset_id'])
                opening = asyncio.create_task(client.__aenter__())
                try:
                    assert await asyncio.to_thread(started.wait, 2)
                    assert app.state.dataset_lifecycle.references == {meta['dataset_id']: 1}
                    assert (await http.delete('/api/datasets/' + meta['dataset_id'])).status_code == 409
                    if cancel_open:
                        client.task.cancel()
                        with pytest.raises(asyncio.CancelledError): await client.task
                        opening.cancel()
                        with pytest.raises(asyncio.CancelledError): await opening
                finally:
                    release.set()
                if not cancel_open:
                    await opening
                    assert (await client.receive())['type'] == 'error'
                    await client.task
                assert not app.state.dataset_lifecycle.references
                assert (await http.delete('/api/datasets/' + meta['dataset_id'])).status_code == 200
    asyncio.run(check())
