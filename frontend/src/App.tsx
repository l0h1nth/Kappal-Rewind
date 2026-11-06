import { useEffect, useState } from 'react';
import { VesselMap } from './components/VesselMap';
import { Timeline } from './components/Timeline';
import { VesselPanel } from './components/VesselPanel';
import { istTime } from './format';
import { useReplaySocket } from './hooks/useReplaySocket';
import { parseMetadata, type Metadata } from './types';

export function App() {
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [metadataAttempt, setMetadataAttempt] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const { frame, status, error, busy, send, reconnect } = useReplaySocket();

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

  const time = frame ? istTime(frame.timestamp) : '—';
  const date = frame ? new Date(frame.timestamp).toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : 'Recorded vessel tracks';
  const selectedPresent = frame?.vessels.some(vessel => vessel.id === selected);

  return <main>
    <header className="app-header">
      <div className="brand"><span className="wordmark">K / R</span><div><h1>Kappal <em>Rewind</em></h1><p>The sea has a replay button.</p></div></div>
      <div className="replay-time"><span>RECORDED TIME · IST</span><time aria-label="Current replay time" dateTime={frame?.timestamp}>{time}</time></div>
      <div className={`connection ${status}`} role="status" aria-label="Replay connection"><span className="connection-dot" />{status}</div>
    </header>
    <div className="map-caption"><p className="eyebrow">VESSEL REPLAY</p><p className="recording-date">{date}</p></div>
    {(status === 'disconnected' || status === 'error') && <div className="notice" role="alert">
      <span>{error ?? 'Replay disconnected. Current positions have been cleared.'}</span>
      <button onClick={reconnect}>Reconnect</button><small>A new session starts paused at the beginning.</small>
    </div>}
    {error && status === 'connected' && <p className="notice" role="alert">{error}</p>}
    <div className="workspace">
      {metadata ? <VesselMap metadata={metadata} frame={frame} selected={selected} onSelect={setSelected} /> :
        <div className="map-placeholder">{metadataError ? <div role="alert"><p>{metadataError}</p><button onClick={() => setMetadataAttempt(value => value + 1)}>Retry metadata</button></div> : <p role="status">Loading dataset bounds…</p>}</div>}
      <VesselPanel selected={selected} frame={frame} connected={status === 'connected'} />
    </div>
    <Timeline frame={frame} metadata={metadata} connected={status === 'connected'} busy={busy} send={send} />
    <footer>
      <span>{frame ? `${frame.vessels.length} vessels observed · ${frame.playing ? 'Playing' : 'Paused'}` : 'Waiting for replay state'}</span>
      <span className="selection" aria-live="polite">{selected ? `${selected} selected${!selectedPresent ? ' · No current observation' : ''}` : 'Select a vessel to identify it'}</span>
    </footer>
  </main>;
}
