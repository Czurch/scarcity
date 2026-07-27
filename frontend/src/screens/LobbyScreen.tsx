import type { UseGameConnection } from '../hooks/useGameConnection';

interface Props {
  conn: UseGameConnection;
}

export function LobbyScreen({ conn }: Props) {
  const room = conn.roomState;
  if (!room) return null;

  const isHost = conn.mySeatIndex === 0;
  const filledCount = room.seats.filter((s) => s.playerId !== null).length;

  return (
    <div className="screen lobby-screen">
      <h1>Lobby — Room {room.roomId}</h1>
      <ul className="seat-list">
        {room.seats.map((seat) => (
          <li key={seat.index} className={seat.connected ? 'connected' : 'disconnected'}>
            <span className="seat-index">Seat {seat.index + 1}</span>
            <span className="seat-name">{seat.name ?? '— empty (CPU) —'}</span>
            {seat.playerId && !seat.connected && <span className="seat-flag">disconnected</span>}
            {seat.playerId === conn.myPlayerId && <span className="seat-flag">you</span>}
          </li>
        ))}
      </ul>
      {isHost ? (
        <button type="button" disabled={filledCount < 1} onClick={() => conn.send({ type: 'start_game' })}>
          Start Game ({filledCount}/{room.maxPlayers} joined)
        </button>
      ) : (
        <p>Waiting for the host to start the game…</p>
      )}
    </div>
  );
}
