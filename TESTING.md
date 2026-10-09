# TESTING

## How to run

```bash
cd packages/game-engine
npm test          # vitest, 100 tests
npm run typecheck # strict TS over src + tests
npm run demo      # CLI smoke: full random games, replay-verified

cd ../ai
npm test          # vitest, AI unit/strategy/simulation tests
npm run simulate -- 100 normal   # 100-game AI-vs-AI acceptance run

cd ../../apps/web
npm test          # vitest, 21 UI tests

cd ../server
npm test          # vitest: rooms, game, integration, reconnect, security
npm run dev       # local server on :8080 (also: npm run dev:server from root)

cd ../../packages/protocol
npm test          # vitest, 18 protocol validation tests
```

## Strategy

- **Rule tests over code coverage.** Every game rule has direct tests:
  board generation, dice, production, building, roads/settlements/cities,
  trading, dev cards, raider, longest road, largest army, victory, turns,
  disconnect-free resign flow, replay reconstruction.
- **White-box fixtures + black-box flows.** Most tests drive the public
  `Game.dispatch` API end-to-end (setup → play). Resource-heavy scenarios use
  `planCommand`/`applyEvent` directly on cloned states with fixture resources —
  the exact code path `dispatch` wraps — so validation and reduction stay
  covered without cheat commands in the engine.
- **Probe-tested enumeration.** `legalCommands` is verified to agree with
  validation (e.g. unaffordable roads are neither listed nor buildable).
- **Determinism tests.** Same seed + same commands ⇒ byte-identical event
  logs and states; different seeds diverge.
- **Replay tests.** `replayEvents(game.getEvents())` deep-equals live state;
  logs not starting with `GAME_CREATED` are rejected.
- **Property-style sweeps.** 6/8 adjacency checked over 40 seeds; dice ranges
  over 30 rolls; topology invariants (54 corners / 72 edges / neighbor
  symmetry / coastal ports).

## Test files

| File | Covers |
|---|---|
| `board.test.ts` | Generation, terrain/number/port distribution, no adjacent 6/8, topology, determinism |
| `engine.test.ts` | Creation, setup snake draft, distance rule, dice, production (+raider block, bank shortage), turns, resign, determinism, replay, hidden info |
| `building.test.ts` | Roads/settlements/cities: costs, connectivity, distance rule, occupancy, Trailblazer free roads |
| `trading.test.ts` | Bank ratios (4:1/3:1/2:1), port ownership, propose/accept/decline, stale auto-decline, turn-end clearing |
| `cards.test.ts` | Buying, play timing (not same turn, one per turn), all five card effects, Landmark silence |
| `robber.test.ts` | 7 → discards (amounts, rounding, errors) → move → steal (victim/empty/invalid) |
| `scoring.test.ts` | Longest-road DFS (branches, blocked pass-through), title tie/loss rules, largest army, victory at 10 via builds/road swings/hidden points |

## Demo (manual verification)

`npm run demo` plays complete games with random legal moves through the real
`dispatch` pipeline, then replay-verifies each finished game from its event
log. It exercises setup, dice, discards, raider moves, steals, building,
trading, dev cards, and victory in combination — the closest thing to a
human playtest at this milestone.

## Later milestones

M5 adds multiplayer integration tests (authoritative server vs malicious
client). No milestone is complete until its tests pass.

## Milestone 2 — UI tests (`apps/web`)

```bash
cd apps/web
npm test            # vitest + jsdom: 21 tests
npx playwright install chromium   # one-time browser download
npm run e2e         # Playwright: critical flows (desktop + mobile viewports)
```

- **Unit:** log formatter (real engine events → text), demo-bot legality
  (every chosen move re-validated by the engine), build-menu availability,
  `activeActor` resolution.
- **Component (jsdom):** board renders 19 hexes / 18 tokens / 9 ports / raider
  from live state; placement targets are keyboard-accessible and dispatch;
  control deck shows live counts, enables Roll on the human turn, opens the
  build menu with engine-derived costs/reasons, and disables everything off-turn.
- **Integration (jsdom + fake timers):** the real GameScreen — human clicks
  setup targets interleaved with bot turns (8 settlements + 8 roads placed),
  rolls real dice, the log narrates it, ending the turn advances to Turn 2
  with the human back on roll; autopilot mode advances turns autonomously
  with no error toasts.
- **Bot full game (slow, ~70s):** `tests/bot-fullgame.test.ts` — the demo
  SimpleBot plays a complete seed-7 game against the real engine (1161 moves)
  to gameover; every move is legal by construction since `dispatch()` throws
  on illegal commands.
- **E2E (Playwright):** menu → start game; setup placement clicks; roll dice
  (real engine result, log narrates it); trade modal opens; end turn advances
  the turn counter; build menu shows all four options; player panels show VP;
  autopilot AI battle plays a complete game to the victory screen and
  Play Again resets cleanly. (Written and committed; the browser download was
  blocked by a flaky CDN in the dev sandbox, so E2E runs in CI / on first
  `npx playwright install`.)
- Engine's 100/100 tests still pass unchanged.

## Multiplayer testing (M4)

- **Protocol validation** (`packages/protocol`): every inbound shape —
  envelope, versions, room codes, names, commands, chat, reconnect — accepted
  or rejected with the right error code (18 tests).
- **Room lifecycle** (`apps/server/tests/rooms.test.ts`): create/join/leave,
  ready, AI seats, host migration, start gating, room close.
- **ServerGame** (`apps/server/tests/game.test.ts`): authoritative dispatch,
  idempotent `commandId`s, anti-spoofing, out-of-turn rejection, AI setup
  cascade, per-viewer event masking, masked snapshots.
- **Full-game integration** (`tests/integration.test.ts`): 4 bot-driven
  WebSocket clients play complete games to `GAME_ENDED`; asserts gapless
  monotonic event seqs from 0, client state == server authoritative masked
  state (JSON-equal), hidden dev-card types never leak, and a 2-human +
  2-server-AI variant.
- **Reconnect** (`tests/reconnect.test.ts`): mid-game drop → `RECONNECT`
  replays missed events gaplessly → snapshot → resume to `GAME_ENDED`;
  unknown sessions rejected; AI takeover keeps the game moving past the
  grace period.
- **Security** (`tests/security.test.ts`): malformed JSON, unknown types,
  wrong versions, oversized frames, spoofed playerIds, out-of-turn commands,
  duplicate `commandId`s (executed once), command/chat spam rate limits,
  seat hijack without session.
- **Manual multi-browser**: `npm run dev:server` + `npm run dev:web`, open
  2–4 windows (or LAN devices via `?server=ws://<host>:8080`), create/join by
  code, ready, start — verified during M4 development.

## Authentication testing (M5)

- **Database** (`packages/db/tests/db.test.ts`): migrations apply once,
  users/profiles CRUD, session rotation, audit-log secret guard — isolated
  embedded PostgreSQL.
- **Auth API** (`apps/server/tests/auth.test.ts`, 20 tests): registration
  (valid/duplicate/invalid/reserved/weak), login (email+username,
  no-enumeration, HttpOnly cookie, lockout), sessions (rotation, logout,
  logout-all, `/auth/me`), profile updates, password reset (single-use,
  no-enumeration).
- **WebSocket auth** (`tests/auth-ws.test.ts`): `AUTHENTICATE` binds userId,
  seats record the owner, bad tokens rejected, guests still play,
  cross-user `RECONNECT` rejected, owner reclaim works.
- **Auth security** (`tests/auth-security.test.ts`): SQL injection payloads,
  malformed/oversized bodies, refresh-token replay → family revocation,
  forged user ids impossible (no userId parameter), audit log contains no
  secrets, login rate limiting, password-reset enumeration resistance.

## Game history testing (M6)

- **Database** (`packages/db/tests/games.test.ts`, 7 tests): game creation,
  idempotent player inserts, idempotent completion, ordered events, stats
  fixtures (3 games → 2 wins/1 loss), zero-game stats (no NaN), cursor
  pagination, abandoned games excluded.
- **History API** (`apps/server/tests/history.test.ts`, 7 tests): auth
  required, cursor pagination, invalid cursor/limit clamping, participant-only
  detail/events (404 for others), stats endpoint, SQL injection resistance.
- **Integration** (`tests/history-integration.test.ts`): 2 authenticated humans
  + 1 server AI play a full game → `GAME_ENDED` → DB has game/players/events/
  stats → history API lists it → exactly one game row.
