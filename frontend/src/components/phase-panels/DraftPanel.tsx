import type { GameState, PlayerState } from '@game/types';
import type { UseGameConnection } from '../../hooks/useGameConnection';

interface Props {
  state: GameState;
  me: PlayerState;
  conn: UseGameConnection;
}

export function DraftPanel({ state, me, conn }: Props) {
  const currentPickerId = state.draftOrder[state.currentDraftIndex % state.draftOrder.length];
  const isMyTurn = currentPickerId === me.id;

  if (!isMyTurn) {
    const picker = state.players.find((p) => p.id === currentPickerId);
    return <div className="phase-panel">Waiting for {picker?.name ?? 'other players'} to draft…</div>;
  }

  return (
    <div className="phase-panel draft-panel">
      <h3>Pick a survivor</h3>
      <div className="draft-pool">
        {state.draftPool.map((template) => (
          <button
            key={template.id}
            type="button"
            className="draft-card"
            onClick={() => conn.send({ type: 'draft_response', gameId: conn.gameId!, playerId: me.id, survivorId: template.id })}
          >
            <div className="draft-card-name">{template.name}</div>
            <div className="draft-card-stats">HP {template.maxHp} · Threat {template.baseThreat}</div>
            {template.passive && <div className="draft-card-passive">{template.passive}</div>}
          </button>
        ))}
      </div>
    </div>
  );
}
