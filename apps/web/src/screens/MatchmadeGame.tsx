/* MatchmadeGameFlow — enter a matchmade game via RECONNECT. */

import { useMultiplayer } from '../game/useMultiplayerGame';
import { GameScreen } from './GameScreen';

export function MatchmadeGameFlow({
  serverUrl,
  sessionId,
  onQuit,
}: {
  serverUrl: string;
  sessionId: string;
  onQuit: () => void;
}) {
  const mp = useMultiplayer(serverUrl, { initialSessionId: sessionId });

  const quitToMenu = () => {
    mp.leaveRoom();
    onQuit();
  };

  if (!mp.api) {
    return (
      <div className="screen">
        <p className="muted">Joining match…</p>
        {mp.error && <p className="error">{mp.error}</p>}
        <button className="secondary" onClick={onQuit}>
          Cancel
        </button>
      </div>
    );
  }
  return (
    <GameScreen
      api={mp.api}
      seats={mp.api.seats}
      autopilot={false}
      onQuit={quitToMenu}
      onPlayAgain={quitToMenu}
    />
  );
}
