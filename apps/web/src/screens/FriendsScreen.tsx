/**
 * M9: Friends screen — friends, presence, requests, player search.
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../game/useAuth';
import { Avatar } from '../components/Avatar';

interface FriendEntry {
  userId: string;
  username: string;
  displayName: string;
  avatarId: string;
  rating: number;
  rankName: string;
  tier: string;
  friendsSince: string;
}

interface PresenceMap {
  [userId: string]: { state: string; activity: string };
}

interface SearchResult {
  userId: string;
  username: string;
  displayName: string;
  avatarId: string;
  rankName: string;
}

export function FriendsScreen({ onBack, onInvite }: { onBack: () => void; onInvite: (userId: string) => void }) {
  const { user, authFetch } = useAuth();
  const [friends, setFriends] = useState<FriendEntry[]>([]);
  const [presence, setPresence] = useState<PresenceMap>({});
  const [incoming, setIncoming] = useState<{ requestId: string; from: SearchResult }[]>([]);
  const [outgoing, setOutgoing] = useState<{ requestId: string; to: SearchResult }[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const load = useCallback(async () => {
    const [fRes, iRes, oRes] = await Promise.all([
      authFetch('/friends?limit=100'),
      authFetch('/friends/requests/incoming'),
      authFetch('/friends/requests/outgoing'),
    ]);
    if (fRes.ok) setFriends(((await fRes.json()) as { friends: FriendEntry[] }).friends);
    if (iRes.ok) setIncoming(((await iRes.json()) as { requests: typeof incoming }).requests);
    if (oRes.ok) setOutgoing(((await oRes.json()) as { requests: typeof outgoing }).requests);
  }, [authFetch]);

  useEffect(() => {
    load();
  }, [load]);

  // Presence via WebSocket (assumes the app's social socket is subscribed).
  // For now, presence is fetched on load; realtime updates come via the
  // notification socket in App (future: dedicated social WS hook).
  useEffect(() => {
    // Poll presence every 30s (lightweight; event-driven via WS is the goal).
    const t = window.setInterval(load, 30000);
    return () => window.clearInterval(t);
  }, [load]);

  const search = async () => {
    if (query.trim().length < 2) return;
    setSearching(true);
    try {
      const res = await authFetch(`/users/search?q=${encodeURIComponent(query.trim())}&limit=20`);
      if (res.ok) setResults(((await res.json()) as { users: SearchResult[] }).users);
    } finally {
      setSearching(false);
    }
  };

  const sendRequest = async (userId: string) => {
    await authFetch('/friends/requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    load();
    search();
  };

  const accept = async (requestId: string) => {
    await authFetch(`/friends/requests/${requestId}/accept`, { method: 'POST' });
    load();
  };

  const decline = async (requestId: string) => {
    await authFetch(`/friends/requests/${requestId}/decline`, { method: 'POST' });
    load();
  };

  const cancel = async (requestId: string) => {
    await authFetch(`/friends/requests/${requestId}`, { method: 'DELETE' });
    load();
  };

  const remove = async (userId: string) => {
    if (!window.confirm('Remove this friend?')) return;
    await authFetch(`/friends/${userId}`, { method: 'DELETE' });
    load();
  };

  const block = async (userId: string) => {
    if (!window.confirm('Block this user? This removes the friendship.')) return;
    await authFetch(`/blocks/${userId}`, { method: 'POST' });
    load();
  };

  if (!user) return <div className="screen"><p>Sign in to manage friends.</p></div>;

  const online = friends.filter((f) => presence[f.userId]?.state === 'ONLINE');
  const inGame = friends.filter((f) => presence[f.userId]?.state === 'IN_GAME');
  const offline = friends.filter(
    (f) => !presence[f.userId] || presence[f.userId]?.state === 'OFFLINE',
  );

  const row = (f: FriendEntry) => (
    <li key={f.userId} className="friend-row">
      <Avatar id={f.avatarId} size={36} />
      <div className="friend-info">
        <span className="friend-name">{f.displayName}</span>
        <span className="friend-meta">
          {f.rankName} · {presence[f.userId]?.activity ?? 'OFFLINE'}
        </span>
      </div>
      <div className="friend-actions">
        <button className="small" onClick={() => onInvite(f.userId)}>Invite</button>
        <button className="small secondary" onClick={() => remove(f.userId)}>Remove</button>
        <button className="small danger" onClick={() => block(f.userId)}>Block</button>
      </div>
    </li>
  );

  return (
    <div className="screen friends-screen">
      <button className="secondary back-btn" onClick={onBack}>← Menu</button>
      <h1>Friends</h1>

      {incoming.length > 0 && (
        <section>
          <h2>Pending Requests ({incoming.length})</h2>
          <ul className="friend-list">
            {incoming.map((r) => (
              <li key={r.requestId} className="friend-row">
                <Avatar id={r.from.avatarId} size={36} />
                <div className="friend-info">
                  <span className="friend-name">{r.from.displayName}</span>
                  <span className="friend-meta">@{r.from.username}</span>
                </div>
                <div className="friend-actions">
                  <button className="small primary" onClick={() => accept(r.requestId)}>Accept</button>
                  <button className="small secondary" onClick={() => decline(r.requestId)}>Decline</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {inGame.length > 0 && (
        <section>
          <h2>In Game ({inGame.length})</h2>
          <ul className="friend-list">{inGame.map(row)}</ul>
        </section>
      )}

      <section>
        <h2>Online ({online.length})</h2>
        {online.length === 0 ? (
          <p className="muted">No friends online right now.</p>
        ) : (
          <ul className="friend-list">{online.map(row)}</ul>
        )}
      </section>

      {offline.length > 0 && (
        <section>
          <h2>Offline ({offline.length})</h2>
          <ul className="friend-list">{offline.map(row)}</ul>
        </section>
      )}

      {outgoing.length > 0 && (
        <section>
          <h2>Sent Requests ({outgoing.length})</h2>
          <ul className="friend-list">
            {outgoing.map((r) => (
              <li key={r.requestId} className="friend-row">
                <Avatar id={r.to.avatarId} size={36} />
                <div className="friend-info">
                  <span className="friend-name">{r.to.displayName}</span>
                  <span className="friend-meta">Pending…</span>
                </div>
                <div className="friend-actions">
                  <button className="small secondary" onClick={() => cancel(r.requestId)}>Cancel</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2>Search Players</h2>
        <div className="search-bar">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
            placeholder="Username (min 2 chars)"
            minLength={2}
          />
          <button onClick={search} disabled={searching || query.trim().length < 2}>
            {searching ? '…' : 'Search'}
          </button>
        </div>
        <ul className="friend-list">
          {results.map((r) => (
            <li key={r.userId} className="friend-row">
              <Avatar id={r.avatarId} size={36} />
              <div className="friend-info">
                <span className="friend-name">{r.displayName}</span>
                <span className="friend-meta">@{r.username} · {r.rankName}</span>
              </div>
              <div className="friend-actions">
                <button className="small primary" onClick={() => sendRequest(r.userId)}>
                  Add Friend
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
