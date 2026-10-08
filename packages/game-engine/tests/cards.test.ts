import { describe, expect, it } from 'vitest';
import {
  totalResources,
  victoryPoints,
  type DevCardType,
  type GameState,
} from '../src/index.js';
import { mulberry32 } from '../src/rng.js';
import { boosted, completeSetup, expectEngineError, newGame, runCmd, scriptedRng } from './helpers.js';

function playState(seed = 301): GameState {
  const g = newGame(seed);
  const s = boosted(completeSetup(g), { wood: 10, brick: 10, grain: 10, wool: 10, ore: 10 });
  runCmd(s, { type: 'ROLL_DICE', playerId: 'p1' }, scriptedRng());
  if (s.phase !== 'play') throw new Error('fixture did not reach play phase');
  return s;
}

/** Put a playable card of the given type straight into p1's hand (white-box fixture). */
function giveCard(s: GameState, type: DevCardType, uid: string): void {
  s.players[0]!.devCards.push({ uid, type, playable: true });
}

describe('buying development cards', () => {
  it('costs 1 grain + 1 wool + 1 ore and draws from the deck', () => {
    const s = playState();
    const deckBefore = s.devDeck.length;
    const before = { ...s.players[0]!.resources };
    const events = runCmd(s, { type: 'BUY_DEVELOPMENT_CARD', playerId: 'p1' }, mulberry32(5));
    const bought = events.find((e) => e.type === 'CARD_PURCHASED');
    expect(bought?.type).toBe('CARD_PURCHASED');
    const p1 = s.players[0]!;
    expect(p1.devCards).toHaveLength(1);
    expect(p1.devCards[0]!.playable).toBe(false);
    expect(s.devDeck).toHaveLength(deckBefore - 1);
    expect(p1.resources.grain).toBe(before.grain - 1);
    expect(p1.resources.wool).toBe(before.wool - 1);
    expect(p1.resources.ore).toBe(before.ore - 1);
    if (bought?.type === 'CARD_PURCHASED') {
      expect(p1.devCards[0]!.type).toBe(bought.data.cardType);
    }
  });

  it('a bought card cannot be played until the next turn', () => {
    const s = playState(302);
    runCmd(s, { type: 'BUY_DEVELOPMENT_CARD', playerId: 'p1' }, mulberry32(6));
    const uid = s.players[0]!.devCards[0]!.uid;
    expectEngineError(
      () => runCmd(s, { type: 'PLAY_DEVELOPMENT_CARD', playerId: 'p1', cardUid: uid }),
      'CARD_NOT_PLAYABLE',
    );
  });

  it('TURN_STARTED makes held cards playable', () => {
    const s = playState(303);
    s.players[0]!.devCards.push({ uid: 'c1', type: 'guardian', playable: false });
    runCmd(s, { type: 'END_TURN', playerId: 'p1' });
    expect(s.players[0]!.devCards[0]!.playable).toBe(true);
  });

  it('rejects buying with an empty deck', () => {
    const s = playState(304);
    s.devDeck = [];
    expectEngineError(() => runCmd(s, { type: 'BUY_DEVELOPMENT_CARD', playerId: 'p1' }), 'EMPTY_DECK');
  });

  it('landmark cards add silent victory points and are never played', () => {
    const s = playState(305);
    giveCard(s, 'landmark', 'cL');
    const vpBefore = victoryPoints(s.players[0]!, s);
    // simulate the purchase path for a landmark via the deck
    s.devDeck.push('landmark');
    runCmd(s, { type: 'BUY_DEVELOPMENT_CARD', playerId: 'p1' }, mulberry32(1));
    const p1 = s.players[0]!;
    const vpAfter = victoryPoints(p1, s);
    expect(p1.devVictoryPoints).toBe(1);
    expect(vpAfter.total).toBe(vpBefore.total + 1);
    expect(vpAfter.public).toBe(vpBefore.public); // hidden from opponents
    expectEngineError(
      () => runCmd(s, { type: 'PLAY_DEVELOPMENT_CARD', playerId: 'p1', cardUid: 'cL' }),
      'INVALID_CARD',
    );
  });
});

describe('playing development cards', () => {
  it('guardian: +1 army, moves to the raider phase', () => {
    const s = playState(311);
    giveCard(s, 'guardian', 'cG');
    const events = runCmd(s, { type: 'PLAY_DEVELOPMENT_CARD', playerId: 'p1', cardUid: 'cG' });
    expect(s.players[0]!.guardiansPlayed).toBe(1);
    expect(s.players[0]!.devCards).toHaveLength(0);
    expect(s.phase).toBe('raider');
    expect(s.raiderReason).toBe('guardian');
    expect(events.some((e) => e.type === 'CARD_PLAYED')).toBe(true);
  });

  it('harvest: takes two named resources from the bank', () => {
    const s = playState(312);
    giveCard(s, 'harvest', 'cH');
    const before = { ...s.players[0]!.resources };
    runCmd(s, {
      type: 'PLAY_DEVELOPMENT_CARD',
      playerId: 'p1',
      cardUid: 'cH',
      params: { resources: ['wood', 'ore'] },
    });
    expect(s.players[0]!.resources.wood).toBe(before.wood + 1);
    expect(s.players[0]!.resources.ore).toBe(before.ore + 1);
    expectEngineError(
      () =>
        runCmd(s, {
          type: 'PLAY_DEVELOPMENT_CARD',
          playerId: 'p1',
          cardUid: 'cH',
          params: { resources: ['wood', 'ore'] },
        }),
      'CARD_NOT_HELD',
    );
  });

  it('harvest rejects bad params', () => {
    const s = playState(313);
    giveCard(s, 'harvest', 'cH');
    expectEngineError(
      () => runCmd(s, { type: 'PLAY_DEVELOPMENT_CARD', playerId: 'p1', cardUid: 'cH' }),
      'INVALID_CARD_PARAMS',
    );
  });

  it('embargo: takes every opponents resource of the named type', () => {
    const s = playState(314);
    giveCard(s, 'embargo', 'cE');
    s.players[1]!.resources.ore = 3;
    s.players[2]!.resources.ore = 2;
    s.players[3]!.resources.ore = 0;
    const before = s.players[0]!.resources.ore;
    runCmd(s, {
      type: 'PLAY_DEVELOPMENT_CARD',
      playerId: 'p1',
      cardUid: 'cE',
      params: { resource: 'ore' },
    });
    expect(s.players[1]!.resources.ore).toBe(0);
    expect(s.players[2]!.resources.ore).toBe(0);
    expect(s.players[0]!.resources.ore).toBe(before + 5);
  });

  it('only one development card per turn', () => {
    const s = playState(315);
    giveCard(s, 'harvest', 'cH1');
    giveCard(s, 'harvest', 'cH2');
    runCmd(s, {
      type: 'PLAY_DEVELOPMENT_CARD',
      playerId: 'p1',
      cardUid: 'cH1',
      params: { resources: ['wood', 'wood'] },
    });
    expectEngineError(
      () =>
        runCmd(s, {
          type: 'PLAY_DEVELOPMENT_CARD',
          playerId: 'p1',
          cardUid: 'cH2',
          params: { resources: ['wood', 'wood'] },
        }),
      'CARD_ALREADY_PLAYED',
    );
  });

  it('rejects playing cards you do not hold', () => {
    const s = playState(316);
    expectEngineError(
      () => runCmd(s, { type: 'PLAY_DEVELOPMENT_CARD', playerId: 'p1', cardUid: 'nope' }),
      'CARD_NOT_HELD',
    );
  });

  it('purchased cards cost resources (sanity on totals)', () => {
    const s = playState(317);
    const before = totalResources(s.players[0]!.resources);
    runCmd(s, { type: 'BUY_DEVELOPMENT_CARD', playerId: 'p1' }, mulberry32(11));
    expect(totalResources(s.players[0]!.resources)).toBe(before - 3);
  });
});
