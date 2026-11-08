import { useEffect, useRef, useState, type FormEvent } from 'react';

interface ImportResult {
  dataset_id: string;
  original_filename: string;
  accepted_row_count: number;
  vessel_count: number;
  duration_seconds: number;
  start: string;
  end: string;
  validation: {
    source_row_count: number;
    discarded_row_count: number;
    heading_normalizations: number;
    missing_observation_seconds: number;
    naive_timezone: string;
  };
}

export function UploadCsv({ onImported }: { onImported?: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<'idle' | 'uploading' | 'processing' | 'completed' | 'failed' | 'cancelled'>('idle');
  const [percent, setPercent] = useState<number | null>(null);
  const uploading = stage === 'uploading' || stage === 'processing';
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limits, setLimits] = useState<{ max_bytes: number; max_rows: number } | null>(null);
  const [limitsError, setLimitsError] = useState(false);
  const [limitsAttempt, setLimitsAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    setLimitsError(false);
    fetch('/api/upload-limits', { signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (!response.ok || ![body.max_bytes, body.max_rows].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('Invalid limits');
      if (active) setLimits(body);
    }).catch(() => { if (active) setLimitsError(true); })
      .finally(() => window.clearTimeout(timeout));
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); };
  }, [limitsAttempt]);
  const pending = useRef<XMLHttpRequest | null>(null);
  useEffect(() => () => {
    const request = pending.current;
    pending.current = null; // Ignore late events after unmount.
    request?.abort();
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || !limits || limitsError || pending.current) return;
    setError(null);
    setResult(null);
    setPercent(null);
    if (file.size > limits.max_bytes) {
      setStage('failed');
      setError(`CSV exceeds the ${limits.max_bytes % 1048576 === 0 ? `${limits.max_bytes / 1048576} MiB` : `${limits.max_bytes.toLocaleString('en-US')} byte`} upload limit.`);
      return;
    }
    const request = new XMLHttpRequest();
    pending.current = request;
    setStage('uploading');
    const current = () => pending.current === request;
    const fail = (message: string) => {
      if (!current()) return;
      pending.current = null;
      setStage('failed');
      setError(message);
    };
    // Progress counts the multipart request body, not validation or conversion work.
    request.upload.onprogress = event => {
      if (!current()) return;
      const measurable = event.lengthComputable && event.total > 0;
      setPercent(measurable ? Math.min(100, Math.floor(100 * event.loaded / event.total)) : null);
      // Firefox can delay upload.load until the response; measured sent bytes are enough.
      if (measurable && event.loaded >= event.total) setStage('processing');
    };
    request.upload.onload = () => { if (current()) setStage('processing'); };
    request.onload = () => {
      if (!current()) return;
      const data = request.response;
      if (request.status < 200 || request.status >= 300) {
        fail(typeof data?.detail === 'string' ? data.detail : request.status === 413
          ? 'Upload exceeds the server size limit.' : `Import was not confirmed (HTTP ${request.status}). Refresh recordings before retrying.`);
        return;
      }
      if (!data || typeof data.dataset_id !== 'string' || !data.validation ||
          typeof data.original_filename !== 'string' || typeof data.start !== 'string' || typeof data.end !== 'string' ||
          typeof data.validation.naive_timezone !== 'string' ||
          ![data.accepted_row_count, data.vessel_count, data.duration_seconds, data.validation.source_row_count,
            data.validation.discarded_row_count, data.validation.heading_normalizations,
            data.validation.missing_observation_seconds].every(n => Number.isSafeInteger(n) && n >= 0)) {
        fail('The server returned an invalid upload result. The import may have completed. Refresh recordings before retrying.');
        return;
      }
      pending.current = null;
      setStage('completed');
      setResult(data);
      onImported?.();
    };
    request.onerror = () => fail('Connection lost before the import was confirmed. It may have completed; refresh recordings before retrying.');
    request.onabort = () => {
      if (!current()) return;
      pending.current = null;
      setStage('cancelled');
    };
    request.open('POST', '/api/datasets');
    request.responseType = 'json';
    const body = new FormData();
    body.append('file', file);
    try { request.send(body); }
    catch { fail('Upload could not start. Please try again.'); }
  }

  return <details className="upload-section">
    <summary>Upload CSV</summary>
    <p>Store a validated recording. Uploading does not change the current replay.</p>
    {limits && <p className="upload-help">UTF-8 CSV · Up to {limits.max_bytes % 1048576 === 0 ? `${limits.max_bytes / 1048576} MiB` : `${limits.max_bytes.toLocaleString('en-US')} bytes`} / {limits.max_rows.toLocaleString('en-US')} rows · one import at a time. Naive times use the server timezone (Asia/Kolkata by default).</p>}
    {!limits && !limitsError && <p role="status">Loading upload limits…</p>}
    {limitsError && <p role="alert">Upload limits unavailable. <button onClick={() => setLimitsAttempt(value => value + 1)}>Retry upload limits</button></p>}
    <form onSubmit={submit}>
      <label>CSV file<input type="file" accept=".csv,text/csv" disabled={uploading}
        onChange={event => { setFile(event.target.files?.[0] ?? null); setResult(null); setError(null); setStage('idle'); setPercent(null); }} /></label>
      <span>{file?.name ?? 'No file selected'}</span>
      <button disabled={!file || !limits || limitsError || uploading} type="submit">{uploading ? 'Import in progress…' : 'Upload and store'}</button>
    </form>
    <div className="upload-feedback" aria-busy={uploading}>
      {uploading && <>
        <p role="status">{stage === 'uploading'
          ? `Uploading${percent === null ? '…' : ` · ${percent}% of transfer sent`}`
          : 'Upload sent. Processing and validating CSV, then saving Parquet…'}</p>
        <progress aria-label={stage === 'uploading' ? 'Upload transfer' : 'Processing and saving Parquet'}
          max={100} value={stage === 'uploading' && percent !== null ? percent : undefined} />
        <p className="upload-help">{stage === 'processing'
          ? 'Waiting for server confirmation. Processing progress is not available.'
          : 'Transfer progress measures bytes sent; validation and storage follow.'}</p>
        <button type="button" onClick={() => pending.current?.abort()}>Cancel import</button>
      </>}
      {stage === 'cancelled' && <p role="status">Import cancelled. Cleanup of unfinished work may take a moment. It may have completed just before cancellation; refresh recordings before retrying.</p>}
    </div>
    {error && <p role="alert" className="upload-error">{error}</p>}
    {result && <div role="status" className="upload-result">
      <p>Completed · Stored {result.original_filename} · {result.dataset_id}</p>
      <p>{result.accepted_row_count} accepted rows / {result.validation.source_row_count} source rows · {result.vessel_count} vessels · {result.duration_seconds} recorded seconds</p>
      <p>Recording start/end · UTC: {result.start} → {result.end}</p>
      <p>{result.validation.discarded_row_count} duplicate rows discarded · {result.validation.heading_normalizations} headings normalized · {result.validation.missing_observation_seconds} missing vessel-seconds</p>
      <p>Naive timestamp timezone: {result.validation.naive_timezone}. Saved as Parquet; current replay unchanged.</p>
    </div>}
  </details>;
}
