import { useMemo, useRef } from 'react';
import { divIcon, type LeafletKeyboardEvent, type Marker as LeafletMarker } from 'leaflet';
import { Marker, Tooltip } from 'react-leaflet';
import { useMarkerMotion } from '../hooks/useMarkerMotion';
import type { ReplayFrame, Vessel } from '../types';

const COLORS = ['#097b83', '#7953a3', '#b45d24', '#3367b0', '#8a4f6e', '#517a2d'];
export function vesselColor(id: string) {
  return COLORS[Array.from(id).reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0) % COLORS.length];
}

interface Props { vessel: Vessel; selected: boolean; onSelect: (id: string) => void; frame: ReplayFrame; motionEnabled: boolean; motionEpoch: number }

export function VesselMarker({ vessel, selected, onSelect, frame, motionEnabled, motionEpoch }: Props) {
  const marker = useRef<LeafletMarker | null>(null);
  const initialPosition = useRef<[number, number]>([vessel.lat, vessel.lon]);
  useMarkerMotion(marker, vessel, frame, motionEnabled, motionEpoch);
  const color = vesselColor(vessel.id);
  const icon = useMemo(() => divIcon({
    className: `vessel-marker${selected ? ' is-selected' : ''}`,
    iconSize: [32, 32], iconAnchor: [16, 16],
    // Leaflet owns the outer positioning transform. Rotate only this inner glyph.
    html: `<span class="vessel-glyph" style="color:${color};transform:rotate(${vessel.heading}deg)">
      <svg class="ship-icon" viewBox="0 0 24 32" width="22" height="30" aria-hidden="true"><path class="ship-hull" d="M12 1C9 4 4 10 4 16L5 28Q12 31 19 28L20 16C20 10 15 4 12 1Z"/><path class="ship-deck" d="M9 12H15V22H9Z M9 25H15"/></svg></span>`,
  }), [vessel.heading, color, selected]);
  const events = useMemo(() => ({
    click: () => onSelect(vessel.id),
    keydown: (event: LeafletKeyboardEvent) => {
      if (event.originalEvent.key === 'Enter' || event.originalEvent.key === ' ') {
        event.originalEvent.preventDefault();
        event.originalEvent.stopPropagation();
        onSelect(vessel.id);
      }
    },
  }), [vessel.id, onSelect]);
  return <Marker ref={marker} position={initialPosition.current} icon={icon} title={`Vessel ${vessel.id}`}
    alt={`Vessel ${vessel.id}`} eventHandlers={events} zIndexOffset={selected ? 1000 : 0}>
    {selected && <Tooltip permanent direction="top" offset={[0, -16]}>{vessel.id}</Tooltip>}
  </Marker>;
}
