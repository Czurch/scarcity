import { useDraggable } from '@dnd-kit/core';
import type { LootToken, SurvivorState } from '@game/types';
import { getSurvivorPortrait } from '../data/survivorArt';
import { getThreatBreakdown, getMaxGearSlots } from '../data/threat';
import { getResourceArt } from '../data/itemArt';
import { tokenArt, tokenLabel } from '../data/lootTokens';

interface SustenanceToken {
  art: string | null;
  label: string;
}

interface PendingGearItem {
  art: string | null;
  label: string;
  onRemove: () => void;
}

interface Props {
  survivor: SurvivorState;
  selected?: boolean;
  onClick?: () => void;
  ammoInCompound?: number;
  wellFedOverride?: boolean;
  /** Omit to fall back to the survivor's resolved wellFed status; pass null to force showing empty (e.g. mid-drag preview). */
  sustenanceToken?: SustenanceToken | null;
  onRemoveSustenance?: () => void;
  /** Loot assigned to this survivor this phase but not yet committed to equippedItems — fills empty gear slots, overflowing past the base slot count if needed. */
  pendingGear?: PendingGearItem[];
  /** Planning phase only: lets already-equipped gear be dragged off to another survivor's card. */
  gearDraggable?: boolean;
}

function DraggableGearItem({ survivorId, itemIndex, item }: { survivorId: string; itemIndex: number; item: LootToken }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `equipped-${survivorId}-${itemIndex}`,
    data: { kind: 'equipment', fromSurvivorId: survivorId, itemIndex },
  });

  return (
    <div
      ref={setNodeRef}
      className={`gear-slot filled draggable${isDragging ? ' dragging' : ''}`}
      title={`${tokenLabel(item)} (drag to reassign)`}
      {...listeners}
      {...attributes}
    >
      {tokenArt(item) ? <img src={tokenArt(item)!} alt={tokenLabel(item)} /> : <span className="fallback-label">{tokenLabel(item)}</span>}
    </div>
  );
}

export function SurvivorCard({
  survivor,
  selected,
  onClick,
  ammoInCompound = 0,
  wellFedOverride,
  sustenanceToken,
  onRemoveSustenance,
  pendingGear = [],
  gearDraggable = false,
}: Props) {
  const portrait = getSurvivorPortrait(survivor.templateId);
  const breakdown = getThreatBreakdown(survivor, ammoInCompound, wellFedOverride);
  const threatDelta = breakdown.reduce((sum, c) => sum + c.amount, 0);

  const sustenance =
    sustenanceToken !== undefined
      ? sustenanceToken
      : survivor.wellFed
        ? { art: getResourceArt('food'), label: 'food' }
        : null;

  return (
    <button
      type="button"
      className={`survivor-card${selected ? ' selected' : ''}${!survivor.alive ? ' dead' : ''}`}
      onClick={onClick}
      disabled={!survivor.alive}
    >
      <div className="survivor-card-left">
        {portrait && <img src={portrait} alt="" />}
        <div className="survivor-name">{survivor.name}</div>
        <div className="survivor-stats">
          <span className="hp">♥ {survivor.hp}/{survivor.maxHp}</span>
          <span className="threat">
            ⛨ {survivor.baseThreat}
            {threatDelta !== 0 && (
              <span className="threat-delta-wrap" tabIndex={0}>
                <span className={`threat-delta${threatDelta > 0 ? ' positive' : ' negative'}`}>
                  {threatDelta > 0 ? `+${threatDelta}` : threatDelta}
                </span>
                <span className="threat-tooltip">
                  {breakdown.map((c) => (
                    <div key={c.label} className="threat-tooltip-row">
                      <span>{c.label}</span>
                      <span>{c.amount > 0 ? `+${c.amount}` : c.amount}</span>
                    </div>
                  ))}
                </span>
              </span>
            )}
          </span>
        </div>
      </div>
      <div className="survivor-card-right">
        <div className="gear-slots">
          <div
            className={`sustenance-slot${sustenance ? ' filled' : ' empty'}${onRemoveSustenance && sustenance ? ' removable' : ''}`}
            onClick={
              onRemoveSustenance && sustenance
                ? (e) => {
                    e.stopPropagation();
                    onRemoveSustenance();
                  }
                : undefined
            }
            title={sustenance ? `Fed: ${sustenance.label}` : 'No food/water assigned yet'}
          >
            {sustenance ? (
              sustenance.art ? <img src={sustenance.art} alt={sustenance.label} /> : <span className="fallback-label">{sustenance.label}</span>
            ) : (
              <span className="empty-icon">⊘</span>
            )}
          </div>
          {(() => {
            const realEntries = survivor.equippedItems
              .map((item, index) => ({ item, index }))
              .filter((e): e is { item: LootToken; index: number } => !!e.item);
            const pending = [...pendingGear];
            const maxSlots = getMaxGearSlots(survivor);

            const filledNodes = realEntries.map(({ item, index }) =>
              gearDraggable ? (
                <DraggableGearItem key={`filled-${index}`} survivorId={survivor.id} itemIndex={index} item={item} />
              ) : (
                <div key={`filled-${index}`} className="gear-slot filled" title={tokenLabel(item)}>
                  {tokenArt(item) ? <img src={tokenArt(item)!} alt={tokenLabel(item)} /> : <span className="fallback-label">{tokenLabel(item)}</span>}
                </div>
              ),
            );

            const emptySlotsNeeded = Math.max(0, maxSlots - realEntries.length);
            const restNodes = Array.from({ length: emptySlotsNeeded }, (_, i) => {
              const p = pending.shift();
              if (p) {
                return (
                  <div
                    key={`fill-${i}`}
                    className="gear-slot filled pending"
                    onClick={(e) => { e.stopPropagation(); p.onRemove(); }}
                    title={`${p.label} (pending — click to remove)`}
                  >
                    {p.art ? <img src={p.art} alt={p.label} /> : <span className="fallback-label">{p.label}</span>}
                  </div>
                );
              }
              return (
                <div key={`empty-${i}`} className="gear-slot empty" title="Empty slot">
                  <span className="empty-icon">⊘</span>
                </div>
              );
            });

            const overflow = pending.map((p, i) => (
              <div
                key={`overflow-${i}`}
                className="gear-slot filled pending"
                onClick={(e) => { e.stopPropagation(); p.onRemove(); }}
                title={`${p.label} (pending — click to remove)`}
              >
                {p.art ? <img src={p.art} alt={p.label} /> : <span className="fallback-label">{p.label}</span>}
              </div>
            ));

            return [...filledNodes, ...restNodes, ...overflow];
          })()}
        </div>
      </div>
    </button>
  );
}
