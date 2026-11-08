"""CPU-only snapshot-loop benchmark (no network), against an I3 imported recording."""
import argparse
import asyncio
import json
import sys
from pathlib import Path
from time import monotonic, perf_counter
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from starlette.websockets import WebSocketState
from app.catalog import StoredDataset
from app.datasets import lookup_dataset
from app.track_store import ParquetTrackStore
import app.replay_socket as replay_socket


class Socket:
    application_state = WebSocketState.CONNECTING
    def __init__(self):
        self.incoming = asyncio.Queue(); self.outgoing = asyncio.Queue()
        self.encode_ms = []; self.sizes = []
    async def accept(self): self.application_state = WebSocketState.CONNECTED
    async def receive(self): return await self.incoming.get()
    async def close(self): self.application_state = WebSocketState.DISCONNECTED
    async def send_json(self, frame):
        began = perf_counter()
        payload = json.dumps(frame, separators=(',', ':'), ensure_ascii=False).encode()
        self.encode_ms.append((perf_counter()-began)*1000); self.sizes.append(len(payload))
        await self.outgoing.put(frame)
    async def command(self, command):
        await self.incoming.put({'type':'websocket.receive','text':json.dumps(command)})
        while True:
            frame = await self.outgoing.get()
            if frame['type'] == 'error': raise RuntimeError(frame)
            if command['type'] == 'pause' and frame['playing']: continue
            return frame


async def run(record, speed, seconds):
    store = ParquetTrackStore(record); socket = Socket(); durations = []
    original = replay_socket.build_frame
    def build(*args):
        began = perf_counter()
        result = original(*args)
        durations.append((perf_counter()-began)*1000)
        return result
    replay_socket.build_frame = build
    task = asyncio.create_task(replay_socket.stream_replay(socket, store))
    try:
        await socket.outgoing.get()
        await socket.command({'type':'seek','second':min(300, int((store.end-store.start).total_seconds()))})
        await socket.command({'type':'set_speed','speed':speed})
        await socket.command({'type':'play'})
        start_calls=len(durations); start_messages=len(socket.sizes)
        began=perf_counter(); await asyncio.sleep(seconds)
        # Drain ordering and any in-flight worker before recording this interval.
        await socket.command({'type':'pause'})
        return dict(speed=speed, wall_seconds=perf_counter()-began,
            build_calls=len(durations)-start_calls, build_ms=sum(durations[start_calls:]),
            messages=len(socket.sizes)-start_messages, payload_bytes=sum(socket.sizes[start_messages:]),
            encode_ms=sum(socket.encode_ms[start_messages:]))
    finally:
        await socket.incoming.put({'type':'websocket.disconnect'})
        await task
        replay_socket.build_frame=original


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--results',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--repeats',type=int,default=3)
    args=parser.parse_args(); measurements=[]
    for item in json.loads(args.results.read_text())['results']:
        if item['repeat'] != 0: continue
        parquet=Path(item['parquet']); record=lookup_dataset(parquet.parent.parent,item['dataset_id'])
        for speed in [1,10]:
            for repeat in range(args.repeats):
                result=asyncio.run(run(record,speed,2.2))
                result.update(case=item['case'],repeat=repeat); measurements.append(result)
                print(json.dumps(result),flush=True)
    args.output.write_text(json.dumps(measurements,indent=2))


if __name__=='__main__': main()
