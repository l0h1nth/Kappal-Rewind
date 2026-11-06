# Learning notes

| Component | What/why; how it works here | Study / interview question |
| --- | --- | --- |
| [React](https://react.dev/learn) + TypeScript | React renders the page; state holds health status. TypeScript checks source types before building; JSON still needs runtime validation. An effect fetches health and cancels on cleanup. | State vs effect; why can a TypeScript cast not validate an API response? |
| [Vite](https://vite.dev/guide/) | Local dev server and production bundler. Compiles TSX and bundles assets into `dist`; dev `/api` proxy targets :8000. | Why is the development server unnecessary in the final image? |
| [FastAPI](https://fastapi.tiangolo.com/tutorial/first-steps/) + Uvicorn | FastAPI declares routes; Uvicorn runs the ASGI app on :8000. Startup validates data before serving; health retains its small liveness response. | What is the difference between the framework and its server? |
| [Nginx](https://nginx.org/en/docs/http/ngx_http_proxy_module.html) | Serves built HTML/JS/CSS and forwards `/api/health` to `backend:8000/api/health`. Browser sees only localhost:8080. | Why does `backend` resolve inside Docker but not in browser code? |
| [Docker Compose](https://docs.docker.com/compose/) | Builds two images, networks services by name, mounts data read-only and waits for backend health before starting Nginx. Multi-stage frontend build leaves Node tooling out of its serving image. | Why is startup order alone insufficient for readiness? |
| [CSV](https://docs.python.org/3/library/csv.html) + [datetime](https://docs.python.org/3/library/datetime.html) | Audit reads raw strings, validates values, compares UTC keys and counts gaps on a one-second grid. Source bytes remain unchanged. | How can 180 missing CSV rows conceal 220 missing vessel-seconds? |
| [Pytest](https://docs.pytest.org/en/stable/) | Health contract check plus audit tests using raw source and small error/gap fixtures. These do not prove browser or Docker behavior. | What distinct failure does each kind of check detect? |
| [Codex agents](https://learn.chatgpt.com/docs/agent-configuration/subagents#custom-agents) and [skills](https://learn.chatgpt.com/docs/build-skills) | Standalone TOML reviewer instructions live in `.codex/agents`; discoverable workflows use `.agents/skills/*/SKILL.md`. Neither replaces executed evidence. | How does a reusable procedure differ from an independent reviewer? |

Request flow: browser → Nginx :8080 → FastAPI :8000 → JSON response → React state.
The frontend checks once at mount; reload to recheck. It times out after five seconds.
FastAPI now loads the CSV once during lifespan startup; `/api/meta` summarizes
the stored dataset. A validation failure prevents startup; health response stays unchanged.

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
Before Phase 3, study monotonic versus wall-clock time, per-connection state and
[WebSocket lifecycle](https://fastapi.tiangolo.com/advanced/websockets/). No replay code exists yet.
