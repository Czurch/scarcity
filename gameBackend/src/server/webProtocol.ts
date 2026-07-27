import { GameState } from '../types';
import { ServerMessage, AgentMessage } from './protocol';

// ─────────────────────────────────────────────────────────────────────────────
// LOBBY (pre-game): client ↔ server, before a GameEngine exists for the room
// ─────────────────────────────────────────────────────────────────────────────

export type LobbyClientMessage =
  | { type: 'join'; name: string }
  | { type: 'rejoin'; playerId: string; rejoinToken: string }
  | { type: 'start_game' }; // host (seat 0) only

export interface RoomSeatView {
  index: number;
  playerId: string | null;
  name: string | null;
  connected: boolean;
}

export type LobbyServerMessage =
  | { type: 'room_state'; roomId: string; maxPlayers: number; status: 'lobby' | 'in_game' | 'game_over'; seats: RoomSeatView[] }
  | { type: 'joined'; seatIndex: number; playerId: string; rejoinToken: string }
  | { type: 'error'; message: string };

// ─────────────────────────────────────────────────────────────────────────────
// IN-GAME: reuses ServerMessage/AgentMessage from protocol.ts (identical shapes
// already work for humans) and adds only what agents don't need.
// ─────────────────────────────────────────────────────────────────────────────

export type HumanClientMessage =
  | AgentMessage
  | { type: 'transfer_item_request'; gameId: string; playerId: string; fromSurvivorId: string; toSurvivorId: string; itemIndex: number }
  | { type: 'equip_from_compound_request'; gameId: string; playerId: string; itemIndex: number; toSurvivorId: string }
  | { type: 'unequip_to_compound_request'; gameId: string; playerId: string; fromSurvivorId: string; itemIndex: number }
  | { type: 'review_ready_request'; gameId: string; playerId: string }
  | { type: 'forfeit_request'; gameId: string; playerId: string };

export type HumanServerMessage =
  | ServerMessage
  | { type: 'state_sync'; gameId: string; state: GameState };

// ─────────────────────────────────────────────────────────────────────────────
// Combined wire types for a single WebSocket connection to the web server
// ─────────────────────────────────────────────────────────────────────────────

export type WebClientMessage = LobbyClientMessage | HumanClientMessage;
export type WebServerMessage = LobbyServerMessage | HumanServerMessage;
