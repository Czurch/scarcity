import type { GameState, PlayerState, SurvivorAction } from '@game/types';
import type { UseGameConnection } from '../../hooks/useGameConnection';

interface Props {
  state: GameState;
  me: PlayerState;
  conn: UseGameConnection;
  actions: Record<string, SurvivorAction>;
}

function describeAction(state: GameState, me: PlayerState, action: SurvivorAction): string {
  switch (action.type) {
    case 'scavenge':
      return `Scavenge ${state.locations.find((l) => l.id === action.locationId)?.name ?? action.locationId}`;
    case 'attack':
      return `Attack ${state.players.find((p) => p.id === action.targetPlayerId)?.name ?? 'opponent'}`;
    case 'craft':
      return `Craft ${action.itemId}`;
    case 'defend':
      return 'Defend';
    case 'rest':
      return 'Rest';
    case 'trade':
      return 'Trade';
    case 'jam':
      return `Jam ${state.players.find((p) => p.id === action.targetPlayerId)?.name ?? 'opponent'}`;
    default:
      return '';
  }
}

export function ActionPanel({ state, me, conn, actions }: Props) {
  const livingSurvivors = me.survivors.filter((s) => s.alive);

  if (me.intentsSubmitted) {
    return <div className="phase-panel">Waiting for other players to finish their actions…</div>;
  }

  const assignedCount = livingSurvivors.filter((s) => actions[s.id]).length;

  function submit() {
    const intents = livingSurvivors.map((s) => ({ survivorId: s.id, action: actions[s.id] ?? { type: 'defend' as const } }));
    conn.send({ type: 'action_response', gameId: conn.gameId!, playerId: me.id, intents });
  }

  return (
    <div className="phase-panel action-panel">
      <h3>Choose actions — click a survivor's action buttons below ({assignedCount}/{livingSurvivors.length} assigned)</h3>
      <ul className="action-summary-list">
        {livingSurvivors.map((s) => (
          <li key={s.id}>
            <span className="action-summary-name">{s.name}</span>
            <span className="action-summary-value">{actions[s.id] ? describeAction(state, me, actions[s.id]) : 'Defend (default)'}</span>
          </li>
        ))}
      </ul>
      <button type="button" className="done-button" onClick={submit}>DONE</button>
    </div>
  );
}
