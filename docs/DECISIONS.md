# Significant decisions

## One origin, two services
- **Decision:** React + TypeScript + Vite builds static assets served by Nginx;
  `/api/` requests are forwarded unchanged to FastAPI. Only port 8080 is published.
- **Reason:** one browser origin, simple startup and no CORS configuration.
- **Alternative considered:** serve Vite's development server in the final container.
- **Tradeoff:** source changes require rebuilding the frontend container; local Vite
  development remains available with an equivalent API proxy.

## Preserve source; separate audit from ingestion
- **Decision:** retain the exact CSV and a standard-library read-only audit command.
- **Reason:** dataset problems must be reproducible before choosing cleanup rules.
- **Alternative considered:** immediately rewrite duplicate IDs based on trajectory.
- **Tradeoff:** audit and runtime share schema/time parsing; independent fixture/source
  assertions are needed to catch shared mistakes. Runtime policy is recorded below.

## Planned replay ownership (not implemented)
- **Decision:** one in-memory dataset and a replay clock per WebSocket connection;
  React renders frames. Leaflet/React Leaflet will handle mapping.
- **Reason:** independent clients and a clear source of playback truth, without a database.
- **Alternative considered:** send the entire log and run the replay only in the browser.
- **Tradeoff:** server must manage connection lifecycle, seek races and paused clients.
  Protocol and timing behavior will be specified/tested before implementation.

## Small foundation with locked dependencies
- **Decision:** pin Python dependencies including transitive versions and use npm's
  package lock; Python 3.14 and Node 24 containers. Add map dependencies when used.
- **Reason:** reproducible dependency installs without unused code or services.
- **Alternative considered:** floating latest application dependencies or full map scaffold now.
- **Tradeoff:** lock updates are deliberate; base image tags still receive upstream
  updates (not digest-pinned). This foundation proves HTTP wiring, not WebSocket support.

## Normalize once at startup; reject invalid input
- **Decision:** load a typed dataset in FastAPI lifespan; preserve original bytes,
  normalize naive IST timestamps to UTC and 360° to 0°, sort/index by vessel/time.
  Invalid rows fail startup with line evidence; `/api/meta` exposes only summary data.
- **Reason:** replay can reuse validated exact lookups without repeated parsing.
- **Alternative considered:** silently skip invalid rows or load on each request.
- **Tradeoff:** one invalid row prevents startup; input must be corrected explicitly.

## Resolve conflicts by complete anchored continuity
- **Decision:** remove normalized exact copies; choose the shortest complete
  geographic path through each contiguous conflict block and both adjacent anchors.
  Abort without anchors or when the best two paths differ by ≤1 m. Report every discard.
- **Reason:** T007's stationary sequence matches both neighbors; the alternate
  requires kilometre jumps in a second. Whole-sequence scoring avoids greedy flips.
- **Alternative considered:** first-row wins, per-second nearest choice, or T012 reassignment.
- **Tradeoff:** two best partial paths per candidate add small local complexity;
  distance favors short travel and cannot establish identity. Conservative rejection
  handles ambiguity; no generic sensor-motion model is claimed.

## No current observation means no current position
- **Decision:** exact timestamp lookup returns `None` for missing positions; record
  inclusive missing intervals across the full recording window without interpolation.
- **Reason:** stale coordinates must not be presented as observed current positions.
- **Alternative considered:** forward-fill gaps or infer the missing T012 identity.
- **Tradeoff:** fewer visible vessels during gaps; future replay/UI must handle absence.
