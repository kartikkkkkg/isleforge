import { useCallback, useState } from 'react';
import { MainMenu } from './screens/MainMenu';
import { GameScreen } from './screens/GameScreen';
import { OnlineGameFlow } from './screens/OnlineGame';
import { LoginScreen } from './screens/LoginScreen';
import { RegisterScreen } from './screens/RegisterScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { MatchHistoryScreen } from './screens/MatchHistoryScreen';
import { GameDetailScreen } from './screens/GameDetailScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { AuthProvider, useAuth } from './game/useAuth';
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

type Screen = 'menu' | 'login' | 'register' | 'profile' | 'settings' | 'history' | 'game-detail';

function Shell() {
  const [online, setOnline] = useState(false);
  const [screen, setScreen] = useState<Screen>('menu');
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const { logout } = useAuth();
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

  const goMenu = useCallback(() => {
    setScreen('menu');
    setOnline(false);
  }, []);

  if (online) {
    return <OnlineGameFlow serverUrl={serverUrl()} onQuit={() => setOnline(false)} />;
  }
  if (screen === 'login') {
    return (
      <LoginScreen
        onDone={goMenu}
        onSwitchToRegister={() => setScreen('register')}
        onBack={goMenu}
      />
    );
  }
  if (screen === 'register') {
    return (
      <RegisterScreen
        onDone={goMenu}
        onSwitchToLogin={() => setScreen('login')}
        onBack={goMenu}
      />
    );
  }
  if (screen === 'profile') {
    return (
      <ProfileScreen
        onBack={goMenu}
        onOpenSettings={() => setScreen('settings')}
        onOpenHistory={() => setScreen('history')}
      />
    );
  }
  if (screen === 'history') {
    return <MatchHistoryScreen onSelectGame={(id) => { setSelectedGameId(id); setScreen('game-detail'); }} />;
  }
  if (screen === 'game-detail' && selectedGameId) {
    return <GameDetailScreen gameId={selectedGameId} onBack={() => setScreen('history')} />;
  }
  if (screen === 'settings') {
    return <SettingsScreen onBack={goMenu} />;
  }
  if (!session) {
    return (
      <MainMenu
        onStart={start}
        onPlayOnline={() => setOnline(true)}
        onSignIn={() => setScreen('login')}
        onRegister={() => setScreen('register')}
        onProfile={() => setScreen('profile')}
        onSettings={() => setScreen('settings')}
        onLogout={() => {
          void logout();
          goMenu();
        }}
      />
    );
  }
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

export default function App() {
  return (
    <AuthProvider serverUrl={serverUrl()}>
      <Shell />
    </AuthProvider>
  );
}
