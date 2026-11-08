import asyncio
from unittest.mock import Mock

import httpx
import pytest

import app.main as main
from test_ingestion import START, row, write_csv


def test_startup_loads_once_and_metadata_reuses_dataset(tmp_path, monkeypatch):
    path = write_csv(tmp_path, [row(), row(1, lat=14)])
    loader = Mock(wraps=main.load_dataset)
    monkeypatch.setattr(main, "load_dataset", loader)
    monkeypatch.setenv("TRACKS_CSV", str(path))
    app = main.create_app()

    async def check():
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                for _ in range(2):
                    response = await client.get("/api/meta")
                    assert response.status_code == 200
                    body = response.json()
                    assert set(body) == {"start", "end", "recording_seconds", "vessel_count", "vessel_ids", "record_count", "bounds"}
                    assert body["record_count"] == 2
                    assert body["vessel_count"] == 1
                    assert body["vessel_ids"] == ["A"]
                    assert body["recording_seconds"] == 2
                    assert body["bounds"] == {"south": 13, "north": 14, "west": 80, "east": 80}
                    assert body["start"] == START.isoformat()
                assert (await client.get("/api/health")).json() == {"status": "ok"}
                assert (await client.get("/api/observations")).status_code == 404
        assert not hasattr(app.state, "dataset")

    asyncio.run(check())
    loader.assert_called_once_with(path)


def test_invalid_dataset_stops_startup_without_partial_state(tmp_path):
    path = write_csv(tmp_path, [row(), row(1, lat=999)])
    app = main.create_app(path)

    async def check():
        with pytest.raises(ValueError, match="CSV line 3: lat"):
            async with app.router.lifespan_context(app):
                pytest.fail("Startup must not complete for invalid data")
        assert not hasattr(app.state, "dataset")

    asyncio.run(check())
