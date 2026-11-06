import { useEffect, useRef, useState } from 'react';
import { elapsed, istTime } from '../format';
import type { Metadata, ReplayCommand, ReplayFrame } from '../types';

interface Props {
  frame: ReplayFrame | null;
  metadata: Metadata | null;
  connected: boolean;
  busy: boolean;
  send: (command: ReplayCommand) => boolean;
}

export function Timeline({ frame, metadata, connected, busy, send }: Props) {
  const [draft, setDraft] = useState<number | null>(null);
  const dragging = useRef(false);
  const submitted = useRef(false);
  const ready = connected && frame !== null;
  const last = (frame?.duration_seconds ?? metadata?.recording_seconds ?? 1) - 1;
  const value = draft ?? frame?.second ?? 0;

  useEffect(() => {
    if (!ready || (!busy && submitted.current)) {
      dragging.current = false;
      submitted.current = false;
      setDraft(null);
    }
  }, [busy, ready]);

  function seek(second: number) {
    dragging.current = false;
    submitted.current = true;
    setDraft(second);
    if (!send({ type: 'seek', second })) {
      submitted.current = false;
      setDraft(null);
    }
  }

  return <section className="timeline" aria-label="Playback controls">
    <div className="timeline-actions">
      <div className="playback">
        <button className="play-button" disabled={!ready || busy || frame.playing || frame.second === last}
          onClick={() => send({ type: 'play' })}>▶ Play</button>
        <button disabled={!ready || busy || !frame.playing} onClick={() => send({ type: 'pause' })}>Ⅱ Pause</button>
        <button disabled={!ready || busy} onClick={() => send({ type: 'reset' })}>↺ Reset</button>
      </div>
      <span className={`playback-state${frame?.playing ? ' is-playing' : ''}`}>
        {busy ? 'Updating replay…' : !ready ? 'Replay unavailable' : frame.second === last ? 'Finished' : frame.playing ? 'Playing' : 'Paused'}
      </span>
      <label className="speed-control">Playback speed
        <select aria-label="Playback speed" value={frame?.speed ?? 1} disabled={!ready} aria-disabled={!ready || busy}
          onPointerDown={event => { if (busy) event.preventDefault(); }}
          onKeyDown={event => { if (busy && ['ArrowUp', 'ArrowDown', 'Home', 'End', ' ', 'Enter'].includes(event.key)) event.preventDefault(); }}
          onChange={event => { if (!busy) send({ type: 'set_speed', speed: Number(event.target.value) as 1 | 2 | 5 | 10 }); }}>
          {[1, 2, 5, 10].map(speed => <option key={speed} value={speed}>{speed}×</option>)}
        </select>
      </label>
    </div>
    <label className="timeline-label" htmlFor="replay-position">Replay position
      <output htmlFor="replay-position">{draft !== null ? 'Seek preview · ' : ''}{elapsed(value)} / {elapsed(last)}</output>
    </label>
    <input id="replay-position" aria-label="Replay position" type="range" min={0} max={last} step={1}
      value={value} disabled={!ready} aria-disabled={!ready || busy}
      aria-valuetext={`${elapsed(value)} of ${elapsed(last)}`}
      onPointerDown={event => {
        if (busy) { event.preventDefault(); return; }
        dragging.current = true;
        setDraft(Number(event.currentTarget.value));
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onChange={event => {
        if (busy) return;
        const second = Number(event.target.value);
        if (dragging.current) setDraft(second);
        else seek(second); // Native keyboard and assistive-technology input.
      }}
      onKeyDown={event => { if (busy && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) event.preventDefault(); }}
      onPointerUp={event => { if (dragging.current) seek(Number(event.currentTarget.value)); }}
      onPointerCancel={() => { dragging.current = false; setDraft(null); }}
      onBlur={event => { if (dragging.current) seek(Number(event.currentTarget.value)); }} />
    <div className="timeline-bounds"><span>{metadata ? `${istTime(metadata.start)} IST` : '—'}</span>
      <span>{metadata ? `${istTime(metadata.end)} IST` : '—'}</span></div>
  </section>;
}
