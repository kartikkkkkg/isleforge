/**
 * M9: social notifications — list, unread count, mark read.
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../game/useAuth';
import { Avatar } from '../components/Avatar';

interface Notification {
  id: string;
  type: string;
  actor: { userId: string; username: string; displayName: string; avatarId: string } | null;
  referenceId: string | null;
  readAt: string | null;
  createdAt: string;
}

const TYPE_TEXT: Record<string, string> = {
  FRIEND_REQUEST_RECEIVED: 'sent you a friend request.',
  FRIEND_REQUEST_ACCEPTED: 'accepted your friend request.',
  GAME_INVITE_RECEIVED: 'invited you to a game.',
};

export function useNotifications() {
  const { user, authFetch } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);

  const load = useCallback(async () => {
    if (!user) return;
    const res = await authFetch('/notifications');
    if (res.ok) {
      const data = (await res.json()) as { notifications: Notification[]; unread: number };
      setNotifications(data.notifications);
      setUnread(data.unread);
    }
  }, [user, authFetch]);

  useEffect(() => {
    load();
    const t = window.setInterval(load, 30000);
    return () => window.clearInterval(t);
  }, [load]);

  const markRead = async (id: string) => {
    await authFetch(`/notifications/${id}/read`, { method: 'POST' });
    load();
  };

  const markAllRead = async () => {
    await authFetch('/notifications/read-all', { method: 'POST' });
    load();
  };

  return { notifications, unread, markRead, markAllRead, reload: load };
}

export function NotificationsPanel({
  onClose,
  onAcceptInvite,
}: {
  onClose: () => void;
  onAcceptInvite: (inviteId: string) => void;
}) {
  const { notifications, unread, markRead, markAllRead } = useNotifications();

  return (
    <div className="notifications-panel">
      <div className="notifications-header">
        <h2>Notifications {unread > 0 && <span className="unread-badge">{unread}</span>}</h2>
        <div>
          <button className="small secondary" onClick={markAllRead}>Mark all read</button>
          <button className="small secondary" onClick={onClose}>Close</button>
        </div>
      </div>
      {notifications.length === 0 ? (
        <p className="muted">No notifications yet.</p>
      ) : (
        <ul className="notification-list">
          {notifications.map((n) => (
            <li key={n.id} className={n.readAt ? '' : 'unread'}>
              {n.actor && <Avatar id={n.actor.avatarId} size={32} />}
              <div className="notification-body">
                <span>
                  <strong>{n.actor?.displayName ?? 'Someone'}</strong>{' '}
                  {TYPE_TEXT[n.type] ?? n.type}
                </span>
                <span className="muted tiny">
                  {new Date(n.createdAt).toLocaleString()}
                </span>
                {n.type === 'GAME_INVITE_RECEIVED' && n.referenceId && !n.readAt && (
                  <button
                    className="small primary"
                    onClick={() => onAcceptInvite(n.referenceId!)}
                  >
                    Accept Invite
                  </button>
                )}
              </div>
              {!n.readAt && (
                <button className="small secondary" onClick={() => markRead(n.id)}>
                  ✓
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
