# Build log

Append dated entries; correct earlier findings in later entries rather than
rewriting recorded results. Dates/times use IST.

## 6 November 2026 — assignment and source inspection
- Objective: understand the private two-page assignment and stop at the requested foundation.
- Read the pasted user request and both PDF pages with `pdftotext -layout`; recorded final requirements in PLAN.md.
- Inspected raw CSV with independent standard-library grouping and expected-second comparison.
- Found 35,820 rows, 20 IDs, 40 conflicting duplicate keys, 220 missing vessel-seconds and mixed timestamps.
- Recorded exact source evidence, timezone assumption and proposed policies in DATA_AUDIT; no normalization applied.
- Read official FastAPI/Vite/Compose/Nginx and Codex custom-agent docs; fetched Praman BUILD_LOG/DECISIONS for documentation philosophy.
- Problem: browser fetch of the Praman directory failed; GitHub API/raw-file reads succeeded instead.
- `git status --short` initially failed because the folder was empty and not a Git repository; initialized `main` without a commit.
- Next: build a minimal same-origin skeleton; reserve ingestion and replay for later reviewed phases.

## 6 November 2026 — skeleton and initial checks
- Added React/TypeScript/Vite page, health fetch, FastAPI endpoint, Dockerfiles, Nginx and Compose; copied CSV byte-for-byte.
- Added read-only audit, initial Pytest cases, three Codex reviewer TOMLs, three skills and concise engineering docs.
- `npm install` succeeded: 24 packages added, 0 reported vulnerabilities. Initial `npm run build` passed typecheck/bundle.
- `uv venv` initially selected Python 3.11; recreated explicitly with `/usr/bin/python3.14` to match Docker and recompiled both requirements locks.
- Installed locked development dependencies. Initial backend run: 9 passed, with a Starlette TestClient HTTPX deprecation warning and relative-path interpreter warnings.
- Switched health test to HTTPX ASGITransport and used the absolute interpreter path; subsequent run: 10 passed in 0.41s, no warnings.
- Independent data review confirmed source measurements and found fractional seconds could corrupt second-grid totals; excluded them from grid counts and added a regression test.
- Latest local `npm run build` passed after health-effect cleanup fix. `docker compose config --quiet` passed; Docker build/start verification remains in progress at this entry.
- Skill validator initially failed three times due to absent PyYAML; retrying with isolated `uv run --with pyyaml`. All four TOMLs parse; required agent keys present.
- Next: finish Docker/browser checks, record actual outcomes, run scoped release review and stop for foundation review.

## 6 November 2026 — Docker and browser verification
- `docker compose up --build -d --wait` succeeded; backend and frontend are healthy. Rebuilt after final frontend cleanup change.
- Docker warned that buildx is unavailable and used its classic builder successfully; no BuildKit-specific features are needed.
- `curl --fail --silent http://localhost:8080/api/health` returned `{"status":"ok"}`; container `nginx -t` passed.
- `cmp` verified source byte identity; hashing the container-mounted CSV returned the same SHA-256. Git ignores PDFs; source PDF remains outside the repo.
- `uv run --with pyyaml python …/quick_validate.py` passed for all three skills; PyYAML stayed outside application dependencies.
- Connected Playwright navigation failed with connection refused; local bundled Playwright/Firefox could reach the app and verified it instead.
- Local browser check: title correct, “Backend connected”, health HTTP 200, zero page errors, no horizontal overflow at 390×844.
- Intercepted HTTP 503 and a stalled health request: both showed “Backend unavailable”; captured actual desktop screenshots/foundation.png at 1280×900.
- Independent data re-review: fractional-second issue fixed, DATA_AUDIT matches source; reviewer ran 10 tests successfully without warnings.
- `git diff --check` passed for tracked changes (files are still untracked). Next: scope-limited release review; stop before ingestion/replay.

## 6 November 2026 — release review and handoff
- Release reviewer independently checked assignment/current scope, code/docs, healthy services, health route, Nginx configuration and actual screenshot.
- Found a README command bug: `realpath` dereferenced the venv Python symlink into the system interpreter, producing `No module named pytest`.
- Fixed instructions to activate the venv before `(cd backend && python -m pytest -q)`; parent ran exact commands: 10 passed in 0.40s, no warnings.
- Reviewer independently reran the corrected commands: 10 passed in 0.39s, no warnings; no remaining actionable foundation findings.
- A first untracked whitespace wrapper misread normal `git diff --no-index` exit 1 as a failure; corrected diagnostic handling and checked 31 text files with no issues.
- Final repository has 39 project files; ignored local caches/dependencies are omitted from the handoff tree. No empty `.github` directory or placeholder workflow added.
- Reviewer/skill files validate, but native custom-agent discovery has not been tested in a fresh Codex session; reviews here used session subagents with those instructions.
- Docker services remain running at :8080. Git initialized on main, no commits/remotes/pushes; private PDF was not copied into the repository.
- Foundation and initial audit are complete; runtime ingestion, map, WebSocket/replay, final screenshot and final submission remain pending.
- Next: user reviews foundation; phase 2 implements tested normalization/ingestion before replay. Study timezone, duplicate policy and gap representation first.
