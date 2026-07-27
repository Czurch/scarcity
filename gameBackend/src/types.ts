// ─────────────────────────────────────────────────────────────────────────────
// RESOURCES & ITEMS
// ─────────────────────────────────────────────────────────────────────────────

export type ResourceType = 'water' | 'food' | 'meds' | 'wood' | 'metal' | 'ammo';

export type WeaponId = 'wooden_club' | 'lead_pipe' | 'sawbat' | 'pipe_gun' | 'handgun' | 'snubnose' | 'rifle';

export type EquipmentId = 'backpack' | 'hand_cart' | 'armor' | 'radio' | 'jammer' | 'flashlight';

export type StructureId =
  | 'bunk'
  | 'spike_trap'
  | 'spring_trap'
  | 'ramparts'
  | 'electric_fence_alarm'
  | 'rain_catch'
  | 'small_garden';

export type ItemId = WeaponId | EquipmentId | StructureId;

// ─────────────────────────────────────────────────────────────────────────────
// LOOT TOKENS (cards in location decks)
// ─────────────────────────────────────────────────────────────────────────────

export interface ResourceToken {
  kind: 'resource';
  resource: ResourceType;
  amount: number;
}

export interface WeaponToken {
  kind: 'weapon';
  weaponId: WeaponId;
}

export interface EquipmentToken {
  kind: 'equipment';
  equipmentId: EquipmentId;
}

export interface NothingToken {
  kind: 'nothing';
}

export type LootToken = ResourceToken | WeaponToken | EquipmentToken | NothingToken;

// ─────────────────────────────────────────────────────────────────────────────
// SURVIVORS
// ─────────────────────────────────────────────────────────────────────────────

export interface SurvivorTemplate {
  id: string;
  name: string;
  maxHp: number;
  baseThreat: number;
  /** Human-readable passive description — mechanics TBD */
  passive?: string;
}

export interface SurvivorState {
  id: string;
  templateId: string;
  name: string;
  hp: number;
  maxHp: number;
  baseThreat: number;
  /** Equipped items (weapons, equipment). Size = 2 base + backpack/hand-cart bonuses. */
  equippedItems: (LootToken | null)[];
  debuffs: DebuffType[];
  alive: boolean;
  /** Set during planning when food is allocated. Grants +1 threat and enables rest-heal this round. */
  wellFed?: boolean;
}

export type DebuffType = 'starving';

// ─────────────────────────────────────────────────────────────────────────────
// COMPOUND
// ─────────────────────────────────────────────────────────────────────────────

export interface BuiltStructure {
  id: StructureId;
  builtOnRound: number;
}

export interface CompoundState {
  resources: Record<ResourceType, number>;
  structures: BuiltStructure[];
  /** Precomputed threat bonus from structures. Recalculated after any build. */
  structureThreat: number;
  /** Weapons/equipment not currently equipped to any survivor (no free slot when acquired, or manually unequipped). */
  storedItems: LootToken[];
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAYER
// ─────────────────────────────────────────────────────────────────────────────

export interface SurvivorIntent {
  survivorId: string;
  action: SurvivorAction;
}

export type AIStrategy = 'balanced' | 'rusher' | 'hoarder' | 'raider';

export type SustenanceChoice = 'food' | 'water' | 'none';
export interface PlanningAllocations {
  sustenance: Record<string, SustenanceChoice>;
}
export interface UpkeepAllocations {
  medHeals: string[];
}

export interface PlayerState {
  id: string;
  name: string;
  survivors: SurvivorState[];
  compound: CompoundState;
  isHuman: boolean;
  isAgent: boolean;
  isEliminated: boolean;
  intentsSubmitted: boolean;
  intents: SurvivorIntent[];
  aiStrategy: AIStrategy;
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTIONS
// ─────────────────────────────────────────────────────────────────────────────

export type LocationId =
  | 'mini_mart'
  | 'police_station'
  | 'reservoir'
  | 'mall'
  | 'hospital'
  | 'woods'
  | 'commercial'
  | 'residential'
  | 'grocery';

export type SurvivorAction =
  | { type: 'scavenge'; locationId: LocationId }
  | { type: 'attack'; targetPlayerId: string }
  | { type: 'defend' }
  | { type: 'rest' }
  | { type: 'trade' }
  | { type: 'craft'; itemId: ItemId }
  | { type: 'jam'; targetPlayerId: string };

// ─────────────────────────────────────────────────────────────────────────────
// LOCATIONS
// ─────────────────────────────────────────────────────────────────────────────

export interface LocationState {
  id: LocationId;
  name: string;
  lootDeck: LootToken[];
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFLICT
// ─────────────────────────────────────────────────────────────────────────────

export type ConflictTarget =
  | { kind: 'location'; locationId: LocationId }
  | { kind: 'compound'; defenderId: string };

export interface ConflictSquad {
  playerId: string;
  survivorIds: string[];
  totalThreat: number;
}

export interface PendingConflict {
  id: string;
  target: ConflictTarget;
  /** length 1 = uncontested (single scavenger/raider), length >=2 = contested */
  squads: ConflictSquad[];
  /** Resolved winner — squads[0].playerId when uncontested. */
  winnerId?: string;
  /** How many d6-off rounds it took to break a tie for first place. 0 if no tie. */
  tieBreaks: number;
  /** Links into GameState.lootOpportunities for loot-art lookup (empty if the conflict granted no loot, e.g. a failed raid). */
  lootOpportunityIds: string[];
}

export interface ConflictResult {
  conflictId: string;
  winnerId: string;
  loserIds: string[];
  /** Drawn: both sides roll d6 until one wins */
  tieBreaks: number;
}

export interface CraftRecap {
  playerId: string;
  survivorId: string;
  itemId: ItemId;
  outcome: 'built' | 'equipped' | 'stored' | 'failed';
  /** Set when outcome === 'equipped' and the item went to a different survivor than the one who crafted it. */
  equippedToSurvivorId?: string;
  /** Set when outcome === 'failed' (can't afford, not craftable, already built). */
  reason?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// LOOT OPPORTUNITIES
// ─────────────────────────────────────────────────────────────────────────────

export interface LootOpportunity {
  id: string;
  playerId: string;
  survivorIds: string[];
  target: ConflictTarget;
  revealedTokens: LootToken[];
  /** Max weapon/equipment tokens that can be taken (= total free item slots of survivors in group). Resources have no carry cap. */
  carryCapacity: number;
  claimed: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// GAME STATE
// ─────────────────────────────────────────────────────────────────────────────

export type GamePhase =
  | 'draft'
  | 'planning'
  | 'action_selection'
  | 'conflict_resolution'
  | 'looting'
  | 'upkeep'
  | 'game_over';

export interface GameEvent {
  round: number;
  phase: GamePhase;
  message: string;
  tags: string[];
}

export interface GameState {
  phase: GamePhase;
  round: number;

  // Draft
  draftPool: SurvivorTemplate[];
  draftOrder: string[];
  currentDraftIndex: number;
  picksPerPlayer: number;
  picksMade: Record<string, number>;

  players: PlayerState[];
  locations: LocationState[];

  pendingConflicts: PendingConflict[];
  craftResults: CraftRecap[];
  lootOpportunities: LootOpportunity[];
  /** Human players who've confirmed they're done reviewing this round's resolution reveal. */
  reviewReadyPlayerIds: string[];

  planningAllocations: Record<string, PlanningAllocations>;
  upkeepAllocations: Record<string, UpkeepAllocations>;
  jammedPlayerIds: string[];  // player IDs whose electric fence is blocked this round

  events: GameEvent[];
  winnerId?: string;

  rngSeed: number;
  rngCounter: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// REDUCER ACTIONS
// ─────────────────────────────────────────────────────────────────────────────

export type GameReducerAction =
  | { type: 'DRAFT_PICK'; playerId: string; survivorId: string }
  | { type: 'SUBMIT_INTENTS'; playerId: string; intents: SurvivorIntent[] }
  | { type: 'CLAIM_LOOT'; lootId: string; tokenIndices: number[]; assignments?: Record<number, string> }
  | { type: 'SUBMIT_PLANNING'; playerId: string; allocations: PlanningAllocations }
  | { type: 'TRANSFER_ITEM'; playerId: string; fromSurvivorId: string; toSurvivorId: string; itemIndex: number }
  | { type: 'EQUIP_FROM_COMPOUND'; playerId: string; itemIndex: number; toSurvivorId: string }
  | { type: 'UNEQUIP_TO_COMPOUND'; playerId: string; fromSurvivorId: string; itemIndex: number }
  | { type: 'SUBMIT_UPKEEP_ALLOCATION'; playerId: string; allocations: UpkeepAllocations }
  | { type: 'FORFEIT'; playerId: string }
  | { type: 'CONFIRM_REVIEW_READY'; playerId: string }
  | { type: 'AUTO_ADVANCE' };

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────

export interface LocationLootConfig {
  resources?: Partial<Record<ResourceType, number>>;
  weapons?: Partial<Record<WeaponId, number>>;
  equipment?: Partial<Record<EquipmentId, number>>;
}

export interface GameConfig {
  playerCount: number;
  playerNames: string[];
  /** Indices (0-based) of human-controlled players */
  humanPlayerIndices: number[];
  startingResources: Partial<Record<ResourceType, number>>;
  locationLootConfigs: Partial<Record<LocationId, LocationLootConfig>>;
  picksPerPlayer?: number;
  /** Whether winning side in conflict also takes -1 HP */
  winnerTakesDamage?: boolean;
  seed?: number;
  /** AI strategy per player slot. Defaults to 'balanced'. */
  aiStrategies?: AIStrategy[];
  /** Indices (0-based) of externally-controlled agent players (RL model, etc.) */
  agentPlayerIndices?: number[];
}

/**
 * Placeholder starting resources — tune these with the simulator.
 * Current values are deliberately generous so games can develop.
 * Key insight from sim: need at least ~2 rounds of water+food buffer per survivor.
 */
/**
 * Placeholder starting resources — tune these with the simulator.
 * Sim insight: food burns at 4/round (4 survivors × 1 action), water at 4/round.
 * Without scavenging recovery, you need ~2-3 rounds of buffer above expected gain.
 * TODO: sweep these values in sim to find the sweet spot for 8-15 round games.
 */
export const DEFAULT_STARTING_RESOURCES: Record<ResourceType, number> = {
  water: 20,
  food: 16,
  meds: 0,
  wood: 4,
  metal: 2,
  ammo: 0,
};

// ─────────────────────────────────────────────────────────────────────────────
// SIMULATION
// ─────────────────────────────────────────────────────────────────────────────

export interface SimulationResult {
  gameId: number;
  winnerId: string;
  winnerName: string;
  rounds: number;
  eliminated: { playerId: string; playerName: string; round: number }[];
}

export interface SimulationSummary {
  gamesPlayed: number;
  winCounts: Record<string, number>;
  winRates: Record<string, string>;
  avgRounds: number;
  minRounds: number;
  maxRounds: number;
}
