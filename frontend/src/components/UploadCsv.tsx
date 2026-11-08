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
  const [uploading, setUploading] = useState(false);
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
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || !limits || limitsError || pending.current) return;
    setError(null);
    setResult(null);
    if (file.size > limits.max_bytes) {
      setError(`CSV exceeds the ${limits.max_bytes % 1048576 === 0 ? `${limits.max_bytes / 1048576} MiB` : `${limits.max_bytes.toLocaleString('en-US')} byte`} upload limit.`);
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    setUploading(true);
    const body = new FormData();
    body.append('file', file);
    try {
      const response = await fetch('/api/datasets', { method: 'POST', body, signal: controller.signal });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(typeof data?.detail === 'string' ? data.detail : response.status === 413
          ? 'Upload exceeds the server size limit.' : 'Upload failed. Please try again.');
      }
      if (!data || typeof data.dataset_id !== 'string' || !data.validation ||
          typeof data.validation.naive_timezone !== 'string' ||
          ![data.accepted_row_count, data.vessel_count, data.duration_seconds, data.validation.source_row_count,
            data.validation.discarded_row_count, data.validation.heading_normalizations,
            data.validation.missing_observation_seconds].every(n => Number.isSafeInteger(n) && n >= 0)) {
        throw new Error('The server returned an invalid upload result. The import may have completed.');
      }
      setResult(data);
      onImported?.();
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Upload response unavailable.');
    } finally {
      pending.current = null;
      if (!controller.signal.aborted) setUploading(false);
    }
  }

  return <details className="upload-section">
    <summary>Upload CSV</summary>
    <p>Store a validated recording. Uploading does not change the current replay.</p>
    {limits && <p className="upload-help">UTF-8 CSV · Up to {limits.max_bytes % 1048576 === 0 ? `${limits.max_bytes / 1048576} MiB` : `${limits.max_bytes.toLocaleString('en-US')} bytes`} / {limits.max_rows.toLocaleString('en-US')} rows · one import at a time. Naive times use the server timezone (Asia/Kolkata by default).</p>}
    {!limits && !limitsError && <p role="status">Loading upload limits…</p>}
    {limitsError && <p role="alert">Upload limits unavailable. <button onClick={() => setLimitsAttempt(value => value + 1)}>Retry upload limits</button></p>}
    <form onSubmit={submit}>
      <label>CSV file<input type="file" accept=".csv,text/csv" disabled={uploading}
        onChange={event => { setFile(event.target.files?.[0] ?? null); setResult(null); setError(null); }} /></label>
      <span>{file?.name ?? 'No file selected'}</span>
      <button disabled={!file || !limits || limitsError || uploading} type="submit">{uploading ? 'Uploading…' : 'Upload and store'}</button>
    </form>
    {uploading && <p role="status">Uploading / processing CSV…</p>}
    {error && <p role="alert" className="upload-error">{error}</p>}
    {result && <div role="status" className="upload-result">
      <p>Stored {result.original_filename} · {result.dataset_id}</p>
      <p>{result.accepted_row_count} accepted rows / {result.validation.source_row_count} source rows · {result.vessel_count} vessels · {result.duration_seconds} recorded seconds</p>
      <p>{result.start} → {result.end}</p>
      <p>{result.validation.discarded_row_count} duplicate rows discarded · {result.validation.heading_normalizations} headings normalized · {result.validation.missing_observation_seconds} missing vessel-seconds</p>
      <p>Naive timestamp timezone: {result.validation.naive_timezone}. Saved as Parquet; current replay unchanged.</p>
    </div>}
  </details>;
}
