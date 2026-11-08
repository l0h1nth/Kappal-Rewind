import { useEffect, useRef, useState } from 'react';
import { MapContainer, ScaleControl, TileLayer, useMap } from 'react-leaflet';
import type { Metadata, ReplayFrame } from '../types';
import { VesselMarker } from './VesselMarker';
import { VesselTrails } from './VesselTrails';

export interface SearchFocus { datasetId: string; lat: number; lon: number }

interface Props { searchFocus?: SearchFocus | null; metadata: Metadata; frame: ReplayFrame | null; selected: string | null; onSelect: (id: string) => void; datasetId?: string; motionEnabled?: boolean; motionEpoch?: number }

function RecordingBounds({ metadata, datasetId }: { metadata: Metadata; datasetId: string }) {
  const map = useMap();
  const previous = useRef(datasetId);
  useEffect(() => {
    if (previous.current !== datasetId) {
      const { south, north, west, east } = metadata.bounds;
      map.fitBounds([[south, west], [north, east]], { padding: [32, 32], maxZoom: 14, animate: false });
      previous.current = datasetId;
    }
  }, [map, metadata, datasetId]);
  return null;
}

// An explicit search choice is a one-shot request, independent of replay frames.
function SearchMapFocus({ request, datasetId }: { request: SearchFocus | null; datasetId: string }) {
  const map = useMap();
  useEffect(() => {
    if (request?.datasetId === datasetId) {
      map.stop();
      map.setView([request.lat, request.lon], Math.min(map.getZoom(), 14), { animate: false });
    }
  }, [map, request, datasetId]);
  return null;
}

export function VesselMap({ metadata, frame, selected, onSelect, datasetId = 'builtin', motionEnabled = true, motionEpoch = 0, searchFocus = null }: Props) {
  const [tileError, setTileError] = useState(false);
  const { south, north, west, east } = metadata.bounds;
  return <section className="map-region" aria-label="Vessel map">
    <MapContainer className="vessel-map" bounds={[[south, west], [north, east]]}
      boundsOptions={{ padding: [32, 32], maxZoom: 14 }}>
      <RecordingBounds metadata={metadata} datasetId={datasetId} />
      <SearchMapFocus request={searchFocus} datasetId={datasetId} />
      <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        eventHandlers={{ tileerror: () => setTileError(true) }} />
      <ScaleControl position="bottomleft" />
      {frame?.vessels.map(vessel => <VesselTrails key={vessel.id} vessel={vessel} selected={vessel.id === selected} />)}
      {frame?.vessels.map(vessel => <VesselMarker key={vessel.id} vessel={vessel}
        selected={vessel.id === selected} onSelect={onSelect} frame={frame} motionEnabled={motionEnabled} motionEpoch={motionEpoch} />)}
    </MapContainer>
    {tileError && <p className="tile-warning" role="alert">Some map tiles could not load. Vessel positions remain available.</p>}
  </section>;
}
