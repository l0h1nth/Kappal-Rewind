import copy
import json
from datetime import timedelta

import pytest

from app.ingestion import load_dataset
from app.replay import ReplaySession, build_frame
from test_ingestion import SOURCE, START, row, write_csv


class FakeClock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


@pytest.fixture(scope="module")
def dataset():
    return load_dataset(SOURCE)


def test_initial_state_and_paused_clock():
    clock = FakeClock()
    session = ReplaySession(1800, clock)
    clock.advance(500)
    assert session.snapshot() == {"second": 0, "duration_seconds": 1800, "playing": False, "speed": 1}


def test_pause_resume_and_speed_preserve_fractional_progress():
    clock = FakeClock()
    session = ReplaySession(1800, clock)
    session.command({"type": "play"})
    clock.advance(3.75)
    assert session.snapshot()["second"] == 3
    session.command({"type": "pause"})
    clock.advance(100)
    assert session.snapshot()["second"] == 3
    session.command({"type": "play"})
    clock.advance(0.25)
    assert session.snapshot()["second"] == 4
    session.command({"type": "set_speed", "speed": 2})
    assert session.snapshot()["second"] == 4
    clock.advance(0.5)
    assert session.snapshot()["second"] == 5


@pytest.mark.parametrize("speed", [1, 2, 5, 10])
def test_all_supported_speeds_and_delayed_sampling(speed):
    clock = FakeClock()
    session = ReplaySession(1800, clock)
    session.command({"type": "set_speed", "speed": speed})
    session.command({"type": "play"})
    clock.advance(13)
    assert session.snapshot()["second"] == 13 * speed
    # No sleep/tick counter: long gaps between samples are accounted for exactly.
    clock.advance(20)
    assert session.snapshot()["second"] == 33 * speed


def test_speed_change_mid_second_has_no_jump():
    clock = FakeClock()
    session = ReplaySession(1800, clock)
    session.command({"type": "play"})
    clock.advance(0.75)
    session.command({"type": "set_speed", "speed": 10})
    assert session.snapshot()["second"] == 0
    clock.advance(0.125)
    assert session.snapshot()["second"] == 2


def test_seek_while_playing_reanchors_and_reset_pauses():
    clock = FakeClock()
    session = ReplaySession(1800, clock)
    session.command({"type": "play"})
    clock.advance(5.5)
    session.command({"type": "seek", "second": 600})
    assert session.snapshot()["second"] == 600
    assert session.snapshot()["playing"] is True
    clock.advance(2)
    assert session.snapshot()["second"] == 602
    session.command({"type": "seek", "second": 0})
    assert session.snapshot()["second"] == 0
    session.command({"type": "set_speed", "speed": 5})
    session.command({"type": "reset"})
    clock.advance(50)
    assert session.snapshot() == {"second": 0, "duration_seconds": 1800, "playing": False, "speed": 5}


def test_end_boundary_stops_without_implicit_rewind():
    clock = FakeClock()
    session = ReplaySession(1800, clock)
    session.command({"type": "seek", "second": 1798})
    session.command({"type": "play"})
    clock.advance(50)
    assert session.snapshot()["second"] == 1799
    assert session.snapshot()["playing"] is False
    session.command({"type": "play"})
    assert session.snapshot()["playing"] is False
    session.command({"type": "seek", "second": 0})
    session.command({"type": "play"})
    session.command({"type": "seek", "second": 1799})
    assert session.snapshot()["playing"] is False


def test_single_observation_recording_cannot_play():
    session = ReplaySession(1, FakeClock())
    session.command({"type": "play"})
    assert session.snapshot()["second"] == 0
    assert session.snapshot()["playing"] is False


@pytest.mark.parametrize("message", [
    None, [], True, "play", {}, {"type": []}, {"type": "unsupported"},
    {"type": "seek"}, {"type": "seek", "second": -1}, {"type": "seek", "second": 1800},
    {"type": "seek", "second": 1.0}, {"type": "seek", "second": True},
    {"type": "set_speed", "speed": 3}, {"type": "set_speed", "speed": "5"},
    {"type": "set_speed", "speed": 1.0}, {"type": "set_speed", "speed": True},
    {"type": "set_speed", "speed": float("nan")}, {"type": "pause", "extra": 1},
])
def test_bad_commands_leave_session_unchanged(message):
    session = ReplaySession(1800, FakeClock())
    session.command({"type": "seek", "second": 600})
    before = session.snapshot()
    with pytest.raises(ValueError):
        session.command(message)
    assert session.snapshot() == before


@pytest.mark.parametrize("second", [0, 20, 59, 60, 600, 1799])
def test_exact_frame_timestamp_and_trail_window(dataset, second):
    session = ReplaySession(1800, FakeClock())
    session.command({"type": "seek", "second": second})
    frame = build_frame(dataset, session)
    assert frame["timestamp"] == (START + timedelta(seconds=second)).isoformat().replace("+00:00", "Z")
    vessels = {v["id"]: v for v in frame["vessels"]}
    for vessel_id, track in dataset.observations.items():
        obs = track.get(START + timedelta(seconds=second))
        if obs is None:
            assert vessel_id not in vessels
            continue
        vessel = vessels[vessel_id]
        assert (vessel["lat"], vessel["lon"], vessel["speed_knots"], vessel["heading"]) == (
            obs.lat, obs.lon, obs.speed_knots, obs.heading)
        expected = [[o.lat, o.lon] for t, o in track.items()
                    if START + timedelta(seconds=max(0, second - 59)) <= t <= obs.timestamp]
        assert [p for segment in vessel["trail_segments"] for p in segment] == expected
        assert len(expected) <= 60
    json.dumps(frame, allow_nan=False)


def test_backward_seek_reconstructs_without_future_points(tmp_path):
    data = load_dataset(write_csv(tmp_path, [row(i, lat=13 + i * 0.001) for i in range(100)]))
    session = ReplaySession(100, FakeClock())
    session.command({"type": "seek", "second": 90})
    future = build_frame(data, session)
    session.command({"type": "seek", "second": 20})
    earlier = build_frame(data, session)
    points = earlier["vessels"][0]["trail_segments"][0]
    assert points == [[13 + i * 0.001, 80] for i in range(21)]
    assert future["vessels"][0]["trail_segments"] != earlier["vessels"][0]["trail_segments"]


@pytest.mark.parametrize("vessel_id,missing_start,missing_end", [("T012", 600, 639), ("T015", 1200, 1379)])
def test_current_missing_positions_are_omitted_and_trails_split(dataset, vessel_id, missing_start, missing_end):
    session = ReplaySession(1800, FakeClock())
    for second in [missing_start, missing_end]:
        session.command({"type": "seek", "second": second})
        assert vessel_id not in {v["id"] for v in build_frame(dataset, session)["vessels"]}
    session.command({"type": "seek", "second": missing_end + 1})
    vessel = next(v for v in build_frame(dataset, session)["vessels"] if v["id"] == vessel_id)
    assert len(vessel["trail_segments"][-1]) == 1
    if vessel_id == "T012":
        assert [len(s) for s in vessel["trail_segments"]] == [19, 1]  # seconds 581–599, 640
    else:
        assert [len(s) for s in vessel["trail_segments"]] == [1]  # gap exceeds the window


def test_multiple_gaps_split_trails_without_connecting_points(tmp_path):
    data = load_dataset(write_csv(tmp_path, [row(i, lat=13 + i * 0.001) for i in [0, 1, 3, 5, 6]]))
    session = ReplaySession(7, FakeClock())
    session.command({"type": "seek", "second": 6})
    segments = build_frame(data, session)["vessels"][0]["trail_segments"]
    assert [len(segment) for segment in segments] == [2, 1, 2]
    assert segments == [[[13 + i * 0.001, 80] for i in seconds] for seconds in [[0, 1], [3], [5, 6]]]


def test_t007_frames_use_accepted_normalized_data_without_modification(dataset):
    before = copy.deepcopy(dataset)
    session = ReplaySession(1800, FakeClock())
    for second in [600, 639, 0, 1799]:
        session.command({"type": "seek", "second": second})
        vessel = next(v for v in build_frame(dataset, session)["vessels"] if v["id"] == "T007")
        assert (vessel["lat"], vessel["lon"]) == (13.082801, 80.358893)
    assert dataset == before
