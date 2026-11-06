# Build log

Entries use actual IST dates and 4–7 evidence-based bullets per phase.
The foundation log was condensed once for readability during Phase 2; its original
version remains in Git history (`bc23f51`). Earlier results are unchanged.

## Phase 1 — 6 Nov 2026 · Foundation

- Built React/TypeScript/Vite and FastAPI health behind Nginx; Docker Compose startup, same-origin health and Nginx configuration passed. CSV remained byte-identical.
- Audited 35,820 rows; found conflicting keys, missing observations, mixed timestamps and heading aliases. Data review found off-grid counting corruption; fixed with a regression test.
- Initial venv selected Python 3.11; recreated with 3.14. Replaced deprecated TestClient use and avoided relative-interpreter warnings. Final backend suite: 10 passed without warnings.
- Frontend production build passed; local Firefox verified connected/error/timeout states, no page errors and mobile width. Connected browser could not reach localhost; bundled Firefox supplied the verified screenshot.
- Release review reproduced a README `realpath` bug that bypassed venv packages; corrected activation commands and independently retested (10 passed). Data and release re-reviews reported no remaining foundation findings.
- Skills initially failed validation without PyYAML; isolated retry passed all three. Four TOMLs validated; native discovery remained untested. Docker used classic builder without buildx; a whitespace wrapper's normal exit-1 handling was corrected.
- Read the private assignment and official framework/Codex docs; Praman raw/API reads worked after browser fetch failed. Initialized Git without committing/publishing in that session; ingestion, map and replay were pending at handoff.

## Phase 2 — 6 Nov 2026 · Ingestion and normalization

- Inspected clean foundation commit `bc23f51`; condensed Phase 1 once with originals preserved in Git, and updated AGENTS/build-journal conventions. Reused the existing schema/time parser for audit and runtime.
- Added strict line-specific validation, in-memory UTC/heading normalization, sorted vessel/time indexes, inclusive gaps and discard records; FastAPI lifespan loads once, `/api/meta` returns summary counts/bounds, and health response stays unchanged.
- Investigated both T007 sequences against adjacent observations; retained continuous stationary positions, discarded 40 conflicts without ID reassignment, and represented missing current observations as `None`. Numerical evidence and heuristic limits are in DATA_AUDIT.
- First test run: 52 passed, 2 failed due to an equal-length fixture mislabeled as unique and an incorrect `Z` serialization expectation. Corrected the fixtures without weakening ambiguity checks; 55 then passed. Independent review caught invalid offset minutes accepted by Python; bounded offsets and added four regression cases.
- Final local suite after the offset fix: 59 passed without warnings. Audit and independent raw-source review reconcile 35,820 source rows to 35,780 observations plus 40 discarded, with 220 missing seconds and 11 heading aliases; source checksum/bytes match the original.
- Docker Compose build/start and proxied health/meta passed before final offset rebuild. Final rebuild/re-review and whitespace checks are pending at this entry; stop before WebSockets, map or playback. No commit/push performed.
- Final offset rebuild completed with both services healthy; proxied health/meta and container source hash passed. Data re-review independently passed 59 tests and confirmed policies/evidence; release review independently verified tests/audit/containers/history and requested a startup-readiness wording fix, now corrected. `git diff --check` and updated skill validation passed; Phase 2 complete, awaiting user review before Phase 3.
