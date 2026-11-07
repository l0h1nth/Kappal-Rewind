# Kappal Rewind
*The sea has a replay button.*

A vessel-track replay tool for the RSKD Labs internship assignment.
**Status: Phase 6 reviewed** — interactive Leaflet map, directional markers, gap-split trails,
server-controlled timeline, Play/Pause/Reset, 1×/2×/5×/10× speeds and current vessel
details. Final verification/submission preparation remain for Phase 7. See the [plan](PLAN.md).

**Stack:** React, TypeScript, Vite, Leaflet/React Leaflet · Python, FastAPI,
WebSockets · Nginx, Docker Compose · Pytest, Playwright.

## Run
Requires Docker Engine and Docker Compose v2; port 8080 must be free.
From this repository:
```sh
docker compose up
```
Open [localhost:8080](http://localhost:8080). The map should load with a connected indicator and 20 initial markers.
[Health endpoint](http://localhost:8080/api/health) returns `{"status":"ok"}` through
Nginx. [Dataset metadata](http://localhost:8080/api/meta) reports counts/time/bounds.
Stop with Ctrl+C, then `docker compose down`. After source changes, rebuild
with `docker compose up --build`. CSV is mounted read-only. Replay connects at
`ws://localhost:8080/ws/replay`; exact commands/frames: [protocol](docs/PROTOCOL.md).

For development/tests (Python 3.14, Node 24+, npm):
```sh
python3.14 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements-dev.txt
. .venv/bin/activate
(cd backend && python -m pytest -q)
python3 scripts/audit_csv.py
(cd frontend && npm ci && npm run build)
python scripts/verify_websocket.py  # requires Compose running
(cd frontend && npx playwright install firefox && npm test)
```
Run `uvicorn app.main:app --reload` from `backend` with the venv activated, and
`npm run dev` from `frontend` for local development at :5173. Vite proxies `/api` and `/ws` to :8000. Browser tests mock frames/tiles; real Docker
checks are recorded separately. OSM tiles require internet; zoom to separate nearby markers.

Optional **E1 upload/storage** adds a CSV import section; imported datasets do not
replace the assignment replay. Limits, timezone configuration, persistent volume
and a DuckDB query: [CSV imports](docs/DATASETS.md).

## Data problems found
35,820 rows become 35,780 validated observations across 20 vessels / 1,800 seconds.
Naive timestamps assume IST and normalize to UTC; 11 headings of 360° become 0°.
Whole-interval geographic continuity resolves 40 T007 conflicts; discarded rows
are reported, without reassigning IDs. T012's 40-second and T015's 180-second gaps
remain absent positions. Source order is sorted in memory; invalid input fails
startup with line errors. CSV bytes are unchanged. Evidence and limits: [data audit](docs/DATA_AUDIT.md).

## For 500 vessels and 24 hours
At one observation per second that is 43.2 million rows. Replace full in-memory
loading with time-indexed storage and windowed reads, stream only requested
windows/deltas, and decimate older paths for display. Measure parsing, wire size
and browser rendering before adding workers or changing the rendering approach.

## AI and web resources
Codex generated ingestion/replay/map/controls, tests and docs; independent AI reviewers check
critical work. Official FastAPI, Vite, Docker and Codex documentation informed setup;
Praman's documentation inspired concise chronological logs. Human verification
is not claimed. Contributions and actual checks: [AI usage](docs/AI_USAGE.md),
[build log](docs/BUILD_LOG.md), [learning notes](docs/LEARNING_NOTES.md).

Earlier application preview (Phase 4; final UI screenshot deferred to Phase 7):
![Interactive map with recorded vessels](screenshots/map.png)
