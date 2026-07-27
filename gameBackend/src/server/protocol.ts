import { GameState, SurvivorIntent, UpkeepAllocations, PlanningAllocations } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// SERVER → AGENT
// ─────────────────────────────────────────────────────────────────────────────

export type ServerMessage =
  | { type: 'game_start';       gameId: string; playerId: string; playerName: string; state: GameState }
  | { type: 'draft_request';    gameId: string; playerId: string; state: GameState }
  | { type: 'planning_request'; gameId: string; playerId: string; state: GameState }
  | { type: 'action_request';   gameId: string; playerId: string; state: GameState }
  | { type: 'loot_request';     gameId: string; playerId: string; lootId: string; state: GameState }
  | { type: 'upkeep_request';   gameId: string; playerId: string; state: GameState }
  | { type: 'game_over';        gameId: string; winnerId: string | undefined; state: GameState };

// ─────────────────────────────────────────────────────────────────────────────
// AGENT → SERVER
// ─────────────────────────────────────────────────────────────────────────────

export type AgentMessage =
  | { type: 'draft_response';    gameId: string; playerId: string; survivorId: string }
  | { type: 'planning_response'; gameId: string; playerId: string; allocations: PlanningAllocations }
  | { type: 'action_response';   gameId: string; playerId: string; intents: SurvivorIntent[] }
  | { type: 'loot_response';     gameId: string; playerId: string; lootId: string; tokenIndices: number[]; assignments?: Record<number, string> }
  | { type: 'upkeep_response';   gameId: string; playerId: string; allocations: UpkeepAllocations };
