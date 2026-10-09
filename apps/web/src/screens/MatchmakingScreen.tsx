/**
 * M7: matchmaking queue screen. PLAY ONLINE → Finding players → Match found → game.
 */
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../game/useAuth';

type Phase = 'queuing' | 'found';

interface MatchPlayer {
  userId: string;
  displayName: string;
}

export function MatchmakingScreen({
  serverUrl,
  mode,
  onGameStart,
  onCancel,
}: {
  serverUrl: string;
  mode: 'CASUAL' | 'RANKED';
  onGameStart: (game: { gameId: string; playerId: string; sessionId: string }) => void;
  onCancel: () => void;
}) {
  const { user, authFetch } = useAuth();
  const [phase, setPhase] = useState<Phase>('queuing');
  const [playersSearching, setPlayersSearching] = useState(1);
  const [estimatedWaitMs, setEstimatedWaitMs] = useState(20000);
  const [matchPlayers, setMatchPlayers] = useState<MatchPlayer[]>([]);
  const [rating, setRating] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [sessionInfo, setSessionInfo] = useState<{ gameId: string; playerId: string; sessionId: string } | null>(null);
  const sessionRef = useRef<{ sessionId: string } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('isleforge_access_token');
    if (!token) {
      setError('Sign in to play matchmaking.');
      return;
    }
    const ws = new WebSocket(serverUrl);
    wsRef.current = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ v: 1, type: 'AUTHENTICATE', accessToken: token }));
    };
    ws.onmessage = (ev) => {
      let msg: { type: string; [k: string]: unknown };
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      switch (msg.type) {
        case 'AUTHENTICATED':
          ws.send(JSON.stringify({ v: 1, type: 'QUEUE_JOIN', mode }));
          break;
        case 'QUEUE_JOINED':
          ws.send(JSON.stringify({ v: 1, type: 'QUEUE_STATUS' }));
          break;
        case 'QUEUE_STATUS':
          if (msg['status'] === 'QUEUED') {
            setPlayersSearching((msg['playersSearching'] as number) ?? 1);
            setEstimatedWaitMs((msg['estimatedWaitMs'] as number) ?? 20000);
            // Refresh status periodically.
            setTimeout(() => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ v: 1, type: 'QUEUE_STATUS' }));
              }
            }, 3000);
          }
          break;
        case 'MATCH_FOUND':
          setMatchPlayers((msg['players'] as MatchPlayer[]) ?? []);
          setPhase('found');
          break;
        case 'MATCH_STARTING':
          sessionRef.current = { sessionId: msg['sessionId'] as string };
          setSessionInfo({
            gameId: '',
            playerId: msg['playerId'] as string,
            sessionId: msg['sessionId'] as string,
          });
          break;
        case 'GAME_STARTED':
          onGameStart({
            gameId: msg['gameId'] as string,
            playerId: msg['playerId'] as string,
            sessionId: sessionRef.current?.sessionId ?? '',
          });
          break;
        case 'MATCH_ERROR':
          setError((msg['message'] as string) ?? 'Matchmaking error.');
          break;
      }
    };
    ws.onerror = () => setError('Connection lost.');

    // Fetch MMR for display.
    authFetch('/me/rating')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setRating(d.rating);
      })
      .catch(() => {});

    return () => {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ v: 1, type: 'QUEUE_LEAVE' }));
        }
      } catch { /* ignore */ }
      ws.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverUrl, mode]);

  const cancel = () => {
    try {
      wsRef.current?.send(JSON.stringify({ v: 1, type: 'QUEUE_LEAVE' }));
    } catch { /* ignore */ }
    onCancel();
  };

  const waitSecs = Math.round(estimatedWaitMs / 1000 / 5) * 5;

  return (
    <div className="screen matchmaking-screen">
      <div className="mode-badge">{mode === 'RANKED' ? 'RANKED' : 'CASUAL'}</div>
      {phase === 'queuing' && (
        <>
          <h1>Finding players…</h1>
          {rating != null && <p className="mmr-line">MMR: {rating.toLocaleString()}</p>}
          <div className="queue-stats">
            <div>
              <span className="queue-num">{playersSearching}</span>
              <span className="queue-label">searching</span>
            </div>
            <div>
              <span className="queue-num">~{waitSecs}s</span>
              <span className="queue-label">estimated wait</span>
            </div>
          </div>
          <div className="spinner" aria-label="Searching" />
          {error && <p className="error">{error}</p>}
          <button className="primary large" onClick={cancel}>
            Cancel
          </button>
        </>
      )}
      {phase === 'found' && (
        <>
          <h1>{mode === 'RANKED' ? 'Ranked match found!' : 'Match found!'}</h1>
          <ul className="match-players">
            {matchPlayers.map((p) => (
              <li key={p.userId}>{p.displayName}</li>
            ))}
          </ul>
          <p className="muted">Starting game…</p>
        </>
      )}
      {!user && <p className="muted">Guests can't use matchmaking — sign in first.</p>}
    </div>
  );
}
