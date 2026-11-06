# AI and resources

Human verification is not claimed. Test outcomes and failures belong in BUILD_LOG;
this file records contributions and reviewer scope.

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
