"""E4 integration check: use an isolated Compose project/volume, never production.

Creates two small uploads and deletes only the ID returned for the first. Prints
both IDs so restart persistence can be checked separately without another upload.
"""

import argparse
import asyncio
import json

import httpx
from websockets.asyncio.client import connect

from verify_websocket import command, receive

CSV = b'track_id,timestamp,lat,lon,speed_knots,heading\nA,2025-01-01T00:00:00Z,1,2,3,0\nA,2025-01-01T00:00:02Z,1.1,2.1,4,90\n'


async def verify(base):
    ws = base.replace('http://', 'ws://').replace('https://', 'wss://') + '/ws/replay'
    async with httpx.AsyncClient(base_url=base, timeout=5) as http:
        # Guard against accidentally targeting a populated user library.
        assert (await http.get('/api/datasets')).json() == [], 'Use a fresh isolated test volume'
        records = []
        for _ in range(2):
            response = await http.post('/api/datasets', files={'file': ('duplicate.csv', CSV, 'text/csv')})
            assert response.status_code == 201, response.text
            records.append(response.json())
        first, keep = records
        url = '/api/datasets/' + first['dataset_id']
        preview = (await http.get('/api/datasets/' + keep['dataset_id'] + '/preview')).json()
        assert len(preview['rows']) == 2
        one = await connect(ws + '?dataset_id=' + first['dataset_id'])
        two = await connect(ws + '?dataset_id=' + first['dataset_id'])
        try:
            assert not (await receive(one))['playing']
            assert not (await receive(two))['playing']
            async with connect(ws) as builtin, connect(ws + '?dataset_id=' + keep['dataset_id']) as other:
                assert (await receive(builtin))['dataset_id'] == 'builtin'
                await receive(other)
                assert (await http.delete(url)).status_code == 409
                await one.close()
                assert (await http.delete(url)).status_code == 409
                await two.close()
                # Wait for server disconnect processing without accepting endless 409s.
                for _ in range(40):
                    deleted = await http.delete(url)
                    if deleted.status_code != 409:
                        break
                    await asyncio.sleep(.05)
                assert deleted.status_code == 200 and deleted.json()['deleted']
                assert (await http.delete(url)).status_code == 404
                assert (await http.delete('/api/datasets/builtin')).status_code == 403
                assert (await http.delete('/api/datasets/not-an-id')).status_code == 422
                assert [r['dataset_id'] for r in (await http.get('/api/datasets')).json()] == [keep['dataset_id']]
                assert (await http.get('/api/datasets/' + keep['dataset_id'] + '/preview')).json() == preview
                final = await command(other, {'type': 'seek', 'second': 2})
                assert final['second'] == 2 and not final['playing']
                assert final['vessels'][0]['lat'] == 1.1
                original = await command(builtin, {'type': 'seek', 'second': 640})
                assert [len(s) for s in next(v for v in original['vessels'] if v['id'] == 'T012')['trail_segments']] == [19, 1]
        finally:
            await one.close()
            await two.close()
        print(json.dumps({'deleted': first['dataset_id'], 'retained': keep['dataset_id']}))
        print('PASS: isolated upload/preview, two paused references, 409 until disconnect,')
        print('      delete/404, duplicate filename isolation, protected builtin, other/default replay.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', required=True, help='Isolated Nginx origin, e.g. http://localhost:18084')
    asyncio.run(verify(parser.parse_args().base_url.rstrip('/')))
