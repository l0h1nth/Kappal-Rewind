export type Coordinate = [number, number]; // Leaflet uses [latitude, longitude].
export type ReplayCommand =
  | { type: 'play' | 'pause' | 'reset' }
  | { type: 'seek'; second: number }
  | { type: 'set_speed'; speed: 1 | 2 | 5 | 10 };

export interface Vessel {
  id: string;
  lat: number;
  lon: number;
  speed_knots: number;
  heading: number;
  trail_segments: Coordinate[][];
}

export interface ReplayFrame {
  type: 'state';
  dataset_id?: string; // Missing on legacy default/built-in frames only.
  second: number;
  duration_seconds: number;
  playing: boolean;
  speed: 1 | 2 | 5 | 10;
  timestamp: string;
  vessels: Vessel[];
}

export interface Metadata {
  start: string;
  end: string;
  recording_seconds: number;
  vessel_count: number;
  vessel_ids?: string[]; // Optional for legacy metadata; current APIs supply all IDs.
  record_count: number;
  bounds: { south: number; north: number; west: number; east: number };
}

const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const integer = (v: unknown): v is number => finite(v) && Number.isInteger(v);
const inRange = (v: unknown, low: number, high: number): v is number => finite(v) && v >= low && v <= high;
const instant = (v: unknown): v is string => typeof v === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));
const coordinate = (v: unknown) => Array.isArray(v) && v.length === 2 && inRange(v[0], -90, 90) && inRange(v[1], -180, 180);

function validVessel(v: unknown): v is Vessel {
  return object(v) && typeof v.id === 'string' && v.id.length > 0 &&
    inRange(v.lat, -90, 90) && inRange(v.lon, -180, 180) && finite(v.speed_knots) && v.speed_knots >= 0 &&
    inRange(v.heading, 0, 360) && v.heading < 360 && Array.isArray(v.trail_segments) &&
    v.trail_segments.every(s => Array.isArray(s) && s.length > 0 && s.every(coordinate));
}

export function parseReplayMessage(v: unknown): ReplayFrame | { type: 'error'; message: string } {
  if (object(v) && v.type === 'error' && typeof v.message === 'string') return { type: 'error', message: v.message };
  if (object(v) && v.type === 'state' && integer(v.second) && integer(v.duration_seconds) &&
      (v.dataset_id === undefined || v.dataset_id === 'builtin' || (typeof v.dataset_id === 'string' && /^[0-9a-f]{32}$/.test(v.dataset_id))) &&
      v.second >= 0 && v.second < v.duration_seconds && typeof v.playing === 'boolean' &&
      [1, 2, 5, 10].includes(v.speed as number) && instant(v.timestamp) &&
      Array.isArray(v.vessels) && v.vessels.every(validVessel) &&
      new Set(v.vessels.map(vessel => vessel.id)).size === v.vessels.length) {
    return v as unknown as ReplayFrame;
  }
  throw new Error('Invalid replay message received from server.');
}

export function parseMetadata(v: unknown): Metadata {
  if (object(v) && instant(v.start) && instant(v.end) && integer(v.recording_seconds) &&
      v.recording_seconds > 0 && Date.parse(v.end) - Date.parse(v.start) === (v.recording_seconds - 1) * 1000 &&
      integer(v.vessel_count) && v.vessel_count > 0 && integer(v.record_count) && v.record_count > 0 &&
      (v.vessel_ids === undefined || (Array.isArray(v.vessel_ids) &&
        v.vessel_ids.length === v.vessel_count && v.vessel_ids.every(id => typeof id === 'string' && id.length > 0) &&
        new Set(v.vessel_ids).size === v.vessel_ids.length)) &&
      object(v.bounds) && inRange(v.bounds.south, -90, 90) && inRange(v.bounds.north, -90, 90) &&
      v.bounds.south <= v.bounds.north && inRange(v.bounds.west, -180, 180) &&
      inRange(v.bounds.east, -180, 180) && v.bounds.west <= v.bounds.east) {
    return v as unknown as Metadata;
  }
  throw new Error('Invalid dataset metadata received from server.');
}
