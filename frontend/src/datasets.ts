export const validationLabels = {
  source_row_count: 'Source rows', discarded_row_count: 'Discarded duplicate rows',
  exact_duplicate_rows: 'Exact duplicates', conflicting_duplicate_rows: 'Conflicting duplicates',
  heading_normalizations: 'Headings normalized', missing_observation_seconds: 'Missing vessel-seconds',
  gap_count: 'Missing intervals', naive_timestamp_rows: 'Naive timestamps', offset_timestamp_rows: 'Offset timestamps',
};
type Summary = Record<keyof typeof validationLabels, number> & { naive_timezone: string };
export interface Recording {
  dataset_id: string; original_filename: string; imported_at: string | null;
  accepted_row_count: number; vessel_count: number; duration_seconds: number;
  start: string; end: string; validation: Summary;
}
export interface PreviewRow {
  track_id: string; timestamp: string; lat: number; lon: number; speed_knots: number; heading: number;
}
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object';
const instant = (v: unknown): v is string => typeof v === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));
const count = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
export function parseRecording(value: unknown): Recording {
  if (!object(value) || typeof value.dataset_id !== 'string' || !/^[0-9a-f]{32}$/.test(value.dataset_id) ||
      typeof value.original_filename !== 'string' || !instant(value.start) || !instant(value.end) ||
      (value.imported_at !== null && !instant(value.imported_at)) ||
      ![value.vessel_count, value.accepted_row_count, value.duration_seconds].every(count) ||
      !object(value.validation) || typeof value.validation.naive_timezone !== 'string' ||
      !Object.keys(validationLabels).every(key => count((value.validation as Record<string, unknown>)[key]))) {
    throw new Error('The server returned invalid recording metadata.');
  }
  return value as unknown as Recording;
}
export function parsePreview(value: unknown, id: string): PreviewRow[] {
  if (!object(value) || value.dataset_id !== id || !Array.isArray(value.rows) || value.rows.length > 100 ||
      !value.rows.every(row => object(row) && typeof row.track_id === 'string' && instant(row.timestamp) &&
        [row.lat, row.lon, row.speed_knots, row.heading].every(n => typeof n === 'number' && Number.isFinite(n)))) {
    throw new Error('The server returned an invalid recording preview.');
  }
  return value.rows as PreviewRow[];
}
export async function getDatasetJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(object(body) && typeof body.detail === 'string' ? body.detail : 'Recording request failed.');
  return body;
}
export function istDateTime(timestamp: string): string {
  return new Date(timestamp).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric',
    month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}
