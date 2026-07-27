import { useState } from 'react';
import type { UseGameConnection } from '../hooks/useGameConnection';
import { getStoredSession } from '../hooks/useGameConnection';

interface Props {
  conn: UseGameConnection;
}

export function JoinScreen({ conn }: Props) {
  const stored = getStoredSession();
  const [url, setUrl] = useState(stored?.url ?? 'ws://localhost:8080');
  const [name, setName] = useState('');

  return (
    <div className="screen join-screen">
      <h1>Scarcity</h1>

      {stored && stored.url === url && (
        <button type="button" className="resume-button" onClick={() => conn.connectAndRejoin(url)}>
          Resume previous session
        </button>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) conn.connectAndJoin(url, name.trim());
        }}
      >
        <label>
          Server address
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="ws://host:8080" />
        </label>
        <label>
          Your name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
        </label>
        <button type="submit" disabled={conn.status === 'connecting' || !name.trim()}>
          {conn.status === 'connecting' ? 'Connecting…' : 'Join'}
        </button>
      </form>
    </div>
  );
}
