import asyncio
import threading
from datetime import timedelta
from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException

from app.main import create_app
from app.routes import RouteCache, MAX_ROUTE_POINTS, route_geometry
from app.track_store import ParquetTrackStore
from test_ingestion import SOURCE, START, load_dataset, row
from test_track_store import recording


def test_original_routes_exact_endpoints_gaps_and_t007():
    data = load_dataset(SOURCE)
    app = SimpleNamespace(state=SimpleNamespace(dataset=data))
    cache = RouteCache()
    for vessel in ['T007', 'T012', 'T015']:
        result = cache.get(app, 'builtin', vessel)
        expected = sorted(data.observations[vessel].values(), key=lambda o: o.timestamp)
        assert [p for seg in result['segments'] for p in seg] == [[o.lat, o.lon] for o in expected]
        assert result['start'] == expected[0].timestamp.isoformat()
        assert result['end'] == expected[-1].timestamp.isoformat()
        assert not result['simplified']
        if vessel in ['T012', 'T015']:
            assert len(result['segments']) >= 2
            # Every adjacent pair inside a segment is a real consecutive fix.
            index = 0
            for segment in result['segments']:
                observations = expected[index:index+len(segment)]
                assert all(b.timestamp-a.timestamp == timedelta(seconds=1) for a,b in zip(observations, observations[1:]))
                index += len(segment)
        assert cache.get(app, 'builtin', vessel) is result


def test_geometry_splits_gaps_discontinuities_dateline_and_keeps_singletons():
    rows = [(START, 13., 80.), (START+timedelta(seconds=1),13.00001,80.),
            (START+timedelta(seconds=3),13.,80.), (START+timedelta(seconds=4),14.,80.),
            (START+timedelta(seconds=5),0.,179.9999), (START+timedelta(seconds=6),0.,-179.9999)]
    assert list(map(len, route_geometry(rows,'builtin','X')['segments'])) == [2,1,1,1,1]
    assert route_geometry(rows[:1],'builtin','X')['segments'] == [[[13.,80.]]]


def test_route_limit_exact_boundary_and_reject_not_truncate():
    rows = [(START+timedelta(seconds=i),13.,80.) for i in range(MAX_ROUTE_POINTS+1)]
    assert route_geometry(rows[:-1],'builtin','X')['point_count'] == MAX_ROUTE_POINTS
    with pytest.raises(HTTPException) as e: route_geometry(rows,'builtin','X')
    assert e.value.status_code == 422


def test_parquet_matches_memory_uses_selected_projection_and_cache(tmp_path, monkeypatch):
    root, meta, data, _ = recording(tmp_path, [row(i,vessel=v,lat=13+i*.00001) for i in range(120) for v in ['X','Y'] if v=='X' or i not in range(30,70)])
    app = SimpleNamespace(state=SimpleNamespace(dataset=data, upload_root=root))
    cache = RouteCache()
    # Opening a full replay store would aggregate the whole recording unnecessarily.
    monkeypatch.setattr(ParquetTrackStore, '__init__', lambda *_: pytest.fail('full store initialized'))
    for v in ['X','Y']:
        uploaded = cache.get(app,meta['dataset_id'],v)
        memory = cache.get(app,'builtin',v)
        assert {k:x for k,x in uploaded.items() if k!='dataset_id'} == {k:x for k,x in memory.items() if k!='dataset_id'}
        monkeypatch.setattr(ParquetTrackStore, '_connection', staticmethod(lambda: pytest.fail('cached query repeated')))
        assert cache.get(app,meta['dataset_id'],v) is uploaded
        monkeypatch.undo()
    assert len(cache.entries) <= 8
    # Catalog resolution still happens before a cached hit.
    (root/meta['dataset_id']/'metadata.json').unlink()
    with pytest.raises(HTTPException) as e:cache.get(app,meta['dataset_id'],'X')
    assert e.value.status_code == 404


def test_lru_is_bounded_and_invalid_coordinates_fail():
    data=load_dataset(SOURCE);app=SimpleNamespace(state=SimpleNamespace(dataset=data));cache=RouteCache()
    for v in data.vessel_ids:cache.get(app,'builtin',v)
    assert len(cache.entries)==8
    for rows in [[(START,float('nan'),80)],[(START,91.,80.)],[(START,13.,80.),(START,13.,80.)]]:
        with pytest.raises(ValueError):route_geometry(rows,'builtin','X')


def test_http_original_uploaded_unknown_invalid_and_cached_delete(tmp_path,monkeypatch):
    async def run():
        root, meta, _, _ = recording(tmp_path,[row(0,vessel='X/船'),row(1,vessel='X/船')])
        monkeypatch.setenv('UPLOAD_ROOT',str(root));app=create_app(SOURCE)
        async with app.router.lifespan_context(app), httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
            for dataset,vessel,status in [('builtin','T012',200),(meta['dataset_id'],'X/船',200),('f'*32,'X',404),('builtin','unknown',404),('bad','X',422),('builtin','bad id',422)]:
                r=await client.get(f'/api/datasets/{dataset}/route',params={'vessel_id':vessel});assert r.status_code==status,r.text
                assert str(root) not in r.text
            assert not app.state.dataset_lifecycle.references
            assert (await client.delete('/api/datasets/'+meta['dataset_id'])).status_code==200
            assert (await client.get('/api/datasets/'+meta['dataset_id']+'/route',params={'vessel_id':'X/船'})).status_code==404
    asyncio.run(run())


def test_cancelled_route_retains_reservation_until_worker_finishes(tmp_path,monkeypatch):
    async def run():
        root,meta,_,_=recording(tmp_path);monkeypatch.setenv('UPLOAD_ROOT',str(root));app=create_app(SOURCE)
        entered,finish=threading.Event(),threading.Event()
        async with app.router.lifespan_context(app),httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
            def slow(*args):
                entered.set();assert finish.wait(5);return {'ok':True}
            monkeypatch.setattr(app.state.route_cache,'get',slow)
            task=asyncio.create_task(client.get('/api/datasets/'+meta['dataset_id']+'/route',params={'vessel_id':'X'}))
            try:
                assert await asyncio.to_thread(entered.wait,5)
                task.cancel()
                with pytest.raises(asyncio.CancelledError):await task
                assert (await client.delete('/api/datasets/'+meta['dataset_id'])).status_code==409
            finally:finish.set()
            await app.state.dataset_lifecycle.finish_pending()
            await asyncio.sleep(0)
            assert not app.state.dataset_lifecycle.references
    asyncio.run(run())



def test_many_disconnected_points_reject_instead_of_creating_thousands_of_layers():
    rows = [(START+timedelta(seconds=2*i),13.,80.) for i in range(513)]
    assert len(route_geometry(rows[:-1],'builtin','X')['segments']) == 512
    with pytest.raises(HTTPException) as error:route_geometry(rows,'builtin','X')
    assert error.value.status_code == 422 and '512-segment' in error.value.detail


def test_large_selected_parquet_is_bounded_and_other_vessels_do_not_count(tmp_path, monkeypatch):
    import duckdb
    root, meta, _, _ = recording(tmp_path, [row(0,vessel='BIG'),row(0,vessel='SMALL')])
    path=root/meta['dataset_id']/'observations.parquet'
    # Trusted normalized schema; test directly avoids normalization overhead unrelated to query limit.
    with duckdb.connect() as connection:
        connection.execute("COPY (SELECT 'BIG' track_id, TIMESTAMPTZ '2026-11-02 03:30:00+00' + i*INTERVAL '1 second' timestamp, 13.0 lat, 80.0 lon FROM range(20001) r(i) UNION ALL SELECT 'SMALL', TIMESTAMPTZ '2026-11-02 03:30:00+00',13.0,80.0) TO ? (FORMAT PARQUET)",[str(path)])
    app=SimpleNamespace(state=SimpleNamespace(upload_root=root));cache=RouteCache()
    with pytest.raises(HTTPException) as error:cache.get(app,meta['dataset_id'],'BIG')
    assert error.value.status_code==422
    assert cache.get(app,meta['dataset_id'],'SMALL')['point_count']==1
