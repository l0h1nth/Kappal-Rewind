import { useEffect, useRef, useState } from 'react';
import { VesselMap, type SearchFocus } from './components/VesselMap';
import { Timeline } from './components/Timeline';
import { VesselPanel } from './components/VesselPanel';
import { RecordingInfo } from './components/RecordingInfo';
import { UploadCsv } from './components/UploadCsv';
import { DatasetLibrary } from './components/DatasetLibrary';
import { istTime } from './format';
import { useReplaySocket } from './hooks/useReplaySocket';
import { parseMetadata, type Metadata } from './types';

type RecordingChoice = { id: string; name: string };
const BUILTIN = { id: 'builtin', name: 'Built-in assignment' };

export function App() {
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [metadataAttempt, setMetadataAttempt] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [searchFocus, setSearchFocus] = useState<SearchFocus | null>(null);
  const [libraryRevision, setLibraryRevision] = useState(0);
  const [recording, setRecording] = useState<RecordingChoice | null>(BUILTIN);
  const [requested, setRequested] = useState<RecordingChoice | null>(BUILTIN);
  const [switching, setSwitching] = useState(false);
  const [tab, setTab] = useState<'vessels' | 'recordings'>('vessels');
  const [recordingDetailsOpen, setRecordingDetailsOpen] = useState(false);
  const recordingsPanel = useRef<HTMLDivElement>(null);
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);
  const preflight = useRef<AbortController | null>(null);
  const preflightEpoch = useRef(0);
  const { frame, status, error, busy, motionEpoch, send, reconnect, disconnect } = useReplaySocket(recording?.id ?? null);

  useEffect(() => {
    const epoch = ++preflightEpoch.current;
    if (!requested) return;
    const controller = new AbortController();
    preflight.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    setMetadataError(null); setSwitching(true);
    const url = requested.id === 'builtin' ? '/api/meta' : `/api/replay/${encodeURIComponent(requested.id)}/meta`;
    fetch(url, { signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body?.detail === 'string' ? body.detail : 'Dataset metadata could not be loaded.');
      if (requested.id !== 'builtin' && body.dataset_id !== requested.id) throw new Error('Wrong recording metadata received.');
      const parsed = parseMetadata(body);
      if (preflightEpoch.current === epoch) {
        setMetadata(parsed); setRecording(requested);
        if (requested.id !== recording?.id) { setSelected(null); setSearchFocus(null); }
        setSwitching(false);
      }
    }).catch(failure => {
      if (preflightEpoch.current === epoch) {
        setMetadataError(`Dataset metadata could not be loaded. ${failure instanceof Error ? failure.message : 'Check the backend and retry.'}`);
        setSwitching(false);
      }
    }).finally(() => window.clearTimeout(timeout));
    return () => { ++preflightEpoch.current; controller.abort(); window.clearTimeout(timeout); };
  }, [metadataAttempt, requested]);

  useEffect(() => { if (recordingDetailsOpen) recordingsPanel.current?.scrollTo({ top: 0 }); }, [recordingDetailsOpen]);

  function chooseRecording(choice: RecordingChoice) {
    if (deletingRef.current) return;
    setRequested(choice); setTab('vessels');
  }
  async function prepareDelete(id: string) {
    deletingRef.current = true; setDeleting(true);
    if (recording?.id !== id) return;
    ++preflightEpoch.current; preflight.current?.abort();
    const closing = disconnect();
    setRecording(null); setRequested(null); setSelected(null); setSearchFocus(null);
    setSwitching(false); setMetadataError(null);
    await closing;
  }
  function finishDelete() { deletingRef.current = false; setDeleting(false); }
  function selectFromSearch(id: string) {
    setSelected(id);
    const vessel = frame?.vessels.find(vessel => vessel.id === id);
    setSearchFocus(vessel && recording ? { datasetId: recording.id, lat: vessel.lat, lon: vessel.lon } : null);
  }
  const selectedPresent = frame?.vessels.some(vessel => vessel.id === selected);
  const activeMetadata = recording ? metadata : null;

  return <main>
    <header className="app-header">
      <div className="brand"><span className="wordmark">K / R</span><div><h1>Kappal <em>Rewind</em></h1><p>The sea has a replay button.</p></div></div>
      <div className="header-recording" aria-label="Current recording"><span className="eyebrow">REPLAY WORKSPACE</span>
        <strong>{recording?.name ?? 'No recording loaded'}</strong><small>{recording ? recording.id === 'builtin' ? 'Built-in assignment · tracks.csv' : recording.id : 'Choose a recording to start replay'}</small></div>
      <div className="replay-time"><span>RECORDED TIME · IST</span><time aria-label="Current replay time" dateTime={frame?.timestamp}>{frame ? istTime(frame.timestamp) : '—'}</time></div>
      <div className={`connection ${recording ? status : 'empty'}`} role="status" aria-label="Replay connection"><span className="connection-dot" />{recording ? status : 'No recording'}</div>
    </header>
    {switching && metadata && <p className="workspace-notice" role="status">Loading recording… Current replay continues until metadata is ready.</p>}
    {metadataError && metadata && <div className="notice" role="alert"><span>{metadataError} {recording ? 'Current replay was kept.' : 'Choose another recording or retry.'}</span>
      <button disabled={deleting} onClick={() => setMetadataAttempt(value => value + 1)}>Retry recording</button></div>}
    {recording && (status === 'disconnected' || status === 'error') && <div className="notice" role="alert">
      <span>{error ?? 'Replay disconnected. Current positions have been cleared.'}</span>
      <button onClick={reconnect}>Reconnect</button><small>A new session starts paused at the beginning.</small>
    </div>}
    {error && status === 'connected' && <p className="notice" role="alert">{error}</p>}
    <div className="workspace">
      <div className="replay-stage">
        {metadata ? <VesselMap metadata={metadata} frame={frame} selected={selected} onSelect={setSelected} datasetId={recording?.id ?? 'empty'} motionEnabled={!busy} motionEpoch={motionEpoch} searchFocus={searchFocus} /> :
          <div className="map-placeholder">{metadataError ? <div role="alert"><p>{metadataError}</p><button onClick={() => setMetadataAttempt(value => value + 1)}>Retry metadata</button></div> : <p role="status">Loading dataset bounds…</p>}</div>}
        {!recording && <div className="empty-workspace" role="status"><strong>No recording loaded.</strong><span>Choose a recording to start replay.</span><button onClick={() => setTab('recordings')}>Choose recording</button></div>}
        <Timeline key={recording?.id ?? 'empty'} frame={frame} metadata={activeMetadata} connected={!!recording && status === 'connected'} busy={busy} send={send} />
        <footer><span>{frame ? `${frame.vessels.length} vessels observed · ${frame.playing ? 'Playing' : 'Paused'}` : recording ? 'Waiting for replay state' : 'No recording loaded'}</span>
          <span className="selection" aria-live="polite">{selected ? `${selected} selected${!selectedPresent ? ' · No current observation' : ''}` : 'Select a vessel to identify it'}</span></footer>
      </div>
      <aside className="workspace-sidebar" aria-label="Workspace sidebar">
        <div role="tablist" aria-label="Workspace tools" className="sidebar-tabs">
          {(['vessels', 'recordings'] as const).map((name, index) => <button key={name} id={`${name}-tab`} role="tab"
            aria-selected={tab === name} aria-controls={`${name}-tools`} tabIndex={tab === name ? 0 : -1}
            onClick={() => setTab(name)} onKeyDown={event => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index;
              setTab(next === 0 ? 'vessels' : 'recordings');
              (event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next])?.focus();
            }}>{name === 'vessels' ? 'Vessels' : 'Recordings'}</button>)}
        </div>
        <div id="vessels-tools" role="tabpanel" aria-labelledby="vessels-tab" hidden={tab !== 'vessels'} className="sidebar-panel">
          <VesselPanel vesselIds={activeMetadata?.vessel_ids ?? []} datasetId={recording?.id ?? 'empty'} onSelect={selectFromSearch} selected={selected} frame={frame} connected={status === 'connected'} />
          {activeMetadata && recording && <RecordingInfo key={`info:${recording.id}`} datasetId={recording.id} name={recording.name} metadata={activeMetadata} />}
        </div>
        <div ref={recordingsPanel} id="recordings-tools" role="tabpanel" aria-labelledby="recordings-tab" hidden={tab !== 'recordings'} className="sidebar-panel">
          <div hidden={recordingDetailsOpen}>
          <button className="builtin-replay" disabled={deleting || (recording?.id === 'builtin' && !switching)} onClick={() => chooseRecording(BUILTIN)}>Replay built-in assignment</button>
          <UploadCsv onImported={() => setLibraryRevision(value => value + 1)} />
          </div>
          <DatasetLibrary onDetailsChange={setRecordingDetailsOpen} revision={libraryRevision} activeDatasetId={recording?.id ?? null} selecting={switching}
            onPrepareDelete={prepareDelete} onDeleteFinished={finishDelete}
            onReplay={item => chooseRecording({ id: item.dataset_id, name: item.original_filename })} />
        </div>
      </aside>
    </div>
  </main>;
}
