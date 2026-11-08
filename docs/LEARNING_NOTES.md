# Learning notes

| Component | What/why; how it works here | Study / interview question |
| --- | --- | --- |
| [React](https://react.dev/learn) + TypeScript | React renders the page; state holds metadata, the latest replay frame and selection. TypeScript checks source types before building; incoming JSON still needs runtime validation. Effects manage network lifecycle. | State vs effect; why can a TypeScript cast not validate an API response? |
| [Vite](https://vite.dev/guide/) | Local dev server and production bundler. Compiles TSX and bundles assets into `dist`; dev `/api` proxy targets :8000. | Why is the development server unnecessary in the final image? |
| [FastAPI](https://fastapi.tiangolo.com/tutorial/first-steps/) + Uvicorn | FastAPI declares routes; Uvicorn runs the ASGI app on :8000. Startup validates data before serving; health retains its small liveness response. | What is the difference between the framework and its server? |
| [Nginx](https://nginx.org/en/docs/http/ngx_http_proxy_module.html) | Serves built HTML/JS/CSS and forwards `/api/health` to `backend:8000/api/health`. Browser sees only localhost:8080. | Why does `backend` resolve inside Docker but not in browser code? |
| [Docker Compose](https://docs.docker.com/compose/) | Builds two images, networks services by name, mounts data read-only and waits for backend health before starting Nginx. Multi-stage frontend build leaves Node tooling out of its serving image. | Why is startup order alone insufficient for readiness? |
| [CSV](https://docs.python.org/3/library/csv.html) + [datetime](https://docs.python.org/3/library/datetime.html) | Audit reads raw strings, validates values, compares UTC keys and counts gaps on a one-second grid. Source bytes remain unchanged. | How can 180 missing CSV rows conceal 220 missing vessel-seconds? |
| [Pytest](https://docs.pytest.org/en/stable/) | Health contract check plus audit tests using raw source and small error/gap fixtures. These do not prove browser or Docker behavior. | What distinct failure does each kind of check detect? |
| [Codex agents](https://learn.chatgpt.com/docs/agent-configuration/subagents#custom-agents) and [skills](https://learn.chatgpt.com/docs/build-skills) | Standalone TOML reviewer instructions live in `.codex/agents`; discoverable workflows use `.agents/skills/*/SKILL.md`. Neither replaces executed evidence. | How does a reusable procedure differ from an independent reviewer? |

Metadata loads at mount with an eight-second timeout; replay frames arrive over
WebSocket. FastAPI loads the CSV once during lifespan startup; a validation failure
prevents startup, and the health response stays unchanged.

## Phase 2 — ingestion

| Concept / code | How it works here | Interview question |
| --- | --- | --- |
| CSV parsing / `_parse_row` | `csv.reader(strict=True)` yields strings; verify header, cells and ranges, preserving source lines in errors. `Observation` is a frozen typed record. | Why validate before resolving duplicates? |
| Naive vs aware / `parse_timestamp` | Naive values lack an offset; explicitly attach assumed IST. Aware values already locate an instant. | Why must we not assume the host computer's timezone? |
| UTC normalization | `astimezone(UTC)` makes equivalent timestamps the same dictionary key; convert to IST only for display. | How do 09:00 IST and 03:30 UTC become one instant? |
| Duplicate detection / `_resolve_track` | Group by vessel/UTC time; collapse equal normalized records and record every discard. | Why do raw string timestamps make unsafe duplicate keys? |
| Continuity / `_resolve_block` | Great-circle distances score complete paths including both anchors; keep two best partial paths per candidate to detect near ties. No vessel ID reassignment. | Why can the closest candidate now produce a worse complete path? |
| Missing observations / `Gap` | Compare sorted neighboring timestamps and global recording boundaries. Store inclusive missing intervals; exact lookup returns `None`. | Why does 09:09:59 → 09:10:40 mean 40 missing seconds? |
| Sorting/indexing / `Dataset` | Sorted vessel dictionaries contain chronological timestamp dictionaries. Lookup by exact aware instant is direct; first/last keys give vessel bounds. | Why is a gap lookup different from finding the most recent observation? |
| Startup / `load_dataset`, `create_app` | Parse/validate/normalize once in lifespan, keep Dataset on app state, expose bounds/counts via `/api/meta`. No file reads per request. | What happens if the CSV is invalid when the server starts? |

Further reading: [Python CSV](https://docs.python.org/3.14/library/csv.html),
[datetime](https://docs.python.org/3.14/library/datetime.html),
[dictionaries](https://docs.python.org/3.14/tutorial/datastructures.html#dictionaries),
[dataclasses](https://docs.python.org/3.14/library/dataclasses.html),
[FastAPI lifespan](https://fastapi.tiangolo.com/advanced/events/).
## Phase 3 — replay

| Concept / code | How it works here | Interview question |
| --- | --- | --- |
| HTTP vs WebSocket / `stream_replay` | Health/meta use request/response HTTP. `/ws/replay` stays open for commands and state frames in both directions; Nginx forwards the upgrade. | Why choose WebSockets over SSE plus separate command requests? |
| `async` / `await` | One coroutine per connection waits for messages with a timeout while playing. Awaiting I/O lets other clients run. Sends and commands stay ordered; bounded waits clean up on disconnect. | Why can blocking `sleep` freeze other clients? |
| Monotonic vs wall-clock / `_current_position` | Elapsed duration comes from a clock that does not jump with wall-clock corrections. Dataset UTC timestamps label recorded observations only. | Why must the recording timestamp not drive elapsed playback time? |
| Speed / `ReplaySession.command` | Position = anchor position + elapsed × speed. Changing speed captures progress before re-anchoring. Pause stores the fraction; resume restarts elapsed measurement. | At second 3.75, why must pause not store just 3? |
| Session state | Position, anchor, speed and playing belong to each connection; validated observations are shared without modification. | Why must two clients not share a replay clock? |
| Seek / `build_frame` | Seek changes the anchor; every frame looks up exact observations again. No mutable trail cache survives a backward seek. | How could a rolling buffer accidentally show future points? |
| Trails | Use seconds `max(0,s−59)` through `s` inclusive. Missing samples end a segment; absent current observations omit the vessel. | At 600, why does the window begin at 541, not 540? |

Study `backend/app/replay.py` for the clock/frames, `replay_socket.py` for the ordered
async loop, and `tests/test_replay*.py` for fake-clock and ASGI examples. Example:
play at 1× for 3.75 s → pause at fractional 3.75 → resume for 0.25 s → displayed
second 4. `docs/PROTOCOL.md` defines exact messages; `scripts/verify_websocket.py`
exercises real Docker/Nginx communication. At the end of Phase 3, the React page did not yet consume replay.

Further reading: [monotonic time](https://docs.python.org/3.14/library/time.html#time.monotonic),
[async waits/cancellation](https://docs.python.org/3.14/library/asyncio-task.html),
[FastAPI WebSockets](https://fastapi.tiangolo.com/advanced/websockets/),
[Nginx upgrades](https://nginx.org/en/docs/http/websocket.html).
React rendering and Leaflet integration are covered below.

## Phase 4 — interactive map

| Concept / source | How it works here | Interview question |
| --- | --- | --- |
| Rendering / `App.tsx` | React state stores metadata, the latest complete frame and selected ID. Props describe what each map layer should show. | Why replace a frame instead of merging absent vessels into old state? |
| Effects / `useReplaySocket` | One effect opens a same-origin ws/wss socket, handles messages and cleans up handlers/socket. Deferred setup cancels StrictMode's probe; explicit reconnect clears old data and starts fresh. | How can an old socket handler overwrite a new session? |
| MapContainer / `VesselMap` | Metadata bounds initialize a single map with explicit CSS height. Frames update children; map identity/view persists. | Why should fitBounds not run after every frame? |
| Coordinates / `VesselMarker` | Positions and polyline points use `[latitude, longitude]`. An inner arrow rotates clockwise from north; the outer div's transform belongs to Leaflet. | What breaks if rotation replaces Leaflet's outer transform? |
| Selection / `VesselMarker` | Stable IDs key markers and selection; click/Enter/Space select, and highlight persists when the vessel returns after a gap. | Why must selection identity be separate from the current observation? |
| Polylines / `VesselTrails` | Each backend segment becomes a separate path. Styling highlights selection; no interpolation or replay window calculation occurs here. | Why does flattening segments create false recorded motion? |

Flow: server frame → hook validation/state → App props → VesselMap → marker position
and heading / separate trail polylines. Play/Pause send commands; only returned
server frames change replay time. Errors are visible and disconnect removes current
fixes. Study `frontend/tests/map.spec.ts`: synthetic frames and mocked tiles cover
UI behavior without OSM traffic; real tile/network checks are separate evidence.

Further reading: [React effects](https://react.dev/reference/react/useEffect),
[React Leaflet MapContainer](https://react-leaflet.js.org/docs/api-map/),
[Leaflet 1.9](https://leafletjs.com/reference-1.9.4.html),
[OSM tile policy](https://operations.osmfoundation.org/policies/tiles/).

## Phase 5 — timeline and current details

| Concept / code | How it works here | Interview question |
| --- | --- | --- |
| Controlled input / [Timeline](../frontend/src/components/Timeline.tsx) | Range value is the drag draft or confirmed frame second. Pointer changes update draft; release sends one seek. Keyboard input sends immediately. | Why would binding only to incoming frames make a drag jump? |
| State vs refs / `Timeline`, [useReplaySocket](../frontend/src/hooks/useReplaySocket.ts) | State renders draft/frame/busy. Refs hold drag flags, latest frame, pending transaction and timeout across handlers without scheduling renders. | Why can a socket callback read stale React state, and when is a ref appropriate? |
| Acknowledgement / `send`, socket `onmessage` | Only one command is pending. Playing seeks use pause→seek→resume; the paused response drains earlier automatic frames. Draft clears after confirmation. | Why does a matching second alone fail to prove a streaming seek completed? |
| Clock/speed / `confirms` | Server clock advances replay. Select sends set_speed and displays returned speed; timeout only detects missing acknowledgement. | Why would a frontend interval drift or disagree after a speed change? |
| Selection / [VesselPanel](../frontend/src/components/VesselPanel.tsx), [App](../frontend/src/App.tsx) | App stores selected ID; panel looks it up in every complete frame. Missing fix renders a status without coordinates/speed/heading; reconnect waits for fresh data. | How can identity survive while its observation disappears? |
| Responsive layout / [style.css](../frontend/src/style.css) | Desktop grid gives map most width; at 800px sidebar stacks and controls wrap. MapContainer remains mounted, preserving its view. | Why should resizing change layout rather than recreate the map? |

Practical bug: disabling the focused range/select during acknowledgement moved
Firefox focus to the page, preventing the next key. Guarded aria-disabled preserves
focus; delayed-ack tests use actual consecutive keyboard events. Study
[playback tests](../frontend/tests/playback.spec.ts) alongside the handlers above.

## Phase 6 — recovery edge cases

Two P2 defects in [useReplaySocket](../frontend/src/hooks/useReplaySocket.ts) had the
same visible result: disabled controls without Reconnect. A malformed paused frame
cleared data but retained connected status; a socket that never delivered its first
state had no deadline. The effect-local `fail` now clears data/pending work, sets
error status and closes the socket. An independent eight-second initialization
deadline ends only on valid state or cleanup; an error packet is not a usable state.
[Recovery tests](../frontend/tests/recovery.spec.ts) failed before the fix and now
cover invalid JSON/fields, pending-deadline cleanup, timeout and fresh reconnect.

Interview questions: Why can a paused connection never recover by waiting for the
next frame? Why must an error packet not cancel the first-state deadline?

Deferred: protocol request IDs, automatic reconnect/session restoration, map
clustering, storage/rendering optimizations and dependency changes without evidence.
The current export's cleaning policy and server clock needed no changes.

## E1 — uploaded recordings

- [UploadCsv](../frontend/src/components/UploadCsv.tsx) submits browser FormData;
  the browser sets the multipart boundary. Server parsing bounds request/file bytes
  and checks complete envelopes; a worker thread performs validation/storage so the
  replay event loop remains available.
- [datasets.py](../backend/app/datasets.py) calls the existing CSV normalizer with an
  explicit timezone and work limits. Offsets override naive assumptions; duplicates
  and gaps retain the established policy. Failed staging is removed before retry.
- [storage.py](../backend/app/storage.py) writes typed, column-oriented Parquet and
  queries it with embedded DuckDB; complete accepted-row equality gates publication.
  Temporary canonical CSV is a transport step, not a new source validator.
- Docker's named volume survives container recreation independently of images.
  Parquet plus JSON is simple but lacks transactions across multiple datasets,
  storage quotas and large-file streaming. [Import contract](DATASETS.md) has the
  actual limits/query; performance improvement has not been measured.

Interview questions: Why does an upload need both a byte limit and a conflict-work
limit? Why publish the directory only after read-back, rather than writing directly
to its final UUID? Study the extreme-date and truncated-multipart regression tests:
normal gap sentinels overflowed at year boundaries; a completed CSV part alone did
not establish that the full multipart upload had completed.

## E2 — persistent library

- Metadata describes a recording (identity, counts, dates, validation); listing
  [catalog.py](../backend/app/catalog.py) reads JSON rather than all observations.
  validate_metadata checks consistency; discover_datasets skips unusable entries.
- Stable UUIDs distinguish identical filenames. [lookup_dataset](../backend/app/datasets.py)
  validates an ID and finds its already-discovered Parquet path; the request never
  becomes a filesystem path. Legacy import dates remain unknown instead of guessed.
- [preview_parquet](../backend/app/storage.py) runs SELECT over the stored file with
  ORDER BY timestamp/track_id and a bound LIMIT. At most 100 rows reach Python/React;
  sorting may still scan the file. No mutable DuckDB database is required.
- Docker's existing named volume retains JSON/Parquet when processes restart.
  Corrupt metadata is omitted/returns 404; corrupt Parquet can leave details visible
  but produces a preview error. Per-request JSON scans are the main small-library
  tradeoff; bounded reads/output mitigate memory/payload growth, not lookup cost.
- [DatasetLibrary](../frontend/src/components/DatasetLibrary.tsx) separates library
  state from replay. Upload increments a revision; abort/active guards and keyed
  details prevent an old response from replacing the newly opened recording.

Interview questions: Why is filename an unsafe identity even without malicious
input? Why can metadata list quickly while preview needs a SQL query? Why does a
LIMIT bound Python results without guaranteeing that DuckDB reads only 20 rows?

## E3 — multi-dataset replay

- [TrackStore](../backend/app/track_store.py) is a small structural interface:
  memory indexes and Parquet supply the same typed observations to
  [build_frame](../backend/app/replay.py). Clock, gap splitting and trails remain shared.
- SQL BETWEEN binds aware UTC start/end, selects all vessels together and sorts
  timestamp/ID. Aggregate metadata is small; only a 60-second result enters Python.
  A query can still scan a whole small Parquet file. See [DuckDB Parquet](https://duckdb.org/docs/data/parquet).
- A socket owns its store, monotonic clock and exact-window cache. Identical windows
  reuse one tuple; a new window replaces it, including backward seeks. A new socket
  creates a new cache. This bounds retained history, not concurrent client count.
- [App](../frontend/src/App.tsx) preflights dynamic metadata before committing an ID;
  [useReplaySocket](../frontend/src/hooks/useReplaySocket.ts) closes/detaches old
  listeners, clears deadlines and verifies frame identity. Active guards reject
  delayed callbacks; the server remains the only playback clock.
- Leaflet MapContainer props are immutable after initialization.
  [VesselMap](../frontend/src/components/VesselMap.tsx) uses useMap().fitBounds only
  on ID changes; the existing map keeps user pan/zoom across frames. See
  [React Leaflet API](https://react-leaflet.js.org/docs/api-map/).

Interview questions: Why query one time window instead of one query per vessel?
Why does opening a new socket simplify cache/session isolation? Why check identity
as well as close the old socket? What remains costly despite bounded Python rows?
Study test_track_store.py and switching.spec.ts for gaps, stale callbacks and
cancelling an in-flight switch back to the current recording.

## E4 — dataset lifecycle and DELETE

- CRUD here means create (CSV upload), read (library/preview/replay), and delete;
  editing normalized observations is not implemented. DELETE addresses the server
  UUID, not the display filename. Success is 200; a repeated delete is 404 while
  leaving the same absent state. 403 protects builtin, 422 rejects malformed IDs,
  409 means an active reference/reservation, 500 means storage failure.
- [DatasetLifecycle](../backend/app/dataset_lifecycle.py) tracks live uses, not a
  second dataset registry. acquire runs before the first await; main.py releases
  in finally, including cancellation. One paused socket still needs future reads.
- A race occurs if deletion checks zero uses, yields, then another socket opens
  before unlink. Synchronous event-loop check/reserve operations act as a gate:
  either opening owns a reference or deletion owns the reservation. No disk work
  runs inside that critical section. Multiple worker processes would need shared
  coordination; these in-memory counts cannot protect them.
- [delete_stored_dataset](../backend/app/dataset_lifecycle.py) uses catalog lookup,
  no-follow directory descriptors and two explicit unlinks. Atomic rename hides
  metadata/data together. A later failure leaves a hidden tombstone; the recovery
  contract is in DATASETS.md. See [Python filesystem APIs](https://docs.python.org/3/library/os.html#files-and-directories).
- Cancelling an HTTP request does not stop an OS worker operation. asyncio.shield
  keeps the tracked task alive; its completion callback releases the reservation
  and consumes unobserved errors. See [task cancellation/shield](https://docs.python.org/3/library/asyncio-task.html#shielding-from-cancellation).
- DatasetLibrary confirms the filename/permanence, serializes confirmation clicks,
  handles conflicts without changing replay, and refreshes while keeping another
  recording's preview mounted. A timeout means the result is uncertain: refresh.
  Finishing playback does not close its socket. The delete confirmation now offers
  an explicit built-in switch and waits for a valid built-in frame before enabling
  deletion; metadata success or an open socket alone does not establish readiness.

Interview questions: Why do paused sockets block deletion? What breaks if the
reference is incremented after opening Parquet? Why must HTTP cancellation not
release a delete reservation immediately? Why hide a partial deletion rather than
restore it? Why is a local counter insufficient with two Uvicorn workers?

## E5a — bounded upload processing

- Streaming means consuming bounded chunks/rows, not calling read() once or
  collecting observations in a list. Multipart first spools a file; its exact
  byte limit is counted as parts arrive. Row limits count logical CSV records,
  while csv.reader.line_num preserves physical error lines, including quoted cells.
- [iter_validated_rows](../backend/app/ingestion.py) is the same validation producer
  for builtin and uploaded data. [resolve_candidate_groups](../backend/app/ingestion.py)
  keeps a conflict interval across fetch boundaries and reuses anchored scoring.
- [normalize_upload](../backend/app/upload_normalization.py) stages typed rows on
  disk, sorts/deduplicates in DuckDB, fetches small batches, writes one Parquet and
  verifies both directions with EXCEPT ALL. Temporary files and DB are transport,
  not another dataset catalog. SQL sort/window operators need buffering or spill;
  see [DuckDB tuning](https://duckdb.org/docs/stable/guides/performance/how_to_tune_workloads.html).
- [run_import](../backend/app/datasets.py) owns the upload spool and one-import lock
  while a worker runs. Disconnect/cancellation sets an event; cleanup is awaited
  before either resource is released. Publication is the directory rename boundary.
- Byte limits protect transport/disk; row and conflict-work limits protect CPU and
  indexing work. A short CSV can have many rows, or few huge fields. Bounded Python
  batches do not make DuckDB/allocator RSS constant. The Linux VmHWM measurements
  in DATASETS.md include native memory; the engine's 128 MiB setting excludes some
  overhead. [measure_upload.py](../scripts/measure_upload.py) uses fresh processes.

Interview questions: Why are byte and row limits both necessary? Why does a
processing batch boundary not end a duplicate interval? Why compare EXCEPT ALL in
both directions? Why must a cancelled HTTP handler wait before closing its spool?
What work still scans a whole file despite a small returned replay window?

## Vessel selection — stable pointer targets

Leaflet translates a native marker click into `VesselMarker`'s callback, which
calls App's local `setSelected(id)` and immediately updates the highlight/panel.
Heading changes recreate DivIcon's inner HTML; a pointer gesture must target the
stable outer marker, so decorative glyphs use
[pointer-events: none](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/pointer-events).
This retains the existing 32px target and keyboard interaction.

A React rerender updates props; it need not remount the marker. Stable ID keys
preserve identity ([React state preservation](https://react.dev/learn/preserving-and-resetting-state)).
Replay frames update observations, while local selection persists through gaps;
selection needs no server query or acknowledgement. Interview question: why can
replacing a child DOM node lose a click even when its React component stays mounted?

## I1 — motion and vessel discovery

- [useMarkerMotion](../frontend/src/hooks/useMarkerMotion.ts) interpolates only the
  display between two received consecutive fixes. A fraction in [0,1] moves the
  Leaflet marker; it never writes intermediate values to the frame or source.
  [requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame)
  schedules repaints, not replay seconds. Duration is 1,000/speed ms; gaps and large jumps snap.
- [Effect cleanup](https://react.dev/reference/react/useEffect) cancels the pending
  callback on frame replacement/unmount. Commands increment a revision immediately,
  preventing an animation even if React batches the command and its response.
- React renders confirmed frames and local selection; animation ticks update a
  Leaflet ref without React state. Stable keys preserve markers and the mounted map;
  selection rerenders do not restart motion. No new memoization was introduced.
- [VesselSearch](../frontend/src/components/VesselSearch.tsx) filters metadata IDs,
  calls the same local selection setter as map clicks, and labels absent observations.
  Its dataset key clears the filter on switching. Search does not query the backend.

Interview questions: Why does catch-up animation lag instead of predict? Why can
consecutive frame numbers still be a seek? Why keep details/trails separate from
animated display coordinates? What does an effect cleanup cancel?

## I2 — upload feedback and recording metadata

- A multipart FormData body includes CSV bytes plus boundaries/headers; the browser
  sets its Content-Type. Native [XHR upload events](https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest/upload)
  report transferred request-body bytes when the total is computable. That percentage
  measures transfer, not validation or Parquet conversion. Known 100% starts an
  indeterminate wait; Firefox may delay upload.load until the final HTTP response.
- UploadCsv uses idle/uploading/processing/completed/failed/cancelled states. Only a
  validated successful response confirms completion. A synchronous request ref blocks
  duplicate submits and ignores old callbacks; abort cancels the request on demand or
  unmount. Server cleanup is cooperative, so retry may initially receive import-busy.
  Lost confirmation or cancellation near publication requires refreshing before retry.
- RecordingInfo combines current replay metadata with existing uploaded metadata
  counts; it labels IST dates and unavailable builtin counts. A dataset key plus
  aborted/ignored stale requests prevents information leaking across switches.

Interview questions: Why is 100% uploaded not 100% imported? Why omit a progress
value during processing? What prevents an aborted request from overwriting retry
state? Why must an uncertain response not automatically trigger another import?
