/* ProfileScreen — the captain's profile. Stats arrive in a later milestone. */

import { useAuth } from '../game/useAuth';
import { Avatar } from '../components/Avatar';

export function ProfileScreen({
  onBack,
  onOpenSettings,
}: {
  onBack: () => void;
  onOpenSettings: () => void;
}) {
  const { user, logout } = useAuth();
  if (!user) return null;

  const created = new Date(user.createdAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="if-menu">
      <div className="if-menu__hero">
        <h1 className="if-menu__title">ISLEFORGE</h1>
        <p className="if-menu__tag">Captain's profile.</p>
      </div>
      <div className="if-panel if-menu__card">
        <div className="if-profile__head">
          <Avatar id={user.avatarId} size={72} label={`${user.displayName}'s avatar`} />
          <div>
            <div className="if-profile__name">{user.displayName}</div>
            <div className="if-profile__sub">@{user.username}</div>
          </div>
        </div>
        <dl className="if-profile__facts">
          <div>
            <dt>Joined</dt>
            <dd>{created}</dd>
          </div>
          <div>
            <dt>Games played</dt>
            <dd className="if-profile__muted">Coming soon</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{user.emailVerified ? 'Verified' : 'Not verified'}</dd>
          </div>
        </dl>
        <div className="if-menu__btns">
          <button className="if-btn if-btn--ghost" onClick={onOpenSettings}>
            Account Settings
          </button>
          <button className="if-btn if-btn--ghost" onClick={onBack}>
            Back
          </button>
          <button
            className="if-btn if-btn--danger"
            onClick={() => {
              void logout();
              onBack();
            }}
          >
            Log Out
          </button>
        </div>
      </div>
    </div>
  );
}
