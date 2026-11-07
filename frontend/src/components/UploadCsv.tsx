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

export function UploadCsv() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || pending.current) return;
    setError(null);
    setResult(null);
    if (file.size > 10 * 1024 * 1024) {
      setError('CSV exceeds the 10 MiB upload limit.');
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
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Upload response unavailable.');
    } finally {
      pending.current = null;
      if (!controller.signal.aborted) setUploading(false);
    }
  }

  return <details className="upload-section">
    <summary>Upload CSV</summary>
    <p>Store a validated recording for later use. Playback continues with the assignment dataset.</p>
    <p className="upload-help">UTF-8 CSV · up to 10 MiB / 50,000 rows · one import at a time. Naive times use the server timezone (Asia/Kolkata by default).</p>
    <form onSubmit={submit}>
      <label>CSV file<input type="file" accept=".csv,text/csv" disabled={uploading}
        onChange={event => { setFile(event.target.files?.[0] ?? null); setResult(null); setError(null); }} /></label>
      <span>{file?.name ?? 'No file selected'}</span>
      <button disabled={!file || uploading} type="submit">{uploading ? 'Uploading…' : 'Upload and store'}</button>
    </form>
    {uploading && <p role="status">Uploading and validating CSV…</p>}
    {error && <p role="alert" className="upload-error">{error}</p>}
    {result && <div role="status" className="upload-result">
      <p>Stored {result.original_filename} · {result.dataset_id}</p>
      <p>{result.accepted_row_count} accepted rows / {result.validation.source_row_count} source rows · {result.vessel_count} vessels · {result.duration_seconds} recorded seconds</p>
      <p>{result.start} → {result.end}</p>
      <p>{result.validation.discarded_row_count} duplicate rows discarded · {result.validation.heading_normalizations} headings normalized · {result.validation.missing_observation_seconds} missing vessel-seconds</p>
      <p>Naive timestamp timezone: {result.validation.naive_timezone}. Saved as Parquet; playback dataset unchanged.</p>
    </div>}
  </details>;
}
