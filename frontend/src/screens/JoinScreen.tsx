import { useState } from 'react';
import type { UseGameConnection } from '../hooks/useGameConnection';
import { getStoredSession } from '../hooks/useGameConnection';

interface Props {
  conn: UseGameConnection;
}

const WS_BASE = import.meta.env.VITE_BACKEND_URL ?? 'ws://localhost:8787';
const HTTP_BASE = WS_BASE.replace(/^ws/, 'http');
const DEFAULT_MAX_PLAYERS = 4;

function roomUrl(roomId: string): string {
  return `${WS_BASE}/?room=${encodeURIComponent(roomId)}`;
}

export function JoinScreen({ conn }: Props) {
  const stored = getStoredSession();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [hosting, setHosting] = useState(false);
  const [hostError, setHostError] = useState<string | null>(null);

  async function handleHost() {
    if (!name.trim()) return;
    setHosting(true);
    setHostError(null);
    try {
      const res = await fetch(`${HTTP_BASE}/api/rooms`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to create room');
      const { roomId } = (await res.json()) as { roomId: string };
      conn.connectAndJoin(`${roomUrl(roomId)}&maxPlayers=${DEFAULT_MAX_PLAYERS}`, name.trim());
    } catch {
      setHostError('Could not reach the server. Try again.');
    } finally {
      setHosting(false);
    }
  }

  return (
    <div className="screen join-screen">
      <h1>Scarcity</h1>

      {stored && (
        <button type="button" className="resume-button" onClick={() => conn.connectAndRejoin(stored.url)}>
          Resume previous session
        </button>
      )}

      <label>
        Your name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
      </label>

      <button type="button" disabled={!name.trim() || hosting} onClick={handleHost}>
        {hosting ? 'Creating lobby…' : 'Host new game'}
      </button>
      {hostError && <p className="error-text">{hostError}</p>}

      <p className="join-divider">— or join with a code —</p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() && code.trim()) conn.connectAndJoin(roomUrl(code.trim().toUpperCase()), name.trim());
        }}
      >
        <label>
          Lobby code
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABCDE"
            maxLength={8}
          />
        </label>
        <button type="submit" disabled={conn.status === 'connecting' || !name.trim() || !code.trim()}>
          {conn.status === 'connecting' ? 'Connecting…' : 'Join'}
        </button>
      </form>
    </div>
  );
}
