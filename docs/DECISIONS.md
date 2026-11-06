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
- **Tradeoff:** ambiguity remains visible; deterministic ingestion policy needs review.

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
