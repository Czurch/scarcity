import { useDraggable, useDroppable } from '@dnd-kit/core';
import type { LootToken, PlayerState, ResourceType } from '@game/types';
import { getResourceArt } from '../data/itemArt';
import { tokenArt, tokenLabel } from '../data/lootTokens';

interface Props {
  me: PlayerState;
  /** Compound storage is only interactive (drag to equip / drop to unequip) during planning. */
  interactive: boolean;
}

const RESOURCE_ORDER: ResourceType[] = ['food', 'water', 'meds', 'wood', 'metal', 'ammo'];

function DraggableStoredItem({ index, item, draggable }: { index: number; item: LootToken; draggable: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `stored-item-${index}`,
    data: { kind: 'stored-item', itemIndex: index },
    disabled: !draggable,
  });
  const art = tokenArt(item);

  return (
    <div
      ref={setNodeRef}
      className={`compound-hud-item${draggable ? ' draggable' : ''}${isDragging ? ' dragging' : ''}`}
      title={draggable ? `${tokenLabel(item)} — drag onto a survivor to equip` : tokenLabel(item)}
      {...(draggable ? { ...listeners, ...attributes } : {})}
    >
      {art ? <img src={art} alt={tokenLabel(item)} /> : <span className="fallback-label">{tokenLabel(item)}</span>}
    </div>
  );
}

export function CompoundHUD({ me, interactive }: Props) {
  const { setNodeRef, isOver } = useDroppable({
    id: 'compound-storage',
    data: { kind: 'compound-storage' },
    disabled: !interactive,
  });
  // Defensive: a game started against an older server process (pre-dating compound storage) won't
  // have this field on its already-created state, since the backend doesn't hot-reload mid-game.
  const storedItems = me.compound.storedItems ?? [];

  return (
    <div className="compound-hud">
      <div className="compound-hud-resources">
        {RESOURCE_ORDER.map((res) => {
          const art = getResourceArt(res);
          return (
            <span key={res} className="compound-hud-resource-chip">
              {art ? <img src={art} alt={res} /> : null}
              {res} {me.compound.resources[res]}
            </span>
          );
        })}
      </div>

      <div ref={setNodeRef} className={`compound-hud-storage${isOver && interactive ? ' drop-active' : ''}`}>
        <div className="compound-hud-storage-label">
          Unequipped items — drag a survivor's weapon here to free their slot, or drag one of these onto a survivor
        </div>
        <div className="compound-hud-storage-items">
          {storedItems.length === 0 && <span className="compound-hud-empty">None</span>}
          {storedItems.map((item, i) => (
            <DraggableStoredItem key={i} index={i} item={item} draggable={interactive} />
          ))}
        </div>
      </div>
    </div>
  );
}
