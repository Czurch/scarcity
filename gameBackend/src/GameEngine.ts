import {
  GameState, GameConfig, GameReducerAction, SurvivorIntent, PlayerState,
  SurvivorAction, LocationId, LootOpportunity, UpkeepAllocations, PlanningAllocations,
} from './types';
import { createInitialState, gameReducer } from './engine/reducer';
import { generateAIIntents } from './engine/ai';

/**
 * Public API for the Scarcity game engine.
 * All state mutations go through dispatch() → gameReducer().
 * getState() returns a snapshot suitable for any renderer (CLI, Unity, web).
 */
export class GameEngine {
  private state: GameState;
  private history: GameReducerAction[] = [];

  constructor(config: GameConfig) {
    this.state = createInitialState(config);
  }

  // ── State ──────────────────────────────────────────────────────────────────

  getState(): Readonly<GameState> {
    return this.state;
  }

  getLogs(round?: number): GameState['events'] {
    if (round === undefined) return this.state.events;
    return this.state.events.filter((e) => e.round === round);
  }

  getLastRoundLogs(): GameState['events'] {
    return this.getLogs(this.state.round);
  }

  isGameOver(): boolean {
    return this.state.phase === 'game_over';
  }

  getWinner(): PlayerState | undefined {
    return this.state.players.find((p) => p.id === this.state.winnerId);
  }

  /**
   * Returns true if any human player still needs to act in the current phase.
   * The CLI uses this to decide whether to prompt for input.
   */
  isWaitingForHuman(): boolean {
    const { phase, players } = this.state;

    if (phase === 'draft') {
      const pickerId = this.state.draftOrder[this.state.currentDraftIndex % this.state.draftOrder.length];
      const picker = players.find((p) => p.id === pickerId);
      return picker?.isHuman ?? false;
    }

    if (phase === 'planning') {
      return players.some(
        (p) => p.isHuman && !p.isEliminated && !this.state.planningAllocations[p.id],
      );
    }

    if (phase === 'action_selection') {
      return players.some((p) => !p.isEliminated && p.isHuman && !p.intentsSubmitted);
    }

    if (phase === 'looting') {
      return this.state.lootOpportunities.some((o) => {
        if (o.claimed) return false;
        const player = players.find((p) => p.id === o.playerId);
        return player?.isHuman ?? false;
      });
    }

    if (phase === 'upkeep') {
      return players.some(
        (p) => p.isHuman && !p.isEliminated && !this.state.upkeepAllocations[p.id],
      );
    }

    return false;
  }

  // ── Human Player API ───────────────────────────────────────────────────────

  /** Draft phase: human picks a survivor. */
  draftPick(playerId: string, survivorId: string): void {
    this.dispatch({ type: 'DRAFT_PICK', playerId, survivorId });
  }

  /** Action selection: human submits all survivor intents at once. */
  submitIntents(playerId: string, intents: SurvivorIntent[]): void {
    this.dispatch({ type: 'SUBMIT_INTENTS', playerId, intents });
  }

  /** Looting: human claims a loot opportunity by choosing token indices, optionally assigning each to a specific survivor. */
  claimLoot(lootId: string, tokenIndices: number[], assignments?: Record<number, string>): void {
    this.dispatch({ type: 'CLAIM_LOOT', lootId, tokenIndices, assignments });
  }

  /** Action selection: move an item between two of the human player's survivors. */
  transferItem(playerId: string, fromSurvivorId: string, toSurvivorId: string, itemIndex: number): void {
    this.dispatch({ type: 'TRANSFER_ITEM', playerId, fromSurvivorId, toSurvivorId, itemIndex });
  }

  /** Planning: equip a weapon/equipment item sitting in compound storage onto a survivor. */
  equipFromCompound(playerId: string, itemIndex: number, toSurvivorId: string): void {
    this.dispatch({ type: 'EQUIP_FROM_COMPOUND', playerId, itemIndex, toSurvivorId });
  }

  /** Planning: unequip an item from a survivor back into compound storage (frees the slot). */
  unequipToCompound(playerId: string, fromSurvivorId: string, itemIndex: number): void {
    this.dispatch({ type: 'UNEQUIP_TO_COMPOUND', playerId, fromSurvivorId, itemIndex });
  }

  /** Planning: human submits per-survivor sustenance choices (equipment transfers use transferItem). */
  submitPlanning(playerId: string, allocations: PlanningAllocations): void {
    this.dispatch({ type: 'SUBMIT_PLANNING', playerId, allocations });
  }

  /** Resolution reveal: human confirms they're done reviewing this round's recap. Phase-agnostic, no gameplay effect. */
  confirmReviewReady(playerId: string): void {
    this.dispatch({ type: 'CONFIRM_REVIEW_READY', playerId });
  }

  /** Upkeep: human submits med heal choices. */
  submitUpkeepAllocation(playerId: string, allocations: UpkeepAllocations): void {
    this.dispatch({ type: 'SUBMIT_UPKEEP_ALLOCATION', playerId, allocations });
  }

  forfeit(playerId: string): void {
    this.dispatch({ type: 'FORFEIT', playerId });
  }

  isWaitingForAgent(): boolean {
    const { phase, players } = this.state;

    if (phase === 'draft') {
      const pickerId = this.state.draftOrder[this.state.currentDraftIndex % this.state.draftOrder.length];
      const picker = players.find((p) => p.id === pickerId);
      return picker?.isAgent ?? false;
    }

    if (phase === 'planning') {
      return players.some(
        (p) => p.isAgent && !p.isEliminated && !this.state.planningAllocations[p.id],
      );
    }

    if (phase === 'action_selection') {
      return players.some((p) => !p.isEliminated && p.isAgent && !p.intentsSubmitted);
    }

    if (phase === 'looting') {
      return this.state.lootOpportunities.some((o) => {
        if (o.claimed) return false;
        const player = players.find((p) => p.id === o.playerId);
        return player?.isAgent ?? false;
      });
    }

    if (phase === 'upkeep') {
      return players.some(
        (p) => p.isAgent && !p.isEliminated && !this.state.upkeepAllocations[p.id],
      );
    }

    return false;
  }

  // ── Auto-advance API ───────────────────────────────────────────────────────

  /**
   * Advance the game as far as possible without human or agent input.
   * AI players act, automatic phases resolve.
   * Stops when isWaitingForHuman(), isWaitingForAgent(), or isGameOver().
   */
  autoAdvance(): void {
    while (!this.isGameOver() && !this.isWaitingForHuman() && !this.isWaitingForAgent()) {
      this.dispatch({ type: 'AUTO_ADVANCE' });
    }
  }

  /**
   * Run the game to completion (all AI). Used by the simulation runner.
   * Returns the winning player id.
   */
  runToEnd(maxRounds = 200): string | undefined {
    let rounds = 0;
    while (!this.isGameOver() && rounds < maxRounds) {
      this.autoAdvance();
      if (this.isWaitingForHuman()) break;  // shouldn't happen in sim mode
      rounds++;
    }
    return this.state.winnerId;
  }

  // ── Query Helpers (useful for CLI / UI) ───────────────────────────────────

  /** Current draft picks per player. */
  getDraftPool() {
    return this.state.draftPool;
  }

  getCurrentDrafter(): PlayerState | undefined {
    if (this.state.phase !== 'draft') return undefined;
    const id = this.state.draftOrder[this.state.currentDraftIndex % this.state.draftOrder.length];
    return this.state.players.find((p) => p.id === id);
  }

  getPendingLootForPlayer(playerId: string): LootOpportunity | undefined {
    return this.state.lootOpportunities.find((o) => o.playerId === playerId && !o.claimed);
  }

  getAISuggestedIntents(playerId: string): SurvivorIntent[] {
    const player = this.state.players.find((p) => p.id === playerId);
    if (!player) return [];
    return generateAIIntents(this.state, player);
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private dispatch(action: GameReducerAction): void {
    this.history.push(action);
    this.state = gameReducer(this.state, action);
  }

  /** Export full action history — allows replaying a game deterministically. */
  exportHistory(): GameReducerAction[] {
    return [...this.history];
  }

  /** Snapshot current state as a plain JSON-serializable object. */
  snapshot(): string {
    return JSON.stringify(this.state, null, 2);
  }
}
