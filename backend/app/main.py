from fastapi import FastAPI

app = FastAPI(title="Kappal Rewind")


@app.get("/api/health")
def health() -> dict[str, str]:
    """Process liveness only; dataset readiness comes with ingestion."""
    return {"status": "ok"}
