import { useEffect, useRef, type RefObject } from 'react';
import { latLng, type Marker } from 'leaflet';
import type { ReplayFrame, Vessel } from '../types';

interface Sample { vessel: Vessel; frame: ReplayFrame; epoch: number; enabled: boolean }

// A visual guard, not a filter or correction to recorded GPS data.
const MAX_TRANSITION_METRES = 100;

export function useMarkerMotion(marker: RefObject<Marker | null>, vessel: Vessel,
  frame: ReplayFrame, enabled: boolean, epoch: number) {
  const previous = useRef<Sample | null>(null);
  useEffect(() => {
    const target = marker.current;
    if (!target) return;
    const before = previous.current;
    previous.current = { vessel, frame, epoch, enabled };
    let animation = 0;
    const finish = () => target.setLatLng([vessel.lat, vessel.lon]);
    const consecutive = before && before.enabled && enabled &&
      before.epoch === epoch && before.frame.playing && frame.playing &&
      before.frame.speed === frame.speed && before.vessel.id === vessel.id &&
      before.frame.dataset_id === frame.dataset_id && frame.second === before.frame.second + 1 &&
      Date.parse(frame.timestamp) - Date.parse(before.frame.timestamp) === 1000;
    const from = before && latLng(before.vessel.lat, before.vessel.lon);
    const to = latLng(vessel.lat, vessel.lon);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!consecutive || !from || reducedMotion || Math.abs(from.lng - to.lng) > 180 ||
        from.distanceTo(to) > MAX_TRANSITION_METRES || from.equals(to)) {
      finish();
      return;
    }
    // Both endpoints have arrived. This catch-up display never predicts a future fix.
    // Finish the previous confirmed segment before beginning the next one.
    target.setLatLng(from);
    const started = performance.now();
    const duration = 1000 / frame.speed;
    function step(now: number) {
      const fraction = Math.min(1, Math.max(0, (now - started) / duration));
      target!.setLatLng([from!.lat + (to.lat - from!.lat) * fraction,
        from!.lng + (to.lng - from!.lng) * fraction]);
      if (fraction < 1) animation = requestAnimationFrame(step);
    }
    animation = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animation);
  }, [marker, vessel, frame, enabled, epoch]);
}
