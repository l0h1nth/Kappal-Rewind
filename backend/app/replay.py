"""Monotonic replay clock and deterministic frames over a read-only track source."""

from collections.abc import Callable
from datetime import timedelta
from time import monotonic

from app.ingestion import Dataset
from app.track_store import MemoryTrackStore, TrackStore

SUPPORTED_SPEEDS = (1, 2, 5, 10)


class ReplaySession:
    def __init__(self, duration_seconds: int, clock: Callable[[], float] = monotonic):
        if type(duration_seconds) is not int or duration_seconds < 1:
            raise ValueError("duration_seconds must be a positive integer")
        self.duration_seconds = duration_seconds
        self.clock = clock
        self.playing = False
        self.speed = 1
        self._position = 0.0
        self._anchor = clock()

    def _current_position(self, now: float) -> float:
        position = self._position
        if self.playing:
            position += (now - self._anchor) * self.speed
        last = self.duration_seconds - 1
        if position >= last:
            self._position = float(last)
            self._anchor = now
            self.playing = False
            return self._position
        return position

    def snapshot(self) -> dict:
        position = self._current_position(self.clock())
        return {"second": int(position), "duration_seconds": self.duration_seconds,
                "playing": self.playing, "speed": self.speed}

    def command(self, message: object) -> None:
        """Validate fully before mutation. Commands preserve fractional progress."""
        fields = {"play": {"type"}, "pause": {"type"}, "reset": {"type"},
                  "seek": {"type", "second"}, "set_speed": {"type", "speed"}}
        if not isinstance(message, dict):
            raise ValueError("command must be a JSON object")
        action = message.get("type")
        if not isinstance(action, str) or action not in fields:
            raise ValueError("type must be play, pause, seek, set_speed or reset")
        if set(message) != fields[action]:
            raise ValueError(f"{action} requires exactly: {', '.join(sorted(fields[action]))}")
        if action == "seek" and (type(message["second"]) is not int or
                                 not 0 <= message["second"] < self.duration_seconds):
            raise ValueError(f"second must be an integer from 0 to {self.duration_seconds - 1}")
        if action == "set_speed" and (type(message["speed"]) is not int or
                                      message["speed"] not in SUPPORTED_SPEEDS):
            raise ValueError("speed must be one of 1, 2, 5, 10 (integer)")

        now = self.clock()
        self._position = self._current_position(now)
        self._anchor = now
        if action == "play":
            self.playing = self._position < self.duration_seconds - 1
        elif action == "pause":
            self.playing = False
        elif action == "seek":
            self._position = float(message["second"])
            if self._position == self.duration_seconds - 1:
                self.playing = False
        elif action == "set_speed":
            self.speed = message["speed"]
        elif action == "reset":
            self._position = 0.0
            self.playing = False


def build_frame(dataset: Dataset | TrackStore, session: ReplaySession) -> dict:
    store = MemoryTrackStore(dataset) if isinstance(dataset, Dataset) else dataset
    state = session.snapshot()  # Sample the clock once for a consistent frame.
    second = state["second"]
    timestamp = store.start + timedelta(seconds=second)
    window = [store.start + timedelta(seconds=i) for i in range(max(0, second - 59), second + 1)]
    tracks = {}
    for observation in store.get_window(window[0], timestamp):
        tracks.setdefault(observation.track_id, {})[observation.timestamp] = observation
    vessels = []
    for vessel_id, track in sorted(tracks.items()):
        current = track.get(timestamp)
        if current is None:
            continue  # No current observation means no current marker or vessel entry.
        segments = []
        segment = []
        for instant in window:
            observation = track.get(instant)
            if observation is None:
                if segment:
                    segments.append(segment)
                    segment = []
            else:
                segment.append([observation.lat, observation.lon])
        if segment:
            segments.append(segment)
        vessels.append({"id": vessel_id, "lat": current.lat, "lon": current.lon,
                        "speed_knots": current.speed_knots, "heading": current.heading,
                        "trail_segments": segments})
    return {"type": "state", "dataset_id": store.dataset_id, **state, "timestamp": timestamp.isoformat().replace("+00:00", "Z"),
            "vessels": vessels}
