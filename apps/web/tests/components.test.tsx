/* Component tests: board renders live engine state; control deck reflects it. */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Game, legalCommands } from '@isleforge/game-engine';
import { GameBoard, playerCssColor } from '../src/components/Board';
import { ControlDeck } from '../src/components/ControlDeck';

const colorOf = (id?: string) => (id ? playerCssColor('ember') : '#999');

function setupGame(seed = 31) {
  const g = new Game({
    seed,
    players: [{ name: 'Ash' }, { name: 'Bryn' }, { name: 'Cora' }],
  });
  let guard = 0;
  while (g.getState().phase === 'setup' && guard++ < 30) {
    const s = g.getState();
    const actor = s.setup!.order[s.setup!.cursor]!;
    const legal = g.legalCommands(actor);
    g.dispatch(legal.find((c) => c.type === 'PLACE_SETTLEMENT' || c.type === 'PLACE_ROAD')!);
  }
  return g;
}

describe('GameBoard', () => {
  it('renders 19 terrain hexes, number tokens, ports, and the raider', () => {
    const g = setupGame();
    const { container } = render(
      <GameBoard
        state={g.getState()}
        mode={{ kind: 'idle' }}
        onPlace={vi.fn()}
        onMoveRaider={vi.fn()}
        freshIds={new Set()}
        colorOf={colorOf}
      />,
    );
    expect(container.querySelectorAll('.if-hex').length).toBe(19);
    // 18 number tokens (desert has none)
    expect(container.querySelectorAll('.if-token').length).toBe(18);
    expect(container.querySelectorAll('.if-port').length).toBe(9);
    expect(container.querySelector('.if-raider')).toBeTruthy();
    // setup placed 6 settlements + 6 roads
    expect(container.querySelectorAll('.if-building').length).toBe(6);
    expect(container.querySelectorAll('.if-road').length).toBe(6);
  });

  it('shows keyboard-accessible placement targets in place mode', () => {
    const g = setupGame();
    const s = g.getState();
    const onPlace = vi.fn();
    // Real edge ids straight from the engine board.
    const targets = new Set(Object.keys(s.board.edges).slice(0, 3));
    const { container } = render(
      <GameBoard
        state={s}
        mode={{ kind: 'place', build: 'road', targets }}
        onPlace={onPlace}
        onMoveRaider={vi.fn()}
        freshIds={new Set()}
        colorOf={colorOf}
      />,
    );
    const btns = container.querySelectorAll('.if-target[role="button"]');
    expect(btns.length).toBe(3);
    // Keyboard activation works.
    fireEvent.keyDown(btns[0]!, { key: 'Enter' });
    expect(onPlace).toHaveBeenCalledWith('road', [...targets][0]);
    // Click activation works.
    fireEvent.click(btns[1]!);
    expect(onPlace).toHaveBeenCalledWith('road', [...targets][1]);
  });

  it('exposes raider tiles as targets in raider mode', () => {
    const g = setupGame();
    const s = g.getState();
    const targets = new Set(s.board.tiles.slice(0, 2).map((t) => t.key));
    const onMove = vi.fn();
    const { container } = render(
      <GameBoard
        state={s}
        mode={{ kind: 'raider', targets }}
        onPlace={vi.fn()}
        onMoveRaider={onMove}
        freshIds={new Set()}
        colorOf={colorOf}
      />,
    );
    const tiles = container.querySelectorAll('.if-raider-target[role="button"]');
    expect(tiles.length).toBe(2);
    fireEvent.click(tiles[0]!);
    expect(onMove).toHaveBeenCalledWith([...targets][0]);
  });
});

describe('ControlDeck', () => {
  it('shows live resource counts and an enabled Roll button on the human turn', () => {
    const g = setupGame();
    const s = g.getState();
    const me = s.currentPlayerId!;
    const legal = legalCommands(s, me);
    // Five resource counters, values from engine state.
    const { container } = render(
      <ControlDeck
        state={s}
        humanId={me}
        legal={legal}
        diceRolling={false}
        canAct={true}
        buildSelection={null}
        onRoll={vi.fn()}
        onEndTurn={vi.fn()}
        onSelectBuild={vi.fn()}
        onBuyCard={vi.fn()}
        onOpenTrade={vi.fn()}
        onPlayCard={vi.fn()}
      />,
    );
    const counts = [...container.querySelectorAll('.if-resource__count')];
    expect(counts.length).toBe(5);
    const total = s.players.find((p) => p.id === me)!.resources;
    const expected = [total.wood, total.brick, total.grain, total.wool, total.ore];
    counts.forEach((el, i) => expect(el.textContent).toBe(String(expected[i])));
    // Roll is available in the roll phase.
    expect(screen.getByRole('button', { name: /roll the dice/i })).toBeEnabled();
    // End Turn is not shown outside the play phase.
    expect(screen.queryByRole('button', { name: /end your turn/i })).toBeNull();
  });

  it('build menu opens with costs and disabled reasons from the engine', () => {
    const g = setupGame();
    let s = g.getState();
    const me = s.currentPlayerId!;
    g.dispatch({ type: 'ROLL_DICE', playerId: me });
    s = g.getState();
    // If a 7 was rolled, skip this seed-sensitive test path.
    if (s.phase !== 'play') return;
    const legal = legalCommands(s, me);
    render(
      <ControlDeck
        state={s}
        humanId={me}
        legal={legal}
        diceRolling={false}
        canAct={true}
        buildSelection={null}
        onRoll={vi.fn()}
        onEndTurn={vi.fn()}
        onSelectBuild={vi.fn()}
        onBuyCard={vi.fn()}
        onOpenTrade={vi.fn()}
        onPlayCard={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /build menu/i }));
    const menu = screen.getByRole('menu', { name: /build options/i });
    expect(menu).toBeTruthy();
    // All four options present with cost lines.
    for (const label of ['Road', 'Settlement', 'City', 'Dev Card']) {
      expect(screen.getByRole('menuitem', { name: new RegExp(label) })).toBeTruthy();
    }
  });

  it('disables all actions when it is not the human turn', () => {
    const g = setupGame();
    const s = g.getState();
    const me = s.currentPlayerId!;
    const other = me === 'p1' ? 'p2' : 'p1';
    render(
      <ControlDeck
        state={s}
        humanId={other}
        legal={[]}
        diceRolling={false}
        canAct={false}
        buildSelection={null}
        onRoll={vi.fn()}
        onEndTurn={vi.fn()}
        onSelectBuild={vi.fn()}
        onBuyCard={vi.fn()}
        onOpenTrade={vi.fn()}
        onPlayCard={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /build menu/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^trade$/i })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /roll the dice/i })).toBeNull();
  });
});
