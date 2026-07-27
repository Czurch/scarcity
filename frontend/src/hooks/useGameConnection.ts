import { useCallback, useRef, useState } from 'react';
import type { GameState } from '@game/types';
import type { WebClientMessage, WebServerMessage, RoomSeatView } from '@game/server/webProtocol';

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'closed';

export interface RoomStateView {
  roomId: string;
  maxPlayers: number;
  status: 'lobby' | 'in_game' | 'game_over';
  seats: RoomSeatView[];
}

interface StoredSeat {
  url: string;
  playerId: string;
  rejoinToken: string;
}

const STORAGE_KEY = 'scarcity_seat';

export function getStoredSession(): StoredSeat | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredSeat) : null;
  } catch {
    return null;
  }
}

function storeSeat(seat: StoredSeat): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(seat));
}

function clearStoredSeat(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export interface UseGameConnection {
  status: ConnectionStatus;
  error: string | null;
  roomState: RoomStateView | null;
  gameState: GameState | null;
  myPlayerId: string | null;
  mySeatIndex: number | null;
  gameId: string | null;
  connectAndJoin: (url: string, name: string) => void;
  connectAndRejoin: (url: string) => boolean;
  send: (msg: WebClientMessage) => void;
  leave: () => void;
}

export function useGameConnection(): UseGameConnection {
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [roomState, setRoomState] = useState<RoomStateView | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [mySeatIndex, setMySeatIndex] = useState<number | null>(null);
  const [gameId, setGameId] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);

  const send = useCallback((msg: WebClientMessage) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(msg));
    }
  }, []);

  const attach = useCallback((url: string, onOpenMsg: WebClientMessage) => {
    socketRef.current?.close();

    const socket = new WebSocket(url);
    socketRef.current = socket;
    setStatus('connecting');
    setError(null);

    socket.onopen = () => {
      socket.send(JSON.stringify(onOpenMsg));
    };

    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data as string) as WebServerMessage;

      switch (msg.type) {
        case 'joined':
          setStatus('connected');
          setMyPlayerId(msg.playerId);
          setMySeatIndex(msg.seatIndex);
          storeSeat({ url, playerId: msg.playerId, rejoinToken: msg.rejoinToken });
          break;
        case 'room_state':
          setRoomState({ roomId: msg.roomId, maxPlayers: msg.maxPlayers, status: msg.status, seats: msg.seats });
          break;
        case 'error':
          setError(msg.message);
          break;
        case 'state_sync':
        case 'game_over':
        case 'game_start':
        case 'draft_request':
        case 'planning_request':
        case 'action_request':
        case 'loot_request':
        case 'upkeep_request':
          setGameState(msg.state);
          setGameId(msg.gameId);
          break;
        default:
          break;
      }
    };

    socket.onclose = () => {
      setStatus('closed');
      socketRef.current = null;
    };

    socket.onerror = () => {
      setStatus('error');
      setError('Connection error');
    };
  }, []);

  const connectAndJoin = useCallback((url: string, name: string) => {
    attach(url, { type: 'join', name });
  }, [attach]);

  const connectAndRejoin = useCallback((url: string): boolean => {
    const stored = getStoredSession();
    if (!stored || stored.url !== url) return false;
    attach(url, { type: 'rejoin', playerId: stored.playerId, rejoinToken: stored.rejoinToken });
    return true;
  }, [attach]);

  const leave = useCallback(() => {
    socketRef.current?.close();
    socketRef.current = null;
    clearStoredSeat();
    setStatus('idle');
    setRoomState(null);
    setGameState(null);
    setMyPlayerId(null);
    setMySeatIndex(null);
    setGameId(null);
  }, []);

  return { status, error, roomState, gameState, myPlayerId, mySeatIndex, gameId, connectAndJoin, connectAndRejoin, send, leave };
}
