"""One ordered writer and one bounded receive wait per WebSocket connection."""

import asyncio
import json
from collections.abc import Callable
from time import monotonic

from fastapi import WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState
from starlette.concurrency import run_in_threadpool

from app.ingestion import Dataset
from app.replay import ReplaySession, build_frame
from app.track_store import TrackStore

UPDATE_INTERVAL = 0.1  # At most 10 automatic state frames per wall-clock second.
SEND_TIMEOUT = 5.0


async def stream_replay(
    websocket: WebSocket, dataset: Dataset | TrackStore, clock: Callable[[], float] = monotonic,
) -> None:
    duration = int((dataset.end - dataset.start).total_seconds()) + 1
    session = ReplaySession(duration, clock)
    loop = asyncio.get_running_loop()

    async def send(payload: dict):
        # A stalled client cannot keep an unbounded backlog of frames/tasks.
        await asyncio.wait_for(websocket.send_json(payload), timeout=SEND_TIMEOUT)

    try:
        await websocket.accept()
        frame = await run_in_threadpool(build_frame, dataset, session)
        await send(frame)
        last_state = (frame["second"], frame["playing"], frame["speed"])
        next_update = loop.time() + UPDATE_INTERVAL
        while True:
            timeout = max(0, next_update - loop.time()) if session.playing else None
            try:
                event = await asyncio.wait_for(websocket.receive(), timeout=timeout)
            except TimeoutError:
                event = None
            force_state = False
            if event is not None:
                if event["type"] == "websocket.disconnect":
                    break
                try:
                    text = event.get("text")
                    if text is None:
                        raise ValueError("commands must be JSON text messages")
                    if len(text) > 4096:
                        raise ValueError("command exceeds 4096 characters")
                    session.command(json.loads(text))
                except (ValueError, RecursionError) as error:
                    await send({"type": "error", "message": str(error)})
                else:
                    force_state = True
            # Also publish due progress after errors; bad traffic cannot stop the clock.
            if force_state or loop.time() >= next_update:
                # Most 1x timer checks still refer to the same recorded second.
                # Commands always reconstruct immediately, even at an unchanged second.
                current = session.snapshot()
                state = (current["second"], current["playing"], current["speed"])
                if not force_state and state == last_state:
                    next_update = loop.time() + UPDATE_INTERVAL
                    continue
                frame = await run_in_threadpool(build_frame, dataset, session)
                state = (frame["second"], frame["playing"], frame["speed"])
                if force_state or state != last_state:
                    await send(frame)
                    last_state = state
                next_update = loop.time() + UPDATE_INTERVAL
    except (WebSocketDisconnect, OSError, TimeoutError):
        pass  # Includes failed sends and the explicit slow-client timeout.
    except Exception:
        try:
            await send({"type": "error", "message": "Recording data is unavailable. Reconnect or choose another recording."})
        except (WebSocketDisconnect, OSError, TimeoutError):
            pass
    finally:
        if websocket.application_state == WebSocketState.CONNECTED:
            try:
                await asyncio.wait_for(websocket.close(), timeout=1.0)
            except (WebSocketDisconnect, OSError, RuntimeError, TimeoutError):
                pass
