# AI and resources — 6 November 2026

| Tool/resource | Actual contribution | Verification |
| --- | --- | --- |
| Codex, this chat | Read request/assignment; authored foundation code, audit/tests, container setup, reviewer/skill definitions and docs. | Agent executed checks recorded in BUILD_LOG. User has not yet independently verified the work. |
| Independent Codex data_reviewer | Read raw CSV and audit/tests, executed audit and tests; confirmed counts and found a fractional-second aggregation defect. | Parent added a regression test and fix; 10 tests then passed. No file edits by reviewer. |
| [Official Codex custom agents](https://learn.chatgpt.com/docs/agent-configuration/subagents#custom-agents) | Confirmed standalone agent TOML fields and project configuration. | Parsed local TOML and checked required keys; native discovery not yet exercised in a new Codex session. |
| Skill Creator and [official skills docs](https://learn.chatgpt.com/docs/build-skills) | Guided lightweight SKILL.md frontmatter and workflow design. | Bundled validator initially failed for absent PyYAML; isolated retry pending at this entry. |
| [FastAPI first steps](https://fastapi.tiangolo.com/tutorial/first-steps/), [Vite guide](https://vite.dev/guide/), [Docker startup order](https://docs.docker.com/compose/how-tos/startup-order/), [Nginx WebSockets](https://nginx.org/en/docs/http/websocket.html) | Informed health route, build, readiness ordering and future proxy requirements. WebSockets not implemented. | Local tests/build passed; container/browser check pending at this entry. |
| [Praman docs](https://github.com/Adwaith-R-Nair/Praman/tree/main/docs) | Read BUILD_LOG and DECISIONS via GitHub API/raw URLs; inspired concise chronology, evidence and decision tradeoffs. | No project content copied. Web fetch of directory failed before the API fallback. |

No claim of human-authored implementation or human verification. No commit, push,
public repository, submission email, AI API integration, or external vessel data.
Later validation and reviewer outcomes are appended below as they happen.

## Verification update
- All three skills passed the bundled validator using isolated `uv run --with pyyaml`.
- Docker build/start, same-origin health, Nginx config, mounted dataset hash and local
  Firefox browser checks succeeded; screenshot is from the actual Docker-served page.
- Connected browser tool could not reach localhost; local bundled Playwright/Firefox
  provided the successful fallback. An unnecessary temporary Playwright npm install
  was made under `/tmp/kappal-browser` before finding the bundled library; it is not a
  project dependency.
- Data reviewer rechecked the fix and DATA_AUDIT, independently ran 10 tests with no
  warnings and reported no further actionable findings. Human review is still pending.
- The browser's unavailable/timeout states were tested with intercepted responses,
  not by disrupting the backend container. Full replay behavior is unimplemented.

## Release review update
- Independent Codex release_reviewer read assignment/current implementation/docs,
  ran tests, checked Docker health/Nginx/HTTP and visually inspected the screenshot.
- Found and reproduced the README's venv interpreter `realpath` bug. Codex fixed
  the command to activate the venv; parent and reviewer independently ran the
  revised commands (10 tests passed, no warnings). Reviewer reported no remaining
  actionable foundation findings.
- Reviews used this session's subagents following the project TOML instructions;
  native agent discovery in a fresh session is still unverified. The release reviewer
  did not independently rebuild containers or launch a browser.
- All verification so far was performed by AI-operated tools. Human verification
  remains pending. No ingestion or replay implementation was generated.
