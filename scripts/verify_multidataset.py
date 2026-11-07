"""Read-only E3 smoke through running Nginx: supply two existing upload IDs."""

import argparse
import asyncio
from urllib.request import urlopen
import json

from websockets.asyncio.client import connect

from verify_websocket import command, receive

HTTP = 'http://localhost:8080'
WS = 'ws://localhost:8080/ws/replay'


def get(path):
    with urlopen(HTTP + path, timeout=5) as response:
        return json.load(response)


async def verify(ids):
    metadata = [get('/api/replay/' + dataset_id + '/meta') for dataset_id in ids]
    previews = [get('/api/datasets/' + dataset_id + '/preview?limit=100')['rows'] for dataset_id in ids]
    async with connect(WS) as builtin, connect(WS + '?dataset_id=' + ids[0]) as first, connect(WS + '?dataset_id=' + ids[1]) as second:
        assert (await receive(builtin))['dataset_id'] == 'builtin'
        for socket, meta, preview in zip([first, second], metadata, previews):
            initial = await receive(socket)
            assert (initial['dataset_id'], initial['second'], initial['playing'], initial['speed']) == (meta['dataset_id'], 0, False, 1)
            assert initial['duration_seconds'] == meta['recording_seconds']
            for row in preview:
                if row['timestamp'] != preview[0]['timestamp']:
                    continue
                vessel = next(v for v in initial['vessels'] if v['id'] == row['track_id'])
                assert [vessel[k] for k in ['lat', 'lon', 'heading', 'speed_knots']] == [row[k] for k in ['lat', 'lon', 'heading', 'speed_knots']]
            final = await command(socket, {'type': 'seek', 'second': meta['recording_seconds'] - 1})
            assert final['second'] == meta['recording_seconds'] - 1 and not final['playing']
            reset = await command(socket, {'type': 'reset'})
            assert reset['second'] == 0 and reset['speed'] == 1 and not reset['playing']
        await command(first, {'type': 'set_speed', 'speed': 10})
        await command(first, {'type': 'play'})
        isolated = await command(second, {'type': 'pause'})
        assert (isolated['second'], isolated['speed'], isolated['playing']) == (0, 1, False)
        original = await command(builtin, {'type': 'seek', 'second': 640})
        assert [len(s) for s in next(v for v in original['vessels'] if v['id'] == 'T012')['trail_segments']] == [19, 1]
    async with connect(WS + '?dataset_id=' + ids[0]) as fresh:
        state = await receive(fresh)
        assert (state['second'], state['speed'], state['playing']) == (0, 1, False)
    async with connect(WS + '?dataset_id=' + 'f' * 32) as missing:
        assert (await receive(missing))['type'] == 'error'
        await missing.wait_closed()
        assert missing.close_code == 1008
    print('PASS: two persisted recordings, dynamic metadata, exact first observations,')
    print('      final/reset, independent uploaded/default sessions, fresh reconnect, unknown ID.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('dataset_ids', nargs=2)
    asyncio.run(verify(parser.parse_args().dataset_ids))
