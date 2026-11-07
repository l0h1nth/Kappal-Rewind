import os
from collections.abc import Callable
from contextlib import asynccontextmanager
from pathlib import Path
from time import monotonic

from fastapi import FastAPI, Request, WebSocket
from starlette.middleware.body_limit import RequestBodyLimitMiddleware

from app.datasets import MAX_REQUEST_BYTES, configure_uploads, router as datasets_router
from app.ingestion import load_dataset
from app.replay_socket import stream_replay

DEFAULT_CSV = Path(__file__).resolve().parents[2] / "data/tracks.csv"


def create_app(
    dataset_path: Path | None = None, *, replay_clock: Callable[[], float] = monotonic,
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(application: FastAPI):
        path = dataset_path if dataset_path is not None else Path(os.environ.get("TRACKS_CSV", DEFAULT_CSV))
        application.state.dataset = load_dataset(path)
        configure_uploads(application)
        yield
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
    async def replay(websocket: WebSocket):
        await stream_replay(websocket, websocket.app.state.dataset, replay_clock)

    return application


app = create_app()
