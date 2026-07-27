import { useGameConnection } from './hooks/useGameConnection';
import { JoinScreen } from './screens/JoinScreen';
import { LobbyScreen } from './screens/LobbyScreen';
import { GameScreen } from './screens/GameScreen';

function App() {
  const conn = useGameConnection();

  let screen;
  if (conn.status !== 'connected' || !conn.roomState) {
    screen = <JoinScreen conn={conn} />;
  } else if (conn.roomState.status === 'lobby') {
    screen = <LobbyScreen conn={conn} />;
  } else {
    screen = <GameScreen conn={conn} />;
  }

  return (
    <div className="app">
      {conn.error && <div className="error-banner">{conn.error}</div>}
      {screen}
    </div>
  );
}

export default App;
