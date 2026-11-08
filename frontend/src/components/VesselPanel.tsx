import { VesselSearch } from './VesselSearch';
import { istTime } from '../format';
import type { ReplayFrame } from '../types';

export function VesselPanel({ selected, frame, connected, vesselIds, datasetId, onSelect }: {
  vesselIds: string[]; datasetId: string; onSelect: (id: string) => void;
  selected: string | null; frame: ReplayFrame | null; connected: boolean;
}) {
  const vessel = frame?.vessels.find(vessel => vessel.id === selected);
  return <aside className="vessel-panel" aria-label="Vessel details">
    <VesselSearch key={datasetId} vesselIds={vesselIds} frame={frame} selected={selected} onSelect={onSelect} />
    <p className="eyebrow">SELECTED VESSEL</p>
    <h2>{selected ?? 'Vessel details'}</h2>
    {!selected ? <p className="panel-note">Select a vessel on the map.</p> :
      !connected || !frame ? <p className="panel-note">Current observation unavailable. Waiting for the replay connection.</p> :
      !vessel ? <p className="missing-observation">No observation at this time.</p> : <>
        <p className="observation-status">Current observation</p>
        <dl>
          <div><dt>Speed</dt><dd>{vessel.speed_knots.toFixed(2)} <span>knots</span></dd></div>
          <div><dt>Heading</dt><dd>{vessel.heading.toFixed(1)}°</dd></div>
          <div><dt>Latitude</dt><dd>{vessel.lat.toFixed(6)}°</dd></div>
          <div><dt>Longitude</dt><dd>{vessel.lon.toFixed(6)}°</dd></div>
          <div className="observation-time"><dt>Observation time · IST</dt>
            <dd><time dateTime={frame.timestamp}>{istTime(frame.timestamp)}</time></dd></div>
        </dl>
      </>}
    {selected && <p className="panel-help">Selection stays with this ID during playback. Values appear only when an observation exists.</p>}
  </aside>;
}
