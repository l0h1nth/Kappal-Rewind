# Initial data audit — 6 November 2026

Run from the root: `python3 scripts/audit_csv.py` (JSON, including source line evidence).
The script is read-only and uses only Python's standard library. This is an audit,
not runtime ingestion. No rows have been removed, reassigned or normalized on disk.

Source copied from the supplied Downloads file. Both SHA-256 values:
`41924aa95b6c6e14e43b9e6120ec7d8efc38a6dd5c36d4ed8a84158f1d5b2568`.

| Measurement | Observed result |
| --- | --- |
| Header | `track_id,timestamp,lat,lon,speed_knots,heading` |
| Data rows / vessel IDs | 35,820 / 20 (`T001`–`T020`) |
| Time range | 2 Nov 2026, 09:00:00–09:29:59 IST; 1,800 inclusive second slots |
| Timestamp formats | 17,860 offset-aware ISO values; 17,960 naive space-separated values |
| Exact duplicate extras | 0 |
| Duplicate `(track_id, timestamp)` extras | 40; all conflict on lat/lon/speed/heading |
| Unique vessel seconds / expected | 35,780 / 36,000; 220 missing |
| Global backwards timestamp transitions | 60; source order cannot be used as replay order |
| Empty cells / malformed rows / invalid timestamps | 0 / 0 / 0 |
| Latitude / longitude ranges | 13.031590–13.109132 / 80.298290–80.371457 |
| Speed range | 0–11.52 knots; no negative/nonfinite values |
| Heading range | 0–360°; 11 values at 360° |

All vessels have 1,800 rows except T007 (1,840), T012 (1,760), and T015 (1,620).
Coordinates are geographically valid and cluster near Chennai. Range validation
does not prove physical motion plausibility or sensor accuracy.

## Findings and proposed handling

- **Timezone ambiguity:** naive timestamps carry no timezone. The audit assumes
  IST (+05:30), matching explicit offsets and the shared export window, and
  compares UTC instants. This is an assumption, not confirmed source metadata.
  Runtime parsing must make the same policy explicit and test it.
- **Conflicting T007 observations:** two rows per second from 09:10:00 through
  09:10:39 IST. First pair: CSV lines 12008/12013; last pair: 12788/12793
  (header is line 1). First pair positions: (13.082801, 80.358893) and
  (13.097101, 80.336738); speeds 0.17 and 10.85. Their correctness cannot be
  established from ID alone. The overlap with T012's gap suggests mislabeling,
  but does not prove identity. Proposed conservative runtime policy: retain the
  first source occurrence per normalized key and report discarded conflicts;
  do not silently reassign an ID. Review this tradeoff before ingestion.
- **T012 missing 40 seconds:** 09:10:00–09:10:39 IST inclusive.
- **T015 missing 180 seconds:** 09:20:00–09:22:59 IST inclusive.
  These are missing observations under the exported IDs. Proposed replay policy:
  no invented positions during gaps; split paths and explicitly show absent/stale
  state. Exact UI behavior and tests remain for replay phases.
- **Heading 360°:** aliases north. Proposed normalization is 360 → 0, while
  rejecting values outside [0,360]. Evidence lines: 379, 4979, 5759, 6119,
  6139, 7199, 7539, 10928, 11659, 11699, 27898.
- **Ordering:** sort normalized observations by time and vessel in memory,
  preserving source line order for deterministic duplicate resolution.

`35,820 − 40 = 35,780` unique keys; `36,000 − 35,780 = 220` missing keys.
Do not report only a 180-row shortfall: duplicates conceal the additional 40.
No preprocessing has been implemented. Tests cover audit calculations, timestamp
equivalence, invalid values, schema/row errors and source-integrity regression.
