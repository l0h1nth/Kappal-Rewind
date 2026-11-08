import os
import asyncio
from collections.abc import Callable
from contextlib import asynccontextmanager
from pathlib import Path
from time import monotonic

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from starlette.concurrency import run_in_threadpool
from starlette.middleware.body_limit import RequestBodyLimitMiddleware

from app.datasets import MAX_REQUEST_BYTES, configure_uploads, lookup_dataset, router as datasets_router
from app.dataset_lifecycle import DatasetLifecycle
from app.ingestion import load_dataset
from app.replay_socket import stream_replay
from app.track_store import MemoryTrackStore, ParquetTrackStore

DEFAULT_CSV = Path(__file__).resolve().parents[2] / "data/tracks.csv"


def select_track_store(application: FastAPI, dataset_id: str):
    if dataset_id == "builtin":
        return MemoryTrackStore(application.state.dataset)
    return ParquetTrackStore(lookup_dataset(application.state.upload_root, dataset_id))


def create_app(
    dataset_path: Path | None = None, *, replay_clock: Callable[[], float] = monotonic,
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(application: FastAPI):
        path = dataset_path if dataset_path is not None else Path(os.environ.get("TRACKS_CSV", DEFAULT_CSV))
        application.state.dataset = load_dataset(path)
        configure_uploads(application)
        application.state.dataset_lifecycle = DatasetLifecycle()
        try:
            yield
        finally:
            await application.state.dataset_lifecycle.finish_pending()
            del application.state.dataset

    application = FastAPI(title="Kappal Rewind", lifespan=lifespan)
    application.add_middleware(RequestBodyLimitMiddleware, max_body_size=MAX_REQUEST_BYTES)
    application.include_router(datasets_router)

    @application.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @application.get("/api/meta")
    def metadata(request: Request):
        dataset = request.app.state.dataset
        return {
            "start": dataset.start,
            "end": dataset.end,
            "recording_seconds": int((dataset.end - dataset.start).total_seconds()) + 1,
            "vessel_count": len(dataset.observations),
            "record_count": dataset.record_count,
            "bounds": dataset.bounds,
        }

    @application.websocket("/ws/replay")
    async def replay(websocket: WebSocket, dataset_id: str = "builtin"):
        lifecycle = websocket.app.state.dataset_lifecycle
        acquired = False
        try:
            try:
                lifecycle.acquire(dataset_id)
                acquired = True
                store = await run_in_threadpool(select_track_store, websocket.app, dataset_id)
            except Exception as error:
                message = error.detail if isinstance(error, HTTPException) else "Recording could not be opened. Choose another recording."
                await websocket.accept()
                try:
                    await asyncio.wait_for(websocket.send_json({"type": "error", "message": message}), timeout=5)
                except (WebSocketDisconnect, OSError, TimeoutError):
                    pass
                finally:
                    try:
                        await asyncio.wait_for(websocket.close(code=1008), timeout=1)
                    except (WebSocketDisconnect, OSError, RuntimeError, TimeoutError):
                        pass
                return
            await stream_replay(websocket, store, replay_clock)
        finally:
            if acquired:
                lifecycle.release(dataset_id)

    @application.get("/api/replay/{dataset_id}/meta")
    def replay_metadata(dataset_id: str, request: Request):
        try:
            return select_track_store(request.app, dataset_id).get_metadata()
        except HTTPException:
            raise
        except Exception as error:
            raise HTTPException(500, "Recording could not be opened. Stored files were not changed.") from error

    return application


app = create_app()
