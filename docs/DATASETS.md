# Uploaded recordings — E1–E5a

Open **Upload CSV**, or POST one multipart `file` to `/api/datasets`:
```sh
curl -F 'file=@data/tracks.csv' http://localhost:8080/api/datasets
```
Success: HTTP 201 with a server UUID, original filename, vessel/accepted-row counts,
UTC start/end, inclusive duration and validation counts (naive/aware times,
duplicates, heading aliases and missing vessel-seconds). Invalid CSV: 422;
unsupported file/request type: 415; size/work limit: 413; another import: 409.
Malformed multipart: 400. Storage errors return a generic 500 without server paths.

Limits: **50 MiB (52,428,800 bytes) UTF-8 CSV, 1,000,000 source rows**, exact existing header/order, and
256 normalized candidates across any contiguous conflicting interval. The entire
multipart request is capped at 55 MiB in Nginx and the backend, including chunked
requests. One import runs per backend process; upload normalization/read-back use disk-backed staging.
This is bounded-upload support, with no month-scale guarantee.

`UPLOAD_NAIVE_TIMEZONE` is an IANA zone, default `Asia/Kolkata`; set it before
`docker compose up`. Explicit timestamp offsets take precedence. Ambiguous or
nonexistent naive DST times require an explicit offset. Original assignment replay
keeps its fixed IST assumption and dataset; uploading does not switch playback.

Compose volume `dataset_uploads` mounts at `/var/lib/kappal/datasets`. Each UUID
directory contains `observations.parquet` and `metadata.json`. UTC TIMESTAMPTZ,
DOUBLE values and original source-line numbers are stored. DuckDB verifies every
accepted row before atomic directory publication. CSV copies and canonical CSV
conversion files are temporary and removed; discarded source values are not retained.
Native development uses ignored `uploads/`, or the server-controlled `UPLOAD_ROOT`.

Inspect stored observations inside the backend (replace UUID with a returned ID):
```python
import duckdb
with duckdb.connect() as connection:
    print(connection.execute(
        'SELECT count(*), count(DISTINCT track_id) FROM read_parquet(?)',
        ['/var/lib/kappal/datasets/UUID/observations.parquet'],
    ).fetchone())
```
Volume data survives container recreation; `docker compose down -v` deletes it.
Handled failures clean staging files; abrupt process termination may leave a hidden
`.import-*` directory. Total stored disk usage has no quota. Partitioning remains deferred.

## E2 — library, details and preview

| Read-only API | Result |
| --- | --- |
| `GET /api/datasets` | Metadata array; empty if none available. No observation query. |
| `GET /api/datasets/{id}` | Validated saved metadata for one recording. |
| `GET /api/datasets/{id}/preview?limit=20` | `{dataset_id, rows}`; default 20, maximum 100. |

IDs must be 32 lowercase hex characters; malformed IDs/limits return 422, unknown
or unavailable metadata returns 404. Discovery reads at most 64 KiB per metadata
file and skips hidden/incomplete/corrupt/symlink entries. A root storage error
returns 503; a corrupt Parquet preview returns generic 500 while details can remain
available. Files are never modified by these read endpoints.

New uploads save UTC `imported_at`; E1 files without it return null and show
**Unknown (E1 import)**. Sort is newest-first, unknown dates last, with ascending
UUID ties. Filesystem times are not substituted. Source counts remain inside
`validation`, as in E1. Extra metadata fields are not exposed.

My Recordings refreshes automatically after upload and supports explicit Refresh.
Details show IST dates/validation plus a horizontally scrollable preview; its API
returns UTC observations ordered by timestamp, then vessel ID. SQL applies LIMIT
before results enter Python; DuckDB may still scan rows to order them. Scanning
JSON on each request is simple but scales with library size; no pagination/index
or full Parquet integrity scan is added in E2. A normal `docker compose restart`
preserves the existing named volume; it does not reconstruct uploads from memory.

## E3 — replay stored observations

Use **Replay** on a library card or **Replay built-in assignment** above the map.
The current filename/ID stays visible; a successful switch starts paused at zero,
1×. Uploading alone still leaves playback unchanged. Selection and error behavior:
[protocol](PROTOCOL.md#e3--select-a-recording-when-connecting).

FastAPI resolves IDs through the existing catalog, then aggregate-checks normalized
values/counts/IDs/UTC range and derives bounds without fetching all rows into
Python. Replay queries all vessels once per needed `[max(start,t−59s),t]` window,
ordered by timestamp/ID. Current fixes require an exact timestamp; gaps stay gaps.
Only one requested window is cached per connection, replaced on seek/progress;
no full-recording Python load, per-vessel query or shared active dataset exists.
DuckDB may scan Parquet rows beyond the returned window. Row-group pruning has
not been benchmarked; E5a records limited window timing samples below. The current 50 MiB/1,000,000-row limits
apply. External file mutation during active replay is unsupported.

Read-only Nginx smoke with two existing upload IDs (no new data or deletion):
```sh
.venv/bin/python scripts/verify_multidataset.py FIRST_UUID SECOND_UUID
```

## E4 — permanent deletion

**Delete** on an upload card opens a filename/ID confirmation. Pending requests
cannot be submitted twice; success refreshes the list and preserves other previews
and playback. For the currently loaded recording, **Permanently delete** is
blocked. Use **Switch to built-in assignment** inside the confirmation, wait for
**Built-in assignment loaded**, then confirm deletion. Switching alone does not
delete anything. Metadata/connection failures offer retry or reconnect locally.
A finished replay still owns a live socket; close or switch away in every tab using
it. Other-tab conflicts remain 409; disconnect processing may take a moment.

`DELETE /api/datasets/{id}` returns 200 `{dataset_id, deleted:true}`, 403 for
`builtin`, 422 for malformed IDs, 404 for absent/unavailable metadata, and 409
while any socket (including paused/opening) uses it or deletion is already running.
Missing/corrupt metadata and symlinks are not cleanup candidates. Unexpected extra
files refuse deletion. Errors omit server paths. No built-in CSV route is removable.

Deletion atomically renames the trusted UUID directory to a hidden
`.delete-{id}-{nonce}` sibling, then unlinks only Parquet/JSON and removes the empty
directory. Before-rename failure returns generic 500 and leaves the recording
visible. After-rename failure returns 500 with `removed_from_library:true`; UI
refreshes and reports incomplete disk cleanup. Discovery skips hidden directories,
including after restart, so partial files never advertise a usable recording.

Recovery is manual: stop the backend, inspect the affected `.delete-*` directory
under the configured upload root, then remove only its remaining known regular
files (`observations.parquet`, `metadata.json`) and empty directory. Investigate
unexpected entries instead of recursive deletion; never restore a partially
removed directory to its UUID name. Abrupt termination can leave hidden remnants;
there is no automatic retry, batch delete or volume removal feature.

Session counts/reservations coordinate **one backend process/event loop only**;
do not run multiple Uvicorn workers or replicas. Descriptor-relative operations
require the existing Linux/POSIX runtime. Stored observations, the DuckDB window
logic and original replay behavior are unchanged. No authentication was added.

The integration smoke creates its own recordings and requires an empty isolated
Compose project/volume; never point it at the normal uploaded-recording volume:
```sh
.venv/bin/python scripts/verify_dataset_deletion.py --base-url http://localhost:18084
```
The script checks active-session conflicts and deletion, leaving one test recording
for a separate Docker restart/persistence check; it does not provision Compose.

## E5a — larger uploads and measured limits

`UPLOAD_MAX_BYTES` and `UPLOAD_MAX_ROWS` can lower the default ceilings above;
invalid/nonpositive/above-ceiling settings fail startup. `GET /api/upload-limits`
returns the configured values for client-side checks/display. Header is excluded
from row counts. A million rows still must fit the byte limit; nothing is split or
truncated. Nginx/backend allow 55 MiB envelopes; the parser counts file bytes during
multipart callbacks, independently of Content-Length. Staging rechecks bounded
64 KiB reads. Multipart spools, Nginx body buffers and canonical/SQL scratch files
require additional temporary disk beyond the final Parquet.

Uploads share the original strict row parser and anchored conflict resolver.
A temporary DuckDB file sorts and exact-deduplicates validated canonical rows;
Python fetches 1,024 rows at a time and keeps at most 256 distinct candidates per
conflict interval. Batch boundaries do not break the interval. SQL verifies both
Parquet multisets including source lines and computes gaps; one timestamp/ID-sorted
Parquet is published with JSON only after success. Temporary DB/CSV/spill files
are removed, not retained as a second registry. Builtin still uses its original
in-memory indexes. DuckDB uses one thread, a 128 MiB engine setting, 4 MiB CSV
buffers and up to 2 GiB scratch spill; these are not a process-wide RSS cap or disk
quota. Disk exhaustion returns a safe failure without publishing partial data.

Request cancellation/disconnect signals the worker, which checks between rows,
batches and SQL stages. The upload lock/spool remain owned until cleanup finishes;
an in-flight SQL stage can finish before cancellation is observed. Once atomic
publication has completed, a lost response cannot undo that successful import.

Measured locally in fresh Linux processes, serial runs, one-vessel fixed-value
synthetic CSVs (not general production throughput):

| Source rows | CSV bytes | Import seconds | Peak VmHWM MiB | Parquet bytes |
| --- | ---: | ---: | ---: | ---: |
| 100,000 | 3,200,048 | 2.233 | 174.49 | 414,093 |
| 500,000 | 16,000,048 | 10.605 | 249.54 | 1,928,633 |
| 1,000,000 | 32,000,048 | 22.161 | 254.39 | 3,823,262 |

Uncached window calls measured 22.545–28.886 ms; 1M metadata construction took
0.371 s. Samples miss the application window cache; filesystem caches were not
cleared. Reproduce each size in a fresh process, using isolated disk scratch:
```sh
.venv/bin/python scripts/measure_upload.py --scratch /tmp/isolated-e5a --rows 1000000
```
Prefer actual disk rather than tmpfs when comparing memory/disk tradeoffs. Linux
VmHWM covers the importer process, not Nginx or kernel page cache. These samples do
not establish constant memory. An isolated Nginx 1M POST took 26.092 s; original
seek responses during import ranged 2.381–2,699.042 ms under concurrent test load.
Backend VmHWM across wire checks reached 325.66 MiB. Exact 50 MiB/next-byte and
1M/next-row boundaries passed; no timeout setting was increased. Many-vessel dense
windows, metadata aggregates, per-window connections, rendering and total stored
disk growth remain bottlenecks; large single-vessel success does not benchmark
those distributions. No partitioning, background queue or month-scale experiment. Frontend restart-on-failure
recovers a transient Docker DNS miss when services restart in parallel; normal
Compose startup still waits for backend health.

## Selected-vessel full route

`GET /api/datasets/{dataset_id}/route?vessel_id=ID` supports `builtin` and trusted uploaded IDs. The query parameter supports the same printable, non-whitespace vessel IDs as ingestion, including encoded slashes/Unicode. Unknown dataset/vessel: 404; malformed ID: 422.

Returns dataset/vessel identity, UTC start/end, point count, `simplified: false` and chronological `[lat,lon]` segments. Gaps, >100m consecutive steps and date-line crossings split segments; singleton fixes remain dots. This inspection includes observations after replay time and never replaces recent trails or stored values.

Routes over **20,000 positions or 512 segments** return an explanatory 422, never partial geometry. No simplification is performed. Eight-entry server/browser caches avoid repeat reads; uploads are resolved through the catalog before cache hits. DuckDB queries only the requested vessel/columns with LIMIT 20,001, one thread and 128MB engine budget; scans, serialization and process RSS are not separately capped. In-flight reads retain deletion protection until their worker finishes, including HTTP cancellation. No new service or persistent route file.
