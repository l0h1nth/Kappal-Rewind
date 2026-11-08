# Replay protocol

Connect to `ws://localhost:8080/ws/replay` (same-origin `/ws/replay`; use `wss`
behind HTTPS). Each connection starts paused at second 0 and speed 1. Reconnecting
creates a new session. HTTP `/api/health` and `/api/meta` remain available.

Send one JSON text object per command, with exactly these fields:

```json
{"type":"play"}
{"type":"pause"}
{"type":"seek","second":600}
{"type":"set_speed","speed":5}
{"type":"reset"}
```

- `second`: integer 0–(duration_seconds−1) for the selected recording; no rounding or clamping invalid input.
- `speed`: integer 1, 2, 5 or 10; booleans, strings and fractional values are rejected.
- Play resumes from the fractional position. Pause freezes it. Speed changes preserve
  the current position. Seek moves immediately and preserves playing/paused state,
  except seeking to the final second pauses. Reset seeks to 0 and pauses, retaining speed.
- At the final second playback stops. Play at the end stays paused; seek/reset before replaying.

Server sends a state immediately on connect and after every valid command. While
playing it checks progress every 100 ms, sending only changed seconds/state, at
most 10 automatic frames/s. Delayed clients receive current snapshots, not a backlog
of missed seconds. Command responses are immediate and outside that automatic cap.

State envelope (vessels omitted here to show the shape):

```json
{"type":"state","dataset_id":"builtin","second":600,"duration_seconds":1800,"playing":false,
 "speed":1,"timestamp":"2026-11-02T03:40:00Z","vessels":[]}
```

Each `vessels` entry has `id` (string), `lat`/`lon` (numbers), `speed_knots` and
`heading` (numbers), and `trail_segments` (array of segments of `[lat,lon]` pairs).
Only vessels with an observation at the current second appear. The frontend must
replace current markers from each complete frame, not retain absent vessels.
There is no historical-only entry for an absent vessel in this protocol.

Trails use `[max(0, second−59), second]` inclusive, at most 60 samples, with a new
segment after every missing second. Single-point segments are valid; there is no
interpolation, future sample or line bridging a gap. Positions and trails are rebuilt
from validated data on every frame, including backward seeks.

Invalid JSON, binary messages, wrong types/fields, commands over 4096 characters,
unsupported speeds and out-of-range seeks produce:

```json
{"type":"error","message":"human-readable validation explanation"}
```

Errors do not alter playback; natural elapsed time continues if already playing.
The connection remains usable. States and errors share one ordered sender; no old
state is generated after a command's response. Frames already in transit can precede
the response. There are no command IDs/acks beyond state responses. Clients should
render ordered server snapshots rather than predict the replay clock locally.

Paused sessions await commands without polling. A send blocked for five seconds
ends the connection; closing is also bounded. Commands wait behind that active send,
so a stalled client is disconnected rather than guaranteed prompt service. There is
no replay task left running after disconnect. Uvicorn WebSocket ping/pong keeps
otherwise idle connections alive through Nginx's 75-second proxy read timeout.

## E3 — select a recording when connecting

Omit the query for the original assignment, or connect to
`/ws/replay?dataset_id=builtin`. For an upload, use `/ws/replay?dataset_id=UUID`
(the server-issued 32 lowercase hex ID). Each socket owns its selected store,
clock and window cache; every new connection starts paused at 0, speed 1.
State frames include `dataset_id`; commands are unchanged. `/api/meta` keeps its
original response. `GET /api/replay/{dataset_id}/meta` returns selected UTC
start/end, recording_seconds, counts, bounds, vessel_ids, dataset_id and name.
Malformed IDs return HTTP 422, unknown IDs 404, unusable Parquet a generic 500.
Invalid socket selections receive an error and close code 1008, leaving other
clients untouched. File failures during replay end that connection with an error.

The UI preflights metadata while current playback continues. Failure preserves
that session and selection. Success closes the old socket, clears selected vessel,
markers/trails and timeline draft, refits the existing map and opens a fresh paused
socket. Cancelled metadata requests and detached socket callbacks are ignored;
frames must match the selected ID. Selecting the currently loaded recording while
another loads cancels that request and keeps the existing session. Reconnect
always starts fresh. Bounds update only on dataset change; ordinary frames retain
user pan/zoom. The UI accepts missing frame identity only for legacy builtin frames.

E4 adds live reference protection: uploaded recordings cannot be deleted while any
socket uses them, even paused or opening. The route releases its reference on
normal disconnect, failed initialization/send or cancellation. Switching away
closes the previous socket; deletion is allowed after that close is processed.
An in-progress delete rejects new socket selections with an error and close 1008.
Other sessions are unaffected. HTTP deletion/recovery: [recordings](DATASETS.md#e4--permanent-deletion).
