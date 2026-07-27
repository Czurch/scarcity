import { useDraggable } from '@dnd-kit/core';
import type { GameState, PlayerState, SustenanceChoice } from '@game/types';
import type { UseGameConnection } from '../../hooks/useGameConnection';
import { getResourceArt } from '../../data/itemArt';

interface Props {
  state: GameState;
  me: PlayerState;
  conn: UseGameConnection;
  sustenanceChoices: Record<string, SustenanceChoice>;
}

type Resource = 'food' | 'water';

const RESOURCE_ART: Record<Resource, string | null> = {
  food: getResourceArt('food'),
  water: getResourceArt('water'),
};

function ResourceStockpile({ resource, count }: { resource: Resource; count: number }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `stockpile-${resource}`,
    data: { kind: 'resource', resource },
    disabled: count <= 0,
  });
  const art = RESOURCE_ART[resource];

  return (
    <div
      ref={setNodeRef}
      className={`resource-stockpile${count <= 0 ? ' depleted' : ''}${isDragging ? ' dragging' : ''}`}
      {...listeners}
      {...attributes}
    >
      {art ? <img src={art} alt={resource} /> : <span className="fallback-label">{resource}</span>}
      <span className="stockpile-count">x{count}</span>
    </div>
  );
}

export function PlanningPanel({ state, me, conn, sustenanceChoices }: Props) {
  const alreadySubmitted = !!state.planningAllocations[me.id];

  if (alreadySubmitted) {
    return <div className="phase-panel">Waiting for other players to finish planning…</div>;
  }

  const foodUsed = Object.values(sustenanceChoices).filter((c) => c === 'food').length;
  const waterUsed = Object.values(sustenanceChoices).filter((c) => c === 'water').length;
  const foodLeft = me.compound.resources.food - foodUsed;
  const waterLeft = me.compound.resources.water - waterUsed;

  return (
    <div className="phase-panel planning-panel">
      <h3>Planning — drag food/water onto a survivor on your board</h3>
      <div className="stockpile-row">
        <ResourceStockpile resource="food" count={foodLeft} />
        <ResourceStockpile resource="water" count={waterLeft} />
      </div>
      <p className="planning-equipment-note">
        You can also drag equipment between survivors' gear slots, or to/from the compound storage below, this
        round. Once you hit DONE, equipment is locked until next round.
      </p>
      <button
        type="button"
        className="done-button"
        onClick={() =>
          conn.send({
            type: 'planning_response',
            gameId: conn.gameId!,
            playerId: me.id,
            allocations: { sustenance: sustenanceChoices },
          })
        }
      >
        DONE
      </button>
    </div>
  );
}
