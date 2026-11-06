---
name: replay-verification
description: Verify Kappal Rewind replay, seek, trail and WebSocket behavior once those components are implemented.
---

# replay-verification

1. Read PLAN.md and the implemented protocol before testing. Mark absent components pending; do not claim replay works from a health check.
2. Verify initial paused state, play/pause continuity, end-of-log behavior and seek at start/end and outside bounds.
3. Check each connection owns its clock. Seek while playing and paused; stale frames must not restore old state.
4. Check trail samples lie within the defined last 60 seconds, reset on backward seek, and never bridge missing observations as observed motion.
5. Exercise T007 conflicts, T012's 40-second gap and T015's 180-second gap using the documented ingestion policy. Verify current speed/heading and stale/absent state.
6. Test disconnect/reconnect and malformed messages through Nginx as well as directly. Record commands, results, browser evidence and limitations; request replay_reviewer review without file edits.
