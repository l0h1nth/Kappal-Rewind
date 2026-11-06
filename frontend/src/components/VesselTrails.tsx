import { Polyline } from 'react-leaflet';
import type { Vessel } from '../types';
import { vesselColor } from './VesselMarker';

export function VesselTrails({ vessel, selected }: { vessel: Vessel; selected: boolean }) {
  return <>{vessel.trail_segments.map((segment, index) => <Polyline
    key={index} positions={segment} interactive={false}
    pathOptions={{ color: vesselColor(vessel.id), weight: selected ? 4 : 2,
      opacity: selected ? 0.95 : 0.55, className: 'vessel-trail' }}
  />)}</>;
}
