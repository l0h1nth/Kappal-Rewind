# Implementation plan

The complete private assignment was read on 6 November 2026. Final deliverables:
repository with backend/frontend/Compose; an approximately one-page README with
run instructions, data issues/handling, scaling discussion, AI/web log and an actual
application screenshot. Submission is due **9 November 2026, noon IST**.
Publishing the repository and emailing its link require the user's permission.

Final behavior: Leaflet map centered on this dataset; approximately 30 minutes of
20 vessels; play/pause/scrub; markers and last-60-second trails; vessel selection
with ID/speed/heading; FastAPI WebSocket streaming; React UI; `docker compose up`.
The PDF permits MapLibre, Node and SSE; the user's selected stack is Leaflet,
Python/FastAPI and WebSockets. The initial task stops before replay implementation.

## 1. Repository initialization and Docker foundation
- [x] Minimal React/TypeScript/Vite page and FastAPI `/api/health` work through Nginx at :8080.
- [x] `docker compose up --build -d --wait` built and started both services; same-origin health verified.
- [x] Repository instructions, three reviewer TOMLs, three validated skills and minimal engineering docs exist. TOML syntax/required fields validated; native agent discovery awaits a fresh session.
- [x] Backend tests and frontend production build pass; foundation screenshot is real.

## 2. CSV inspection, validation and ingestion
- [x] Original CSV is byte-identical to the supplied source; reproducible audit records anomalies.
- [ ] Explicitly choose and test timezone, duplicate, heading and invalid-value policies.
- [ ] Ingestion produces ordered per-vessel data with gap metadata and reconciled row counts.
- [x] Independent initial-audit review has no unresolved findings; repeat for ingestion.
Initial audit belongs to this foundation task; runtime ingestion remains pending.

## 3. FastAPI replay engine and WebSockets
- [ ] Document a small typed command/frame protocol and per-connection clock ownership.
- [ ] Verify play/pause/seek/end boundaries with a controllable clock and malformed-command tests.
- [ ] Handle disconnects and gaps without fabricating observations; independent replay review.

## 4. React application and Leaflet map
- [ ] Install Leaflet/React Leaflet and center/fit the map to validated vessel coordinates.
- [ ] Show current vessel markers and paths without joining gaps as observed movement.
- [ ] Include tile attribution and follow provider usage policy.

## 5. Timeline, vessel details and integration
- [ ] Play/pause/scrub match server clock, including backward seeks and stale-frame handling.
- [ ] Clicking a marker shows current ID, speed in knots and heading in degrees.
- [ ] Trail age, selected-vessel gaps and reconnect behavior are defined and verified through Nginx.

## 6. Testing, documentation and final submission
- [ ] Integration checks cover clean startup, multi-client behavior, seek boundaries and dataset anomalies.
- [ ] README has run/data/scaling/resources sections and a final application screenshot.
- [ ] Logs and learning notes reflect actual checks; release review documents limitations.
- [ ] User reviews and authorizes commit/push/submission. No automatic publishing.

**Review gate:** stop after the foundation and initial audit. Explain the result and
wait for review before continuing phase 2 ingestion or phase 3 replay.
