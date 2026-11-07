import asyncio
from datetime import datetime, timedelta, timezone
from io import BytesIO
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

import httpx
import pytest

from app.datasets import import_dataset, lookup_dataset
from app.ingestion import load_dataset
from app.main import create_app
from app.replay import ReplaySession, build_frame
from app.track_store import MemoryTrackStore, ParquetTrackStore
from test_ingestion import SOURCE, row, write_csv
from test_replay import FakeClock
from test_replay_socket import SocketClient


def recording(tmp_path, rows=None, name='other.csv'):
    rows = rows if rows is not None else [row(i,vessel=v,lat=40+i*.001,lon=-74) for i in range(130)
                                         for v in ['X','Y'] if v=='X' or not 30 <= i < 70]
    path=write_csv(tmp_path,rows)
    data=load_dataset(path)
    root=tmp_path/'uploads'
    metadata=import_dataset(BytesIO(path.read_bytes()),name,root,ZoneInfo('UTC'))
    return root, metadata, data, ParquetTrackStore(lookup_dataset(root,metadata['dataset_id']))


def test_memory_and_parquet_frames_exactly_equal_across_gap_and_seeks(tmp_path):
    root,meta,data,store=recording(tmp_path)
    metadata=store.get_metadata()
    assert metadata['vessel_ids']==['X','Y']
    assert metadata['vessel_count']==2 and metadata['recording_seconds']==130
    assert metadata['bounds']==data.bounds and metadata['name']=='other.csv'
    session=ReplaySession(130,FakeClock())
    for second in list(range(130))+[100,20,0,129]:
        session.command({'type':'seek','second':second})
        expected=build_frame(MemoryTrackStore(data),session)
        actual=build_frame(store,session)
        assert actual.pop('dataset_id')==meta['dataset_id']
        expected.pop('dataset_id')
        assert actual==expected
    assert not list(root.glob('.import-*'))


def test_exact_window_cache_replaces_rows_and_never_queries_per_vessel(tmp_path,monkeypatch):
    _,_,data,store=recording(tmp_path)
    original=store._connection
    calls=[]
    def connect():
        calls.append(1)
        return original()
    monkeypatch.setattr(store,'_connection',connect)
    session=ReplaySession(130,FakeClock())
    for command in [{'type':'seek','second':70},{'type':'set_speed','speed':10},{'type':'play'},{'type':'pause'}]:
        session.command(command);build_frame(store,session)
    assert len(calls)==1
    assert all(data.start+timedelta(seconds=11)<=o.timestamp<=data.start+timedelta(seconds=70) for o in store._cache)
    for second in [129,20,70]:
        session.command({'type':'seek','second':second});build_frame(store,session)
    assert len(calls)==4 and len(store._cache)<=120
    another=ParquetTrackStore(lookup_dataset(tmp_path/'uploads',store.dataset_id))
    assert another._cache==() and another._cache_key is None
    for start,end in [(data.start,data.end),(data.start-timedelta(seconds=1),data.start),(data.end,data.end+timedelta(seconds=1))]:
        with pytest.raises(ValueError):store.get_window(start,end)


@pytest.mark.parametrize('stamp',['0001-01-01T00:00:00Z','9999-12-31T23:59:59Z'])
def test_single_second_boundary_recording_stops_and_returns_exact_observation(tmp_path,stamp):
    source=row();source[1]=stamp
    _,_,_,store=recording(tmp_path,[source])
    session=ReplaySession(1,FakeClock());session.command({'type':'play'})
    frame=build_frame(store,session)
    assert frame['second']==0 and not frame['playing'] and len(frame['vessels'])==1
    assert frame['timestamp']==stamp and len(frame['vessels'][0]['trail_segments'][0])==1


@pytest.mark.parametrize('field,expression',[('heading','999'),('speed_knots',"CAST('NaN' AS DOUBLE)"),('timestamp',"timestamp + INTERVAL '0.1 second'")])
def test_corrupt_observations_fail_metadata_preflight_without_path_leaks(tmp_path,monkeypatch,field,expression):
    root,meta,_,store=recording(tmp_path)
    with store._connection() as connection:
        connection.sql(f'SELECT * REPLACE ({expression} AS {field}) FROM read_parquet(?)',params=[str(store.parquet)]).write_parquet(str(tmp_path/'bad.parquet'))
    (tmp_path/'bad.parquet').replace(store.parquet)
    monkeypatch.setenv('UPLOAD_ROOT',str(root))
    app=create_app(SOURCE)
    async def check():
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
                response=await client.get('/api/replay/'+meta['dataset_id']+'/meta')
                assert response.status_code==500 and str(root) not in response.text
                assert (await client.get('/api/meta')).json()['record_count']==35780
    asyncio.run(check())


class SelectedClient(SocketClient):
    def __init__(self,app,dataset_id):
        super().__init__(app);self.dataset_id=dataset_id
    async def __aenter__(self):
        # Reuse the existing ordered ASGI test transport, adding only query parameters.
        original=self.app
        async def selected(scope,receive,send):
            scope={**scope,'query_string':urlencode({'dataset_id':self.dataset_id}).encode()}
            await original(scope,receive,send)
        self.app=selected
        return await super().__aenter__()


def test_selected_sessions_default_isolation_dynamic_meta_and_back_to_builtin(tmp_path,monkeypatch):
    root,meta,_,_=recording(tmp_path)
    second_row=row(0,vessel='TOKYO',lat=35.6,lon=139.7);second_row[1]='2024-06-01T01:00:00Z'
    _,other,_,_=recording(tmp_path,[second_row],name='short.csv')
    monkeypatch.setenv('UPLOAD_ROOT',str(root));clock=FakeClock();app=create_app(SOURCE,replay_clock=clock)
    async def check():
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as http:
                metadata=(await http.get('/api/replay/'+meta['dataset_id']+'/meta')).json()
                assert metadata['vessel_ids']==['X','Y'] and metadata['recording_seconds']==130
                assert (await http.get('/api/replay/builtin/meta')).json()['dataset_id']=='builtin'
                assert (await http.get('/api/replay/not-an-id/meta')).status_code==422
                assert (await http.get('/api/replay/'+'f'*32+'/meta')).status_code==404
            async with SocketClient(app) as builtin,SelectedClient(app,meta['dataset_id']) as upload,SelectedClient(app,other['dataset_id']) as short:
                assert (await builtin.receive())['dataset_id']=='builtin'
                initial=await upload.receive();tiny=await short.receive()
                assert initial['duration_seconds']==130 and initial['playing'] is False and initial['speed']==1
                assert tiny['duration_seconds']==1 and [v['id'] for v in tiny['vessels']]==['TOKYO']
                await builtin.send({'type':'play'});await builtin.receive()
                await upload.send({'type':'seek','second':70});frame=await upload.receive()
                assert [len(s) for s in next(v for v in frame['vessels'] if v['id']=='Y')['trail_segments']]==[19,1]
                await upload.send({'type':'play'});await upload.receive();clock.advance(1.25)
                await upload.send({'type':'pause'});paused=await upload.receive()
                assert paused['second']==71
                await short.send({'type':'play'});assert not (await short.receive())['playing']
                await builtin.send({'type':'pause'});assert (await builtin.receive())['second']==1
                await upload.send({'type':'seek','second':129});assert not (await upload.receive())['playing']
                await upload.send({'type':'reset'});assert (await upload.receive())['second']==0
            async with SelectedClient(app,meta['dataset_id']) as again:
                assert (await again.receive())['second']==0
            async with SelectedClient(app,'builtin') as back:
                assert (await back.receive())['duration_seconds']==1800
    asyncio.run(check())


@pytest.mark.parametrize('dataset_id',['not-an-id','f'*32])
def test_invalid_socket_selection_reports_error_and_does_not_touch_working_client(tmp_path,monkeypatch,dataset_id):
    monkeypatch.setenv('UPLOAD_ROOT',str(tmp_path/'uploads'));app=create_app(SOURCE)
    async def check():
        async with app.router.lifespan_context(app),SocketClient(app) as working:
            await working.receive()
            rejected=SelectedClient(app,dataset_id);await rejected.__aenter__()
            error=await rejected.receive();assert error['type']=='error' and str(tmp_path) not in error['message']
            assert (await rejected.event())['type']=='websocket.close'
            await rejected.task
            await working.send({'type':'seek','second':600})
            assert (await working.receive())['second']==600
    asyncio.run(check())


@pytest.mark.parametrize('speed', [1, 2, 5, 10])
def test_uploaded_speed_progress_and_automatic_stop(tmp_path, monkeypatch, speed):
    root, meta, _, _ = recording(tmp_path)
    monkeypatch.setenv('UPLOAD_ROOT', str(root))
    clock = FakeClock()
    app = create_app(SOURCE, replay_clock=clock)

    async def check():
        async with app.router.lifespan_context(app), SelectedClient(app, meta['dataset_id']) as client:
            await client.receive()
            await client.send({'type': 'set_speed', 'speed': speed})
            assert (await client.receive())['speed'] == speed
            await client.send({'type': 'play'})
            await client.receive()
            clock.advance(1.25)
            progressed = await client.receive()
            assert progressed['second'] == int(1.25 * speed) and progressed['playing']
            await client.send({'type': 'seek', 'second': 128})
            assert (await client.receive())['second'] == 128
            clock.advance(2)
            finished = await client.receive()
            assert finished['second'] == 129 and not finished['playing']

    asyncio.run(check())
