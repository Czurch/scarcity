import type { PlayerState, ResourceType, SurvivorState } from '@game/types';
import type { ItemId } from '@game/types';
import { CRAFTABLE_DEFS } from '../data/craftables';
import { getItemArt, getResourceArt } from '../data/itemArt';

interface Props {
  survivor: SurvivorState;
  me: PlayerState;
  onPick: (itemId: ItemId) => void;
  onClose: () => void;
}

const RESOURCE_ORDER: ResourceType[] = ['food', 'water', 'meds', 'wood', 'metal', 'ammo'];

function canAfford(cost: Partial<Record<ResourceType, number>>, resources: Record<ResourceType, number>): boolean {
  return Object.entries(cost).every(([res, amount]) => resources[res as ResourceType] >= (amount as number));
}

export function CraftModal({ survivor, me, onPick, onClose }: Props) {
  const resources = me.compound.resources;

  return (
    <div className="craft-modal-backdrop" onClick={onClose}>
      <div className="craft-modal" onClick={(e) => e.stopPropagation()}>
        <div className="craft-modal-header">
          <h3>Craft — {survivor.name}</h3>
          <button type="button" className="craft-modal-close" onClick={onClose} title="Close">
            &times;
          </button>
        </div>

        <div className="craft-modal-resources">
          {RESOURCE_ORDER.map((res) => {
            const art = getResourceArt(res);
            return (
              <span key={res} className="craft-modal-resource-chip">
                {art ? <img src={art} alt={res} /> : null}
                {res} {resources[res]}
              </span>
            );
          })}
        </div>

        <div className="craft-modal-list">
          {CRAFTABLE_DEFS.map((def) => {
            const alreadyBuilt = def.kind === 'structure' && me.compound.structures.some((s) => s.id === def.id);
            const affordable = !alreadyBuilt && canAfford(def.craftCost, resources);
            const art = getItemArt(def.id);

            return (
              <button
                key={def.id}
                type="button"
                className={`craft-modal-item${affordable ? '' : ' unaffordable'}`}
                onClick={() => onPick(def.id)}
                disabled={!affordable}
                title={alreadyBuilt ? 'Already built' : undefined}
              >
                <div className="craft-modal-item-icon">
                  {art ? <img src={art} alt={def.name} /> : <span className="fallback-label">{def.name}</span>}
                </div>
                <div className="craft-modal-item-info">
                  <div className="craft-modal-item-name">{def.name}</div>
                  <div className="craft-modal-item-effect">{alreadyBuilt ? 'Already built' : def.effect}</div>
                  <div className="craft-modal-item-cost">
                    {Object.entries(def.craftCost).map(([res, amount]) => (
                      <span
                        key={res}
                        className={`cost-chip${resources[res as ResourceType] >= (amount as number) ? ' have' : ' short'}`}
                      >
                        {amount} {res}
                      </span>
                    ))}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
