import { useState } from 'react';
import type { GameState, PlayerState, SustenanceChoice } from '@game/types';
import type { UseGameConnection } from '../../hooks/useGameConnection';

interface Props {
  state: GameState;
  me: PlayerState;
  conn: UseGameConnection;
}

interface SustenancePreview {
  survivorId: string;
  name: string;
  choice: SustenanceChoice;
  outcome: 'fed' | 'watered' | 'starving';
}

/**
 * Food/water aren't actually deducted until the whole round resolves (all players'
 * upkeep submissions in), so this mirrors resolveUpkeep's consumeSustenance ordering
 * against the live compound stock to preview what's about to happen.
 */
function previewSustenance(state: GameState, me: PlayerState): SustenancePreview[] {
  const sustenance = state.planningAllocations[me.id]?.sustenance ?? {};
  let foodLeft = me.compound.resources.food;
  let waterLeft = me.compound.resources.water;
  const results: SustenancePreview[] = [];

  for (const sv of me.survivors) {
    if (!sv.alive) continue;
    const choice = sustenance[sv.id] ?? 'none';
    let outcome: SustenancePreview['outcome'];
    if (choice === 'food' && foodLeft > 0) { outcome = 'fed'; foodLeft--; }
    else if (choice === 'water' && waterLeft > 0) { outcome = 'watered'; waterLeft--; }
    else outcome = 'starving';
    results.push({ survivorId: sv.id, name: sv.name, choice, outcome });
  }
  return results;
}

export function UpkeepPanel({ state, me, conn }: Props) {
  const alreadySubmitted = !!state.upkeepAllocations[me.id];
  const injured = me.survivors.filter((s) => s.alive && s.hp < s.maxHp);
  const [heals, setHeals] = useState<string[]>([]);

  if (alreadySubmitted) {
    return <div className="phase-panel">Waiting for other players to finish upkeep…</div>;
  }

  const medsLeft = me.compound.resources.meds - heals.length;
  const sustenancePreview = previewSustenance(state, me);
  const starvingCount = sustenancePreview.filter((p) => p.outcome === 'starving').length;

  function toggle(survivorId: string) {
    setHeals((prev) => {
      if (prev.includes(survivorId)) return prev.filter((id) => id !== survivorId);
      if (medsLeft <= 0) return prev;
      return [...prev, survivorId];
    });
  }

  return (
    <div className="phase-panel upkeep-panel">
      <h3>Upkeep — food and water are consumed now, then injuries can be treated</h3>

      <ul className="upkeep-sustenance-list">
        {sustenancePreview.map((p) => (
          <li key={p.survivorId} className={`upkeep-sustenance-row outcome-${p.outcome}`}>
            <span className="upkeep-sustenance-name">{p.name}</span>
            <span className="upkeep-sustenance-outcome">
              {p.outcome === 'fed' && 'Ate — well fed (+1 threat)'}
              {p.outcome === 'watered' && 'Drank water — hydrated'}
              {p.outcome === 'starving' && 'No food or water — starving (-1 HP)'}
            </span>
          </li>
        ))}
      </ul>
      {starvingCount > 0 && (
        <p className="upkeep-warning">
          {starvingCount} survivor{starvingCount > 1 ? 's' : ''} will take starvation damage this round.
        </p>
      )}

      <h4>Treat injuries — {medsLeft} meds left</h4>
      {injured.length === 0 && <p>No injured survivors.</p>}
      {injured.map((s) => (
        <label key={s.id} className="upkeep-row">
          <input type="checkbox" checked={heals.includes(s.id)} onChange={() => toggle(s.id)} />
          {s.name} ({s.hp}/{s.maxHp} HP)
        </label>
      ))}
      <button
        type="button"
        className="done-button"
        onClick={() => conn.send({ type: 'upkeep_response', gameId: conn.gameId!, playerId: me.id, allocations: { medHeals: heals } })}
      >
        DONE
      </button>
    </div>
  );
}
