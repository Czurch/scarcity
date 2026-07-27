import { useEffect, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import type { CraftRecap, ItemId, LocationId, PendingConflict, SurvivorAction, SurvivorState, SustenanceChoice } from '@game/types';
import type { UseGameConnection } from '../hooks/useGameConnection';
import { TopBar } from '../components/TopBar';
import { OpponentRail } from '../components/OpponentRail';
import { LocationGrid } from '../components/LocationGrid';
import { SurvivorCard } from '../components/SurvivorCard';
import { CompoundHUD } from '../components/CompoundHUD';
import { EventLog } from '../components/EventLog';
import { PhasePanel } from '../components/phase-panels/PhasePanel';
import { CraftModal } from '../components/CraftModal';
import { ResolutionReveal } from '../components/ResolutionReveal';
import { isCarryLimited, tokenArt, tokenLabel } from '../data/lootTokens';
import { getResourceArt } from '../data/itemArt';
import { getMaxGearSlots } from '../data/threat';

interface Props {
  conn: UseGameConnection;
}

type ActionButtonType = 'scavenge' | 'attack' | 'defend' | 'craft';
type Targeting = { survivorId: string; type: 'scavenge' | 'attack' } | null;
type Resource = 'food' | 'water';

const ACTION_BUTTONS: { type: ActionButtonType; glyph: string; label: string }[] = [
  { type: 'scavenge', glyph: '\u{1F50D}', label: 'Scavenge' },
  { type: 'attack', glyph: '⚔', label: 'Attack' },
  { type: 'defend', glyph: '\u{1F6E1}', label: 'Defend' },
  { type: 'craft', glyph: '\u{1F528}', label: 'Craft' },
];

function BoardSurvivorSlot({
  survivor,
  selected,
  onClick,
  dropEnabled,
  dimmed,
  assignedIndices,
  assignedArt,
  onUnassign,
  ammoInCompound,
}: {
  survivor: SurvivorState;
  selected: boolean;
  onClick: () => void;
  dropEnabled: boolean;
  dimmed: boolean;
  assignedIndices: number[];
  assignedArt: (index: number) => { art: string | null; label: string };
  onUnassign: (index: number) => void;
  ammoInCompound: number;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `survivor-${survivor.id}`,
    data: { survivorId: survivor.id },
    disabled: !dropEnabled,
  });

  const pendingGear = assignedIndices.map((idx) => ({ ...assignedArt(idx), onRemove: () => onUnassign(idx) }));

  return (
    <div
      ref={setNodeRef}
      className={`board-survivor-slot${isOver && dropEnabled ? ' drop-active' : ''}${dropEnabled ? ' loot-participant' : ''}${dimmed ? ' dimmed' : ''}`}
    >
      <SurvivorCard
        survivor={survivor}
        selected={selected}
        onClick={onClick}
        ammoInCompound={ammoInCompound}
        pendingGear={pendingGear}
      />
    </div>
  );
}

function PlanningSurvivorSlot({
  survivor,
  selected,
  onClick,
  choice,
  onUnassign,
  ammoInCompound,
}: {
  survivor: SurvivorState;
  selected: boolean;
  onClick: () => void;
  choice: SustenanceChoice;
  onUnassign: () => void;
  ammoInCompound: number;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `survivor-${survivor.id}`,
    data: { survivorId: survivor.id },
    disabled: !survivor.alive,
  });
  const sustenanceToken = choice !== 'none' ? { art: getResourceArt(choice), label: choice } : null;

  return (
    <div
      ref={setNodeRef}
      className={`board-survivor-slot${isOver ? ' drop-active' : ''}${!survivor.alive ? ' dead' : ''}`}
    >
      <SurvivorCard
        survivor={survivor}
        selected={selected}
        onClick={onClick}
        ammoInCompound={ammoInCompound}
        wellFedOverride={choice === 'food'}
        sustenanceToken={sustenanceToken}
        onRemoveSustenance={onUnassign}
        gearDraggable
      />
    </div>
  );
}

function ActionSurvivorSlot({
  survivor,
  selected,
  onClick,
  action,
  isTargetingSource,
  slotRef,
  onPickType,
  onCancel,
  ammoInCompound,
}: {
  survivor: SurvivorState;
  selected: boolean;
  onClick: () => void;
  action: SurvivorAction | undefined;
  isTargetingSource: boolean;
  slotRef: (el: HTMLElement | null) => void;
  onPickType: (type: ActionButtonType) => void;
  onCancel: () => void;
  ammoInCompound: number;
}) {
  return (
    <div
      ref={slotRef}
      className={`action-survivor-slot${isTargetingSource ? ' targeting' : ''}${action ? ' assigned' : ''}`}
    >
      <SurvivorCard survivor={survivor} selected={selected} onClick={onClick} ammoInCompound={ammoInCompound} />
      {action && (
        <button
          type="button"
          className="cancel-action-x"
          onClick={(e) => { e.stopPropagation(); onCancel(); }}
          title="Cancel selection"
        >
          &times;
        </button>
      )}
      {!action && survivor.alive && (
        <div className="action-buttons-row" onClick={(e) => e.stopPropagation()}>
          {ACTION_BUTTONS.map((b) => (
            <button
              key={b.type}
              type="button"
              className="action-square-btn"
              onClick={() => onPickType(b.type)}
              title={b.label}
            >
              {b.glyph}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function centerOf(rect: DOMRect): { x: number; y: number } {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function arcPath(x1: number, y1: number, x2: number, y2: number): string {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy) || 1;
  const offset = Math.min(Math.max(dist * 0.3, 40), 140);
  const nx = -dy / dist;
  const ny = dx / dist;
  const cx = mx + nx * offset;
  const cy = my + ny * offset;
  return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
}

function ActionArrowOverlay({
  arrows,
  live,
}: {
  arrows: { id: string; from: DOMRect; to: DOMRect }[];
  live: { from: DOMRect; to: { x: number; y: number } } | null;
}) {
  if (arrows.length === 0 && !live) return null;
  return (
    <svg className="action-arrow-overlay">
      <defs>
        <marker id="action-arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="#c9a24b" />
        </marker>
      </defs>
      {arrows.map((a) => {
        const from = centerOf(a.from);
        const to = centerOf(a.to);
        return <path key={a.id} d={arcPath(from.x, from.y, to.x, to.y)} className="action-arrow" markerEnd="url(#action-arrowhead)" />;
      })}
      {live && (() => {
        const from = centerOf(live.from);
        return <path d={arcPath(from.x, from.y, live.to.x, live.to.y)} className="action-arrow live" markerEnd="url(#action-arrowhead)" />;
      })()}
    </svg>
  );
}

export function GameScreen({ conn }: Props) {
  const state = conn.gameState;
  const [selectedSurvivorId, setSelectedSurvivorId] = useState<string | null>(null);
  const [lootAssignments, setLootAssignments] = useState<Record<number, string>>({});
  const [sustenanceChoices, setSustenanceChoices] = useState<Record<string, SustenanceChoice>>({});
  const [activeDragLabel, setActiveDragLabel] = useState<{ art: string | null; label: string } | null>(null);
  const [actions, setActions] = useState<Record<string, SurvivorAction>>({});
  const [targeting, setTargeting] = useState<Targeting>(null);
  const [craftPickerSurvivorId, setCraftPickerSurvivorId] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [revealData, setRevealData] = useState<{ conflicts: PendingConflict[]; crafts: CraftRecap[] } | null>(null);
  const [revealActiveSurvivorIds, setRevealActiveSurvivorIds] = useState<string[]>([]);
  const [, forceTick] = useState(0);

  const lootOppIdRef = useRef<string | null>(null);
  const actionRoundKeyRef = useRef<number | null>(null);
  const planningRoundKeyRef = useRef<number | null>(null);
  const resolveRoundKeyRef = useRef<number | null>(null);
  const survivorRefs = useRef<Map<string, HTMLElement>>(new Map());
  const locationRefs = useRef<Map<string, HTMLElement>>(new Map());
  const opponentRefs = useRef<Map<string, HTMLElement>>(new Map());
  const opponentSurvivorRefs = useRef<Map<string, HTMLElement>>(new Map());

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const me = state?.players.find((p) => p.id === conn.myPlayerId);

  const lootOpportunity =
    state?.phase === 'looting' && me ? state.lootOpportunities.find((o) => o.playerId === me.id && !o.claimed) : undefined;

  // lootAssignments can briefly hold indices from a just-claimed opportunity (state update lags
  // one render behind the reset effect below) -- scope reads to what's valid for the *current* one.
  const safeLootAssignments = lootOpportunity
    ? Object.fromEntries(
        Object.entries(lootAssignments).filter(([idx]) => Number(idx) < lootOpportunity.revealedTokens.length),
      )
    : {};

  useEffect(() => {
    if ((lootOpportunity?.id ?? null) !== lootOppIdRef.current) {
      lootOppIdRef.current = lootOpportunity?.id ?? null;
      setLootAssignments({});
    }
  }, [lootOpportunity?.id]);

  useEffect(() => {
    if (state?.phase === 'action_selection' && actionRoundKeyRef.current !== state.round) {
      actionRoundKeyRef.current = state.round;
      setActions({});
      setTargeting(null);
      setCraftPickerSurvivorId(null);
    }
  }, [state?.phase, state?.round]);

  useEffect(() => {
    if (state?.phase === 'planning' && planningRoundKeyRef.current !== state.round) {
      planningRoundKeyRef.current = state.round;
      setSustenanceChoices({});
    }
  }, [state?.phase, state?.round]);

  useEffect(() => {
    if (state && (state.phase === 'looting' || state.phase === 'upkeep') && resolveRoundKeyRef.current !== state.round) {
      resolveRoundKeyRef.current = state.round;
      if (state.pendingConflicts.length + state.craftResults.length > 0) {
        setRevealData({ conflicts: state.pendingConflicts, crafts: state.craftResults });
      }
    }
  }, [state?.phase, state?.round]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setTargeting(null);
        setCraftPickerSurvivorId(null);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!targeting) { setMousePos(null); return; }
    function onMove(e: MouseEvent) { setMousePos({ x: e.clientX, y: e.clientY }); }
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [targeting]);

  useEffect(() => {
    if (!targeting) return;
    const validTargetSelector = targeting.type === 'scavenge' ? '.location-card' : '.opponent-rail';
    function onDocClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (target.closest('.action-square-btn')) return; // picking a different action for this survivor
      if (target.closest(validTargetSelector)) return; // valid target — its own handler resolves this click
      setTargeting(null);
    }
    window.addEventListener('click', onDocClick);
    return () => window.removeEventListener('click', onDocClick);
  }, [targeting]);

  useEffect(() => {
    function onResize() { forceTick((t) => t + 1); }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (!state || !conn.myPlayerId) {
    return <div className="screen">Loading game…</div>;
  }
  if (!me) {
    return <div className="screen">You are not seated in this game.</div>;
  }

  const opponents = state.players.filter((p) => p.id !== conn.myPlayerId);
  const half = Math.ceil(opponents.length / 2);
  const leftOpponents = opponents.slice(0, half);
  const rightOpponents = opponents.slice(half);

  const selected =
    me.survivors.find((s) => s.id === selectedSurvivorId) ?? me.survivors.find((s) => s.alive) ?? null;

  const inActionSelection = state.phase === 'action_selection' && !me.intentsSubmitted;
  const inPlanning = state.phase === 'planning' && !state.planningAllocations[me.id];

  function handleDragStart({ active }: DragStartEvent) {
    const data = active.data.current;
    if (!data) return;
    if (data.kind === 'loot' && lootOpportunity) {
      const token = lootOpportunity.revealedTokens[data.tokenIndex as number];
      setActiveDragLabel({ art: tokenArt(token), label: tokenLabel(token) });
    } else if (data.kind === 'resource') {
      const resource = data.resource as Resource;
      setActiveDragLabel({ art: getResourceArt(resource), label: resource });
    } else if (data.kind === 'equipment' && me) {
      const fromSurvivor = me.survivors.find((s) => s.id === data.fromSurvivorId);
      const item = fromSurvivor?.equippedItems[data.itemIndex as number];
      if (item) setActiveDragLabel({ art: tokenArt(item), label: tokenLabel(item) });
    } else if (data.kind === 'stored-item' && me) {
      const item = me.compound.storedItems[data.itemIndex as number];
      if (item) setActiveDragLabel({ art: tokenArt(item), label: tokenLabel(item) });
    }
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    setActiveDragLabel(null);
    if (!over || !me) return;
    const data = active.data.current;
    if (!data) return;

    if (data.kind === 'loot' && lootOpportunity) {
      const tokenIndex = data.tokenIndex as number;
      const survivorId = over.data.current?.survivorId as string | undefined;
      if (!survivorId || !lootOpportunity.survivorIds.includes(survivorId)) return;

      const token = lootOpportunity.revealedTokens[tokenIndex];
      if (isCarryLimited(token)) {
        const carryUsed = Object.keys(safeLootAssignments)
          .filter((idx) => Number(idx) !== tokenIndex)
          .filter((idx) => isCarryLimited(lootOpportunity.revealedTokens[Number(idx)]))
          .length;
        if (carryUsed >= lootOpportunity.carryCapacity) return;
      }

      setLootAssignments((prev) => ({ ...prev, [tokenIndex]: survivorId }));
      return;
    }

    if (data.kind === 'resource') {
      const resource = data.resource as Resource | undefined;
      const survivorId = over.data.current?.survivorId as string | undefined;
      if (!resource || !survivorId) return;
      const usedByOthers = Object.entries(sustenanceChoices).filter(
        ([sid, c]) => sid !== survivorId && c === resource,
      ).length;
      const available = me.compound.resources[resource] - usedByOthers;
      if (available <= 0) return;
      setSustenanceChoices((prev) => ({ ...prev, [survivorId]: resource }));
      return;
    }

    if (data.kind === 'equipment') {
      const fromSurvivorId = data.fromSurvivorId as string;
      const itemIndex = data.itemIndex as number;

      if (over.data.current?.kind === 'compound-storage') {
        conn.send({
          type: 'unequip_to_compound_request',
          gameId: conn.gameId!,
          playerId: me.id,
          fromSurvivorId,
          itemIndex,
        });
        return;
      }

      const toSurvivorId = over.data.current?.survivorId as string | undefined;
      if (!toSurvivorId || toSurvivorId === fromSurvivorId) return;

      const toSurvivor = me.survivors.find((s) => s.id === toSurvivorId);
      if (!toSurvivor) return;
      const toUsed = toSurvivor.equippedItems.filter(Boolean).length;
      if (toUsed >= getMaxGearSlots(toSurvivor)) return; // destination has no free slot

      conn.send({
        type: 'transfer_item_request',
        gameId: conn.gameId!,
        playerId: me.id,
        fromSurvivorId,
        toSurvivorId,
        itemIndex,
      });
      return;
    }

    if (data.kind === 'stored-item') {
      const itemIndex = data.itemIndex as number;
      const toSurvivorId = over.data.current?.survivorId as string | undefined;
      if (!toSurvivorId) return;

      const toSurvivor = me.survivors.find((s) => s.id === toSurvivorId);
      if (!toSurvivor) return;
      const toUsed = toSurvivor.equippedItems.filter(Boolean).length;
      if (toUsed >= getMaxGearSlots(toSurvivor)) return; // destination has no free slot

      conn.send({
        type: 'equip_from_compound_request',
        gameId: conn.gameId!,
        playerId: me.id,
        itemIndex,
        toSurvivorId,
      });
    }
  }

  function unassignLoot(index: number) {
    setLootAssignments((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
  }

  function unassignSustenance(survivorId: string) {
    setSustenanceChoices((prev) => {
      const next = { ...prev };
      delete next[survivorId];
      return next;
    });
  }

  function handlePickActionType(survivorId: string, type: ActionButtonType) {
    if (type === 'defend') {
      setActions((prev) => ({ ...prev, [survivorId]: { type: 'defend' } }));
      setTargeting(null);
      return;
    }
    if (type === 'craft') {
      setCraftPickerSurvivorId(survivorId);
      setTargeting(null);
      return;
    }
    setTargeting({ survivorId, type });
    setCraftPickerSurvivorId(null);
  }

  function handleCancelAction(survivorId: string) {
    setActions((prev) => {
      const next = { ...prev };
      delete next[survivorId];
      return next;
    });
  }

  function handlePickCraftItem(survivorId: string, itemId: ItemId) {
    setActions((prev) => ({ ...prev, [survivorId]: { type: 'craft', itemId } }));
    setCraftPickerSurvivorId(null);
  }

  function handleLocationSelect(locationId: LocationId) {
    if (!targeting || targeting.type !== 'scavenge') return;
    setActions((prev) => ({ ...prev, [targeting.survivorId]: { type: 'scavenge', locationId } }));
    setTargeting(null);
  }

  function handleOpponentSelect(playerId: string) {
    if (!targeting || targeting.type !== 'attack') return;
    setActions((prev) => ({ ...prev, [targeting.survivorId]: { type: 'attack', targetPlayerId: playerId } }));
    setTargeting(null);
  }

  const actionArrows: { id: string; from: DOMRect; to: DOMRect }[] = [];
  if (inActionSelection) {
    for (const [survivorId, action] of Object.entries(actions)) {
      const fromEl = survivorRefs.current.get(survivorId);
      if (!fromEl) continue;
      let toEl: HTMLElement | undefined;
      if (action.type === 'scavenge') toEl = locationRefs.current.get(action.locationId);
      else if (action.type === 'attack') toEl = opponentRefs.current.get(action.targetPlayerId);
      if (toEl) actionArrows.push({ id: survivorId, from: fromEl.getBoundingClientRect(), to: toEl.getBoundingClientRect() });
    }
  }
  if (revealData) {
    for (const player of state.players) {
      for (const intent of player.intents) {
        if (intent.action.type !== 'scavenge' && intent.action.type !== 'attack') continue;
        const fromEl = player.id === me.id
          ? survivorRefs.current.get(intent.survivorId)
          : opponentSurvivorRefs.current.get(intent.survivorId);
        if (!fromEl) continue;
        const toEl = intent.action.type === 'scavenge'
          ? locationRefs.current.get(intent.action.locationId)
          : opponentRefs.current.get(intent.action.targetPlayerId);
        if (toEl) actionArrows.push({ id: `reveal-${intent.survivorId}`, from: fromEl.getBoundingClientRect(), to: toEl.getBoundingClientRect() });
      }
    }
  }
  const liveArrow = (() => {
    if (!targeting || !mousePos) return null;
    const fromEl = survivorRefs.current.get(targeting.survivorId);
    if (!fromEl) return null;
    return { from: fromEl.getBoundingClientRect(), to: mousePos };
  })();

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="screen game-screen">
        <TopBar state={state} me={me} conn={conn} />
        <div className="board">
          <div className="opponent-column">
            {leftOpponents.map((p) => (
              <OpponentRail
                key={p.id}
                player={p}
                targetable={inActionSelection && targeting?.type === 'attack'}
                onSelect={handleOpponentSelect}
                registerRef={(id, el) => { if (el) opponentRefs.current.set(id, el); else opponentRefs.current.delete(id); }}
                registerSurvivorRef={(id, el) => { if (el) opponentSurvivorRefs.current.set(id, el); else opponentSurvivorRefs.current.delete(id); }}
                dimSurvivorIds={revealData ? revealActiveSurvivorIds : undefined}
              />
            ))}
          </div>
          <div className="center-column">
            <LocationGrid
              locations={state.locations}
              selectable={inActionSelection && targeting?.type === 'scavenge'}
              onSelect={handleLocationSelect}
              targetable={inActionSelection && targeting?.type === 'scavenge'}
              registerRef={(id, el) => { if (el) locationRefs.current.set(id, el); else locationRefs.current.delete(id); }}
            />
            <PhasePanel
              state={state}
              me={me}
              conn={conn}
              lootAssignments={safeLootAssignments}
              actions={actions}
              sustenanceChoices={sustenanceChoices}
            />
          </div>
          <div className="opponent-column">
            {rightOpponents.map((p) => (
              <OpponentRail
                key={p.id}
                player={p}
                targetable={inActionSelection && targeting?.type === 'attack'}
                onSelect={handleOpponentSelect}
                registerRef={(id, el) => { if (el) opponentRefs.current.set(id, el); else opponentRefs.current.delete(id); }}
                registerSurvivorRef={(id, el) => { if (el) opponentSurvivorRefs.current.set(id, el); else opponentSurvivorRefs.current.delete(id); }}
                dimSurvivorIds={revealData ? revealActiveSurvivorIds : undefined}
              />
            ))}
          </div>
        </div>
        <div className="my-survivors">
          {me.survivors.map((s) => {
            if (inActionSelection) {
              return (
                <ActionSurvivorSlot
                  key={s.id}
                  survivor={s}
                  selected={s.id === selected?.id}
                  onClick={() => setSelectedSurvivorId(s.id)}
                  action={actions[s.id]}
                  isTargetingSource={targeting?.survivorId === s.id}
                  slotRef={(el) => { if (el) survivorRefs.current.set(s.id, el); else survivorRefs.current.delete(s.id); }}
                  onPickType={(type) => handlePickActionType(s.id, type)}
                  onCancel={() => handleCancelAction(s.id)}
                  ammoInCompound={me.compound.resources.ammo}
                />
              );
            }

            if (inPlanning) {
              return (
                <PlanningSurvivorSlot
                  key={s.id}
                  survivor={s}
                  selected={s.id === selected?.id}
                  onClick={() => setSelectedSurvivorId(s.id)}
                  choice={sustenanceChoices[s.id] ?? 'none'}
                  onUnassign={() => unassignSustenance(s.id)}
                  ammoInCompound={me.compound.resources.ammo}
                />
              );
            }

            const assignedIndices = lootOpportunity
              ? Object.entries(safeLootAssignments)
                  .filter(([, sid]) => sid === s.id)
                  .map(([idx]) => Number(idx))
              : [];
            return (
              <BoardSurvivorSlot
                key={s.id}
                survivor={s}
                selected={s.id === selected?.id}
                onClick={() => setSelectedSurvivorId(s.id)}
                dropEnabled={!!lootOpportunity && lootOpportunity.survivorIds.includes(s.id) && s.alive}
                dimmed={
                  (!!lootOpportunity && !lootOpportunity.survivorIds.includes(s.id)) ||
                  (!!revealData && !revealActiveSurvivorIds.includes(s.id))
                }
                assignedIndices={assignedIndices}
                assignedArt={(idx) => {
                  const token = lootOpportunity!.revealedTokens[idx];
                  return { art: tokenArt(token), label: tokenLabel(token) };
                }}
                onUnassign={unassignLoot}
                ammoInCompound={me.compound.resources.ammo}
              />
            );
          })}
        </div>
        <CompoundHUD me={me} interactive={inPlanning} />
      </div>
      <EventLog events={state.events} />
      <DragOverlay dropAnimation={null}>
        {activeDragLabel ? (
          <div className="loot-token drag-overlay-token">
            {activeDragLabel.art ? <img src={activeDragLabel.art} alt={activeDragLabel.label} /> : <span>{activeDragLabel.label}</span>}
          </div>
        ) : null}
      </DragOverlay>
      <ActionArrowOverlay arrows={actionArrows} live={liveArrow} />
      {craftPickerSurvivorId && (() => {
        const craftingSurvivor = me.survivors.find((s) => s.id === craftPickerSurvivorId);
        if (!craftingSurvivor) return null;
        return (
          <CraftModal
            survivor={craftingSurvivor}
            me={me}
            onPick={(itemId) => handlePickCraftItem(craftPickerSurvivorId, itemId)}
            onClose={() => setCraftPickerSurvivorId(null)}
          />
        );
      })()}
      {revealData && (
        <ResolutionReveal
          state={state}
          myPlayerId={me.id}
          conn={conn}
          conflicts={revealData.conflicts}
          crafts={revealData.crafts}
          onActiveSurvivorsChange={setRevealActiveSurvivorIds}
          onDone={() => { setRevealData(null); setRevealActiveSurvivorIds([]); }}
        />
      )}
    </DndContext>
  );
}
