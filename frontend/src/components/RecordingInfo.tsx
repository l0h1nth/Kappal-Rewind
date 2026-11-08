import { useEffect, useState } from 'react';
import { getDatasetJson, istDateTime, parseRecording, type Recording } from '../datasets';
import type { Metadata } from '../types';

export function RecordingInfo({ datasetId, name, metadata }: {
  datasetId: string; name: string; metadata: Metadata;
}) {
  const [recording, setRecording] = useState<Recording | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const builtin = datasetId === 'builtin';
  useEffect(() => {
    if (builtin) return;
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    setError(false);
    getDatasetJson(`/api/datasets/${datasetId}`, controller.signal).then(parseRecording).then(value => {
      if (value.dataset_id !== datasetId) throw new Error('Wrong recording');
      if (active) setRecording(value);
    }).catch(() => { if (active) setError(true); })
      .finally(() => window.clearTimeout(timeout));
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); };
  }, [builtin, datasetId, attempt]);
  return <details className="recording-info" aria-label="Recording information">
    <summary>About this recording</summary>
    <dl className="recording-summary">
      <div><dt>Recording type</dt><dd>{builtin ? 'Built-in assignment' : 'Uploaded recording'}</dd></div>
      <div><dt>Vessels</dt><dd>{metadata.vessel_count.toLocaleString('en-US')}</dd></div>
      <div><dt>Accepted observations</dt><dd>{metadata.record_count.toLocaleString('en-US')}</dd></div>
      <div><dt>Filename</dt><dd>{builtin ? 'tracks.csv' : name}</dd></div>
      <div><dt>Recorded duration</dt><dd>{metadata.recording_seconds.toLocaleString('en-US')} seconds</dd></div>
      <div><dt>Recording start · IST (Asia/Kolkata)</dt><dd><time dateTime={metadata.start}>{istDateTime(metadata.start)}</time></dd></div>
      <div><dt>Recording end · IST (Asia/Kolkata)</dt><dd><time dateTime={metadata.end}>{istDateTime(metadata.end)}</time></dd></div>
      {recording && <>
        <div><dt>Missing vessel-seconds</dt><dd>{recording.validation.missing_observation_seconds.toLocaleString('en-US')}</dd></div>
        <div><dt>Discarded duplicate observations</dt><dd>{recording.validation.discarded_row_count.toLocaleString('en-US')}</dd></div>
      </>}
    </dl>
    {builtin ? <p>Detailed validation counts are unavailable for the built-in recording.</p> :
      error ? <p>Validation counts unavailable. <button onClick={() => setAttempt(value => value + 1)}>Retry recording information</button></p> :
      !recording && <p role="status">Loading validation counts…</p>}
  </details>;
}
