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

## Backend clock and independent WebSocket sessions
- **Decision:** each connection owns a monotonic replay clock over the shared validated
  dataset. Play/pause/speed changes re-anchor fractional progress; frames reflect server time.
- **Reason:** bidirectional WebSocket commands/state and independent clients keep browser
  rendering simple and avoid one user's pause/seek changing another's session.
- **Alternative considered:** browser-only clocks, a global clock, or SSE plus HTTP commands.
- **Tradeoff:** connection lifecycle is server work; sessions reset on reconnect. A single
  async loop serializes commands and sends, with bounded waits instead of background writers.

## Small foundation with locked dependencies
- **Decision:** pin Python dependencies including transitive versions and use npm's
  package lock; Python 3.14 and Node 24 containers. Add map dependencies when used.
- **Reason:** reproducible dependency installs without unused code or services.
- **Alternative considered:** floating latest application dependencies or full map scaffold now.
- **Tradeoff:** lock updates are deliberate; base image tags still receive upstream
  updates (not digest-pinned). WebSocket transport is added explicitly when used.

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
- **Tradeoff:** fewer visible vessels during gaps. Replay omits absent vessels entirely;
  trails use seconds [max(0,s−59),s], splitting segments at missing samples. The future
  UI must replace current markers from each complete frame.

## Snapshot scheduling and deterministic reconstruction
- **Decision:** check playing sessions every 100 ms; send only changed states, plus
  immediate command responses. Rebuild at most 60 observed samples per vessel per frame.
- **Reason:** 10× remains usable without queuing every missed second; seek needs no cache invalidation.
- **Alternative considered:** increment-after-sleep clocks, a sender task per command,
  or mutable rolling trail buffers.
- **Tradeoff:** scheduling can skip intermediate seconds under load; clock accuracy
  does not depend on send cadence. A send stalled for five seconds closes the session.

## Stable map, complete snapshots and explicit reconnect
- **Decision:** mount one React Leaflet MapContainer with metadata bounds; update
  keyed markers and one polyline per server segment. Keep selection by ID. Use
  an inner rotated arrow so Leaflet retains its positioning transform.
- **Reason:** user pan/zoom persists, gaps remove current markers, and backward
  seeks replace trails without frontend timing/window calculations.
- **Alternative considered:** recenter/recreate on every frame, accumulate positions,
  auto-reconnect with an assumed restored session, or add a state-management library.
- **Tradeoff:** reconnect is manual and starts a new paused session; disconnect clears
  current fixes. Initial-fit markers may overlap; users can zoom or use keyboard
  selection. OSM tiles use the official URL, visible attribution and browser cache/
  Referer defaults; no prefetch/offline feature or tile proxy.
