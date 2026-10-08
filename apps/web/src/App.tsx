import { useCallback, useState } from 'react';
import { MainMenu } from './screens/MainMenu';
import { GameScreen } from './screens/GameScreen';
import { buildSeats, type Seat } from './game/useGame';
import './styles/tokens.css';
import './styles/app.css';
import './styles/board.css';
import './styles/screens.css';

interface Session {
  seats: Seat[];
  seed?: number | undefined;
  autopilot: boolean;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(() => {
    // Deep-link support: ?autopilot=1[&seed=N][&fast=1] boots straight into a game (E2E + demos).
    if (typeof window === 'undefined') return null;
    const q = new URLSearchParams(window.location.search);
    if (q.has('autopilot') || q.has('seed') || q.has('quick')) {
      const autopilot = q.get('autopilot') === '1';
      const seed = q.get('seed') ? Number(q.get('seed')) : undefined;
      return {
        seats: buildSeats(q.get('name') ?? 'Skipper', autopilot),
        seed,
        autopilot,
      };
    }
    return null;
  });

  const start = useCallback(
    (opts: { name: string; seed?: number; autopilot: boolean }) => {
      setSession({
        seats: buildSeats(opts.name, opts.autopilot),
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

  if (!session) return <MainMenu onStart={start} />;
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
