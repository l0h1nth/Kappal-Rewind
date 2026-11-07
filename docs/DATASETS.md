# E1 — CSV import storage

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
`.import-*` directory. Total stored disk usage has no quota. Listing, selection,
replay switching, deletion and partitioning remain outside E1.
