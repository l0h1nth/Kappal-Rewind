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
