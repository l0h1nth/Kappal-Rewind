import { useEffect, useRef, useState } from 'react';
import { getDatasetJson } from '../datasets';

export interface VesselRoute {
  dataset_id: string; vessel_id: string; start: string; end: string;
  point_count: number; max_points: number; simplified: false;
  segments: [number, number][][];
}
function parseRoute(value: unknown, dataset: string, vessel: string): VesselRoute {
  const v = value as VesselRoute;
  if (!v || v.dataset_id !== dataset || v.vessel_id !== vessel || v.simplified !== false ||
      !Number.isFinite(Date.parse(v.start)) || !Number.isFinite(Date.parse(v.end)) ||
      !Number.isInteger(v.point_count) || v.point_count < 1 || v.point_count > 20000 ||
      !Array.isArray(v.segments) || v.segments.length > Math.min(512, v.point_count)) throw new Error('Invalid route response.');
  let count = 0;
  for (const segment of v.segments) {
    if (!Array.isArray(segment) || !segment.length || segment.length > v.point_count) throw new Error('Invalid route segment.');
    for (const p of segment) {
      if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite) || Math.abs(p[0]) > 90 || Math.abs(p[1]) > 180) throw new Error('Invalid route position.');
      if (++count > v.point_count) throw new Error('Invalid route count.');
    }
  }
  if (count !== v.point_count) throw new Error('Invalid route count.');
  return v;
}
interface Result { key: string; status: 'loading' | 'ready' | 'error'; data?: VesselRoute; error?: string }

export function useVesselRoute(dataset: string, vessel: string | null) {
  const [toggle, setToggle] = useState({ dataset, enabled: false });
  const [result, setResult] = useState<Result | null>(null);
  const [attempt, setAttempt] = useState(0);
  const cache = useRef(new Map<string, VesselRoute>());
  const enabled = toggle.dataset === dataset && toggle.enabled;
  const key = JSON.stringify([dataset, vessel]);
  useEffect(() => { setToggle({ dataset, enabled: false }); cache.current.clear(); }, [dataset]);
  useEffect(() => {
    if (!enabled || !vessel || dataset === 'empty') return;
    const cached = cache.current.get(key);
    if (cached) { setResult({ key, status: 'ready', data: cached }); return; }
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    setResult({ key, status: 'loading' });
    getDatasetJson(`/api/datasets/${encodeURIComponent(dataset)}/route?vessel_id=${encodeURIComponent(vessel)}`, controller.signal)
      .then(value => parseRoute(value, dataset, vessel)).then(data => {
        if (!active) return;
        cache.current.set(key, data);
        if (cache.current.size > 8) cache.current.delete(cache.current.keys().next().value!);
        setResult({ key, status: 'ready', data });
      }).catch(error => {
        if (active) setResult({ key, status: 'error', error: controller.signal.aborted ? 'Route request timed out. Try again.' : error instanceof Error ? error.message : 'Full route could not be loaded.' });
      }).finally(() => window.clearTimeout(timeout));
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); };
  }, [dataset, vessel, enabled, key, attempt]);
  const current = enabled && result?.key === key ? result : null;
  return { enabled, setEnabled: (value: boolean) => setToggle({ dataset, enabled: value }),
    status: enabled ? current?.status ?? 'loading' : 'off',
    data: current?.data ?? null, error: current?.error,
    retry: () => setAttempt(value => value + 1) };
}
export type RouteControl = ReturnType<typeof useVesselRoute>;
