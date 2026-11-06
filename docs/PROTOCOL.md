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

- `second`: integer 0–1799 for this recording; no rounding or clamping invalid input.
- `speed`: integer 1, 2, 5 or 10; booleans, strings and fractional values are rejected.
- Play resumes from the fractional position. Pause freezes it. Speed changes preserve
  the current position. Seek moves immediately and preserves playing/paused state,
  except seeking to the final second pauses. Reset seeks to 0 and pauses, retaining speed.
- At 1799 playback stops. Play at the end stays paused; seek/reset before replaying.

Server sends a state immediately on connect and after every valid command. While
playing it checks progress every 100 ms, sending only changed seconds/state, at
most 10 automatic frames/s. Delayed clients receive current snapshots, not a backlog
of missed seconds. Command responses are immediate and outside that automatic cap.

State envelope (vessels omitted here to show the shape):

```json
{"type":"state","second":600,"duration_seconds":1800,"playing":false,
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
