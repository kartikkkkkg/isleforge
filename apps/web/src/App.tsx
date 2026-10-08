import { useCallback, useState } from 'react';
import { MainMenu } from './screens/MainMenu';
import { GameScreen } from './screens/GameScreen';
import { OnlineGameFlow } from './screens/OnlineGame';
import { buildSeats, type AiSetup, type Seat } from './game/useGame';
import './styles/tokens.css';
import './styles/app.css';
import './styles/board.css';
import './styles/screens.css';

interface Session {
  seats: Seat[];
  seed?: number | undefined;
  autopilot: boolean;
}

const DEFAULT_AI: AiSetup = { count: 3, difficulty: 'normal', personality: 'varied' };

/** WebSocket server URL: override with ?server=ws://host:port for LAN play. */
const serverUrl = (): string => {
  if (typeof window === 'undefined') return 'ws://localhost:8080';
  return new URLSearchParams(window.location.search).get('server') ?? 'ws://localhost:8080';
};

export default function App() {
  const [online, setOnline] = useState(false);
  const [session, setSession] = useState<Session | null>(() => {
    // Deep-link support: ?autopilot=1[&seed=N][&fast=1] boots straight into a game (E2E + demos).
    if (typeof window === 'undefined') return null;
    const q = new URLSearchParams(window.location.search);
    if (q.has('autopilot') || q.has('seed') || q.has('quick')) {
      const autopilot = q.get('autopilot') === '1';
      const seed = q.get('seed') ? Number(q.get('seed')) : undefined;
      return {
        seats: buildSeats(q.get('name') ?? 'Skipper', autopilot, DEFAULT_AI),
        seed,
        autopilot,
      };
    }
    return null;
  });

  const start = useCallback(
    (opts: { name: string; seed?: number; autopilot: boolean; ai: AiSetup }) => {
      setSession({
        seats: buildSeats(opts.name, opts.autopilot, opts.ai),
        seed: opts.seed,
        autopilot: opts.autopilot,
      });
    },
    [],
  );

  const quit = useCallback(() => {
    setSession(null);
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  if (online) {
    return <OnlineGameFlow serverUrl={serverUrl()} onQuit={() => setOnline(false)} />;
  }
  if (!session) return <MainMenu onStart={start} onPlayOnline={() => setOnline(true)} />;
  return (
    <GameScreen
      key={`${session.autopilot}-${session.seed ?? 'random'}-${session.seats.map((s) => s.name).join(',')}`}
      seats={session.seats}
      seed={session.seed}
      autopilot={session.autopilot}
      onQuit={quit}
    />
  );
}
