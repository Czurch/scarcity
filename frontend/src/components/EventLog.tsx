import { useState } from 'react';
import type { GameEvent } from '@game/types';

interface Props {
  events: GameEvent[];
}

function eventClass(tags: string[]): string {
  if (tags.includes('death') || tags.includes('elimination') || tags.includes('game_over')) return 'event-critical';
  if (tags.includes('conflict') || tags.includes('damage') || tags.includes('raid')) return 'event-conflict';
  if (tags.includes('loot')) return 'event-loot';
  if (tags.includes('phase')) return 'event-phase';
  return '';
}

export function EventLog({ events }: Props) {
  const [open, setOpen] = useState(true);
  const newestFirst = events.map((e, i) => ({ e, i })).reverse();

  return (
    <div className={`event-log${open ? '' : ' collapsed'}`}>
      <button type="button" className="event-log-toggle" onClick={() => setOpen((o) => !o)} title={open ? 'Collapse' : 'Expand'}>
        {open ? '› Event Log' : '‹'}
      </button>
      {open && (
        <div className="event-log-list">
          {newestFirst.length === 0 && <div className="event-log-empty">Nothing has happened yet.</div>}
          {newestFirst.map(({ e, i }) => (
            <div key={i} className={`event-log-row ${eventClass(e.tags)}`}>
              <span className="event-log-meta">R{e.round}</span>
              <span className="event-log-message">{e.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
