import { useEffect, useState } from 'react';
import type { PlayerState } from '@game/types';
import type { UseGameConnection } from '../hooks/useGameConnection';

interface Props {
  me: PlayerState;
  gameOver: boolean;
  conn: UseGameConnection;
}

export function GameMenu({ me, gameOver, conn }: Props) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest('.game-menu')) {
        setOpen(false);
        setConfirming(false);
      }
    }
    window.addEventListener('click', onDocClick);
    return () => window.removeEventListener('click', onDocClick);
  }, [open]);

  function handleForfeit() {
    conn.send({ type: 'forfeit_request', gameId: conn.gameId!, playerId: me.id });
    setConfirming(false);
    setOpen(false);
  }

  return (
    <div className="game-menu">
      <button
        type="button"
        className="game-menu-toggle"
        onClick={() => { setOpen((o) => !o); setConfirming(false); }}
        title="Menu"
      >
        ☰
      </button>
      {open && (
        <div className="game-menu-dropdown">
          {!confirming ? (
            <button
              type="button"
              className="game-menu-item"
              disabled={me.isEliminated || gameOver}
              onClick={(e) => { e.stopPropagation(); setConfirming(true); }}
            >
              Forfeit / End Game
            </button>
          ) : (
            <div className="game-menu-confirm">
              <p>Forfeit this game? You'll be eliminated immediately.</p>
              <div className="game-menu-confirm-actions">
                <button type="button" className="game-menu-confirm-yes" onClick={(e) => { e.stopPropagation(); handleForfeit(); }}>Yes, forfeit</button>
                <button type="button" className="game-menu-confirm-no" onClick={(e) => { e.stopPropagation(); setConfirming(false); }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
