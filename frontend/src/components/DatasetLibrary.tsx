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
        <p>Ordered by timestamp, then vessel ID · IST</p>
        <ol className="preview-rows">{rows.map(row => <li key={`${row.timestamp}:${row.track_id}`}>
          <strong>{row.track_id}</strong><time dateTime={row.timestamp}>{istDateTime(row.timestamp)}</time>
          <dl><div><dt>Latitude / longitude</dt><dd>{row.lat} / {row.lon}</dd></div>
            <div><dt>Speed / heading</dt><dd>{row.speed_knots} kn / {row.heading}°</dd></div></dl>
        </li>)}</ol>
        {!rows.length && <p>No observations returned.</p>}
      </div>}

  </section>;
}

export function DatasetLibrary({ revision, activeDatasetId, selecting = false, onReplay, onPrepareDelete, onDeleteFinished, onDetailsChange }: {
  revision: number; activeDatasetId: string | null; selecting?: boolean; onReplay: (recording: Recording) => void;
  onDetailsChange: (open: boolean) => void;
  onPrepareDelete: (id: string) => Promise<void>; onDeleteFinished: () => void;
}) {
  const [refresh, setRefresh] = useState(0);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Recording | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteMessage, setDeleteMessage] = useState<{ error: boolean; text: string } | null>(null);
  const deleteRequest = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const refreshButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; deleteRequest.current?.abort(); };
  }, []);
  useEffect(() => {
    if (deleteTarget) dialog.current?.showModal();
    else if (dialog.current?.open) {
      dialog.current.close();
      (trigger.current?.isConnected ? trigger.current : refreshButton.current)?.focus();
    }
  }, [deleteTarget]);
  useEffect(() => { if (selected) heading.current?.focus(); }, [selected]);
  useEffect(() => { onDetailsChange(selected !== null); }, [selected, onDetailsChange]);

  async function confirmDelete() {
    if (!deleteTarget || deleteRequest.current || selecting) return;
    const target = deleteTarget;
    const controller = new AbortController();
    deleteRequest.current = controller;
    setDeletePending(true); setDeleteMessage(null);
    let timeout: number | undefined;
    try {
      // Close only this tab's session, then let the existing server reservation decide.
      await onPrepareDelete(target.dataset_id);
      if (!mounted.current || controller.signal.aborted) return;
      timeout = window.setTimeout(() => controller.abort(), 8000);
      const response = await fetch(`/api/datasets/${target.dataset_id}`, { method: 'DELETE', signal: controller.signal });
      const body = await response.json().catch(() => null);
      if (!mounted.current) return;
      const removed = body?.removed_from_library === true ||
        (response.ok && body?.deleted === true && body?.dataset_id === target.dataset_id);
      if (removed) {
        setRecordings(previous => previous.filter(item => item.dataset_id !== target.dataset_id));
        setSelected(previous => previous === target.dataset_id ? null : previous);
        setDeleteTarget(null); setRefresh(value => value + 1);
      }
      if (!response.ok) throw new Error(response.status === 409
        ? `${typeof body?.detail === 'string' ? body.detail : 'Recording is in use.'} Another tab or a closing replay may still use it. Close that session, then retry.`
        : typeof body?.detail === 'string' ? body.detail : 'Recording could not be deleted. Refresh and retry.');
      if (!removed) throw new Error('Deletion was not confirmed. Refresh the library before retrying.');
      setDeleteMessage({ error: false, text: `Deleted ${target.original_filename} (${target.dataset_id.slice(0, 8)}).` });
    } catch (failure) {
      if (mounted.current) setDeleteMessage({ error: true, text: controller.signal.aborted
        ? 'Deletion could not be confirmed. Refresh the library before retrying.'
        : failure instanceof Error ? failure.message : 'Recording could not be deleted.' });
    } finally {
      window.clearTimeout(timeout); deleteRequest.current = null;
      if (mounted.current) setDeletePending(false);
      onDeleteFinished();
    }
  }
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    setLoading(true); setError(null);
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
  const matches = recordings.filter(item => `${item.original_filename} ${item.dataset_id}`.toLowerCase().includes(filter.trim().toLowerCase()));
  // Bound rendered library rows; refine search to reach any recording by ID/name.
  const visible = matches.slice(0, 50);
  return <section className="dataset-library" aria-label="My Recordings">
    <div className="library-header"><h2>My Recordings</h2><button ref={refreshButton} onClick={() => setRefresh(value => value + 1)}>Refresh recordings</button></div>
    {deleteMessage && !deleteTarget && <p role={deleteMessage.error ? 'alert' : 'status'}>{deleteMessage.text}</p>}
    <dialog ref={dialog} className="delete-confirmation" aria-labelledby="delete-title" aria-describedby="delete-description"
      onCancel={event => { event.preventDefault(); if (!deleteRequest.current) { setDeleteTarget(null); setDeleteMessage(null); } }}>
      {deleteTarget && <>
        <h3 id="delete-title">Delete recording?</h3><p id="delete-description">Delete <strong>{deleteTarget.original_filename}</strong>? This permanently removes its stored data and metadata.</p>
        {deleteTarget.dataset_id === activeDatasetId && <p>This tab's replay will close, leaving an empty workspace.</p>}
        {deleteMessage && <p role="alert">{deleteMessage.text}</p>}
        <div className="dialog-actions"><button autoFocus disabled={deletePending} onClick={() => { setDeleteTarget(null); setDeleteMessage(null); }}>Cancel</button>
          <button className="delete-action" disabled={deletePending || selecting} onClick={confirmDelete}>{deletePending ? 'Deleting…' : 'Delete recording'}</button></div>
      </>}
    </dialog>
    {selected && !error ? <>
      <button className="close-details" onClick={() => { setSelected(null); refreshButton.current?.focus(); }}>← Back to recordings</button>
      <h2 ref={heading} tabIndex={-1} className="details-heading">Recording information</h2>
      <RecordingDetails key={`${selected}:${revision}`} id={selected} />
    </> : <>
      <label className="library-filter">Search recordings<input type="search" value={filter} onChange={event => setFilter(event.target.value)} placeholder="Filename or dataset ID" /></label>
      {loading && !recordings.length ? <p role="status">Loading recordings…</p> : error ? <p role="alert">{error}</p> : !recordings.length ?
        <p>No uploaded recordings yet. Upload a CSV to add one.</p> : <>
        <p className="library-count">{matches.length} recordings{matches.length > visible.length ? ` · showing first ${visible.length}; refine search` : ''}</p>
        {!matches.length && <p>No matching recordings.</p>}
        <ul className="recording-list">{visible.map(recording => <li key={recording.dataset_id}>
          <div className="recording-row-title"><h3>{recording.original_filename}</h3>{recording.dataset_id === activeDatasetId && <span className="current-badge">Current</span>}</div>
          <p className="recording-id" title={recording.dataset_id}>{recording.dataset_id}</p>
          <p>{recording.vessel_count} vessels · {recording.duration_seconds}s · {recording.accepted_row_count.toLocaleString('en-US')} observations</p>
          <p className="imported-at">Imported · IST: {recording.imported_at ? istDateTime(recording.imported_at) : 'Unknown (E1 import)'}</p>
          <div className="recording-actions">
            <button className="recording-replay" disabled={deletePending || (recording.dataset_id === activeDatasetId && !selecting)}
              aria-label={`Replay ${recording.original_filename} (${recording.dataset_id.slice(0, 8)})`}
              onClick={() => onReplay(recording)}>{recording.dataset_id === activeDatasetId ? 'Loaded' : 'Replay'}</button>
            <button aria-label={`View details for ${recording.original_filename} (${recording.dataset_id.slice(0, 8)})`}
              onClick={() => setSelected(recording.dataset_id)}>Details</button>
            <button className="delete-action" disabled={deletePending}
              aria-label={`Delete ${recording.original_filename} (${recording.dataset_id.slice(0, 8)})`}
              onClick={event => { trigger.current = event.currentTarget; setDeleteTarget(recording); setDeleteMessage(null); }}>Delete</button>
          </div>
        </li>)}</ul>
      </>}
    </>}
  </section>;
}
