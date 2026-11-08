# I3 measurements — 8 Nov 2026

Local measurements, not capacity guarantees. Raw JSON/plans live outside the repo
at `/home/gr00t/.cache/kappal-i3/{before,optimized}`. No application uploads were
used for destructive tests. Original source SHA-256 remains unchanged.

## Method

- Python 3.14.9, DuckDB 2.0.0, Linux x86_64, 16 logical CPUs, 15.28 GiB RAM.
  Three serial fresh worker processes per dataset/version; normal filesystem cache,
  no OS cache eviction. Fresh connections are not proof of cold physical disk.
- Original: 35,820 source rows / 35,780 accepted, 20 vessels, 1,800 seconds.
  Synthetic: 50/250/500 vessels × 2,000 seconds = 100K/500K/1M rows.
  Parallel ~6-knot eastbound tracks are continuous, valid and compress particularly
  well; they do not represent every field recording. CSV sizes: 4,900,047 /
  24,500,047 / 49,000,047 bytes, all below 50 MiB.
- Tables use medians of three run medians (single per-run metrics use three values).
  Import calls the actual importer, excluding HTTP/Nginx/multipart spooling.
  Linux VmHWM is sampled immediately after import, before read-back verification.
  Later all-phase HWM is not comparable: the final verifier adds extra SQL work.
- Window/frame timings include connection, fetch, Python conversion/validation and
  frame building as applicable. Adjacent frames use seconds 301–320; unrelated
  seeks first evict the prior window. Exact cache hits are measured separately.
- Docker comparison used baseline/current backend images behind identical Nginx
  and unchanged production frontend, with identical read-only Parquets, port
  18089. No CPU/RAM container caps; resource samples are snapshots, not peaks.
  Probes ran serially; host activity and warm-cache variation remain uncontrolled.

## Results

| Recording | Import before → after (s) | Import peak RSS before → after (MiB) | Adjacent frame before → after (ms) | Unrelated seek before → after (ms) |
|---|---:|---:|---:|---:|
| Original / 20 vessels | 0.575 → 0.539 | 165.28 → 165.23 | 15.53 → 13.20 | 15.36 → 15.50 |
| 100K / 50 | 1.225 → 1.233 | 211.92 → 214.20 | 19.69 → 13.51 | 19.05 → 18.81 |
| 500K / 250 | 5.991 → 6.017 | 299.40 → 300.42 | 49.74 → 18.69 | 46.96 → 46.95 |
| 1M / 500 | 12.635 → 12.690 | 303.87 → 303.40 | 91.81 → 25.83 | 87.51 → 84.68 |

No ingestion optimization or speedup is claimed. Earlier E5a single-vessel figures
used different data/conditions and are historical context, not a causal comparison.
The final fractional-boundary correction preserves these whole-second windows;
Docker/stream/browser probes and correctness tests used the corrected implementation.

| Recording | After opening / first frame (ms, separate calls) | After sampled staging logical / allocated peak (MiB) | Parquet bytes (identical before/after) | Snapshot bytes at second 300 |
|---|---:|---:|---:|---:|
| Original | 20.11 / 13.20 | 12.85 / 12.86 | 439,036 | 28,367 |
| 100K | 30.35 / 12.62 | 28.72 / 28.48 | 295,315 | 52,374 |
| 500K | 95.59 / 13.13 | 97.10 / 97.12 | 1,236,274 | 285,574 |
| 1M | 191.11 / 14.58 | 260.52 / 260.53 | 2,329,007 | 574,024 |

Staging is sampled every 20 ms: a lower bound excluding input CSV, HTTP spools and
unlinked/open spill files. Do not budget deployment disk using this table alone.

## Findings and accepted changes

`track_store.py` previously retained only an exact requested window; the next second
reread and rebuilt up to 60 seconds of observations. Forward overlaps now retain
only relevant confirmed observations and query the disjoint new tail. Backward and
unrelated seeks reconstruct; each session owns its cache. A 60,000-row retention cap
bounds cached rows, not transient frame memory. Larger results are complete but
uncached. Fractional end boundaries initially skipped the next whole-second fix;
review reproduced it and a regression now covers the corrected boundary.

`replay_socket.py` previously built unchanged seconds before suppressing their send.
It now checks server state first; every valid command still forces reconstruction.
In three 2.2-second CPU-only 1M samples, median 1× builds fell 18 → 3, build wall time
419.87 → 93.74 ms, with the same three responses. At 10×, faster processing produced
more current snapshots (11 → 16), not a new frontend clock or protocol.

The actual 1M SQL plan reads 30,000 rows for seconds 941–1000 in 7.2 ms, reporting
156.7 kB read with timestamp pushdown. Sixteen 65,536-row groups already support
pruning; all seven projected fields serve reconstruction/provenance. A diagnostic
cProfile of a full uncached window attributes substantial time to Python object
creation/validation; profiled wall time includes instrumentation overhead. Fresh
SELECT 1 connections cost ~10 ms. Exact cache lookup is ~0.001 ms, but cached-frame
construction is still ~8 ms and JSON encoding ~13 ms at 500 vessels. No SQL rewrite,
index, persistent connection or metadata-integrity shortcut was justified here.

Through real Nginx/WebSockets (compression explicitly disabled), 1M median HTTP
opening was 185.49 → 181.37 ms; WebSocket connect-to-first-frame 215.00 → 200.15 ms;
adjacent seek 301 response 131.31 → 57.88 ms. Short 10× streams emitted 10 → 15
snapshots in ~2.6 s, sampled CPU 55.84% → 36.68%, memory 233.8 → 171.2 MiB.
These are single stream samples, not throughput/peak-memory guarantees. More useful
frames also increase aggregate egress: ~6.3 → 8.6 MB uncompressed in those intervals.
Snapshot contents/size and maximum automatic send rate remain unchanged.

Headless Firefox 1600×1000, production frontend, mocked tiles: all eight pointer
selections per version succeeded; the map stayed mounted across datasets. At 500
vessels/10×, the sampled 2.5 s interval received 11 → 16 frames and counted 13 → 18
React root commits, rather than committing every animation tick. Maximum rAF gaps
were ~33 ms in both. Click-to-DOM-update-plus-next-rAF proxies were 16 → 14 ms.
This callback precedes paint (legacy raw keys say `to_paint`); no completed-paint or
long-task claim is made. Short synthetic samples do not isolate every Leaflet cost
or guarantee smooth playback under arbitrary network/rendering load.

## Reproduce and verify

Run `scripts/benchmark_backend.py --scratch OUTSIDE_REPO --label NAME` with the
backend virtualenv; it rejects existing run directories. Repeat at the comparison
revision with another label. `benchmark_stream.py --results RESULTS --output OUT`
profiles the real loop without network. `benchmark_replay_wire.py --base-url URL
--results RESULTS --output OUT [--container NAME]` uses existing IDs only; resource
sampling is optional. `node scripts/benchmark_browser.mjs URL RESULTS OUT` probes
the production UI. For wire/browser, mount the result recordings read-only in a
separate stack, with original data also read-only; never substitute the main volume.

Source and Parquet comparisons cover every synthetic field/provenance, all 12
before/after Parquet pairs, and every normalized original row (zero differences).
Functional suites cover original/uploaded gaps, UTC, cache bounds, backward seeks,
60-second trails, independent clients, commands, switching and animation/selection.
Raw timing artifacts are local, not automatically portable test fixtures.

## Scaling boundaries

At 1 Hz, 500 vessels produce 43.2M rows/day, 302.4M/week and 1.296B/30 days.
Only 500 × 2,000 seconds (1M rows) was tested; longer cases exceed current 1M-row /
50 MiB admission limits. The ~304 MiB measured import RSS is larger than DuckDB's
128 MB engine budget, which is not a process limit. A 60-second 500-vessel window
contains 30,000 observations; per-client materialization, JSON, network and Leaflet
costs remain. HTTP metadata preflight and socket opening still repeat full integrity
aggregates. Current lifecycle/import coordination assumes one backend worker.

Future wider support would require bounded chunked ingestion, measured admission
and concurrency budgets, and time partitions (hour/day chosen by measurements).
A 60-second window can cross partitions; retain exact ordering and gap semantics.
Neither a larger cache nor a database swap removes snapshot bandwidth/rendering cost.
Parquet suits immutable compressed recordings and filtered analytical reads; embedded
DuckDB avoids a separate service. PostgreSQL becomes preferable when transactional
concurrent writes, indexed serving and shared catalog/access coordination dominate.
No partitioning, PostgreSQL migration or multi-worker guarantee is implemented.

References: [DuckDB tuning](https://duckdb.org/docs/2.0/guides/performance/how_to_tune_workloads),
[Parquet pushdown](https://duckdb.org/docs/2.0/data/parquet/overview),
[indexing tradeoffs](https://duckdb.org/docs/2.0/guides/performance/indexing),
[PostgreSQL concurrency](https://www.postgresql.org/docs/current/mvcc-intro.html).
