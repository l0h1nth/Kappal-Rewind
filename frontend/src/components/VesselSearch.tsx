import { useState } from 'react';
import type { ReplayFrame } from '../types';

export function VesselSearch({ vesselIds, frame, selected, onSelect }: {
  vesselIds: string[]; frame: ReplayFrame | null; selected: string | null; onSelect: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const matches = vesselIds.filter(id => id.toLowerCase().includes(search.trim().toLowerCase()));
  const present = new Set(frame?.vessels.map(vessel => vessel.id));
  return <details className="vessel-search">
    <summary>Find a vessel ({vesselIds.length})</summary>
    <label htmlFor="vessel-search">Search vessel ID</label>
    <input id="vessel-search" type="search" value={search} onChange={event => setSearch(event.target.value)} />
    <p>{matches.length} matching vessels</p>
    <ul aria-label="Matching vessels">
      {matches.map(id => <li key={id}><button type="button" aria-pressed={id === selected}
        onClick={() => onSelect(id)}>{id}<small>{!frame ? 'Connection unavailable' : present.has(id) ? 'Current observation' : 'No current observation'}</small></button></li>)}
    </ul>
    {!matches.length && <p>No matching vessels.</p>}
  </details>;
}
