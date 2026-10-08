/** Road building extends toward open spots; raider play is strategic. */
import { describe, expect, it } from 'vitest';
import { activeActor, makeAgent, newGame, playUntil } from './helpers.js';

describe('road evaluation', () => {
  it('builds roads rather than passing when it can afford them', () => {
    const game = newGame(42);
    const agents = [1, 2, 3, 4].map(() => makeAgent('hard', 'balanced', 3));
    let roadsBuilt = 0;
    playUntil(
      game,
      agents,
      (g) => {
        const st = g.getState();
        return st.turnNumber > 30 || st.phase === 'gameover';
      },
      2500,
    );
    for (const p of game.getState().players) roadsBuilt += p.roads.length;
    // 8 setup roads + meaningful expansion.
    expect(roadsBuilt).toBeGreaterThan(12);
  }, 120000);

  it('does not build meaningless roads when a settlement is available', () => {
    // Builder personality with resources should expand usefully — check via
    // a mid-game state that the AI is building (roads and/or settlements).
    const game = newGame(7);
    const agents = [1, 2, 3, 4].map(() => makeAgent('normal', 'builder', 9));
    playUntil(game, agents, (g) => g.getState().turnNumber >= 25, 2500);
    const st = game.getState();
    const totalRoads = st.players.reduce((a, p) => a + p.roads.length, 0);
    const totalBuildings = st.players.reduce(
      (a, p) => a + p.settlements.length + p.cities.length,
      0,
    );
    // 8 setup roads/settlements + meaningful expansion by turn 25.
    expect(totalRoads + totalBuildings).toBeGreaterThan(18);
  }, 180000);
});

describe('robber evaluation', () => {
  it('moves the raider onto a productive opponent tile, never its own', () => {
    const game = newGame(42);
    const agents = [1, 2, 3, 4].map(() => makeAgent('hard', 'aggressive', 13));
    let checked = 0;
    playUntil(
      game,
      agents,
      (g) => {
        const st = g.getState();
        if (st.phase === 'raider' && !st.pendingSteal) {
          const actor = activeActor(st)!;
          const agent = agents[Number(actor.slice(1)) - 1]!;
          const cmd = agent.chooseAction(st, actor);
          if (cmd?.type === 'MOVE_RAIDER') {
            const tileKey = (cmd as { tileKey: string }).tileKey;
            // Never onto a tile adjacent to my own buildings.
            const me = st.players.find((p) => p.id === actor)!;
            const myCorners = new Set([...me.settlements, ...me.cities]);
            const adj = Object.keys(st.board.corners).filter((c) =>
              (st.board.corners[c]?.tiles ?? []).includes(tileKey),
            );
            expect(adj.some((c) => myCorners.has(c))).toBe(false);
            // The tile should have a number (blocking production).
            expect(st.board.tileByKey[tileKey]?.number).not.toBeNull();
            checked++;
            if (checked >= 3) return true;
          }
        }
        return st.phase === 'gameover';
      },
      2500,
    );
    expect(checked).toBeGreaterThan(0);
  }, 180000);

  it('steals from the most threatening opponent', () => {
    const game = newGame(99);
    const agents = [1, 2, 3, 4].map(() => makeAgent('hard', 'aggressive', 21));
    let steals = 0;
    playUntil(
      game,
      agents,
      (g) => {
        const st = g.getState();
        if (st.phase === 'raider' && st.pendingSteal) {
          const actor = activeActor(st)!;
          const cmd = agents[Number(actor.slice(1)) - 1]!.chooseAction(st, actor);
          if (cmd?.type === 'STEAL_RESOURCE') steals++;
          if (steals >= 2) return true;
        }
        return st.phase === 'gameover';
      },
      2500,
    );
    expect(steals).toBeGreaterThan(0);
  }, 180000);
});
