import { GameState, GameReducerAction, GameConfig, PlayerState, CompoundState, ResourceType, LootToken, UpkeepAllocations, DEFAULT_STARTING_RESOURCES } from '../types';
import { buildLocationStates } from '../data/locations';
import { createRng } from '../utils/rng';
import { addEvent, computeStructureThreat } from './helpers';
import { buildDraftState, applyDraftPick } from './phases/draft';
import { applySubmitPlanning, autoAdvancePlanning } from './phases/planning';
import { applySubmitIntents } from './phases/actionSelection';
import { resolveAllConflicts } from './phases/conflictResolution';
import { applyClaimLoot, resolveAllLoot } from './phases/looting';
import { resolveUpkeep } from './phases/upkeep';

// ─────────────────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────────────────

export function createInitialState(config: GameConfig): GameState {
  const seed = config.seed ?? Math.floor(Math.random() * 1_000_000);
  const rng = createRng(seed);

  const startResources: Record<ResourceType, number> = {
    ...DEFAULT_STARTING_RESOURCES,
    ...config.startingResources,
  };

  const players: PlayerState[] = config.playerNames.map((name, i) => {
    const compound: CompoundState = {
      resources: { ...startResources },
      structures: [],
      structureThreat: 0,
      storedItems: [],
    };
    return {
      id: `player_${i}`,
      name,
      survivors: [],
      compound,
      isHuman: config.humanPlayerIndices.includes(i),
      isAgent: config.agentPlayerIndices?.includes(i) ?? false,
      isEliminated: false,
      intentsSubmitted: false,
      intents: [],
      aiStrategy: config.aiStrategies?.[i] ?? 'balanced',
    };
  });

  const locations = buildLocationStates(config.locationLootConfigs, rng);

  const baseState: GameState = {
    phase: 'draft',
    round: 1,
    draftPool: [],
    draftOrder: [],
    currentDraftIndex: 0,
    picksPerPlayer: config.picksPerPlayer ?? 4,
    picksMade: {},
    players,
    locations,
    pendingConflicts: [],
    craftResults: [],
    lootOpportunities: [],
    reviewReadyPlayerIds: [],
    planningAllocations: {},
    upkeepAllocations: {},
    jammedPlayerIds: [],
    events: [],
    rngSeed: seed,
    rngCounter: 1,
  };

  addEvent(baseState, `Game started with ${config.playerCount} players. Seed: ${seed}`, ['game_start']);
  return buildDraftState(baseState);
}

// ─────────────────────────────────────────────────────────────────────────────
// REDUCER
// ─────────────────────────────────────────────────────────────────────────────

export function gameReducer(state: GameState, action: GameReducerAction): GameState {
  // Cross-phase actions
  if (action.type === 'FORFEIT') {
    const s = JSON.parse(JSON.stringify(state)) as GameState;
    const player = s.players.find((p) => p.id === action.playerId);
    if (player) {
      player.isEliminated = true;
      addEvent(s, `${player.name} has forfeited.`, ['elimination']);
    }
    return checkGameOver(s);
  }

  if (action.type === 'CONFIRM_REVIEW_READY') {
    if (state.reviewReadyPlayerIds.includes(action.playerId)) return state;
    const s = JSON.parse(JSON.stringify(state)) as GameState;
    s.reviewReadyPlayerIds.push(action.playerId);
    return s;
  }

  switch (state.phase) {
    case 'draft':
      if (action.type === 'DRAFT_PICK') return applyDraftPick(state, action);
      if (action.type === 'AUTO_ADVANCE') return autoAdvanceDraft(state);
      break;

    case 'planning':
      if (action.type === 'SUBMIT_PLANNING') return applySubmitPlanning(state, action);
      if (action.type === 'TRANSFER_ITEM') return applyTransferItem(state, action);
      if (action.type === 'EQUIP_FROM_COMPOUND') return applyEquipFromCompound(state, action);
      if (action.type === 'UNEQUIP_TO_COMPOUND') return applyUnequipToCompound(state, action);
      if (action.type === 'AUTO_ADVANCE') return autoAdvancePlanning(state);
      break;

    case 'action_selection':
      if (action.type === 'SUBMIT_INTENTS') return applySubmitIntents(state, action);
      if (action.type === 'AUTO_ADVANCE') return autoAdvanceActionSelection(state);
      break;

    case 'conflict_resolution':
      if (action.type === 'AUTO_ADVANCE') return resolveAllConflicts(state);
      break;

    case 'looting':
      if (action.type === 'CLAIM_LOOT') return applyClaimLoot(state, action);
      if (action.type === 'AUTO_ADVANCE') return resolveAllLoot(state);
      break;

    case 'upkeep':
      if (action.type === 'SUBMIT_UPKEEP_ALLOCATION') return applyUpkeepAllocation(state, action);
      if (action.type === 'AUTO_ADVANCE') return autoAdvanceUpkeep(state);
      break;

    case 'game_over':
      return state;
  }

  return state;
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTO-ADVANCE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

import { generateAIIntents } from './ai';
import { getMaxSlots } from './helpers';

function autoAdvanceDraft(state: GameState): GameState {
  let s = JSON.parse(JSON.stringify(state)) as GameState;
  while (s.phase === 'draft') {
    const pickerId = s.draftOrder[s.currentDraftIndex % s.draftOrder.length];
    const picker = s.players.find((p) => p.id === pickerId)!;
    if (picker.isHuman || picker.isAgent) break;  // stop and wait for external input
    const rng = createRng(s.rngSeed + s.rngCounter++);
    const pick = s.draftPool[rng.int(s.draftPool.length)];
    s = applyDraftPick(s, { type: 'DRAFT_PICK', playerId: pickerId, survivorId: pick.id });
  }
  return s;
}

function autoAdvanceActionSelection(state: GameState): GameState {
  let s = JSON.parse(JSON.stringify(state)) as GameState;

  for (const player of s.players) {
    if (player.isEliminated || player.intentsSubmitted || player.isHuman || player.isAgent) continue;
    const intents = generateAIIntents(s, player);
    s = applySubmitIntents(s, { type: 'SUBMIT_INTENTS', playerId: player.id, intents });
  }
  return s;
}

function applyTransferItem(
  state: GameState,
  action: Extract<GameReducerAction, { type: 'TRANSFER_ITEM' }>,
): GameState {
  const s = JSON.parse(JSON.stringify(state)) as GameState;
  const player = s.players.find((p) => p.id === action.playerId);
  if (!player) return s;

  const from = player.survivors.find((sv) => sv.id === action.fromSurvivorId);
  const to = player.survivors.find((sv) => sv.id === action.toSurvivorId);
  if (!from || !to || !from.alive || !to.alive || from === to) return s;

  const item = from.equippedItems[action.itemIndex];
  if (!item) return s;

  const toUsed = to.equippedItems.filter(Boolean).length;
  if (toUsed >= getMaxSlots(to)) return s;  // destination has no free slot

  from.equippedItems[action.itemIndex] = null;
  to.equippedItems = [...to.equippedItems.filter(Boolean), item];

  const label = item.kind === 'weapon' ? item.weaponId.replace(/_/g, ' ') : item.kind === 'equipment' ? item.equipmentId.replace(/_/g, ' ') : item.kind === 'resource' ? `${item.amount}x ${item.resource}` : 'item';
  addEvent(s, `${label} moved from ${from.name} to ${to.name}.`, ['inventory']);
  return s;
}

function itemLabel(item: LootToken): string {
  if (item.kind === 'weapon') return item.weaponId.replace(/_/g, ' ');
  if (item.kind === 'equipment') return item.equipmentId.replace(/_/g, ' ');
  if (item.kind === 'resource') return `${item.amount}x ${item.resource}`;
  return 'item';
}

function applyEquipFromCompound(
  state: GameState,
  action: Extract<GameReducerAction, { type: 'EQUIP_FROM_COMPOUND' }>,
): GameState {
  const s = JSON.parse(JSON.stringify(state)) as GameState;
  const player = s.players.find((p) => p.id === action.playerId);
  if (!player) return s;

  const to = player.survivors.find((sv) => sv.id === action.toSurvivorId);
  if (!to || !to.alive) return s;

  const item = player.compound.storedItems[action.itemIndex];
  if (!item) return s;

  if (to.equippedItems.filter(Boolean).length >= getMaxSlots(to)) return s; // destination has no free slot

  player.compound.storedItems.splice(action.itemIndex, 1);
  to.equippedItems = [...to.equippedItems.filter(Boolean), item];

  addEvent(s, `${itemLabel(item)} equipped to ${to.name} from compound storage.`, ['inventory']);
  return s;
}

function applyUnequipToCompound(
  state: GameState,
  action: Extract<GameReducerAction, { type: 'UNEQUIP_TO_COMPOUND' }>,
): GameState {
  const s = JSON.parse(JSON.stringify(state)) as GameState;
  const player = s.players.find((p) => p.id === action.playerId);
  if (!player) return s;

  const from = player.survivors.find((sv) => sv.id === action.fromSurvivorId);
  if (!from || !from.alive) return s;

  const item = from.equippedItems[action.itemIndex];
  if (!item) return s;

  from.equippedItems[action.itemIndex] = null;
  player.compound.storedItems.push(item);

  addEvent(s, `${itemLabel(item)} unequipped from ${from.name} to compound storage.`, ['inventory']);
  return s;
}

function applyUpkeepAllocation(
  state: GameState,
  action: Extract<GameReducerAction, { type: 'SUBMIT_UPKEEP_ALLOCATION' }>,
): GameState {
  const s = JSON.parse(JSON.stringify(state)) as GameState;
  s.upkeepAllocations[action.playerId] = action.allocations;
  return s;
}

function autoAdvanceUpkeep(state: GameState): GameState {
  let s = JSON.parse(JSON.stringify(state)) as GameState;

  // Auto-allocate for CPU and eliminated players who haven't submitted yet
  for (const player of s.players) {
    if (s.upkeepAllocations[player.id]) continue;
    if (player.isEliminated || (!player.isHuman && !player.isAgent)) {
      s.upkeepAllocations[player.id] = autoAllocateUpkeep(player);
    }
  }

  // Resolve once all human and agent players have submitted
  const pendingInput = s.players.filter(
    (p) => (p.isHuman || p.isAgent) && !p.isEliminated && !s.upkeepAllocations[p.id],
  );
  if (pendingInput.length === 0) return resolveUpkeep(s);
  return s;
}

function autoAllocateUpkeep(_player: PlayerState): UpkeepAllocations {
  return { medHeals: [] };
}

function checkGameOver(state: GameState): GameState {
  const alive = state.players.filter((p) => !p.isEliminated);
  if (alive.length <= 1) {
    const s = JSON.parse(JSON.stringify(state)) as GameState;
    s.phase = 'game_over';
    s.winnerId = alive[0]?.id;
    addEvent(s, `GAME OVER — ${alive[0]?.name ?? 'Nobody'} wins!`, ['game_over']);
    return s;
  }
  return state;
}
