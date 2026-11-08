import type { RouteControl } from '../hooks/useVesselRoute';
import { VesselSearch } from './VesselSearch';
import { istTime } from '../format';
import type { ReplayFrame } from '../types';

export function VesselPanel({ selected, frame, connected, vesselIds, datasetId, onSelect, route }: {
  route: RouteControl; vesselIds: string[]; datasetId: string; onSelect: (id: string) => void;
  selected: string | null; frame: ReplayFrame | null; connected: boolean;
}) {
  const vessel = frame?.vessels.find(vessel => vessel.id === selected);
  return <aside className="vessel-panel" aria-label="Vessel details">
    <section className="vessel-search-card">
    <VesselSearch key={datasetId} vesselIds={vesselIds} frame={frame} selected={selected} onSelect={onSelect} />
    </section>
    <section className="selected-vessel-card">
    <p className="eyebrow">Selected vessel</p>
    <h2>{selected ?? 'Vessel details'}</h2>
    {!selected ? <p className="panel-note">Search by vessel ID or select a vessel on the map.</p> :
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
    {selected && <div className="route-control">
      <label><input type="checkbox" checked={route.enabled} onChange={event => route.setEnabled(event.target.checked)} />Show full route</label>
      <p>Preview this vessel's complete recorded journey.</p>
      <p>Includes observations after the current replay time. Dashed blue route; solid vessel-colored recent trail.</p>
      {route.enabled && route.status === 'loading' && <p role="status">Loading full route…</p>}
      {route.enabled && route.status === 'error' && <div role="alert"><p>{route.error}</p><button onClick={route.retry}>Retry route</button></div>}
      {route.data && <p role="status">{route.data.point_count.toLocaleString('en-US')} recorded positions · {route.data.segments.length} separate segments. Gaps and sudden jumps stay disconnected.</p>}
    </div>}
    </section>
  </aside>;
}
