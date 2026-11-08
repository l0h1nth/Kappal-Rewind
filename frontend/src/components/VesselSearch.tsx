import { useState } from 'react';
import type { ReplayFrame } from '../types';

export function VesselSearch({ vesselIds, frame, selected, onSelect }: {
  vesselIds: string[]; frame: ReplayFrame | null; selected: string | null; onSelect: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const matches = vesselIds.filter(id => id.toLowerCase().includes(search.trim().toLowerCase()));
  const present = new Set(frame?.vessels.map(vessel => vessel.id));
  return <section className="vessel-search" aria-label="Vessel search">
    <label htmlFor="vessel-search">Search vessel ID</label>
    <input id="vessel-search" type="search" placeholder="Enter an ID" autoComplete="off" aria-controls="matching-vessels" value={search} onChange={event => setSearch(event.target.value)} />
    <p aria-live="polite">{matches.length} of {vesselIds.length} vessels</p>
    <ul id="matching-vessels" aria-label="Matching vessels">
      {matches.map(id => <li key={id}><button type="button" aria-pressed={id === selected}
        onClick={() => onSelect(id)}>{id}<small>{!frame ? 'Connection unavailable' : present.has(id) ? 'Current observation' : 'No current observation'}</small></button></li>)}
    </ul>
    {!matches.length && <p>No matching vessels.</p>}
  </section>;
}
