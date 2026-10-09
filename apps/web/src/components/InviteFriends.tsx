/**
 * M9: Invite friends to a private room from the lobby.
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../game/useAuth';
import { Avatar } from '../components/Avatar';

interface Friend {
  userId: string;
  username: string;
  displayName: string;
  avatarId: string;
}

export function InviteFriends({ roomCode }: { roomCode: string }) {
  const { authFetch } = useAuth();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const res = await authFetch('/friends?limit=100');
    if (res.ok) {
      setFriends(((await res.json()) as { friends: Friend[] }).friends);
    }
  }, [authFetch]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const invite = async (userId: string) => {
    const res = await authFetch(`/rooms/${encodeURIComponent(roomCode)}/invites`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    if (res.ok) {
      setSent((s) => new Set(s).add(userId));
    }
  };

  if (!open) {
    return (
      <button className="secondary" onClick={() => setOpen(true)}>
        Invite Friends
      </button>
    );
  }

  return (
    <div className="invite-friends">
      <h3>Invite Friends</h3>
      {friends.length === 0 ? (
        <p className="muted">No friends yet. Add friends from the Friends screen.</p>
      ) : (
        <ul className="friend-list">
          {friends.map((f) => (
            <li key={f.userId} className="friend-row">
              <Avatar id={f.avatarId} size={32} />
              <div className="friend-info">
                <span className="friend-name">{f.displayName}</span>
              </div>
              <button
                className="small primary"
                disabled={sent.has(f.userId)}
                onClick={() => invite(f.userId)}
              >
                {sent.has(f.userId) ? 'Sent' : 'Invite'}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button className="secondary" onClick={() => setOpen(false)}>Close</button>
    </div>
  );
}
