# AI and resources

Human verification is not claimed. Test outcomes and failures belong in BUILD_LOG;
this file records contributions and reviewer scope.

Current implementation includes the original assignment, E1–E5a, I1–I3, Coastal
Editorial UI, ship/full-route visualization and the independent-column/dialog fix.
Earlier sections are dated history, including their then-current verification
limits; the Phase 7 entry records final readiness checks.

## Phase 1 — 6 Nov 2026
- Codex authored the foundation, audit/tests, container setup, agent/skill definitions
  and documentation. Independent session subagents followed project data/release
  instructions; their findings and fixes are preserved in the condensed build log.
- Official [FastAPI](https://fastapi.tiangolo.com/tutorial/first-steps/),
  [Vite](https://vite.dev/guide/), [Docker](https://docs.docker.com/compose/),
  [Nginx](https://nginx.org/en/docs/http/websocket.html) and
  [Codex agents/skills](https://learn.chatgpt.com/docs/agent-configuration/subagents)
  informed setup. Skill Creator guided frontmatter/workflows; isolated PyYAML
  validated skills without adding an app dependency.
- [Praman docs](https://github.com/Adwaith-R-Nair/Praman/tree/main/docs) inspired
  chronology and evidence, without copied content. GitHub API/raw reads supplied
  the reference after a failed browser fetch. Local bundled Playwright/Firefox
  verified the actual Docker page/screenshot after the connected browser failed;
  a temporary Playwright install in `/tmp` was unnecessary and not a project dependency.
- Native custom-agent discovery was not verified; release reviewer did not independently
  rebuild containers or launch a browser. No commits/pushes were made by Codex.

## Phase 2 — 6 Nov 2026
- Codex investigated raw candidate sequences; authored shared parsing, ingestion,
  in-memory indexes, startup/meta integration, tests and requested documentation cleanup.
- Consulted [Python CSV](https://docs.python.org/3/library/csv.html),
  [datetime](https://docs.python.org/3/library/datetime.html) and
  [FastAPI lifespan](https://fastapi.tiangolo.com/advanced/events/); reread Praman's
  BUILD_LOG through its raw URL for concise chronological style.
- Independent data_reviewer followed the existing TOML instructions through a session
  subagent, ran tests and separate raw-CSV/geographic calculations, verified source
  integrity, and found acceptance of invalid offset minutes. Codex fixed that defect
  with regression tests. Data re-review independently passed 59 tests and confirmed
  the final audit/decision records, with no remaining findings.
- Release reviewer independently checked tests, raw audit, source/container hashes,
  Compose configuration/running containers, health/meta, whitespace and documentation
  against Git history. Corrected its startup-readiness wording comment. It inspected
  rebuild evidence but did not rebuild independently or repeat browser checks.
- Codex executed final rebuild/start, audit/count reconciliation, source-byte comparison,
  health/meta requests, updated skill validation and whitespace checks. No commits or
  pushes performed in this phase; frontend and its labeled foundation screenshot unchanged.

## Phase 3 — 6 Nov 2026
- Codex implemented the replay clock/frames, socket loop, proxy/transport setup,
  fake-clock/ASGI tests and real-network smoke script; updated concise protocol and teaching docs.
- Consulted official [FastAPI WebSockets](https://fastapi.tiangolo.com/advanced/websockets/),
  [Nginx upgrades](https://nginx.org/en/docs/http/websocket.html),
  [asyncio waits](https://docs.python.org/3.14/library/asyncio-task.html) and
  [monotonic time](https://docs.python.org/3.14/library/time.html#time.monotonic).
- Independent replay_reviewer followed project instructions through a session subagent,
  inspected clock/trail/protocol/cleanup behavior, ran 115 tests, and separately
  exercised 1,000 invalid messages during playback; no actionable findings. It did
  not repeat Docker/network tests or prolonged idle/browser rendering checks.
- Codex ran actual Docker/Nginx WebSocket and HTTP checks, the complete tests and
  frontend build; screenshot/UI unchanged. No commits or pushes in this phase.
- Independent release_reviewer ran tests with the absolute venv interpreter,
  frontend build, actual network smoke/reconnect and HTTP/config/source/audit checks;
  found no actionable issues. It did not rebuild Docker, exercise prolonged idle/load,
  test browser replay rendering or revalidate the unchanged foundation screenshot.

## Phase 4 — 6 Nov 2026
- Codex authored the typed socket hook, metadata loading, Leaflet layers, responsive
  map UI, focused Playwright tests and documentation. Backend implementation unchanged.
- Consulted official [React effects](https://react.dev/reference/react/useEffect),
  [React Leaflet](https://react-leaflet.js.org/docs/api-map/),
  [Leaflet 1.9](https://leafletjs.com/reference-1.9.4.html),
  [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/) and
  [Playwright mocking](https://playwright.dev/docs/mock#mock-websockets).
- Independent replay_reviewer read the rendering/lifecycle code and ran the browser
  suite/build; targeted re-review independently passed six tests after the keyboard
  selection fix. It used mocked tiles/frames, not real data/network checks.
- Codex-operated local Firefox verified actual Docker/Nginx, OSM tiles, real vessel
  motion/pause and gap states, keyboard/click selection, responsive layout and actual
  screenshots. Direct WebSocket seek commands were test instrumentation, not new UI.
  Human verification is not claimed. No commits/pushes.
- Release reviewer independently reran browser/backend tests, frontend build, real
  WebSocket smoke and configuration/source checks; requested learning-note wording
  corrections and visually verified final settled desktop/mobile screenshots. It
  did not rebuild images or repeat real tile/motion or prolonged-load checks.

## Phase 5 — 6 Nov 2026
- Codex implemented timeline/details/layout, ordered command acknowledgement and
  focused browser tests, with existing backend/protocol/dependencies unchanged.
  Updated teaching notes and concise phase records; no commits/pushes.
- Consulted official [React controlled inputs](https://react.dev/reference/react-dom/components/input),
  [React refs](https://react.dev/reference/react/useRef) and
  [MDN range input](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/range).
- Independent replay_reviewer inspected synchronization, races, missing data and
  cleanup; ran 13 browser tests, then independently reproduced focus loss with delayed
  acknowledgements. Codex fixed it and added a regression. Re-review passed five
  targeted tests and reported no remaining findings; mocked Firefox scope only.
- Codex ran 14 mocked-frame/tile browser tests, backend tests/build, Docker rebuild,
  real network smoke and actual Firefox UI with real tiles/data. UI-driven seeking
  verified real gaps, T007, reset/boundaries and active 10× pause→seek→resume;
  additional real UI checks measured 2×/5× progression with tiles blocked.
  Temporary desktop/mobile captures were visually inspected; repository preview
  remains explicitly labeled Phase 4. Human verification is not claimed.
- Independent release_reviewer inspected all changed/new code and docs, reran
  14 browser tests, 115 backend tests, production build, actual network/config/source
  checks and visually inspected temporary captures; no actionable findings. It did
  not rebuild images or repeat the parent's real-tile UI checks. Prolonged idle/load,
  other browser engines and comprehensive tile-provider outages remain unverified.

## Phase 6 — 6 Nov 2026
- Codex reviewed existing source/tests/assignment, reproduced recovery failures,
  added minimal hook fixes and browser regressions, corrected stale audit/scope
  wording and kept final screenshot/README/submission work for Phase 7. No new
  dependencies, backend/data policy changes, commits or pushes.
- Independent data_reviewer reconciled every accepted observation and all 1,800
  frames against raw source, including 2,108,050 trail points; no data defect.
  Replay reviewer independently reproduced both recovery bugs, reran 17 browser
  tests after fixes and separately verified a stalled CONNECTING socket and cleanup.
- General reviewer followed release-reviewer instructions, checked Leaflet layout/
  keyboard behavior at five viewport widths and proportional security source
  handling. Security-audit guidance was used only for source review; no full audit,
  dependency vulnerability scan or external security probing was performed.
- Codex executed current tests/build, read-only audit/source comparison, Docker
  rebuild/network checks and real-backend Firefox interactions with mocked tiles.
  The 90-second paused/playing two-tab check passed through Nginx with one socket
  each and no browser errors. General re-review independently reran 17 browser
  tests, build/typecheck and whitespace checks; no unresolved findings. No new web
  resources consulted and no human verification claimed.

## E1 — 7 Nov 2026
- Codex implemented bounded multipart import, shared configurable normalization,
  typed DuckDB/Parquet I/O, atomic metadata publication, Docker volume and minimal
  React upload UI/tests. Used local csv-audit/build-journal skills; kept original
  source and replay dataset intact. No commit/push or final submission preparation.
- Consulted official [FastAPI uploads](https://fastapi.tiangolo.com/tutorial/request-files/),
  [Starlette request limits](https://starlette.dev/requests/), local pinned Starlette
  parser/body-limit source and [DuckDB Python API](https://duckdb.org/docs/stable/clients/python/reference/).
  A direct DuckDB TIMESTAMPTZ fetch required optional pytz; explicit SQL UTC string
  conversion avoided adding it, while retaining timezone-aware Parquet timestamps.
- Independent data reviewer reproduced extreme-date overflow, advised DST/work
  limits and verified full Parquet fidelity including extreme doubles/Unicode IDs.
  Replay reviewer independently compared all 1,800 frames to HEAD. Release reviewer
  reproduced truncated multipart acceptance; Codex fixed it with closed-spool
  regression evidence. Re-review passed 25 upload tests and 19 Chromium tests.
- Codex executed backend/build/browser, Docker/volume-recreation and real-backend
  upload/playback checks; UI tiles were mocked. Firefox installation was needed in
  this session; all 19 Firefox tests passed, independently repeated by the replay reviewer. Final
  release documentation review found no issues. No human verification or measured
  performance improvement is claimed.

## E2 — 8 Nov 2026
- Codex implemented discovery/metadata validation and trusted-ID APIs, bounded
  DuckDB preview, read-only library/details UI, upload-triggered refresh and tests.
  Applied build-journal; kept original CSV/ingestion/replay and existing volume intact.
- Consulted official [DuckDB Parquet](https://duckdb.org/docs/data/parquet) and
  [SELECT/ORDER BY/LIMIT](https://duckdb.org/docs/current/sql/statements/select)
  documentation. Local storage/parser code supplied E1 compatibility details.
- Independent data reviewer ran 45 upload/catalog tests and compared 100 previews
  against raw source; replay reviewer ran regressions and separate delayed-response
  checks. Release reviewer ran 160 backend tests/build and initial browser suite.
  Final release re-review passed five new library tests, checked live details/preview
  for eight recordings and reviewed documentation; no actionable findings.
- Codex ran 160 backend/24 Firefox tests, build and actual Docker/API/UI/restart
  checks with mocked map tiles. A shared Vite shutdown interrupted the first expanded
  browser run; isolated rerun passed. Temporary visual captures were inspected;
  no new submission screenshot, human verification, performance claim or commit/push.

## E3 — 8 Nov 2026
- Codex implemented TrackStore adapters, bounded Parquet replay, per-connection
  dataset selection, metadata preflight and React switching lifecycle/tests/docs.
  Applied replay-verification and build-journal skills; retained source/volume data.
- Consulted official [DuckDB Python API](https://duckdb.org/docs/stable/clients/python/reference/),
  [Parquet querying](https://duckdb.org/docs/data/parquet) and
  [React Leaflet map API](https://react-leaflet.js.org/docs/api-map/).
- Independent data reviewer compared source/store frames at gap/window boundaries
  and reproduced the corrupted-value preflight issue; re-review passed three fix
  regressions. Replay reviewer ran 56 regressions, synthetic parity and multi-dataset
  ASGI isolation checks. Release reviewer ran 70 replay/storage tests and source,
  Compose/whitespace checks; final documentation re-review and independent real
  two-upload Nginx smoke passed, with rebuilt services healthy and source unchanged.
- Codex ran 174 backend/29 Firefox tests, build, Docker rebuild and real Nginx
  default/two-upload WebSocket checks plus actual-backend Firefox switching with
  mocked tiles. Initial browser harness failures were corrected without changing
  playback assertions. No human verification, scaling measurement or publishing claimed.

## E4 — 8 Nov 2026
- Codex implemented per-session references/deletion reservations, trusted-ID DELETE,
  atomic hide/nonrecursive filesystem cleanup, confirmation/error UI and tests.
  Used replay-verification/build-journal skills; preserved ingestion/replay queries.
- Consulted official [Python filesystem APIs](https://docs.python.org/3/library/os.html#files-and-directories)
  and [asyncio cancellation/shield](https://docs.python.org/3/library/asyncio-task.html#shielding-from-cancellation)
  for descriptor-relative operations and cancellation ownership.
- Independent replay reviewer ran 70 existing replay/storage tests plus temporary
  cancellation, failed-open/accept and multiple-paused-client probes. Release
  reviewer ran 59 catalog/upload/storage tests and temporary deletion/partial-failure,
  symlink/extra-file and cancelled-deletion probes. Neither edited implementation;
  no confirmed actionable issue was reported. Final release review independently
  passed 24 deletion tests, nine library Firefox tests on port 5182, original real
  WebSocket smoke and read-only isolated API/Compose/source/whitespace checks;
  documentation and temporary conflict visual review found no issue.
- Codex ran 198 backend/33 Firefox tests, typecheck/build, source/whitespace checks,
  and real isolated Docker/Nginx deletion/restart/browser checks. Only newly created
  test uploads were deleted; normal upload storage was not used for destructive
  checks. Map tiles were mocked and temporary screenshots visually inspected;
  no human verification, scaling results, final screenshot or publishing claimed.
- E4 follow-up: Codex traced the user's loaded-singleton screenshot to a missing
  confirmation-local switch action, reproduced a failing regression and added
  explicit switch/readiness/reconnect handling. Independent release review ran
  12 library Firefox tests on :5182 and found no remaining issue. Codex ran 36
  browser/24 deletion backend tests, build, main Docker rebuild and real-browser
  main read-only switch plus isolated two-tab deletion checks; normal library
  metadata remained unchanged. Original WebSocket/source/whitespace checks passed.

## E5a — 8 Nov 2026
- Codex implemented shared streaming validation/conflict iteration, disk-backed
  DuckDB upload staging and SQL Parquet verification, limits API/UI/proxy settings,
  disconnect/cancellation ownership, tests and reproducible measurement script.
  Applied csv-audit, replay-verification and build-journal skills.
- Consulted official [DuckDB workload tuning](https://duckdb.org/docs/stable/guides/performance/how_to_tune_workloads.html)
  and [Python API](https://duckdb.org/docs/stable/clients/python/reference/).
  Cross-checked memory reporting and used Linux VmHWM for the final process peaks;
  no resource-based preliminary figure is presented as the final peak.
- Data reviewer independently compared HEAD/current normalization, complete source
  tuples/provenance and counters, including accepted/rejected randomized fixtures,
  tiny fetch boundaries, Unicode, doubles and extreme dates; 72 ingestion/upload
  tests passed. Replay reviewer passed 70 replay/storage tests plus read-only 1M
  store/ASGI boundary/cache/isolation probes. Release reviewer passed 25 upload and
  three cancellation/disconnect tests and reviewed multipart/config/source safety.
  Final release review independently passed four configured/chunked/cancellation
  cases and main health/limits/Compose checks; its stale E3 performance wording
  finding was corrected. No unresolved implementation finding remained.
- Codex executed 211 backend/38 Firefox tests, build, serial 100K/500K/1M measurements,
  real isolated Nginx byte/row/cancellation/replay/browser/restart checks and main
  Docker rebuild with existing-recording preservation. UI tiles were mocked;
  no human verification, final screenshot or month-scale result is claimed.

## Vessel selection fix — 8 Nov 2026

- Codex traced native pointer → Leaflet → React selection, reproduced a lost click
  across heading-driven SVG replacement, applied the CSS fix and added six pointer
  regressions plus selection assertions after recording switches. Used the
  replay-verification and build-journal skills; consulted MDN pointer-events and
  React state-preservation documentation alongside installed Leaflet source.
- Independent replay review passed 56 backend replay tests and checked event/state
  ownership. Release review found repeated-target test assertions too weak;
  alternating targets fixed that finding, with no remaining actionable findings.
- Codex ran backend/browser/build checks, rebuilt main Docker, and exercised real
  20/100-vessel playback using a new upload only in the isolated test volume.
  Browser instrumentation checked marker identity, click feedback and animation
  frame intervals. Tiles were mocked; no human verification is claimed.

## I1 — 8 Nov 2026

- Codex inspected replay/Leaflet data flow, added confirmed-position animation,
  command cancellation and metadata-based local vessel search, and wrote controlled
  animation-clock browser tests plus recording-switch/search regressions. Applied
  replay-verification/build-journal skills and consulted official MDN animation-frame
  and React effect-cleanup documentation.
- Independent replay review executed 58 replay/socket/metadata tests; release review
  executed build, two metadata tests, live metadata/health, Compose, source hash and
  whitespace checks. Neither reviewer edited implementation or claimed browser runs.
- Codex executed 211 backend and 55 Firefox tests, production build, main Docker
  rebuild, WebSocket regression and live Firefox checks on builtin/50-vessel uploaded
  playback. Animation callback instrumentation checked pause/switch cleanup; temporary
  mobile visual QA was inspected with mocked tiles. No human verification or general
  performance improvement is claimed.

## I2 — 8 Nov 2026

- Codex inspected upload parsing/cancellation, normalization, catalog and Nginx, then
  implemented XHR transfer feedback/cancel and current-recording metadata UI without
  changing backend/storage rules. Applied build-journal/replay-verification skills
  and consulted MDN XHR upload/progress documentation.
- Codex executed 211 backend/60 Firefox tests, build and main Docker preservation
  checks. A test-only throttled HTTP proxy exposed Firefox's delayed upload.load;
  native byte progress now changes the busy stage at measured completion. Controlled
  event tests are distinguished from real transfer/cancellation tests. Corrected the
  new sibling key collision and method-insensitive deletion fixtures.
- Independent replay review passed 56 tests; release review executed typecheck,
  Compose/health/hash/whitespace checks and reviewed the event-order correction.
  Real upload tests used an isolated persistent volume; main-recording metadata and
  previews stayed unchanged. Tiles were mocked and temporary mobile QA inspected;
  no human verification or general performance improvement is claimed.

## I3 — 8 Nov 2026

- Codex inspected storage/replay/lifecycle code, authored four isolated profiling
  scripts and five regression tests, measured baseline/current behavior, and kept
  only bounded overlap reuse and unchanged-tick avoidance. Applied csv-audit,
  replay-verification and build-journal skills; consulted official DuckDB tuning,
  Parquet/indexing and PostgreSQL concurrency documentation.
- Independent reviewers inspected data/replay/release scope without implementation
  edits. Data review reproduced the fractional-window omission, then verified all
  12 Parquet pairs, complete original parity and four targeted tests. Replay review
  ran 75 tests. Release review passed 36 targeted tests and identified hardcoded resource sampling and inaccurate
  paint terminology in probes; both corrected. Benchmark-only parity initially
  exhausted its memory-only SQL budget; disk-backed verification fixed that check.
- Codex executed 216 backend/60 Firefox tests, production build, paired real Docker
  HTTP/WebSocket and production-browser probes, main rebuild and read-only existing
  recording preservation/integration checks. Browser tiles were mocked; timing uses
  next-rAF feedback proxies. No human verification, generic capacity guarantee,
  final submission verification, commit or push is claimed.

## Frontend UX/layout redesign — 8 Nov 2026

- Codex authored the workspace/tabs, bounded autocomplete and sidebar detail view,
  nullable replay lifecycle and one-confirmation deletion UI, plus browser regressions.
  Used build-journal/replay-verification skills. The user-supplied
  [AIS demo](https://github.com/HoangSonDeveloper/ais-demo) and overview screenshot
  informed visual hierarchy only; no source/assets copied. Consulted WAI combobox
  and MDN WebSocket-close documentation for accessibility/lifecycle behavior.
- Independent replay review inspected shutdown/preflight/empty-state races; release
  review found off-screen keyboard highlights. Codex corrected scrolling and added
  a bounding-box regression, and visual QA corrected upload/details crowding.
  Reviewers did not edit implementation or claim the parent's browser runs.
- Browser checks use controlled API/socket fixtures and mocked tiles; separate real
  Docker checks use disposable isolated uploads, including another live client.
  Codex executed 216 backend/69 Firefox tests, build, main preservation/WebSocket
  checks and actual main desktop/mobile QA with real OSM tiles.
  No real user recording was deleted, no human verification is claimed, and final
  assignment screenshot/submission work remains deferred.

## Coastal Editorial redesign — 8 Nov 2026

- Codex inspected and installed original upstream skills: [ui-ux-pro-max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill), [frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design), and Vercel [web-design-guidelines/react-best-practices](https://github.com/vercel-labs/agent-skills). Used their design, accessibility and stable-rendering guidance; UIUX search returned generic landing-page suggestions, so the user's Coastal brief governed composition. No remote installation script or component framework was added.
- [AIS demo](https://github.com/HoangSonDeveloper/ais-demo) screenshots informed warm surfaces, hierarchy and spacing only; no source/logo/assets copied. Google Fonts supplied licensed Newsreader/Source Sans 3 subsets with OFL notices. Codex used build-journal/replay-verification, implemented React/CSS/tests, inspected four real viewport captures and made an intentional critique/refinement pass.
- Independent read-only replay/release reviewers identified hidden-map fitting, boundary contrast and duration-label issues; Codex fixed them. Actual checks: 216 backend/72 Firefox tests, typecheck/build, isolated real import/delete/protection flows, main Docker/read-only replay/data-preservation checks and real OSM screenshots. Fixture tests and isolated interaction checks mock tiles; visual captures do not. No human verification, performance gain, final submission work, commit or push is claimed.

## Ship markers/full routes — 8 Nov 2026

- Codex inspected the existing map, motion, selection, protocol, stores and SQL; authored original ship SVGs, bounded exact-route retrieval/cache, UI request lifecycle and focused tests. Applied build-journal/replay-verification; consulted the already-installed frontend-design guidance while preserving the user's theme. No generated raster assets, new dependencies or external source code were added.
- Independent data/replay reviewers executed nine route tests and checked exact normalized parity, caps, gaps and cancellation; release review identified checkbox CSS and inspected real rendered screenshots. Codex corrected that issue and the production-only path-class initialization discrepancy, then ran 225 backend/78 browser tests, build, main Docker/WebSocket and actual real-OSM browser checks. Fixtures mock API/socket/tile responses; separate main checks use real recordings. No human verification or rendering-performance improvement is claimed.

- **8 Nov 2026, layout/dialog fix:** Codex measured the live grid/DOM before editing, implemented independent replay columns/native recording dialog and six new browser regressions, then executed 84 Firefox tests, build and main Docker/real replay/40-state layout checks. Read-only replay/release reviewers checked lifecycle, layout and accessibility; release review independently probed native keyboard scrolling. Actual main screenshots use real OSM requests; long IDs use controlled test fixtures. No backend or source-data changes, human verification claim or publishing.

## Phase 7 — 8 Nov 2026

- Codex reread the original assignment/current source and Git history, reconciled current documentation without rewriting dated records, and rewrote the README. Captured genuine production Firefox replay/library screenshots with real OSM tiles; PNG compression preserves image data losslessly. No generated UI images or new product features.
- Codex executed 225 backend/84 browser tests, typecheck/build, a no-cache Docker build from a fresh public clone, isolated real import/deletion/persistence checks and main read-only replay/layout checks. Full-source Parquet parity and source bytes were verified; destructive checks used only new isolated recordings. No human verification is claimed.
- Independent data/replay/release agents performed read-only final checks, including data tests, replay regressions, deployment/source hygiene and final README/screenshots. Actual commands/results are recorded in BUILD_LOG. No commit, merge, push or submission was performed by Codex.
