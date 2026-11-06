import { useEffect, useState } from 'react';
import { VesselMap } from './components/VesselMap';
import { useReplaySocket } from './hooks/useReplaySocket';
import { parseMetadata, type Metadata } from './types';

export function App() {
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [metadataAttempt, setMetadataAttempt] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const { frame, status, error, send, reconnect } = useReplaySocket();

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    setMetadataError(null);
    fetch('/api/meta', { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Dataset metadata could not be loaded.');
        const parsed = parseMetadata(await response.json());
        if (active) setMetadata(parsed);
      })
      .catch(() => { if (active) setMetadataError('Dataset metadata could not be loaded. Check the backend and retry.'); })
      .finally(() => window.clearTimeout(timeout));
    return () => { active = false; window.clearTimeout(timeout); controller.abort(); };
  }, [metadataAttempt]);

  const ready = status === 'connected' && frame !== null;
  const time = frame ? new Date(frame.timestamp).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false }) : '—';
  const date = frame ? new Date(frame.timestamp).toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : 'Recorded vessel tracks';
  const selectedPresent = frame?.vessels.some(vessel => vessel.id === selected);

  return <main>
    <header className="app-header">
      <div className="brand"><span className="wordmark">K / R</span><div><h1>Kappal <em>Rewind</em></h1><p>The sea has a replay button.</p></div></div>
      <div className={`connection ${status}`} role="status"><span className="connection-dot" />{status}</div>
    </header>
    <div className="replay-toolbar">
      <div><p className="eyebrow">VESSEL REPLAY</p><p className="recording-date">{date}</p></div>
      <div className="playback"><div className="replay-time"><span>RECORDED TIME · IST</span><time dateTime={frame?.timestamp}>{time}</time></div>
        <button className="play-button" disabled={!ready || frame.playing || frame.second === frame.duration_seconds - 1}
          onClick={() => send({ type: 'play' })}>▶ Play</button>
        <button disabled={!ready || !frame.playing} onClick={() => send({ type: 'pause' })}>Ⅱ Pause</button>
      </div>
    </div>
    {(status === 'disconnected' || status === 'error') && <div className="notice" role="alert">
      <span>{error ?? 'Replay disconnected. Current positions have been cleared.'}</span>
      <button onClick={reconnect}>Reconnect</button><small>A new session starts paused at the beginning.</small>
    </div>}
    {error && status === 'connected' && <p className="notice" role="alert">{error}</p>}
    {metadata ? <VesselMap metadata={metadata} frame={frame} selected={selected} onSelect={setSelected} /> :
      <div className="map-placeholder">{metadataError ? <div role="alert"><p>{metadataError}</p><button onClick={() => setMetadataAttempt(value => value + 1)}>Retry metadata</button></div> : <p role="status">Loading dataset bounds…</p>}</div>}
    <footer>
      <span>{frame ? `${frame.vessels.length} vessels observed · ${frame.playing ? 'Playing' : 'Paused'}` : 'Waiting for replay state'}</span>
      <span className="selection" aria-live="polite">{selected ? `${selected} selected${!selectedPresent ? ' · No current observation' : ''}` : 'Select a vessel to identify it'}</span>
    </footer>
  </main>;
}
