import type { LocationState, LocationId } from '@game/types';

interface Props {
  locations: LocationState[];
  selectable?: boolean;
  onSelect?: (locationId: LocationId) => void;
  targetable?: boolean;
  registerRef?: (id: string, el: HTMLElement | null) => void;
}

export function LocationGrid({ locations, selectable, onSelect, targetable, registerRef }: Props) {
  return (
    <div className="location-grid">
      {locations.map((loc) => (
        <button
          key={loc.id}
          type="button"
          ref={(el) => registerRef?.(loc.id, el)}
          className={`location-card${targetable && loc.lootDeck.length > 0 ? ' targetable' : ''}`}
          disabled={!selectable || loc.lootDeck.length === 0}
          onClick={() => onSelect?.(loc.id)}
        >
          <div className="location-name">{loc.name}</div>
          <div className="location-deck-count">{loc.lootDeck.length} cards left</div>
        </button>
      ))}
    </div>
  );
}
