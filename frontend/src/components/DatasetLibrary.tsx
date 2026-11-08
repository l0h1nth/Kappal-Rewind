import { useEffect, useRef, useState } from 'react';
import { getDatasetJson, istDateTime, parsePreview, parseRecording, validationLabels, type PreviewRow, type Recording } from '../datasets';

function RecordingDetails({ id }: { id: string }) {
  const [recording, setRecording] = useState<Recording | null>(null);
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    getDatasetJson(`/api/datasets/${id}`, controller.signal).then(parseRecording)
      .then(value => { if (active) setRecording(value); })
      .catch(() => { if (active) setMetadataError('Recording details could not be loaded. Refresh the library and try again.'); });
    getDatasetJson(`/api/datasets/${id}/preview?limit=20`, controller.signal).then(value => parsePreview(value, id))
      .then(value => { if (active) setRows(value); })
      .catch(() => { if (active) setPreviewError('Preview could not be loaded. Stored files have not been changed.'); });
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); };
  }, [id]);
  return <section className="recording-details" aria-label="Recording details">
    <h3>Read-only recording details</h3>
    {metadataError ? <p role="alert">{metadataError}</p> : !recording ? <p role="status">Loading recording details…</p> : <>
      <h4>{recording.original_filename}</h4><p className="recording-id">{recording.dataset_id}</p>
      <dl className="recording-summary">
        <div><dt>Imported · IST</dt><dd>{recording.imported_at ? istDateTime(recording.imported_at) : 'Unknown (E1 import)'}</dd></div>
        <div><dt>Recording start · IST</dt><dd>{istDateTime(recording.start)}</dd></div>
        <div><dt>Recording end · IST</dt><dd>{istDateTime(recording.end)}</dd></div>
        <div><dt>Vessels / recorded seconds</dt><dd>{recording.vessel_count} / {recording.duration_seconds}</dd></div>
        <div><dt>Accepted observations</dt><dd>{recording.accepted_row_count}</dd></div>
        <div><dt>Naive timestamp timezone</dt><dd>{recording.validation.naive_timezone}</dd></div>
        {Object.entries(validationLabels).map(([key, label]) => <div key={key}><dt>{label}</dt>
          <dd>{recording.validation[key as keyof typeof validationLabels]}</dd></div>)}
      </dl>
    </>}
    <h4>Normalized observations · first 20 rows</h4>
    {previewError ? <p role="alert">{previewError}</p> : rows === null ? <p role="status">Loading observation preview…</p> :
      <div className="preview-scroll" role="region" aria-label="Observation preview" tabIndex={0}>
        <table><caption>Ordered by timestamp, then vessel ID. Times shown in IST.</caption>
          <thead><tr>{['Vessel ID', 'Timestamp · IST', 'Latitude', 'Longitude', 'Speed · knots', 'Heading · degrees'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{rows.map(row => <tr key={`${row.timestamp}:${row.track_id}`}>
            <td>{row.track_id}</td><td><time dateTime={row.timestamp}>{istDateTime(row.timestamp)}</time></td>
            <td>{row.lat}</td><td>{row.lon}</td><td>{row.speed_knots}</td><td>{row.heading}</td>
          </tr>)}</tbody>
        </table>
        {!rows.length && <p>No observations returned.</p>}
      </div>}
  </section>;
}

export function DatasetLibrary({ revision, activeDatasetId = 'builtin', selecting = false, onReplay, builtinReplayReady, builtinReplayFailed, switchError, onSwitchToBuiltin }: {
  revision: number; activeDatasetId?: string; selecting?: boolean; onReplay?: (recording: Recording) => void;
  builtinReplayReady: boolean; builtinReplayFailed: boolean; switchError: string | null; onSwitchToBuiltin: () => void;
}) {
  const [refresh, setRefresh] = useState(0);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Recording | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [awaitingBuiltin, setAwaitingBuiltin] = useState(false);
  const [deleteMessage, setDeleteMessage] = useState<{ error: boolean; text: string } | null>(null);
  const deleteRequest = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; deleteRequest.current?.abort(); };
  }, []);

  const deleteBlocked = selecting || deleteTarget?.dataset_id === activeDatasetId || (awaitingBuiltin && !builtinReplayReady);

  async function confirmDelete() {
    if (!deleteTarget || deleteRequest.current || deleteBlocked) return;
    const target = deleteTarget;
    const controller = new AbortController();
    deleteRequest.current = controller;
    setDeletePending(true);
    setDeleteMessage(null);
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`/api/datasets/${target.dataset_id}`, { method: 'DELETE', signal: controller.signal });
      const body = await response.json().catch(() => null);
      if (!mounted.current) return;
      const removed = body?.removed_from_library === true ||
        (response.ok && body?.deleted === true && body?.dataset_id === target.dataset_id);
      if (removed) {
        setRecordings(previous => previous.filter(item => item.dataset_id !== target.dataset_id));
        setSelected(previous => previous === target.dataset_id ? null : previous);
        setDeleteTarget(null);
        setAwaitingBuiltin(false);
        setRefresh(value => value + 1);
      }
      if (!response.ok) throw new Error(response.status === 409
        ? 'This recording is still open in another tab or its previous connection is closing. Close or switch away in every tab, then retry. A deletion may also already be in progress.'
        : typeof body?.detail === 'string' ? body.detail : 'Recording could not be deleted. Refresh and retry.');
      if (!removed) throw new Error('Deletion was not confirmed. Refresh the library before retrying.');
      setDeleteMessage({ error: false, text: `Deleted ${target.original_filename} (${target.dataset_id.slice(0, 8)}).` });
    } catch (failure) {
      if (mounted.current) setDeleteMessage({ error: true, text: controller.signal.aborted
        ? 'Deletion could not be confirmed. Refresh the library before retrying.'
        : failure instanceof Error ? failure.message : 'Recording could not be deleted.' });
    } finally {
      window.clearTimeout(timeout);
      deleteRequest.current = null;
      if (mounted.current) setDeletePending(false);
    }
  }
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    setLoading(true);
    setError(null);
    getDatasetJson('/api/datasets', controller.signal).then(value => {
      if (!Array.isArray(value)) throw new Error('Invalid recording list.');
      return value.map(parseRecording);
    }).then(value => {
      if (active) {
        setRecordings(value);
        setSelected(previous => value.some(recording => recording.dataset_id === previous) ? previous : null);
      }
    }).catch(() => { if (active) { setError('Recording library could not be loaded. Try Refresh.'); setRecordings([]); setSelected(null); } })
      .finally(() => { window.clearTimeout(timeout); if (active) setLoading(false); });
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); };
  }, [refresh, revision]);
  return <section className="dataset-library" aria-label="My Recordings">
    <div className="library-header"><h2>My Recordings</h2><button onClick={() => setRefresh(value => value + 1)}>Refresh recordings</button></div>
    <p>Uploaded recordings · times shown in Asia/Kolkata (IST). Details are read-only; Replay opens a fresh paused session.</p>
    {deleteMessage && <p role={deleteMessage.error ? 'alert' : 'status'}>{deleteMessage.text}</p>}
    {deleteTarget && <section className="delete-confirmation" role="alertdialog" aria-label="Delete recording?" aria-describedby="delete-description">
      <h3>Delete recording?</h3><p id="delete-description">Permanently delete <strong>{deleteTarget.original_filename}</strong> ({deleteTarget.dataset_id})? This removes its observations and metadata and cannot be undone.</p>
      {deleteTarget.dataset_id === activeDatasetId && <p>This recording is loaded here. Switch to the built-in assignment below, then confirm permanent deletion.</p>}
      {(deleteTarget.dataset_id === activeDatasetId || (awaitingBuiltin && !builtinReplayReady)) && <>
        <button disabled={deletePending || selecting || (activeDatasetId === 'builtin' && !builtinReplayReady && !builtinReplayFailed)}
          onClick={() => { setAwaitingBuiltin(true); setDeleteMessage(null); onSwitchToBuiltin(); }}>
          {builtinReplayFailed ? 'Reconnect built-in assignment' : selecting || (activeDatasetId === 'builtin' && !builtinReplayReady) ? 'Switching to built-in…' : 'Switch to built-in assignment'}
        </button>
        {awaitingBuiltin && (switchError || builtinReplayFailed) && <p role="alert">{switchError ?? 'Built-in replay disconnected. Reconnect to continue.'} Deletion has not been sent. Retry switching or cancel.</p>}
      </>}
      {awaitingBuiltin && builtinReplayReady && <p role="status">Built-in assignment loaded. Confirm permanent deletion below.</p>}
      <button disabled={deletePending} onClick={() => { setDeleteTarget(null); setAwaitingBuiltin(false); setDeleteMessage(null); }}>Cancel</button>
      <button className="delete-action" disabled={deletePending || deleteBlocked} onClick={confirmDelete}>{deletePending ? 'Deleting…' : 'Permanently delete'}</button>
    </section>}
    {loading && !recordings.length ? <p role="status">Loading recordings…</p> : error ? <p role="alert">{error}</p> : !recordings.length ?
      <p>No uploaded recordings yet. Upload a CSV to add one.</p> : <ul className="recording-list">
        {recordings.map(recording => <li key={recording.dataset_id}>
          <h3>{recording.original_filename}</h3><p className="recording-id">{recording.dataset_id}</p>
          <p>{recording.vessel_count} vessels · {recording.duration_seconds} recorded seconds · {recording.accepted_row_count} observations</p>
          <p>Imported · IST: {recording.imported_at ? istDateTime(recording.imported_at) : 'Unknown (E1 import)'}</p>
          <button aria-label={`View details for ${recording.original_filename} (${recording.dataset_id.slice(0, 8)})`}
            aria-expanded={selected === recording.dataset_id} onClick={() => setSelected(recording.dataset_id)}>View details</button>
          {onReplay && <button className="recording-replay" disabled={recording.dataset_id === activeDatasetId && !selecting}
            aria-label={`Replay ${recording.original_filename} (${recording.dataset_id.slice(0, 8)})`}
            onClick={() => onReplay(recording)}>{recording.dataset_id === activeDatasetId ? 'Currently loaded' : 'Replay'}</button>}
          <button className="delete-action" disabled={deletePending}
            aria-label={`Delete ${recording.original_filename} (${recording.dataset_id.slice(0, 8)})`}
            onClick={() => { setDeleteTarget(recording); setAwaitingBuiltin(false); setDeleteMessage(null); }}>Delete</button>
        </li>)}
      </ul>}
    {selected && !error && <>
      <button className="close-details" onClick={() => setSelected(null)}>Close recording details</button>
      <RecordingDetails key={`${selected}:${revision}`} id={selected} />
    </>}
  </section>;
}
