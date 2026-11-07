import asyncio
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest

import app.catalog as catalog
from app.main import create_app
from app.storage import read_parquet
from test_ingestion import SOURCE, row, write_csv


@pytest.fixture
def library(tmp_path, monkeypatch):
    root = tmp_path / 'uploads'
    monkeypatch.setenv('UPLOAD_ROOT', str(root))
    monkeypatch.setenv('UPLOAD_NAIVE_TIMEZONE', 'Asia/Kolkata')
    return root, create_app(SOURCE)


def run(library, action):
    async def check():
        async with library[1].router.lifespan_context(library[1]):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=library[1]), base_url='http://test') as client:
                return await action(client)
    return asyncio.run(check())


async def upload(client, content, name='same.csv'):
    response = await client.post('/api/datasets', files={'file': (name, content, 'text/csv')})
    assert response.status_code == 201, response.text
    return response.json()


def edit(root, metadata, **changes):
    updated = {**metadata, **changes}
    (root / metadata['dataset_id'] / 'metadata.json').write_text(json.dumps(updated))
    return updated


def test_empty_missing_root_and_failed_import(library):
    async def check(client):
        assert (await client.get('/api/datasets')).json() == []
        assert not library[0].exists()
        assert (await client.post('/api/datasets', files={'file': ('bad.csv', b'bad')})).status_code == 422
        assert (await client.get('/api/datasets')).json() == []
    run(library, check)


def test_multiple_uploads_details_legacy_and_newest_first(library, tmp_path, monkeypatch):
    content = write_csv(tmp_path, [row()]).read_bytes()
    async def check(client):
        first, second, old, offset = [await upload(client, content) for _ in range(4)]
        assert len({m['dataset_id'] for m in [first, second, old, offset]}) == 4
        for metadata in [first, second]:
            edit(library[0], metadata, imported_at='2026-11-07T12:00:00Z')
        # This is 13:00 UTC, despite its earlier-looking wall-clock hour.
        edit(library[0], offset, imported_at='2026-11-07T08:00:00-05:00')
        legacy = dict(old)
        legacy.pop('imported_at')
        edit(library[0], old, **legacy, imported_at=None)
        # Removing the field must be compatible too.
        path = library[0] / old['dataset_id'] / 'metadata.json'
        path.write_text(json.dumps(legacy))
        def no_parquet_read(*args, **kwargs):
            pytest.fail('List/details must not query Parquet observations')
        monkeypatch.setattr('app.storage.duckdb.connect', no_parquet_read)
        listed = (await client.get('/api/datasets')).json()
        assert [m['dataset_id'] for m in listed] == [offset['dataset_id'], *sorted([first['dataset_id'], second['dataset_id']]), old['dataset_id']]
        assert listed[-1]['imported_at'] is None
        assert listed[0]['imported_at'] == '2026-11-07T13:00:00+00:00'
        assert all(m['original_filename'] == 'same.csv' for m in listed)
        detail = (await client.get('/api/datasets/' + first['dataset_id'])).json()
        assert detail == next(m for m in listed if m['dataset_id'] == first['dataset_id'])
        assert detail['validation']['source_row_count'] == detail['accepted_row_count'] == 1
        assert detail['vessel_count'] == 1
        assert datetime.fromisoformat(first['imported_at']).utcoffset() == timedelta(0)
    run(library, check)


def test_preview_order_limits_real_source_values_and_read_only(library, tmp_path):
    rows = [row(second, vessel=vessel, lat=13+second*.001) for second in range(60) for vessel in ['B', 'A']]
    content = write_csv(tmp_path, list(reversed(rows))).read_bytes()
    async def check(client):
        metadata = await upload(client, content)
        url = '/api/datasets/' + metadata['dataset_id'] + '/preview'
        parquet = library[0] / metadata['dataset_id'] / 'observations.parquet'
        original = parquet.read_bytes()
        for limit in [None, 1, 100]:
            response = await client.get(url, params={} if limit is None else {'limit': limit})
            assert response.status_code == 200, response.text
            result = response.json()
            assert result['dataset_id'] == metadata['dataset_id']
            preview = result['rows']
            assert len(preview) == (20 if limit is None else limit)
            assert [(o['timestamp'], o['track_id']) for o in preview] == sorted((o['timestamp'], o['track_id']) for o in preview)
            assert preview[0] == {'track_id':'A','timestamp':'2026-11-02T03:30:00+00:00','lat':13,'lon':80,'speed_knots':1,'heading':0}
            assert set(preview[0]) == {'track_id','timestamp','lat','lon','speed_knots','heading'}
        for invalid in ['0', '-1', '101', '1.5', 'true', 'abc', '1;DROP TABLE x']:
            assert (await client.get(url, params={'limit': invalid})).status_code == 422
        assert parquet.read_bytes() == original
        assert sorted(p.name for p in parquet.parent.iterdir()) == ['metadata.json','observations.parquet']
        # Verify the actual E1 upload against typed full read-back, independent of API output.
        real = await upload(client, SOURCE.read_bytes(), 'tracks.csv')
        preview = (await client.get('/api/datasets/' + real['dataset_id'] + '/preview')).json()['rows']
        expected = sorted(read_parquet(library[0] / real['dataset_id'] / 'observations.parquet'), key=lambda o:(o[1],o[0]))[:20]
        assert preview == [dict(zip(['track_id','timestamp','lat','lon','speed_knots','heading'], [r[0],r[1].isoformat(),*r[2:6]])) for r in expected]
    run(library, check)


@pytest.mark.parametrize('suffix', ['', '/preview'])
def test_unknown_and_invalid_ids(library, suffix):
    async def check(client):
        assert (await client.get('/api/datasets/' + 'a'*32 + suffix)).status_code == 404
        for invalid in ['not-an-id', 'A'*32, 'x'*32, "' OR 1=1", 'a'*31, 'a'*33]:
            response = await client.get('/api/datasets/' + invalid + suffix)
            assert response.status_code == 422
            assert str(library[0]) not in response.text
        assert (await client.get('/api/datasets/%2e%2e%2fetc%2fpasswd' + suffix)).status_code == 404
    run(library, check)


@pytest.mark.parametrize('damage', ['json','missing','oversize','wrong_id','boolean','time','duration','counts','symlink_metadata','symlink_parquet','symlink_directory','missing_parquet','empty_parquet'])
def test_corrupt_incomplete_and_symlink_entries_are_omitted(library, tmp_path, damage):
    async def check(client):
        healthy = await upload(client, write_csv(tmp_path,[row()]).read_bytes(), 'healthy.csv')
        broken = await upload(client, write_csv(tmp_path,[row()]).read_bytes(), 'broken.csv')
        root = library[0]
        directory = root / broken['dataset_id']
        path = directory / 'metadata.json'
        parquet = directory / 'observations.parquet'
        if damage == 'json': path.write_text('{bad')
        elif damage == 'missing': path.unlink()
        elif damage == 'oversize': path.write_text(' ' * (catalog.MAX_METADATA_BYTES + 1))
        elif damage == 'wrong_id': edit(root,broken,dataset_id='0'*32)
        elif damage == 'boolean': edit(root,broken,vessel_count=True)
        elif damage == 'time': edit(root,broken,imported_at='2026-01-01')
        elif damage == 'duration': edit(root,broken,duration_seconds=3)
        elif damage == 'counts': edit(root,broken,accepted_row_count=2)
        elif damage.startswith('symlink_'):
            if damage == 'symlink_directory':
                outside = tmp_path/'outside'; directory.rename(outside); directory.symlink_to(outside,target_is_directory=True)
            else:
                target = path if damage == 'symlink_metadata' else parquet
                outside = tmp_path/target.name; target.rename(outside); target.symlink_to(outside)
        elif damage == 'missing_parquet': parquet.unlink()
        elif damage == 'empty_parquet': parquet.write_bytes(b'')
        staging = root/'.import-incomplete'; staging.mkdir(); (staging/'metadata.json').write_text(json.dumps(healthy))
        response = await client.get('/api/datasets')
        assert response.status_code == 200
        assert [m['dataset_id'] for m in response.json()] == [healthy['dataset_id']]
        assert (await client.get('/api/datasets/'+broken['dataset_id'])).status_code == 404
        assert (await client.get('/api/datasets/'+broken['dataset_id']+'/preview')).status_code == 404
    run(library, check)


def test_extra_metadata_fields_filtered_and_corrupt_parquet_has_generic_error(library, tmp_path):
    async def check(client):
        metadata = await upload(client, write_csv(tmp_path,[row()]).read_bytes())
        edit(library[0], metadata, private_path='/secret/server/path')
        url='/api/datasets/'+metadata['dataset_id']
        assert 'private_path' not in (await client.get(url)).json()
        assert '/secret' not in (await client.get('/api/datasets')).text
        (library[0]/metadata['dataset_id']/'observations.parquet').write_bytes(b'not parquet')
        assert (await client.get(url)).status_code == 200
        error=await client.get(url+'/preview')
        assert error.status_code == 500 and str(library[0]) not in error.text
    run(library, check)


def test_library_root_failure_is_not_misrepresented_as_empty(library):
    library[0].write_text('not a directory')
    async def check(client):
        response=await client.get('/api/datasets')
        assert response.status_code == 503 and str(library[0]) not in response.text
    run(library, check)
