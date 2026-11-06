# Learning notes — foundation

| Component | What/why; how it works here | Study / interview question |
| --- | --- | --- |
| [React](https://react.dev/learn) + TypeScript | React renders the page; state holds health status. TypeScript checks source types before building; JSON still needs runtime validation. An effect fetches health and cancels on cleanup. | State vs effect; why can a TypeScript cast not validate an API response? |
| [Vite](https://vite.dev/guide/) | Local dev server and production bundler. Compiles TSX and bundles assets into `dist`; dev `/api` proxy targets :8000. | Why is the development server unnecessary in the final image? |
| [FastAPI](https://fastapi.tiangolo.com/tutorial/first-steps/) + Uvicorn | FastAPI declares HTTP routes and serializes the health dictionary to JSON. Uvicorn listens on :8000 and runs the ASGI app. Health means process liveness, not dataset readiness. | What is the difference between the framework and its server? |
| [Nginx](https://nginx.org/en/docs/http/ngx_http_proxy_module.html) | Serves built HTML/JS/CSS and forwards `/api/health` to `backend:8000/api/health`. Browser sees only localhost:8080. | Why does `backend` resolve inside Docker but not in browser code? |
| [Docker Compose](https://docs.docker.com/compose/) | Builds two images, networks services by name, mounts data read-only and waits for backend health before starting Nginx. Multi-stage frontend build leaves Node tooling out of its serving image. | Why is startup order alone insufficient for readiness? |
| [CSV](https://docs.python.org/3/library/csv.html) + [datetime](https://docs.python.org/3/library/datetime.html) | Audit reads raw strings, validates values, compares UTC keys and counts gaps on a one-second grid. Source bytes remain unchanged. | How can 180 missing CSV rows conceal 220 missing vessel-seconds? |
| [Pytest](https://docs.pytest.org/en/stable/) | Health contract check plus audit tests using raw source and small error/gap fixtures. These do not prove browser or Docker behavior. | What distinct failure does each kind of check detect? |
| [Codex agents](https://learn.chatgpt.com/docs/agent-configuration/subagents#custom-agents) and [skills](https://learn.chatgpt.com/docs/build-skills) | Standalone TOML reviewer instructions live in `.codex/agents`; discoverable workflows use `.agents/skills/*/SKILL.md`. Neither replaces executed evidence. | How does a reusable procedure differ from an independent reviewer? |

Request flow: browser → Nginx :8080 → FastAPI :8000 → JSON response → React state.
The frontend checks once at mount; reload to recheck. It times out after five seconds.
Source audit is a separate command; FastAPI does not load the CSV yet.

Before phase 2, study naive vs aware datetimes, dictionaries keyed by vessel/time,
sorting, and deterministic duplicate policies. Later study WebSocket lifecycle,
monotonic replay time, [FastAPI WebSockets](https://fastapi.tiangolo.com/advanced/websockets/),
and [Leaflet](https://leafletjs.com/reference.html). These later components are not built.
