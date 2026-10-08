import { describe, expect, it } from 'vitest';
import {
  EngineError,
  publicGameState,
  replayEvents,
  tileResource,
  totalResources,
  victoryPoints,
  type Command,
  type GameState,
} from '../src/index.js';
import { mulberry32 } from '../src/rng.js';
import { Game } from '../src/index.js';
import {
  boosted,
  completeSetup,
  expectEngineError,
  newGame,
  runCmd,
  scriptedRng,
  toPlay,
} from './helpers.js';

describe('game creation', () => {
  it('creates a game in setup phase with a snake order', () => {
    const g = newGame(10);
    const s = g.getState();
    expect(s.phase).toBe('setup');
    expect(s.setup?.order).toEqual(['p1', 'p2', 'p3', 'p4', 'p4', 'p3', 'p2', 'p1']);
    expect(s.setup?.expecting).toBe('settlement');
    expect(s.players).toHaveLength(4);
    expect(s.devDeck).toHaveLength(25);
    expect(s.events).toHaveLength(1);
    expect(s.events[0]?.type).toBe('GAME_CREATED');
  });

  it('rejects invalid player counts and duplicate colors', () => {
    expect(() => new Game({ seed: 1, players: [{ name: 'A' }, { name: 'B' }] })).toThrow(EngineError);
    expect(() =>
      new Game({
        seed: 1,
        players: [
          { name: 'A', color: 'ember' },
          { name: 'B', color: 'ember' },
          { name: 'C' },
        ],
      }),
    ).toThrow(EngineError);
    expect(() => new Game({ seed: 1, players: [{ name: 'A' }, { name: 'B' }, { name: '' }] })).toThrow(
      EngineError,
    );
  });

  it('starts from the same state for the same seed (reset semantics)', () => {
    const a = JSON.stringify(newGame(77).getState().events);
    const b = JSON.stringify(newGame(77).getState().events);
    expect(a).toBe(b);
  });
});

describe('setup phase', () => {
  it('completes with 2 settlements + 2 roads per player and grants resources on round 2', () => {
    const g = newGame(21);
    const s = completeSetup(g);
    for (const p of s.players) {
      expect(p.settlements).toHaveLength(2);
      expect(p.roads).toHaveLength(2);
    }
    const total = s.players.reduce((sum, p) => sum + totalResources(p.resources), 0);
    expect(total).toBeGreaterThan(0);
    expect(s.phase).toBe('roll');
    expect(s.currentPlayerId).toBe('p1');
    expect(s.turnNumber).toBe(1);
  });

  it('follows the snake order in setup events', () => {
    const g = newGame(22);
    completeSetup(g);
    const order = g
      .getEvents()
      .filter((e) => e.type === 'SETUP_PLACED' && e.data.kind === 'settlement')
      .map((e) => e.playerId);
    expect(order).toEqual(['p1', 'p2', 'p3', 'p4', 'p4', 'p3', 'p2', 'p1']);
  });

  it('enforces the distance rule during setup', () => {
    const g = newGame(23);
    const s0 = g.getState();
    const actor = s0.setup!.order[0]!;
    const first = g.legalCommands(actor).find((c) => c.type === 'PLACE_SETTLEMENT');
    if (!first || first.type !== 'PLACE_SETTLEMENT') throw new Error('no setup move');
    g.dispatch(first);
    const road = g.legalCommands(actor).find((c) => c.type === 'PLACE_ROAD');
    if (!road) throw new Error('no road move');
    g.dispatch(road);
    // now it is the next player's settlement turn: settling adjacent to the
    // existing settlement must fail the distance rule
    const s1 = g.getState();
    const next = s1.setup!.order[s1.setup!.cursor]!;
    const corner = s1.board.corners[first.cornerId]!;
    const neighbor = corner.neighbors[0]!;
    expectEngineError(
      () => g.dispatch({ type: 'PLACE_SETTLEMENT', playerId: next, cornerId: neighbor }),
      'DISTANCE_RULE',
    );
  });

  it('requires the setup road to touch the new settlement', () => {
    const g = newGame(24);
    const s0 = g.getState();
    const actor = s0.setup!.order[0]!;
    const settlement = g.legalCommands(actor).find((c) => c.type === 'PLACE_SETTLEMENT');
    if (!settlement) throw new Error('no setup move');
    g.dispatch(settlement);
    // any edge far away from the settlement must be rejected
    const s1 = g.getState();
    const cornerId = (settlement as { cornerId: string }).cornerId;
    const farEdge = Object.keys(s1.board.edges).find((e) => {
      const cs = s1.board.edges[e]!.corners;
      return !cs.includes(cornerId);
    })!;
    expectEngineError(
      () => g.dispatch({ type: 'PLACE_ROAD', playerId: actor, edgeId: farEdge }),
      'NO_ROAD_CONNECTION',
    );
  });

  it('rejects out-of-turn setup placements', () => {
    const g = newGame(25);
    const s0 = g.getState();
    const actor = s0.setup!.order[0]!;
    const other = s0.setup!.order[1]!;
    const legal = g.legalCommands(actor).find((c) => c.type === 'PLACE_SETTLEMENT');
    if (!legal || legal.type !== 'PLACE_SETTLEMENT') throw new Error('no setup move');
    expectEngineError(
      () => g.dispatch({ ...legal, playerId: other }),
      'NOT_YOUR_TURN',
    );
  });
});

describe('dice and production', () => {
  function productionScenario(seed: number) {
    const g = newGame(seed);
    completeSetup(g);
    const base = g.getState();
    // Fixture: give p1 a settlement next to a numbered tile.
    const s: GameState = structuredClone(base);
    const tile = s.board.tiles.find((t) => t.number !== null)!;
    const cornerId = Object.keys(s.board.corners).find((cid) =>
      s.board.corners[cid]!.tiles.includes(tile.key),
    )!;
    const p1 = s.players[0]!;
    p1.settlements.push(cornerId);
    return { s, tile, cornerId, p1 };
  }

  it('produces resources on the rolled number', () => {
    const { s, tile } = productionScenario(31);
    const total = tile.number!;
    const d1 = Math.min(6, total - 1);
    const d2 = total - d1;
    const events = runCmd(
      s,
      { type: 'ROLL_DICE', playerId: s.currentPlayerId! },
      scriptedRng([d1, d2]),
    );
    const dice = events.find((e) => e.type === 'DICE_ROLLED');
    expect(dice?.type).toBe('DICE_ROLLED');
    if (dice?.type === 'DICE_ROLLED') expect(dice.data.total).toBe(total);
    const res = tileResource(tile)!;
    const grants = events.filter(
      (e) => e.type === 'RESOURCE_GRANTED' && e.data.resource === res && e.data.reason === 'production',
    );
    expect(grants.length).toBeGreaterThan(0);
    expect(s.phase).toBe('play');
  });

  it('cities produce double', () => {
    const { s, tile, cornerId, p1 } = productionScenario(32);
    p1.cities.push(cornerId);
    p1.settlements = p1.settlements.filter((c) => c !== cornerId);
    const total = tile.number!;
    const d1 = Math.min(6, total - 1);
    runCmd(s, { type: 'ROLL_DICE', playerId: s.currentPlayerId! }, scriptedRng([d1, total - d1]));
    // city owner may share the tile with other fixture-free players; at least the city got 2
    const got = s.players[0]!.resources[tileResource(tile)!];
    expect(got).toBeGreaterThanOrEqual(2);
  });

  it('the raider blocks production on its tile', () => {
    const { s, tile } = productionScenario(33);
    s.raiderTileKey = tile.key;
    const total = tile.number!;
    const d1 = Math.min(6, total - 1);
    const events = runCmd(
      s,
      { type: 'ROLL_DICE', playerId: s.currentPlayerId! },
      scriptedRng([d1, total - d1]),
    );
    const res = tileResource(tile)!;
    const grants = events.filter(
      (e) => e.type === 'RESOURCE_GRANTED' && e.data.resource === res,
    );
    // p1's fixture settlement is on the raider tile -> no grant to p1 for it.
    // (Other players might still earn from other tiles with the same number.)
    const p1Grants = grants.filter((e) => e.playerId === 'p1');
    expect(p1Grants).toHaveLength(0);
  });

  it('bank shortage means nobody gets that resource', () => {
    const { s, tile } = productionScenario(34);
    const res = tileResource(tile)!;
    s.bank[res] = 0;
    const total = tile.number!;
    const d1 = Math.min(6, total - 1);
    const events = runCmd(
      s,
      { type: 'ROLL_DICE', playerId: s.currentPlayerId! },
      scriptedRng([d1, total - d1]),
    );
    expect(events.filter((e) => e.type === 'RESOURCE_GRANTED' && e.data.resource === res)).toHaveLength(0);
  });

  it('dice values are always valid (many rolls)', () => {
    const g = newGame(35);
    completeSetup(g);
    for (let i = 0; i < 30; i++) {
      const s = g.getState();
      const actor = s.currentPlayerId!;
      const events = g.dispatch({ type: 'ROLL_DICE', playerId: actor });
      const dice = events.find((e) => e.type === 'DICE_ROLLED');
      if (dice?.type === 'DICE_ROLLED') {
        expect(dice.data.d1).toBeGreaterThanOrEqual(1);
        expect(dice.data.d1).toBeLessThanOrEqual(6);
        expect(dice.data.d2).toBeGreaterThanOrEqual(1);
        expect(dice.data.d2).toBeLessThanOrEqual(6);
        expect(dice.data.total).toBe(dice.data.d1 + dice.data.d2);
      }
      // finish the turn so the next roll is legal
      const s2 = g.getState();
      if (s2.phase === 'discard') {
        for (const [pid, need] of Object.entries(s2.pendingDiscards ?? {})) {
          const me = g.getState().players.find((p) => p.id === pid)!;
          const combo = { wood: 0, brick: 0, grain: 0, wool: 0, ore: 0 };
          let left = need;
          for (const r of ['wood', 'brick', 'grain', 'wool', 'ore'] as const) {
            const take = Math.min(me.resources[r], left);
            combo[r] = take;
            left -= take;
          }
          g.dispatch({ type: 'DISCARD_RESOURCES', playerId: pid, resources: combo });
        }
      }
      const s3 = g.getState();
      if (s3.phase === 'raider') {
        const tile = s3.board.tiles.find((t) => t.key !== s3.raiderTileKey)!;
        g.dispatch({ type: 'MOVE_RAIDER', playerId: actor, tileKey: tile.key });
        const s4 = g.getState();
        if (s4.pendingSteal) {
          const victims = g
            .legalCommands(actor)
            .filter((c) => c.type === 'STEAL_RESOURCE')
            .map((c) => (c as { targetPlayerId: string }).targetPlayerId);
          g.dispatch({ type: 'STEAL_RESOURCE', playerId: actor, targetPlayerId: victims[0]! });
        }
      }
      g.dispatch({ type: 'END_TURN', playerId: actor });
      if (g.getState().phase === 'gameover') break;
    }
  });

  it('rejects a second roll in the same turn', () => {
    const g = newGame(36);
    completeSetup(g);
    const actor = g.getState().currentPlayerId!;
    g.dispatch({ type: 'ROLL_DICE', playerId: actor });
    const s = g.getState();
    if (s.phase === 'play') {
      expectEngineError(() => g.dispatch({ type: 'ROLL_DICE', playerId: actor }), 'WRONG_PHASE');
    }
  });
});

describe('turn progression', () => {
  it('advances to the next player and increments the round on wrap', () => {
    const g = newGame(41);
    completeSetup(g);
    expect(g.getState().currentPlayerId).toBe('p1');
    // p1 rolls (forced non-7 via game rng is fine — handle raider/discard generically is overkill;
    // instead drive turns with legalCommands probing)
    for (const expected of ['p2', 'p3', 'p4', 'p1']) {
      const s = g.getState();
      const actor = s.currentPlayerId!;
      // move to a state where END_TURN is legal
      let guard = 0;
      while (g.getState().phase !== 'play' && guard++ < 10) {
        const st = g.getState();
        const legal = g.legalCommands(st.currentPlayerId ?? actor);
        const cmd = legal.find((c) => c.type !== 'END_TURN' && c.type !== 'RESIGN' && c.type !== 'TRADE_PROPOSE');
        if (!cmd) break;
        g.dispatch(cmd);
      }
      g.dispatch({ type: 'END_TURN', playerId: actor });
      expect(g.getState().currentPlayerId).toBe(expected);
    }
    expect(g.getState().turnNumber).toBe(2);
  });

  it('skips resigned players', () => {
    const g = newGame(42);
    completeSetup(g);
    g.dispatch({ type: 'RESIGN', playerId: 'p2' });
    const s = g.getState();
    expect(s.players.find((p) => p.id === 'p2')?.resigned).toBe(true);
    // p1 ends turn -> should go to p3
    let guard = 0;
    while (g.getState().phase !== 'play' && guard++ < 10) {
      const st = g.getState();
      const legal = g.legalCommands(st.currentPlayerId!);
      const cmd = legal.find((c) => c.type !== 'END_TURN' && c.type !== 'RESIGN' && c.type !== 'TRADE_PROPOSE');
      if (!cmd) break;
      g.dispatch(cmd);
    }
    g.dispatch({ type: 'END_TURN', playerId: 'p1' });
    expect(g.getState().currentPlayerId).toBe('p3');
  });

  it('ends the game when one player remains', () => {
    const g = newGame(43);
    completeSetup(g);
    g.dispatch({ type: 'RESIGN', playerId: 'p2' });
    g.dispatch({ type: 'RESIGN', playerId: 'p3' });
    g.dispatch({ type: 'RESIGN', playerId: 'p4' });
    const s = g.getState();
    expect(s.phase).toBe('gameover');
    expect(s.winnerId).toBe('p1');
    expect(s.events.some((e) => e.type === 'GAME_ENDED')).toBe(true);
  });

  it('rejects commands after game over', () => {
    const g = newGame(44);
    completeSetup(g);
    g.dispatch({ type: 'RESIGN', playerId: 'p2' });
    g.dispatch({ type: 'RESIGN', playerId: 'p3' });
    g.dispatch({ type: 'RESIGN', playerId: 'p4' });
    expectEngineError(() => g.dispatch({ type: 'ROLL_DICE', playerId: 'p1' }), 'WRONG_PHASE');
  });
});

describe('determinism', () => {
  function script(g: ReturnType<typeof newGame>): void {
    completeSetup(g);
    const cmds: Command[] = [];
    for (let i = 0; i < 6; i++) {
      const s = g.getState();
      if (s.phase === 'gameover') break;
      const actor = s.currentPlayerId!;
      cmds.push({ type: 'ROLL_DICE', playerId: actor });
      cmds.push({ type: 'END_TURN', playerId: actor });
    }
    // filter to commands legal at dispatch time
    for (const c of cmds) {
      const s = g.getState();
      if (s.phase === 'gameover') break;
      try {
        // END_TURN right after ROLL_DICE may hit discard/raider phases; skip those turns
        g.dispatch(c);
      } catch (e) {
        if (e instanceof EngineError && (e.code === 'WRONG_PHASE' || e.code === 'NOT_YOUR_TURN')) {
          // fast-forward the turn with probed legal moves
          let guard = 0;
          while (g.getState().phase !== 'play' && guard++ < 12) {
            const st = g.getState();
            const who =
              st.phase === 'discard' && st.pendingDiscards
                ? Object.keys(st.pendingDiscards)[0]!
                : (st.currentPlayerId ?? st.setup?.order[st.setup.cursor] ?? null);
            if (!who) break;
            const legal = g.legalCommands(who);
            const cmd = legal.find(
              (x) => x.type !== 'END_TURN' && x.type !== 'RESIGN' && x.type !== 'TRADE_PROPOSE',
            );
            if (!cmd) break;
            g.dispatch(cmd);
          }
          const st2 = g.getState();
          if (st2.phase === 'play' && st2.currentPlayerId) {
            g.dispatch({ type: 'END_TURN', playerId: st2.currentPlayerId });
          }
        } else throw e;
      }
    }
  }

  it('same seed + same commands => identical event logs', () => {
    const a = newGame(55);
    const b = newGame(55);
    script(a);
    script(b);
    expect(JSON.stringify(a.getEvents())).toBe(JSON.stringify(b.getEvents()));
    expect(JSON.stringify(a.getState())).toBe(JSON.stringify(b.getState()));
  });

  it('different seeds diverge', () => {
    const a = newGame(56);
    const b = newGame(57);
    script(a);
    script(b);
    expect(JSON.stringify(a.getEvents())).not.toBe(JSON.stringify(b.getEvents()));
  });
});

describe('replay', () => {
  it('rebuilding from the event log reproduces the exact state', () => {
    const g = newGame(61);
    completeSetup(g);
    for (let i = 0; i < 4; i++) {
      const s = g.getState();
      if (s.phase === 'gameover') break;
      const actor = s.currentPlayerId!;
      g.dispatch({ type: 'ROLL_DICE', playerId: actor });
      let guard = 0;
      while (g.getState().phase !== 'play' && guard++ < 12) {
        const st = g.getState();
        if (st.phase === 'gameover') break;
        const who =
          st.phase === 'discard' && st.pendingDiscards
            ? Object.keys(st.pendingDiscards)[0]!
            : st.currentPlayerId!;
        const legal = g.legalCommands(who);
        const cmd = legal.find(
          (x) => x.type !== 'END_TURN' && x.type !== 'RESIGN' && x.type !== 'TRADE_PROPOSE',
        );
        if (!cmd) break;
        g.dispatch(cmd);
      }
      const st2 = g.getState();
      if (st2.phase === 'play') g.dispatch({ type: 'END_TURN', playerId: actor });
    }
    const live = g.getState();
    const replayed = replayEvents(g.getEvents());
    expect(JSON.stringify(replayed)).toBe(JSON.stringify(live));
  });

  it('rejects logs that do not start with GAME_CREATED', () => {
    expect(() => replayEvents([])).toThrow(EngineError);
  });
});

describe('hidden information', () => {
  it('publicView masks opponents dev-card types but not your own', () => {
    const g = newGame(71);
    completeSetup(g);
    const s = toPlay(boosted(g.getState(), { wood: 5, brick: 5, grain: 5, wool: 5, ore: 5 }));
    runCmd(s, { type: 'BUY_DEVELOPMENT_CARD', playerId: 'p1' }, mulberry32(9));
    const asP2 = publicGameState(s, 'p2');
    const p1cards = asP2.players.find((p) => p.id === 'p1')!.devCards;
    expect(p1cards).toHaveLength(1);
    expect(p1cards[0]!.type).toBe('hidden');
    const asP1 = publicGameState(s, 'p1');
    expect(asP1.players.find((p) => p.id === 'p1')!.devCards[0]!.type).not.toBe('hidden');
  });
});

describe('victory points bookkeeping', () => {
  it('counts settlements and cities', () => {
    const g = newGame(81);
    const s = completeSetup(g);
    const p1 = s.players[0]!;
    expect(victoryPoints(p1, s).public).toBe(2);
  });
});
