---
name: csv-audit
description: Audit the Kappal Rewind source CSV and verify proposed preprocessing with reproducible evidence.
---

# csv-audit

1. Read docs/DATA_AUDIT.md and preserve data/tracks.csv; compare its SHA-256 with the recorded source.
2. Run `python3 scripts/audit_csv.py`. Inspect raw rows for unexpected results rather than trusting prior summaries.
3. Check schema, vessel counts, timestamp formats/timezone, exact and conflicting duplicates, global one-second gaps, coordinates, speed and heading. Record source line examples.
4. Separate measured facts from inferred identity repairs and timezone assumptions. Never rewrite source data or guess vessel identity silently.
5. When ingestion is implemented, test offset equivalence, duplicate policy, invalid values, ordering and gaps; reconcile every dropped or changed row.
6. Run `cd backend && ../.venv/bin/python -m pytest -q`; append actual outcomes to BUILD_LOG and update DATA_AUDIT with the reproducible command.
