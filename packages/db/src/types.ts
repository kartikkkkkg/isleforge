/** Row types mirroring the 001_init schema. */
export interface UserRow {
  id: string;
  email: string;
  email_normalized: string;
  username: string;
  username_normalized: string;
  password_hash: string;
  status: 'active' | 'locked' | 'deleted';
  email_verified_at: Date | null;
  failed_login_count: number;
  locked_until: Date | null;
  created_at: Date;
  updated_at: Date;
  last_seen_at: Date | null;
}

export interface ProfileRow {
  user_id: string;
  display_name: string;
  avatar_id: string;
  country: string | null;
  locale: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface SessionRow {
  id: string;
  user_id: string;
  refresh_token_hash: string;
  family_id: string;
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  replaced_by: string | null;
  device_label: string | null;
  last_used_at: Date | null;
}

export interface PasswordResetRow {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: Date;
  expires_at: Date;
  used_at: Date | null;
}

export interface EmailVerificationRow {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: Date;
  expires_at: Date;
  used_at: Date | null;
}

/** Public account shape returned by /auth/me (never includes secrets). */
export interface PublicAccount {
  id: string;
  username: string;
  displayName: string;
  avatarId: string;
  emailVerified: boolean;
  createdAt: string;
}
