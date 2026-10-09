# IsleForge — Social Architecture (Milestone 9)

## Friendship state model

`friendships` table: `requester_id`, `addressee_id`, `status` (`PENDING`/`ACCEPTED`).

- Direction-independent uniqueness via `LEAST/GREATEST` index.
- No self-friendship (CHECK constraint).
- Mutual pending requests auto-accept (no duplicates).
- All mutations server-authoritative via HTTP API.

## Block model

`blocks` table: composite PK (`blocker_id`, `blocked_id`). No self-blocking.

Blocking:
- removes friendships and pending requests (both directions)
- prevents friend requests (404 to avoid leaking block state)
- prevents game invitations
- hides blocked users from search
- blocks presence visibility

## Presence architecture

`PresenceManager` (in-memory, server-authoritative):

- `OFFLINE` — no active connections (after 15s grace)
- `ONLINE` — ≥1 active connection
- `IN_GAME` — seated in a live game (activity: "IN RANKED GAME", etc.)

Multi-tab: connection count per user. Stays ONLINE until the LAST connection
closes. Grace period prevents flicker on reconnect.

Presence changes fan out via `onChange` → `broadcastPresence` → only to
subscribed friends (not blocked).

## WebSocket events

Client → server: `SOCIAL_SUBSCRIBE`, `SOCIAL_UNSUBSCRIBE`.

Server → client:
- `PRESENCE_UPDATE` (userId, state, activity)
- `SOCIAL_NOTIFICATION` (kind, payload)
- `FRIEND_REQUEST_RECEIVED`, `FRIEND_REQUEST_ACCEPTED`, `FRIEND_REMOVED`

Only friends receive each other's presence. Blocked users are excluded.
Subscriptions are per-connection; reconnect requires re-subscribe.

## Invitation lifecycle

`game_invites`: `PENDING` → `ACCEPTED`/`DECLINED`/`EXPIRED`/`CANCELLED`.
5-minute expiry. Duplicate invites collapse to existing PENDING.

Accept flow validates: recipient, expiry, friendship, room exists/joinable,
not blocked. Returns room code; client joins via normal `JOIN_ROOM`.

## Authorization model

- Friend requests: only recipient can accept/decline; only requester can cancel.
- Invitations: inviter must hold a seat; target must be accepted friend.
- Notifications: users can only read their own.
- All IDs server-generated; no client-authoritative state.

## Privacy rules

Never expose: email, sessions, tokens, private room codes, game state.
Search returns public profile only. Blocked users hidden from search.
Presence activity is high-level ("IN GAME", never room codes).

## Rate limits

- `social_search`: 30/min
- `social_friend_request`: 10/min
- `social_invite`: 10/min

Reuse `RateLimiter`; no new infrastructure.

## Database schema

See `004_social.sql`: friendships, blocks, social_notifications,
game_invites. Indexes on requester, addressee, status, blocker, blocked,
recipient, unread, username search.

## Reconnect behavior

WS reconnect: re-authenticate, re-subscribe to social. Presence grace period
(15s) prevents OFFLINE flicker. Game seats use the existing 120s grace.
