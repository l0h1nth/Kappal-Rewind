"""Read-only HTTP/WebSocket profile through an isolated Nginx stack.

Uses existing benchmark imports only; never uploads/deletes a recording. Decoded JSON
bytes are uncompressed payload sizes; this probe disables WebSocket compression.
"""
import argparse
import asyncio
import json
from pathlib import Path
from time import perf_counter
from urllib.request import urlopen
from websockets.asyncio.client import connect


async def state(ws):
    text = await asyncio.wait_for(ws.recv(), 10)
    frame = json.loads(text)
    if frame['type'] != 'state': raise RuntimeError(frame)
    return frame, len(text.encode())


async def command(ws, message):
    await ws.send(json.dumps(message))
    while True:
        frame, size = await state(ws)
        if message['type'] == 'pause' and frame['playing']: continue
        return frame, size


async def sample(base, item, container=None):
    uri = base.replace('http://', 'ws://').replace('https://', 'wss://') + '/ws/replay?dataset_id=' + item['dataset_id']
    opens=[]; first=[]; seeks=[]
    for _ in range(3):
        began=perf_counter()
        with urlopen(base+'/api/replay/'+item['dataset_id']+'/meta') as response: json.load(response)
        opens.append((perf_counter()-began)*1000)
        began=perf_counter()
        async with connect(uri, compression=None, max_size=None) as ws:
            await state(ws); first.append((perf_counter()-began)*1000)
            for second in [300,301,302,50,1900,0]:
                began=perf_counter();frame,size=await command(ws,{'type':'seek','second':min(second,1799 if item['case']=='original' else 1999)})
                seeks.append(dict(second=frame['second'],ms=(perf_counter()-began)*1000,bytes=size))
    streams=[]
    for speed in [1,10]:
        async with connect(uri,compression=None,max_size=None) as ws:
            await state(ws); await command(ws,{'type':'seek','second':300})
            await command(ws,{'type':'set_speed','speed':speed});await command(ws,{'type':'play'})
            began=perf_counter();seconds=[];sizes=[]
            process = None
            if container:
                process = await asyncio.create_subprocess_exec('docker', 'stats', '--no-stream',
                    '--format', '{{json .}}', container, stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE)
            while perf_counter()-began<2.5:
                try:
                    frame,size=await asyncio.wait_for(state(ws),max(.01,2.5-(perf_counter()-began)))
                except TimeoutError:break
                seconds.append(frame['second']);sizes.append(size)
            await command(ws,{'type':'pause'})
            resource_sample = None
            if process is not None:
                output, error = await process.communicate()
                if process.returncode:
                    raise RuntimeError('Docker resource sample failed: ' + error.decode())
                resource_sample = json.loads(output)
            streams.append(dict(speed=speed,seconds=seconds,frames=len(sizes),elapsed_seconds=perf_counter()-began,
                uncompressed_bytes=sum(sizes),docker_stats=resource_sample))
    return dict(case=item['case'],http_open_ms=opens,ws_first_frame_ms=first,seeks=seeks,streams=streams)


async def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--base-url',required=True);p.add_argument('--container',help='Optional Docker container for resource sampling');p.add_argument('--results',type=Path,required=True);p.add_argument('--output',type=Path,required=True);args=p.parse_args()
    measurements=[]
    for item in json.loads(args.results.read_text())['results']:
        if item['repeat']!=0:continue
        result=await sample(args.base_url.rstrip('/'),item,args.container);measurements.append(result);print(json.dumps(result),flush=True)
    args.output.write_text(json.dumps(measurements,indent=2))


if __name__=='__main__':asyncio.run(main())
