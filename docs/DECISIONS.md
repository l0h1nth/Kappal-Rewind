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

## Native timeline draft and ordered seek acknowledgement
- **Decision:** use a native range with a temporary drag draft; serialize commands in
  the socket hook. An active seek pauses, waits for the paused frame, seeks to an
  exact paused target, then resumes unless at the end. Show only confirmed speed.
- **Reason:** the existing protocol has no request IDs; a streaming frame can share
  the requested second without acknowledging a seek. The pause response is a barrier
  in the backend's ordered loop, so old automatic frames cannot follow it.
- **Alternative considered:** assume any matching streaming second acknowledges the
  seek, or add protocol fields/backend changes.
- **Tradeoff:** active seeks add two command round trips. Controls wait for confirmation;
  five-second command deadlines fail visibly and require a fresh session. Range/select
  stay focused using guarded aria-disabled while busy; native disabled is used when
  unavailable. The draft and deadline never advance recorded time.

## Recover explicitly from unusable replay connections
- **Decision:** malformed server frames terminate the session and expose manual
  reconnect; allow eight seconds for connection plus first valid state, independently
  of the existing command deadline.
- **Reason:** clearing an invalid frame while retaining a paused connection left all
  controls disabled with no recovery action. An open socket alone is not usable data.
- **Tradeoff:** malformed frames require a fresh paused session rather than waiting
  for a later unsolicited frame. Slow initialization can be retried explicitly.

## E1 — one verified Parquet file and JSON metadata per import
- **Decision:** reuse typed ingestion, then write UTC/numeric Parquet through embedded
  DuckDB. Verify all accepted rows before atomically renaming a staging directory
  containing Parquet and metadata on the persistent upload volume.
- **Reason:** durable normalized recordings and SQL read-back without a metadata
  database, extra server or a second CSV normalization policy.
- **Alternative:** retain only CSV, create a DuckDB database per recording, or add
  pandas/Arrow for transport. A temporary canonical CSV avoids those dependencies.
- **Tradeoff:** normalization and verification still use memory; conservative import
  limits bound work. Raw/discarded CSV values are not retained. Atomic publication
  prevents partial valid datasets; it does not promise power-loss durability.

## E2 — metadata discovery and bounded read-only previews
- **Decision:** discover validated E1 UUID directories on request; retain JSON as the
  registry. New uploads add UTC imported_at; older missing dates remain null and
  sort last, with UUID tie-breaking. Resolve requested IDs through discovered entries.
- **Reason:** compatibility and restart persistence without a second database,
  invented filesystem-derived dates or user-controlled paths.
- **Tradeoff:** lookup/list work grows with stored files. Bounded metadata reads and
  SQL LIMIT 20–100 keep individual payloads small; they do not eliminate Parquet scan
  work. Skip unusable metadata; report preview failures without modifying files.

## E3 — shared frame builder over two small track stores
- **Decision:** TrackStore exposes metadata and one all-vessel UTC time window.
  MemoryTrackStore adapts the assignment indexes; ParquetTrackStore performs
  parameterized BETWEEN/ORDER BY queries. The existing clock/trail builder serves both.
- **Reason:** exact recorded values and gap behavior stay in one implementation;
  Python receives only the current inclusive 60-second window for uploads.
- **Alternative:** eagerly load every upload, query separately per vessel, or add
  a mutable dataset-switch command. A dataset ID on a new socket gives clear
  session/cache ownership and preserves the default protocol.
- **Tradeoff:** metadata preflight and socket initialization each aggregate-scan
  the file; SQL connections open/close per uncached window. One exact-window tuple
  per session avoids same-second reads and is replaced on any window change;
  nothing accumulates across seeks or sessions. Queries run off the event loop,
  with one DuckDB thread, a 128 MiB engine limit and no disk spill. Cancellation
  may leave an already-running bounded worker query finishing. This is the E1
  small-recording limit, not measured scalable or memory-streaming ingestion.

## E4 — reserve active recordings; hide before unlinking
- **Decision:** keep per-upload live socket counts and deletion reservations in one
  application lifecycle object, separate from the disk catalog. Paused sockets
  count; reserve before store initialization and release in the route's finally.
- **Reason:** replay opens files for each window. Blocking deletion preserves that
  session and avoids a silent switch or mid-playback missing file.
- **Alternative:** delete open files immediately, force-disconnect clients, or add
  cross-process locking. Synchronous state transitions on one event loop have no
  await between check and reservation; this fits the existing one-process server.
- **Tradeoff:** run exactly one backend process/worker. A shielded worker task keeps
  the deletion reservation until disk work completes, even after HTTP cancellation;
  graceful shutdown waits for pending deletes. This is not a job queue.
- **Consistency:** resolve the existing catalog entry, validate its two-file layout,
  open directories without following symlinks, then rename to a hidden `.delete-*`
  sibling before descriptor-relative unlink/rmdir. No recursive deletion. Failures
  before rename preserve the visible recording; later failures remain hidden for
  manual cleanup. No automatic recovery or power-loss durability is promised.

## E5a — disk-backed upload normalization, shared policy
- **Decision:** stream raw CSV through the shared validator into canonical rows;
  use a temporary DuckDB database for sort/exact dedup, then feed bounded batches
  and conflict blocks to the shared anchored resolver. Verify Parquet multisets
  in SQL before publishing the unchanged UUID/JSON/Parquet layout.
- **Reason:** raising limits on the prior in-memory Dataset and full-list read-back
  would retain multiple million-observation copies. Builtin indexes remain useful
  and unchanged; a second parser or duplicate-policy implementation would drift.
- **Tradeoff:** extra canonical files, SQL passes and temporary disk replace Python
  recording-sized collections. Engine memory settings are not RSS limits. One
  import retains the lock/spool through cancellation cleanup; SQL stages can finish
  before a disconnect is observed. Two settings can lower the tested 50 MiB/1M
  ceilings. No new permanent database, partition scheme or job service is needed.

## I1 — animate confirmed display positions only
- **Decision:** Leaflet marker refs ease between received consecutive observations
  over 1,000/speed ms; the server clock, frame coordinates, headings and trails stay exact.
- **Reason:** current messages contain no confirmed future fix. Prediction would
  require invented data; a catch-up transition needs neither a protocol change nor a new clock.
- **Alternative:** instant marker updates or buffered future-frame playback.
- **Tradeoff:** visual position can lag by one observation interval. Missing/skipped
  seconds, commands, speed changes, >100m steps and date-line crossings snap instead;
  100m is a conservative visual guard, not data validation. Reduced motion snaps too.

## I3 — bounded forward replay-window reuse
- **Decision:** retain at most 60,000 observations per Parquet replay session, reuse
  only a forward overlap and query its disjoint tail; skip automatic reconstruction
  when the authoritative replay state is unchanged. Commands still force frames.
- **Reason:** measured 1M/500-vessel adjacent frames improved 91.81→25.83 ms; repeated
  same-second builds wasted work. Existing SQL pushdown already works.
- **Alternative/tradeoff:** exact-only caching rereads overlap. Broader caches,
  persistent connections or protocol deltas add lifecycle/memory/compatibility cost
  without evidence needed here. Oversized windows return complete but uncached;
  per-client frame memory and snapshot bandwidth remain. Architecture is unchanged.

## Exact, bounded selected-vessel route inspection
- **Decision:** keep full routes out of replay frames; query one vessel on demand and preserve exact coordinates, splitting missing seconds, >100m steps and date-line crossings. Reject beyond 20,000 positions or 512 segments; cache eight routes per process/browser. The 100m rule is a conservative visualization guard, not GPS validation.
- **Reason/tradeoff:** explicit limits avoid unbounded JSON/Leaflet layers without a geospatial framework or shape-loss claims. Simplification is deferred; larger/fragmented routes remain unavailable while replay works. Selected-only DuckDB projection/predicate/limit bounds Python rows, not Parquet scan cost or total RSS. Cached geometry/file reservations do not survive server restart.
