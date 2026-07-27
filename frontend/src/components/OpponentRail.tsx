import type { PlayerState } from '@game/types';
import { getSurvivorPortrait } from '../data/survivorArt';

interface Props {
  player: PlayerState;
  targetable?: boolean;
  onSelect?: (playerId: string) => void;
  registerRef?: (id: string, el: HTMLElement | null) => void;
  registerSurvivorRef?: (survivorId: string, el: HTMLElement | null) => void;
  /** Survivors not involved in the current reveal step — dimmed, same pattern as BoardSurvivorSlot during looting. */
  dimSurvivorIds?: string[];
}

export function OpponentRail({ player, targetable, onSelect, registerRef, registerSurvivorRef, dimSurvivorIds }: Props) {
  const interactive = targetable && !player.isEliminated;

  return (
    <div
      ref={(el) => registerRef?.(player.id, el)}
      className={`opponent-rail${player.isEliminated ? ' eliminated' : ''}${interactive ? ' targetable' : ''}`}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? () => onSelect?.(player.id) : undefined}
    >
      <h3>{player.name}{player.isEliminated ? ' (eliminated)' : ''}</h3>
      <div className="resource-counts">
        {Object.entries(player.compound.resources).map(([res, count]) => (
          <div key={res} className="resource-count">
            <span className="label">{res}</span>
            <span className="value">{count}</span>
          </div>
        ))}
      </div>
      <div className="opponent-survivor-row">
        {player.survivors.map((sv) => {
          const portrait = getSurvivorPortrait(sv.templateId);
          const dimmed = !!dimSurvivorIds && !dimSurvivorIds.includes(sv.id);
          return (
            <div
              key={sv.id}
              ref={(el) => registerSurvivorRef?.(sv.id, el)}
              className={`opponent-survivor-mini${!sv.alive ? ' dead' : ''}${dimmed ? ' dimmed' : ''}`}
              title={sv.name}
            >
              {portrait && <img src={portrait} alt="" />}
              <span className="opponent-survivor-mini-name">{sv.name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
