/* OnlineGameFlow — lobby -> server-authoritative game using the shared UI. */

import { useCallback } from 'react';
import { useMultiplayer } from '../game/useMultiplayerGame';
import { OnlineLobby } from './OnlineLobby';
import { GameScreen } from './GameScreen';

export function OnlineGameFlow({
  serverUrl,
  onQuit,
}: {
  serverUrl: string;
  onQuit: () => void;
}) {
  const mp = useMultiplayer(serverUrl);

  const quitToMenu = useCallback(() => {
    mp.leaveRoom();
    onQuit();
  }, [mp, onQuit]);

  if (mp.phase === 'lobby' || !mp.api) {
    return <OnlineLobby mp={mp} serverUrl={serverUrl} onQuit={onQuit} />;
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
