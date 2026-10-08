# SECURITY

Milestone 1 is a local engine; this document records the trust model it
establishes and what each later milestone must add. The core invariant,
already enforced: **assume every client is malicious — the engine validates
everything and never trusts caller-supplied state.**

## Enforced in the engine (M1)

- **Full command validation.** `planCommand` re-derives legality from current
  state for every command: turn order, phase, resources, costs, board
  occupancy, road connectivity, settlement distance rule, port ownership,
  trade balances, card ownership/playability/timing, raider adjacency.
- **No client-controlled randomness.** Dice, steals, and card draws use the
  server-side (here: engine-side) seeded RNG; outcomes are recorded in events.
  Clients cannot submit dice values, steal choices, or victory claims.
- **Atomic dispatch.** A rejected command leaves state untouched; there is no
  partial application to exploit.
- **No cheat paths.** There is deliberately no "set resources" command; tests
  use white-box fixtures outside the command surface.
- **Hidden information.** `publicView()` masks dev-card identities; resource
  counts stay public per the rules. The engine never leaks card types through
  public projections.
- **Deterministic replay.** The event log fully determines state, enabling
  post-game cheat review (M5/M9): any disputed game can be re-simulated and
  every command re-validated.

## Threats deferred to later milestones

| Threat | Milestone | Planned mitigation |
|---|---|---|
| Forged/mutated client state | M5 | Authoritative server owns `Game`; clients send commands only |
| Replay/duplicate commands | M5 | Per-game sequence numbers, idempotency on `seq` |
| Unauthenticated play, impersonation | M4 | Auth (email/Google/Discord/Apple), signed sessions |
| Room griefing, spam | M6/M11 | Host controls, chat rate limiting, spam protection, mute/block/report |
| Matchmaking abuse (smurfing, win-trading) | M7/M8 | Transparent MMR, anomaly detection on match history |
| Spectator info leaks | M10 | `publicView` projections only; never full state |
| Payment fraud | M17 | Cosmetics-only currency; server-side entitlement checks |
| Data loss, injection, secret leaks | M18 | PostgreSQL + Redis per spec, parameterized queries, secret management, audits |

## Dependency posture

`@isleforge/game-engine` has **zero runtime dependencies** — no supply-chain
attack surface in the rules core. Dev dependencies (vitest, typescript, tsx)
are pinned via lockfile.
