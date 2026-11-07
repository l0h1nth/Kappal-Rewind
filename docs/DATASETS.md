# Uploaded recordings — E1–E2

Open **Upload CSV**, or POST one multipart `file` to `/api/datasets`:
```sh
curl -F 'file=@data/tracks.csv' http://localhost:8080/api/datasets
```
Success: HTTP 201 with a server UUID, original filename, vessel/accepted-row counts,
UTC start/end, inclusive duration and validation counts (naive/aware times,
duplicates, heading aliases and missing vessel-seconds). Invalid CSV: 422;
unsupported file/request type: 415; size/work limit: 413; another import: 409.
Malformed multipart: 400. Storage errors return a generic 500 without server paths.

Limits: **10 MiB UTF-8 CSV, 50,000 source rows**, exact existing header/order, and
256 normalized candidates across any contiguous conflicting interval. The entire
multipart request is capped at 11 MiB in Nginx and the backend, including chunked
requests. One import runs per backend process; normalization/read-back use memory.
This is small-recording support, with no month-scale or performance claim.

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
`.import-*` directory. Total stored disk usage has no quota. Selection, replay switching, deletion and partitioning remain deferred.

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
