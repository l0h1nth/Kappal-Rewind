import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request

from app.ingestion import load_dataset

DEFAULT_CSV = Path(__file__).resolve().parents[2] / "data/tracks.csv"


def create_app(dataset_path: Path | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(application: FastAPI):
        path = dataset_path if dataset_path is not None else Path(os.environ.get("TRACKS_CSV", DEFAULT_CSV))
        application.state.dataset = load_dataset(path)
        yield
        del application.state.dataset

    application = FastAPI(title="Kappal Rewind", lifespan=lifespan)

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

    return application


app = create_app()
