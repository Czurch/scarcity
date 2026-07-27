import { GameEngine } from '../GameEngine';
import { GameConfig, DEFAULT_STARTING_RESOURCES, GameState } from '../types';
import { ServerMessage } from './protocol';
import { WebClientMessage, WebServerMessage, LobbyServerMessage } from './webProtocol';

interface Seat {
  index: number;
  playerId: string | null;
  name: string | null;
  rejoinToken: string | null;
  socket: WebSocket | null;
}

/**
 * One hosted game. Owns the lobby (seat claiming) and, once started, drives the
 * GameEngine by broadcasting state to every connected seat and pushing *_request
 * messages to whichever human seats are currently pending — unlike session.ts's
 * serial one-transport loop, several seats can be pending at once here.
 */
export class Room {
  readonly roomId: string;
  readonly maxPlayers: number;

  private seats: Seat[];
  private status: 'lobby' | 'in_game' | 'game_over' = 'lobby';
  private engine: GameEngine | null = null;
  private gameId: string | null = null;

  constructor(roomId: string, maxPlayers: number) {
    this.roomId = roomId;
    this.maxPlayers = maxPlayers;
    this.seats = Array.from({ length: maxPlayers }, (_, index) => ({
      index, playerId: null, name: null, rejoinToken: null, socket: null,
    }));
  }

  handleConnection(socket: WebSocket): void {
    let boundSeat: Seat | null = null;

    socket.addEventListener('message', (event) => {
      let msg: WebClientMessage;
      try {
        msg = JSON.parse(event.data.toString());
      } catch {
        this.sendTo(socket, { type: 'error', message: 'Malformed message' });
        return;
      }

      if (!boundSeat) {
        if (msg.type === 'join') {
          boundSeat = this.handleJoin(socket, msg.name);
        } else if (msg.type === 'rejoin') {
          boundSeat = this.handleRejoin(socket, msg.playerId, msg.rejoinToken);
        } else {
          this.sendTo(socket, { type: 'error', message: 'Must join or rejoin first' });
        }
        return;
      }

      this.handleBoundMessage(boundSeat, msg);
    });

    socket.addEventListener('close', () => {
      if (boundSeat && boundSeat.socket === socket) {
        boundSeat.socket = null;
        this.broadcastRoomState();
      }
    });
  }

  // ── Lobby ──────────────────────────────────────────────────────────────────

  private handleJoin(socket: WebSocket, name: string): Seat | null {
    if (this.status !== 'lobby') {
      this.sendTo(socket, { type: 'error', message: 'Game already started' });
      return null;
    }
    const seat = this.seats.find((s) => s.playerId === null);
    if (!seat) {
      this.sendTo(socket, { type: 'error', message: 'Room is full' });
      return null;
    }
    seat.playerId = `player_${seat.index}`;
    seat.name = name;
    seat.rejoinToken = crypto.randomUUID();
    seat.socket = socket;
    this.sendTo(socket, { type: 'joined', seatIndex: seat.index, playerId: seat.playerId, rejoinToken: seat.rejoinToken });
    this.broadcastRoomState();
    return seat;
  }

  private handleRejoin(socket: WebSocket, playerId: string, rejoinToken: string): Seat | null {
    const seat = this.seats.find((s) => s.playerId === playerId);
    if (!seat || seat.rejoinToken !== rejoinToken) {
      this.sendTo(socket, { type: 'error', message: 'Invalid rejoin' });
      return null;
    }
    seat.socket = socket;
    this.sendTo(socket, { type: 'joined', seatIndex: seat.index, playerId: seat.playerId!, rejoinToken: seat.rejoinToken! });
    this.broadcastRoomState();
    if (this.status === 'in_game' && this.engine) {
      this.sendTo(socket, { type: 'state_sync', gameId: this.gameId!, state: this.engine.getState() });
      this.sendPendingRequests(this.engine.getState());
    }
    return seat;
  }

  private startGame(): void {
    if (this.status !== 'lobby') return;
    const filledSeats = this.seats.filter((s) => s.playerId !== null);
    if (filledSeats.length < 1) {
      this.broadcastError('Need at least 1 player to start');
      return;
    }

    const config: GameConfig = {
      playerCount: this.maxPlayers,
      playerNames: this.seats.map((s) => s.name ?? `CPU ${s.index + 1}`),
      humanPlayerIndices: filledSeats.map((s) => s.index),
      agentPlayerIndices: [],
      startingResources: { ...DEFAULT_STARTING_RESOURCES },
      locationLootConfigs: {},
      picksPerPlayer: 4,
      winnerTakesDamage: false,
    };

    this.engine = new GameEngine(config);
    this.gameId = `game_${Date.now()}`;
    this.status = 'in_game';
    this.broadcastRoomState();
    this.engine.autoAdvance();
    this.pushGameUpdates();
  }

  // ── In-game ────────────────────────────────────────────────────────────────

  private handleBoundMessage(seat: Seat, msg: WebClientMessage): void {
    if (msg.type === 'join' || msg.type === 'rejoin') return; // already bound, no-op

    if (msg.type === 'start_game') {
      if (seat.index !== 0) {
        this.sendTo(seat.socket!, { type: 'error', message: 'Only the host can start the game' });
        return;
      }
      this.startGame();
      return;
    }

    if (this.status !== 'in_game' || !this.engine) {
      this.sendTo(seat.socket!, { type: 'error', message: 'Game has not started' });
      return;
    }

    if (msg.playerId !== seat.playerId) {
      this.sendTo(seat.socket!, { type: 'error', message: 'Player id mismatch' });
      return;
    }

    switch (msg.type) {
      case 'draft_response':
        this.engine.draftPick(msg.playerId, msg.survivorId);
        break;
      case 'planning_response':
        this.engine.submitPlanning(msg.playerId, msg.allocations);
        break;
      case 'action_response':
        this.engine.submitIntents(msg.playerId, msg.intents);
        break;
      case 'loot_response': {
        const opp = this.engine.getState().lootOpportunities.find((o) => o.id === msg.lootId);
        if (!opp || opp.playerId !== seat.playerId) {
          this.sendTo(seat.socket!, { type: 'error', message: 'Not your loot to claim' });
          return;
        }
        this.engine.claimLoot(msg.lootId, msg.tokenIndices, msg.assignments);
        break;
      }
      case 'upkeep_response':
        this.engine.submitUpkeepAllocation(msg.playerId, msg.allocations);
        break;
      case 'transfer_item_request':
        this.engine.transferItem(msg.playerId, msg.fromSurvivorId, msg.toSurvivorId, msg.itemIndex);
        break;
      case 'equip_from_compound_request':
        this.engine.equipFromCompound(msg.playerId, msg.itemIndex, msg.toSurvivorId);
        break;
      case 'unequip_to_compound_request':
        this.engine.unequipToCompound(msg.playerId, msg.fromSurvivorId, msg.itemIndex);
        break;
      case 'review_ready_request':
        this.engine.confirmReviewReady(msg.playerId);
        break;
      case 'forfeit_request':
        this.engine.forfeit(msg.playerId);
        break;
      default:
        return;
    }

    this.engine.autoAdvance();
    this.pushGameUpdates();
  }

  private pushGameUpdates(): void {
    if (!this.engine || !this.gameId) return;
    const state = this.engine.getState();

    for (const seat of this.seats) {
      if (seat.socket) this.sendTo(seat.socket, { type: 'state_sync', gameId: this.gameId, state });
    }

    if (this.engine.isGameOver()) {
      const winner = this.engine.getWinner();
      for (const seat of this.seats) {
        if (seat.socket) {
          this.sendTo(seat.socket, { type: 'game_over', gameId: this.gameId, winnerId: winner?.id, state });
        }
      }
      this.status = 'game_over';
      return;
    }

    this.sendPendingRequests(state);
  }

  private sendPendingRequests(state: GameState): void {
    if (!this.gameId || !this.engine) return;
    const gameId = this.gameId;

    switch (state.phase) {
      case 'draft': {
        const drafter = this.engine.getCurrentDrafter();
        if (drafter?.isHuman) {
          this.sendToPlayer(drafter.id, { type: 'draft_request', gameId, playerId: drafter.id, state });
        }
        break;
      }
      case 'planning': {
        for (const p of state.players) {
          if (p.isHuman && !p.isEliminated && !state.planningAllocations[p.id]) {
            this.sendToPlayer(p.id, { type: 'planning_request', gameId, playerId: p.id, state });
          }
        }
        break;
      }
      case 'action_selection': {
        for (const p of state.players) {
          if (p.isHuman && !p.isEliminated && !p.intentsSubmitted) {
            this.sendToPlayer(p.id, { type: 'action_request', gameId, playerId: p.id, state });
          }
        }
        break;
      }
      case 'looting': {
        for (const opp of state.lootOpportunities) {
          if (opp.claimed) continue;
          const player = state.players.find((p) => p.id === opp.playerId);
          if (player?.isHuman) {
            this.sendToPlayer(player.id, { type: 'loot_request', gameId, playerId: player.id, lootId: opp.id, state });
          }
        }
        break;
      }
      case 'upkeep': {
        for (const p of state.players) {
          if (p.isHuman && !p.isEliminated && !state.upkeepAllocations[p.id]) {
            this.sendToPlayer(p.id, { type: 'upkeep_request', gameId, playerId: p.id, state });
          }
        }
        break;
      }
      default:
        break;
    }
  }

  private sendToPlayer(playerId: string, msg: ServerMessage): void {
    const seat = this.seats.find((s) => s.playerId === playerId);
    if (seat?.socket) this.sendTo(seat.socket, msg);
  }

  // ── Wire helpers ───────────────────────────────────────────────────────────

  private sendTo(socket: WebSocket, msg: WebServerMessage): void {
    if (socket.readyState !== 1 /* OPEN */) return;
    socket.send(JSON.stringify(msg));
  }

  private broadcastRoomState(): void {
    const msg: LobbyServerMessage = {
      type: 'room_state',
      roomId: this.roomId,
      maxPlayers: this.maxPlayers,
      status: this.status,
      seats: this.seats.map((s) => ({
        index: s.index, playerId: s.playerId, name: s.name, connected: s.socket !== null,
      })),
    };
    for (const seat of this.seats) {
      if (seat.socket) this.sendTo(seat.socket, msg);
    }
  }

  private broadcastError(message: string): void {
    for (const seat of this.seats) {
      if (seat.socket) this.sendTo(seat.socket, { type: 'error', message });
    }
  }
}
