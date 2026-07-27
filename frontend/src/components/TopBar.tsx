import type { GameState, PlayerState } from '@game/types';
import type { UseGameConnection } from '../hooks/useGameConnection';
import { GameMenu } from './GameMenu';

interface Props {
  state: GameState;
  me: PlayerState;
  conn: UseGameConnection;
}

export function TopBar({ state, me, conn }: Props) {
  return (
    <div className="top-bar">
      <div className="top-bar-left">
        <GameMenu me={me} gameOver={state.phase === 'game_over'} conn={conn} />
        <span className="round">Round {state.round}</span>
      </div>
      <span className="phase">{state.phase.replace('_', ' ').toUpperCase()}</span>
    </div>
  );
}
