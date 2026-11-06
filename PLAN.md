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
Python/FastAPI and WebSockets. Current authorized scope ends after Phase 4.

## 1. Repository initialization and Docker foundation
- [x] Minimal React/TypeScript/Vite page and FastAPI `/api/health` work through Nginx at :8080.
- [x] `docker compose up --build -d --wait` built and started both services; same-origin health verified.
- [x] Repository instructions, three reviewer TOMLs, three validated skills and minimal engineering docs exist. TOML syntax/required fields validated; native agent discovery awaits a fresh session.
- [x] Backend tests and frontend production build pass; foundation screenshot is real.

## 2. CSV inspection, validation and ingestion
- [x] Original CSV is byte-identical to the supplied source; reproducible audit records anomalies.
- [x] Explicit timezone, whole-interval duplicate, heading and invalid-value policies implemented and tested.
- [x] Ingestion produces ordered per-vessel data, exact lookups, inclusive gaps and reconciled counts; source unchanged.
- [x] FastAPI loads once at startup; summary metadata and unchanged health work through Docker/Nginx.
- [x] Independent data review/re-review reports no unresolved findings; 59 backend tests pass.

## 3. FastAPI replay engine and WebSockets
- [x] Document exact command/frame types and per-connection clock ownership in docs/PROTOCOL.md.
- [x] Verify play/pause/seek/reset/speed/end boundaries with fake-clock and malformed-message tests.
- [x] Reconstruct last-60-second trails, split gaps, omit absent positions and preserve source/indexes.
- [x] Verify cleanup, independent clients and actual WebSocket upgrade/streaming through Docker/Nginx.
- [x] Independent replay/release reviews report no actionable findings; 115 backend tests and frontend build pass.

## 4. React application and Leaflet map
- [x] Install Leaflet/React Leaflet and initialize map bounds from actual metadata; preserve user pan/zoom across frames.
- [x] Show keyed directional markers and separate server trail segments; omit absent current fixes and retain selection identity.
- [x] Add cleaned-up ws/wss lifecycle, visible errors, explicit reconnect and server-driven Play/Pause; no frontend replay clock.
- [x] Support pointer/keyboard selection and responsive layout without a final sidebar or timeline.
- [x] Use official OSM tiles with visible attribution, normal cache/Referer and no prefetch.
- [x] Verify six focused browser tests, 115 backend tests, frontend build, real Docker/browser tiles/motion/gaps and independent reviews.

## 5. Timeline, vessel details and integration
- [ ] Play/pause/scrub match server clock, including backward seeks and stale-frame handling.
- [ ] Clicking a marker shows current ID, speed in knots and heading in degrees.
- [ ] Trail age, selected-vessel gaps and reconnect behavior are defined and verified through Nginx.

## 6. Testing, documentation and final submission
- [ ] Integration checks cover clean startup, multi-client behavior, seek boundaries and dataset anomalies.
- [ ] README has run/data/scaling/resources sections and a final application screenshot.
- [ ] Logs and learning notes reflect actual checks; release review documents limitations.
- [ ] User reviews and authorizes commit/push/submission. No automatic publishing.

**Review gate:** Phase 4 is complete. Stop for review before Phase 5 timeline,
speed controls, scrubber and selected-vessel details sidebar.
