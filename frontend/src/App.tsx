import { useEffect, useState } from 'react';
import { VesselMap, type SearchFocus } from './components/VesselMap';
import { Timeline } from './components/Timeline';
import { VesselPanel } from './components/VesselPanel';
import { RecordingInfo } from './components/RecordingInfo';
import { UploadCsv } from './components/UploadCsv';
import { DatasetLibrary } from './components/DatasetLibrary';
import { istTime } from './format';
import { useReplaySocket } from './hooks/useReplaySocket';
import { parseMetadata, type Metadata } from './types';

export function App() {
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [metadataAttempt, setMetadataAttempt] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [searchFocus, setSearchFocus] = useState<SearchFocus | null>(null);
  const [libraryRevision, setLibraryRevision] = useState(0);
  const [recording, setRecording] = useState({ id: 'builtin', name: 'Built-in assignment' });
  const [requested, setRequested] = useState(recording);
  const [switching, setSwitching] = useState(false);
  const { frame, status, error, busy, motionEpoch, send, reconnect } = useReplaySocket(recording.id);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    setMetadataError(null);
    setSwitching(true);
    const url = requested.id === 'builtin' ? '/api/meta' : `/api/replay/${encodeURIComponent(requested.id)}/meta`;
    fetch(url, { signal: controller.signal })
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(typeof body?.detail === 'string' ? body.detail : 'Dataset metadata could not be loaded.');
        if (requested.id !== 'builtin' && body.dataset_id !== requested.id) throw new Error('Wrong recording metadata received.');
        const parsed = parseMetadata(body);
        if (active) {
          setMetadata(parsed); setRecording(requested);
          if (requested.id !== recording.id) { setSelected(null); setSearchFocus(null); }
          setSwitching(false);
        }
      })
      .catch(failure => { if (active) { setMetadataError(`Dataset metadata could not be loaded. ${failure instanceof Error ? failure.message : 'Check the backend and retry.'}`); setSwitching(false); } })
      .finally(() => window.clearTimeout(timeout));
    return () => { active = false; window.clearTimeout(timeout); controller.abort(); };
  }, [metadataAttempt, requested]);

  function selectFromSearch(id: string) {
    setSelected(id);
    const vessel = frame?.vessels.find(vessel => vessel.id === id);
    setSearchFocus(vessel ? { datasetId: recording.id, lat: vessel.lat, lon: vessel.lon } : null);
  }

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
    <div className="recording-choice">
      <p aria-label="Current recording">Current recording: <strong>{recording.name}</strong> · {recording.id === 'builtin' ? 'Built-in' : recording.id}</p>
      <button disabled={recording.id === 'builtin' && !switching}
        onClick={() => setRequested({ id: 'builtin', name: 'Built-in assignment' })}>Replay built-in assignment</button>
    </div>
    {metadata && <RecordingInfo key={`info:${recording.id}`} datasetId={recording.id} name={recording.name} metadata={metadata} />}
    {switching && metadata && <p role="status">Loading recording… Current replay continues until metadata is ready.</p>}
    {metadataError && metadata && <div className="notice" role="alert"><span>{metadataError} Current replay was kept.</span>
      <button onClick={() => setMetadataAttempt(value => value + 1)}>Retry recording</button></div>}
    {(status === 'disconnected' || status === 'error') && <div className="notice" role="alert">
      <span>{error ?? 'Replay disconnected. Current positions have been cleared.'}</span>
      <button onClick={reconnect}>Reconnect</button><small>A new session starts paused at the beginning.</small>
    </div>}
    {error && status === 'connected' && <p className="notice" role="alert">{error}</p>}
    <div className="workspace">
      {metadata ? <VesselMap metadata={metadata} frame={frame} selected={selected} onSelect={setSelected} datasetId={recording.id} motionEnabled={!busy} motionEpoch={motionEpoch} searchFocus={searchFocus} /> :
        <div className="map-placeholder">{metadataError ? <div role="alert"><p>{metadataError}</p><button onClick={() => setMetadataAttempt(value => value + 1)}>Retry metadata</button></div> : <p role="status">Loading dataset bounds…</p>}</div>}
      <VesselPanel vesselIds={metadata?.vessel_ids ?? []} datasetId={recording.id} onSelect={selectFromSearch} selected={selected} frame={frame} connected={status === 'connected'} />
    </div>
    <Timeline key={recording.id} frame={frame} metadata={metadata} connected={status === 'connected'} busy={busy} send={send} />
    <footer>
      <span>{frame ? `${frame.vessels.length} vessels observed · ${frame.playing ? 'Playing' : 'Paused'}` : 'Waiting for replay state'}</span>
      <span className="selection" aria-live="polite">{selected ? `${selected} selected${!selectedPresent ? ' · No current observation' : ''}` : 'Select a vessel to identify it'}</span>
    </footer>
    <UploadCsv onImported={() => setLibraryRevision(value => value + 1)} />
    <DatasetLibrary revision={libraryRevision} activeDatasetId={recording.id} selecting={switching}
      builtinReplayReady={recording.id === 'builtin' && status === 'connected' && frame !== null && (frame.dataset_id ?? 'builtin') === 'builtin'}
      builtinReplayFailed={recording.id === 'builtin' && (status === 'error' || status === 'disconnected')}
      switchError={metadataError ?? (recording.id === 'builtin' ? error : null)}
      onSwitchToBuiltin={() => recording.id === 'builtin' ? reconnect() : setRequested({ id: 'builtin', name: 'Built-in assignment' })}
      onReplay={item => setRequested({ id: item.dataset_id, name: item.original_filename })} />
  </main>;
}
