# Data audit — 6 November 2026

Reproduce from the root: `python3 scripts/audit_csv.py` (read-only JSON with CSV
line evidence). Ingestion: `app.ingestion.load_dataset(Path(...))` from the backend.
Both use the same schema/timestamp parser; independent grouping and gap tests
cross-check the source. All cleanup is in memory.

Original and current source SHA-256:
`41924aa95b6c6e14e43b9e6120ec7d8efc38a6dd5c36d4ed8a84158f1d5b2568`.

| Measurement | Verified source / normalized result |
| --- | --- |
| Schema | `track_id,timestamp,lat,lon,speed_knots,heading` |
| Source rows / vessels | 35,820 / 20 (`T001`–`T020`) |
| Recording window | 2 Nov 2026, 09:00:00–09:29:59 IST; 1,800 inclusive seconds |
| Timestamp formats | 17,860 offset-aware; 17,960 naive |
| Exact raw duplicate extras | 0 |
| Conflicting duplicate extras / discarded | 40 / 40, all T007 |
| Accepted observations | 35,780 unique vessel-seconds |
| Missing observations | 220: T012 40, T015 180 |
| Empty cells / malformed rows / invalid timestamps | 0 / 0 / 0 |
| Source backwards timestamp transitions | 60; sorted during ingestion |
| Latitude / longitude ranges | 13.031590–13.109132 / 80.298290–80.371457 |
| Speed / source heading | 0–11.52 knots / 0–360°; 11 headings at 360° |
| Invalid rows rejected in this source | 0; any invalid input aborts loading |

T007 has 1,840 source rows, T012 1,760 and T015 1,620; others have 1,800.
Reconciliation: **35,820 − 40 discarded − 0 invalid = 35,780 accepted**;
**20 × 1,800 − 35,780 = 220 missing**. There is no partial dataset on failure.

## T007 interval evidence and decision

Conflicts run from 09:10:00 to 09:10:39 IST inclusive. CSV lines 11988 and
12808 (adjacent unambiguous T007 anchors) both have (13.082801, 80.358893).
The candidate starting at line 12008 stays at exactly those coordinates for
all 40 seconds: entry, internal and exit distances are **0 m**.

The alternative starts at line 12013 at (13.097101, 80.336738) and ends at
12793 at (13.099055, 80.336626). It would require a **2,878.55 m** entry jump
and **3,013.72 m** exit jump, each in one second; internal distance is 220.44 m
(total anchored sequence 6,112.71 m). Recorded endpoint speeds are 10.85 and
11.35 knots. These cannot explain the jumps. Keep the stationary sequence;
discard the 40 alternate T007 rows with their original line and reason.

The moving sequence lies near T012's surrounding observations (lines 11993 and
12813), but that does not establish ownership. **No records are reassigned.**

## Implemented normalization policy

- **Validation:** exact header names/order; printable nonempty IDs without whitespace;
  full date/time including seconds; finite numeric values; lat [-90,90], lon
  [-180,180], speed ≥0, heading [0,360]; timestamps on whole UTC seconds.
  Empty/malformed/invalid rows abort ingestion with a CSV line error. No silent
  filtering or rounding. ISO fractions up to six digits are supported; nonzero
  fractions are off-grid; greater precision is rejected rather than truncated.
- **Time:** naive values assume IST (+05:30), supported by the export window and
  explicit offsets, not independently confirmed metadata. Store aware UTC;
  `timestamp.astimezone(IST)` preserves future local display. Shared parser prevents
  different audit/runtime timezone policies.
- **Duplicates:** collapse normalized exact duplicates, recording each discarded
  source line and representative. For a contiguous conflicting block, compare
  entire candidate paths including adjacent unambiguous one-second anchors.
  Retain the minimum total great-circle-distance path using two best partial paths
  per candidate to detect alternatives. Both anchors are required. Abort if the
  best two complete paths differ by ≤1 m; the 1 m margin is a conservative policy,
  not a measured sensor uncertainty. This heuristic is supported for this export,
  not proof of vessel identity or a general physical-motion validator. Source row
  order cannot decide conflicting positions. Speed/heading support investigation
  but do not enter the score.
- **Heading:** normalize 360° to 0°; preserve other valid values, reject out-of-range
  or nonfinite values. Source examples: lines 379 and 4979; full evidence in audit JSON.
- **Index/gaps:** vessel IDs and per-vessel timestamps are sorted. Exact dictionary
  lookup returns an observation or `None`, including gaps and out-of-range times.
  Missing intervals include recording boundaries, with inclusive first/last times.
  T012 lacks 09:10:00–09:10:39; T015 lacks 09:20:00–09:22:59 IST. No synthetic
  positions or carry-forward current coordinates. Replay omits absent current fixes,
  splits trails at gaps and shows no current values in the selected-vessel panel.

Phase 1 proposed keeping the first conflicting occurrence. Phase 2 supersedes
that proposal with measured whole-interval continuity; it happens to select the
same source rows here. No baseline count was corrected.
