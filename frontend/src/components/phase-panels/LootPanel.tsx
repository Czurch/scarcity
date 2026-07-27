import { useDraggable } from '@dnd-kit/core';
import type { GameState, PlayerState } from '@game/types';
import type { UseGameConnection } from '../../hooks/useGameConnection';
import { isCarryLimited, tokenArt, tokenLabel } from '../../data/lootTokens';

interface Props {
  state: GameState;
  me: PlayerState;
  conn: UseGameConnection;
  lootAssignments: Record<number, string>;
}

function targetLabel(state: GameState, opportunity: GameState['lootOpportunities'][number]): string {
  const target = opportunity.target;
  if (target.kind === 'location') {
    return state.locations.find((l) => l.id === target.locationId)?.name ?? target.locationId;
  }
  const defender = state.players.find((p) => p.id === target.defenderId);
  return `${defender?.name ?? 'Unknown'}'s Compound`;
}

export function LootPanel({ state, me, conn, lootAssignments }: Props) {
  const opportunity = state.lootOpportunities.find((o) => o.playerId === me.id && !o.claimed);

  if (!opportunity) {
    return <div className="phase-panel">Waiting for other players to finish looting…</div>;
  }

  const carryUsed = Object.keys(lootAssignments)
    .filter((idx) => isCarryLimited(opportunity.revealedTokens[Number(idx)]))
    .length;

  return (
    <div className="phase-panel loot-panel">
      <h3>Loot — {targetLabel(state, opportunity)}</h3>
      <p className="loot-subtitle">
        Drag onto a survivor who scavenged here ({carryUsed}/{opportunity.carryCapacity} carry slots used)
      </p>
      <div className="loot-tokens">
        {opportunity.revealedTokens.map((token, i) => {
          const assignedTo = lootAssignments[i];
          const assignedName = assignedTo ? me.survivors.find((s) => s.id === assignedTo)?.name ?? null : null;
          return (
            <DraggableLootToken
              key={i}
              index={i}
              art={tokenArt(token)}
              label={tokenLabel(token)}
              draggable={token.kind !== 'nothing' && !assignedTo}
              assignedName={assignedName}
            />
          );
        })}
      </div>
      <button
        type="button"
        className="done-button"
        onClick={() =>
          conn.send({
            type: 'loot_response',
            gameId: conn.gameId!,
            playerId: me.id,
            lootId: opportunity.id,
            tokenIndices: Object.keys(lootAssignments).map(Number),
            assignments: lootAssignments,
          })
        }
      >
        DONE
      </button>
    </div>
  );
}

function DraggableLootToken({
  index,
  art,
  label,
  draggable,
  assignedName,
}: {
  index: number;
  art: string | null;
  label: string;
  draggable: boolean;
  assignedName: string | null;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `loot-token-${index}`,
    data: { kind: 'loot', tokenIndex: index },
    disabled: !draggable,
  });

  return (
    <div
      ref={setNodeRef}
      className={`loot-token${assignedName ? ' assigned' : ''}${isDragging ? ' dragging' : ''}`}
      {...(draggable ? { ...listeners, ...attributes } : {})}
    >
      {art ? <img src={art} alt={label} /> : <span>{label}</span>}
      {assignedName && <span className="loot-token-assigned-tag">→ {assignedName}</span>}
    </div>
  );
}
