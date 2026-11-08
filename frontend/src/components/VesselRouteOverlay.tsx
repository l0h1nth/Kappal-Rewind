import { CircleMarker, Polyline } from 'react-leaflet';
import type { VesselRoute } from '../hooks/useVesselRoute';

export function VesselRouteOverlay({ route }: { route: VesselRoute | null }) {
  if (!route) return null;
  return <>{route.segments.map((segment, i) => segment.length === 1 ?
    <CircleMarker className="vessel-full-route" key={i} center={segment[0]} radius={3} interactive={false}
      pathOptions={{ color: '#446e87', opacity: .65, fillOpacity: .45, className: 'vessel-full-route' }} /> :
    <Polyline className="vessel-full-route" key={i} positions={segment} interactive={false} smoothFactor={0}
      pathOptions={{ color: '#446e87', weight: 2, opacity: .6, dashArray: '5 5', className: 'vessel-full-route' }} />)}</>;
}
