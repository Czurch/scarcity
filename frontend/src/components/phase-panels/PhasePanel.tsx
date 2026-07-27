import type { GameState, PlayerState, SurvivorAction, SustenanceChoice } from '@game/types';
import type { UseGameConnection } from '../../hooks/useGameConnection';
import { DraftPanel } from './DraftPanel';
import { PlanningPanel } from './PlanningPanel';
import { ActionPanel } from './ActionPanel';
import { LootPanel } from './LootPanel';
import { UpkeepPanel } from './UpkeepPanel';

interface Props {
  state: GameState;
  me: PlayerState;
  conn: UseGameConnection;
  lootAssignments: Record<number, string>;
  actions: Record<string, SurvivorAction>;
  sustenanceChoices: Record<string, SustenanceChoice>;
}

export function PhasePanel({ state, me, conn, lootAssignments, actions, sustenanceChoices }: Props) {
  if (me.isEliminated) {
    return <div className="phase-panel">You have been eliminated. Spectating…</div>;
  }

  switch (state.phase) {
    case 'draft':
      return <DraftPanel state={state} me={me} conn={conn} />;
    case 'planning':
      return <PlanningPanel state={state} me={me} conn={conn} sustenanceChoices={sustenanceChoices} />;
    case 'action_selection':
      return <ActionPanel state={state} me={me} conn={conn} actions={actions} />;
    case 'looting':
      return <LootPanel state={state} me={me} conn={conn} lootAssignments={lootAssignments} />;
    case 'upkeep':
      return <UpkeepPanel state={state} me={me} conn={conn} />;
    case 'conflict_resolution':
      return <div className="phase-panel">Resolving conflicts…</div>;
    case 'game_over':
      return (
        <div className="phase-panel">
          Game over — {state.players.find((p) => p.id === state.winnerId)?.name ?? 'nobody'} wins!
        </div>
      );
    default:
      return null;
  }
}
