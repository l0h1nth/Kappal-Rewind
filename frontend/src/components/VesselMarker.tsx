import { useMemo } from 'react';
import { divIcon, type LeafletKeyboardEvent } from 'leaflet';
import { Marker, Tooltip } from 'react-leaflet';
import type { Vessel } from '../types';

const COLORS = ['#097b83', '#7953a3', '#b45d24', '#3367b0', '#8a4f6e', '#517a2d'];
export function vesselColor(id: string) {
  return COLORS[Array.from(id).reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0) % COLORS.length];
}

interface Props { vessel: Vessel; selected: boolean; onSelect: (id: string) => void }

export function VesselMarker({ vessel, selected, onSelect }: Props) {
  const color = vesselColor(vessel.id);
  const icon = useMemo(() => divIcon({
    className: `vessel-marker${selected ? ' is-selected' : ''}`,
    iconSize: [32, 32], iconAnchor: [16, 16],
    // Leaflet owns the outer positioning transform. Rotate only this inner glyph.
    html: `<span class="vessel-glyph" style="color:${color};transform:rotate(${vessel.heading}deg)">
      <svg viewBox="0 0 24 30" width="22" height="28" aria-hidden="true"><path d="M12 2 21 25 12 20 3 25Z"/></svg></span>`,
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
  return <Marker position={[vessel.lat, vessel.lon]} icon={icon} title={`Vessel ${vessel.id}`}
    alt={`Vessel ${vessel.id}`} eventHandlers={events} zIndexOffset={selected ? 1000 : 0}>
    {selected && <Tooltip permanent direction="top" offset={[0, -16]}>{vessel.id}</Tooltip>}
  </Marker>;
}
