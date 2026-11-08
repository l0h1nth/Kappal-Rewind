import asyncio
import json

import pytest

from app.main import create_app
import app.replay_socket as replay_socket
from test_ingestion import SOURCE
from test_replay import FakeClock


class SocketClient:
    """In-process ASGI client: exercises the actual route without real-time playback."""
    def __init__(self, app):
        self.app = app
        self.incoming = asyncio.Queue()
        self.outgoing = asyncio.Queue()

    async def __aenter__(self):
        scope = {"type": "websocket", "asgi": {"version": "3.0", "spec_version": "2.4"},
                 "http_version": "1.1", "scheme": "ws", "path": "/ws/replay",
                 "raw_path": b"/ws/replay", "root_path": "", "query_string": b"",
                 "headers": [], "subprotocols": [], "server": ("test", 80), "client": ("test", 123)}
        self.task = asyncio.create_task(self.app(scope, self.incoming.get, self.outgoing.put))
        await self.incoming.put({"type": "websocket.connect"})
        assert (await self.event())["type"] == "websocket.accept"
        return self

    async def __aexit__(self, *args):
        await self.incoming.put({"type": "websocket.disconnect", "code": 1000})
        await asyncio.wait_for(self.task, timeout=2)

    async def event(self):
        return await asyncio.wait_for(self.outgoing.get(), timeout=2)

    async def receive(self):
        event = await self.event()
        assert event["type"] == "websocket.send", event
        return json.loads(event["text"])

    async def send(self, message):
        await self.raw(json.dumps(message))

    async def raw(self, text):
        await self.incoming.put({"type": "websocket.receive", "text": text})


def test_initial_commands_and_ordered_seek_responses():
    async def check():
        clock = FakeClock()
        app = create_app(SOURCE, replay_clock=clock)
        async with app.router.lifespan_context(app), SocketClient(app) as client:
            first = await client.receive()
            assert (first["second"], first["playing"], first["speed"]) == (0, False, 1)
            assert first["duration_seconds"] == 1800
            await client.send({"type": "play"})
            assert (await client.receive())["playing"] is True
            clock.advance(2)
            await client.send({"type": "pause"})
            paused = await client.receive()
            assert (paused["second"], paused["playing"]) == (2, False)
            await client.send({"type": "seek", "second": 600})
            assert (await client.receive())["timestamp"] == "2026-11-02T03:40:00Z"
            await client.send({"type": "set_speed", "speed": 5})
            assert (await client.receive())["speed"] == 5
            # Pipeline seeks; no competing writer can send old progress after the final response.
            for second in [1000, 20, 0]:
                await client.send({"type": "seek", "second": second})
            assert [(await client.receive())["second"] for _ in range(3)] == [1000, 20, 0]
            await client.send({"type": "reset"})
            reset = await client.receive()
            assert (reset["second"], reset["playing"], reset["speed"]) == (0, False, 5)
    asyncio.run(check())


@pytest.mark.parametrize("text", ["not JSON", "{", "null", "[]", '{"type":[]}',
                                  '{"type":"unknown"}', '{"type":"seek","second":1800}',
                                  '{"type":"set_speed","speed":true}',
                                  '{"type":"set_speed","speed":NaN}', "x" * 4097,
                                  "[" * 1500 + "]" * 1500])
def test_invalid_messages_recover_without_resetting_state(text):
    async def check():
        app = create_app(SOURCE, replay_clock=FakeClock())
        async with app.router.lifespan_context(app), SocketClient(app) as client:
            await client.receive()
            await client.send({"type": "seek", "second": 600})
            await client.receive()
            await client.raw(text)
            error = await client.receive()
            assert error["type"] == "error"
            assert error["message"]
            await client.send({"type": "pause"})
            assert (await client.receive())["second"] == 600
    asyncio.run(check())


def test_binary_messages_recover():
    async def check():
        app = create_app(SOURCE)
        async with app.router.lifespan_context(app), SocketClient(app) as client:
            await client.receive()
            await client.incoming.put({"type": "websocket.receive", "bytes": b"binary"})
            assert (await client.receive())["type"] == "error"
            await client.send({"type": "play"})
            assert (await client.receive())["playing"] is True
    asyncio.run(check())


def test_automatic_stream_final_stop_and_live_commands_with_fake_clock():
    async def check():
        clock = FakeClock()
        app = create_app(SOURCE, replay_clock=clock)
        async with app.router.lifespan_context(app), SocketClient(app) as client:
            await client.receive()
            await client.send({"type": "set_speed", "speed": 10})
            await client.receive()
            await client.send({"type": "play"})
            await client.receive()
            clock.advance(2)
            streamed = await client.receive()  # Only scheduler wait, no real playback sleep.
            assert (streamed["second"], streamed["playing"]) == (20, True)
            await client.send({"type": "seek", "second": 1798})
            assert (await client.receive())["second"] == 1798
            clock.advance(1)
            stopped = await client.receive()
            assert (stopped["second"], stopped["playing"]) == (1799, False)
    asyncio.run(check())


def test_client_isolation_and_disconnect_cleanup():
    async def check():
        clock = FakeClock()
        app = create_app(SOURCE, replay_clock=clock)
        async with app.router.lifespan_context(app):
            baseline = set(asyncio.all_tasks())
            async with SocketClient(app) as first, SocketClient(app) as second:
                await first.receive()
                await second.receive()
                await first.send({"type": "seek", "second": 600})
                await first.receive()
                await first.send({"type": "set_speed", "speed": 10})
                await first.receive()
                await first.send({"type": "play"})
                await first.receive()
                clock.advance(1)
                await first.send({"type": "pause"})
                assert (await first.receive())["second"] == 610
                await second.send({"type": "pause"})
                other = await second.receive()
                assert (other["second"], other["speed"], other["playing"]) == (0, 1, False)
                await second.send({"type": "play"})  # Disconnect during active playback.
                await second.receive()
            assert first.task.done() and second.task.done()
            assert set(asyncio.all_tasks()) == baseline
            async with SocketClient(app) as reconnected:
                state = await reconnected.receive()
                assert (state["second"], state["speed"], state["playing"]) == (0, 1, False)
    asyncio.run(check())


def test_slow_writer_is_cancelled_and_connection_cleaned_up(monkeypatch):
    monkeypatch.setattr(replay_socket, "SEND_TIMEOUT", 0.01)

    async def check():
        app = create_app(SOURCE)
        async with app.router.lifespan_context(app):
            baseline = set(asyncio.all_tasks())
            client = SocketClient(app)
            cancelled = asyncio.Event()
            messages = []

            async def blocked_send(event):
                messages.append(event)
                if event["type"] == "websocket.send":
                    try:
                        await asyncio.Future()
                    finally:
                        cancelled.set()

            scope = {"type": "websocket", "path": "/ws/replay", "headers": [],
                     "query_string": b"", "scheme": "ws", "root_path": ""}
            await client.incoming.put({"type": "websocket.connect"})
            await asyncio.wait_for(app(scope, client.incoming.get, blocked_send), timeout=2)
            assert cancelled.is_set()
            assert [event["type"] for event in messages] == ["websocket.accept", "websocket.send", "websocket.close"]
            assert set(asyncio.all_tasks()) == baseline
    asyncio.run(check())


def test_handler_cancellation_cleans_pending_receive():
    async def check():
        app = create_app(SOURCE)
        async with app.router.lifespan_context(app):
            baseline = set(asyncio.all_tasks())
            client = SocketClient(app)
            await client.__aenter__()
            await client.receive()
            client.task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await client.task
            assert client.task.done()
            assert set(asyncio.all_tasks()) == baseline
    asyncio.run(check())


def test_unchanged_automatic_ticks_skip_frame_build_but_commands_still_reconstruct(monkeypatch):
    original = replay_socket.build_frame
    calls = []
    def build(*args):
        calls.append(1)
        return original(*args)
    monkeypatch.setattr(replay_socket, 'build_frame', build)
    monkeypatch.setattr(replay_socket, 'UPDATE_INTERVAL', .01)
    async def check():
        clock = FakeClock()
        app = create_app(SOURCE, replay_clock=clock)
        async with app.router.lifespan_context(app), SocketClient(app) as client:
            await client.receive()
            await client.send({'type': 'play'}); await client.receive()
            before = len(calls)
            await asyncio.sleep(.06)
            assert len(calls) == before
            clock.advance(1)
            assert (await client.receive())['second'] == 1
            assert len(calls) == before + 1
            # A seek at the unchanged second still gets an immediate complete frame.
            await client.send({'type': 'seek', 'second': 1})
            assert (await client.receive())['second'] == 1
            assert len(calls) == before + 2
    asyncio.run(check())
