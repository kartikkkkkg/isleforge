# DECISIONS

Durable technical and product decisions. Newest first.

## 2026-10-08 — Milestone 1 complete

1. **Original IP, deliberately.** The game is *inspired by* the Catan-style
   interaction model but shares no assets, text, or code with any existing
   product. Renamed for distance: Raider (not robber), Guardian/Trailblazer/
   Harvest/Embargo/Landmark cards, *Archipelago* as the base-game module,
   Isleforge as the platform. Mechanics themselves are not copied expression.
2. **TypeScript monorepo, engine-first.** The engine is a zero-dependency
   package so the browser UI, bots, and game server all share one rules
   implementation. No engine code will ever import UI or Node APIs.
3. **Event sourcing from the first commit.** Commands → validated → events →
   reducer. Replay, spectators, and anti-cheat fall out of this; retrofitting
   later would have been far more expensive.
4. **Probe-based legal-move enumeration.** `legalCommands` validates candidates
   by running them through `planCommand` on a throwaway RNG instead of
   duplicating rule logic — the enumerator cannot drift from the validator.
   This is also the bot interface for M3.
5. **Draft-based multi-event planning.** `planCommand` emits into a cloned
   draft so chained consequences (road → longest road → victory) see correct
   intermediate state, while `dispatch` stays atomic.
6. **Corner identity via rounded world positions.** Axial hex math with
   `toFixed`-style keys; notably, `-0.000` vs `0.000` was a real bug found by
   tests (topology came out 56 corners instead of 54) — normalized with `+0`.
7. **Classic bank-shortage rule.** If the bank can't cover everyone's share of
   a resource on a roll, nobody gets that resource (not proportional split).
8. **Longest road:** opponent settlements block *pass-through* but a road may
   still *end* at such a corner; ties keep the current holder; dropping below
   5 vacates the title (turn-order tiebreak for the vacant title).
9. **Largest army:** 3+ Guardians; same tie semantics as longest road.
10. **Landmark VP is silent.** Counts toward the 10 but never appears in public
    VP until it decides the game — matching the hidden-information model.
11. **No cheat commands.** Tests use white-box state fixtures via the exported
    `planCommand`/`applyEvent`, never a backdoor in the command surface.
12. **3–4 players in M1.** The board topology supports it; 5–8 player boards
    are an expansion (M13), not a config flag, because tile counts and ports
    must change.
13. **Two double-application bugs caught by tests** (embargo granted twice;
    bank trades charged twice) — both fixed by making transfer events atomic
    (`RESOURCE_STOLEN` / `BANK_TRADED` move both sides; no companion
    grant/payment events).
