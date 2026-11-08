import { useEffect, useRef, useState } from 'react';
import type { ReplayFrame } from '../types';

const SUGGESTION_LIMIT = 8;

export function VesselSearch({ vesselIds, frame, selected, onSelect }: {
  vesselIds: string[]; frame: ReplayFrame | null; selected: string | null; onSelect: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const root = useRef<HTMLElement>(null);
  const matches = vesselIds.filter(id => id.toLowerCase().includes(search.trim().toLowerCase()));
  const suggestions = matches.slice(0, SUGGESTION_LIMIT);
  const active = highlight >= 0 && highlight < suggestions.length ? highlight : -1;
  const present = new Set(frame?.vessels.map(vessel => vessel.id));
  const status = (id: string) => !frame ? 'Connection unavailable' : present.has(id) ? 'Current observation' : 'No current observation';
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) { setOpen(false); setHighlight(-1); }
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  useEffect(() => {
    if (open && active >= 0) root.current?.querySelectorAll<HTMLElement>('[role=option]')[active]?.scrollIntoView({ block: 'nearest' });
  }, [open, active, search]);
  function select(id: string) {
    onSelect(id); setSearch(id); setOpen(false); setHighlight(-1);
  }
  return <section ref={root} className="vessel-search" aria-label="Vessel search">
    <label htmlFor="vessel-search">Search vessel ID</label>
    <input id="vessel-search" type="text" role="combobox" aria-autocomplete="list"
      aria-expanded={open} aria-controls="matching-vessels"
      aria-activedescendant={open && active >= 0 ? `vessel-option-${active}` : undefined}
      placeholder="Find a vessel…" autoComplete="off" value={search}
      onFocus={() => setOpen(true)}
      onBlur={event => { if (!root.current?.contains(event.relatedTarget)) { setOpen(false); setHighlight(-1); } }}
      onChange={event => { setSearch(event.target.value); setOpen(true); setHighlight(-1); }}
      onKeyDown={event => {
        if (event.key === 'Escape') { setOpen(false); setHighlight(-1); event.preventDefault(); }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); setOpen(true);
          setHighlight(!suggestions.length ? -1 : event.key === 'ArrowDown'
            ? (active + 1) % suggestions.length : active <= 0 ? suggestions.length - 1 : active - 1);
        }
        if (event.key === 'Enter' && open && active >= 0) { event.preventDefault(); select(suggestions[active]); }
      }} />
    {open && <div className="suggestion-popup">
      <ul id="matching-vessels" role="listbox" aria-label="Matching vessels">
        {suggestions.map((id, index) => <li id={`vessel-option-${index}`} key={id} role="option"
          aria-selected={active === index} className={active === index ? 'highlighted' : ''}
          onPointerDown={event => event.preventDefault()} onMouseEnter={() => setHighlight(index)} onClick={() => select(id)}>
          <span>{id}{id === selected && <span className="selected-label"> · Selected</span>}</span><small>{status(id)}</small>
        </li>)}
      </ul>
      <p role="status">{!matches.length ? 'No matching vessels.' : `${matches.length} matches · showing ${suggestions.length}`}</p>
    </div>}
    <p className="search-selection">{selected ? `${selected} · ${status(selected)}` : `${vesselIds.length} vessels · search to select`}</p>
  </section>;
}
