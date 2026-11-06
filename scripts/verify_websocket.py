"""End-to-end smoke check against running Compose/Nginx; no real playback sleeps."""

import asyncio
import json

from websockets.asyncio.client import connect

URL = "ws://localhost:8080/ws/replay"


async def receive(socket):
    return json.loads(await asyncio.wait_for(socket.recv(), timeout=3))


async def command(socket, payload):
    await socket.send(json.dumps(payload))
    return await receive(socket)


async def verify():
    async with connect(URL) as first, connect(URL) as second:
        for socket in [first, second]:
            initial = await receive(socket)
            assert (initial["second"], initial["playing"], initial["speed"]) == (0, False, 1)
            assert initial["duration_seconds"] == 1800
        state = await command(first, {"type": "seek", "second": 600})
        assert state["timestamp"] == "2026-11-02T03:40:00Z"
        assert "T012" not in {v["id"] for v in state["vessels"]}
        t007 = next(v for v in state["vessels"] if v["id"] == "T007")
        assert [t007["lat"], t007["lon"]] == [13.082801, 80.358893]
        assert (await command(first, {"type": "set_speed", "speed": 10}))["speed"] == 10
        assert (await command(first, {"type": "play"}))["playing"] is True
        progressed = await receive(first)
        assert progressed["second"] > 600 and progressed["playing"]
        await first.send(json.dumps({"type": "pause"}))
        # A progress frame already in transit may precede the ordered pause response.
        while (await receive(first))["playing"]:
            pass
        isolated = await command(second, {"type": "pause"})
        assert (isolated["second"], isolated["speed"], isolated["playing"]) == (0, 1, False)
        at640 = await command(first, {"type": "seek", "second": 640})
        t012 = next(v for v in at640["vessels"] if v["id"] == "T012")
        assert [len(s) for s in t012["trail_segments"]] == [19, 1]
        at1200 = await command(first, {"type": "seek", "second": 1200})
        assert "T015" not in {v["id"] for v in at1200["vessels"]}
        at1380 = await command(first, {"type": "seek", "second": 1380})
        assert [len(s) for s in next(v for v in at1380["vessels"] if v["id"] == "T015")["trail_segments"]] == [1]
        final = await command(first, {"type": "seek", "second": 1799})
        assert final["second"] == 1799 and not final["playing"]
        for text in ["bad JSON", '{"type":"seek","second":1800}', '{"type":"set_speed","speed":3}']:
            await first.send(text)
            assert (await receive(first))["type"] == "error"
        reset = await command(first, {"type": "reset"})
        assert (reset["second"], reset["playing"], reset["speed"]) == (0, False, 10)
        await command(first, {"type": "play"})  # Close an active replay connection.
    async with connect(URL) as reconnected:
        initial = await receive(reconnected)
        assert (initial["second"], initial["playing"], initial["speed"]) == (0, False, 1)
    print("PASS: Nginx WebSocket upgrade, initial/command/stream frames, 10x progress,")
    print("      client isolation, real gaps/trails, accepted T007, errors, end/reset and reconnect.")


if __name__ == "__main__":
    asyncio.run(verify())
