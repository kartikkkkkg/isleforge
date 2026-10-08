/* Integration: drive the real GameScreen — setup clicks, dice, log, bot turns.
   jsdom + fake timers stand in for the browser; every command still flows
   through the engine via the same dispatch pipeline the UI uses. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { GameScreen } from '../src/screens/GameScreen';
import { buildSeats } from '../src/game/useGame';

describe('GameScreen full flow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('human places setup pieces, rolls dice, and bots take their turns', async () => {
    const { container } = render(
      <GameScreen
        seats={buildSeats('Kartik', false)}
        seed={42}
        autopilot={false}
        onQuit={vi.fn()}
      />,
    );

    // Setup: human clicks glowing targets whenever it's their turn;
    // bots interleave automatically via the bot runner.
    for (let i = 0; i < 60; i++) {
      const target = container.querySelector('.if-target');
      if (target) {
        await act(async () => {
          fireEvent.click(target);
        });
      }
      await act(async () => {
        vi.advanceTimersByTime(1500);
      });
      const phase = container.querySelector('.if-topbar')?.textContent ?? '';
      if (!phase.includes('Setup')) break;
    }

    // Setup complete: 8 settlements + 8 roads (4 players × 2 each).
    expect(container.querySelectorAll('.if-building').length).toBe(8);
    expect(container.querySelectorAll('.if-road').length).toBe(8);

    // Human rolls first (p1 starts turn 1).
    const rollBtn = screen.getByRole('button', { name: /roll the dice/i });
    expect(rollBtn).toBeEnabled();
    await act(async () => {
      fireEvent.click(rollBtn);
    });

    // Dice show a real engine result.
    const dice = [...container.querySelectorAll('.if-die')].map((d) => d.textContent);
    expect(dice.length).toBe(2);
    for (const d of dice) {
      const n = Number(d);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(6);
    }

    // The game log narrated setup + the roll.
    const logText = container.querySelector('.if-log')?.textContent ?? '';
    expect(logText).toMatch(/placed a settlement/);
    expect(logText).toMatch(/rolled \d \+ \d = \d+/);

    // End the turn; bots play and the turn counter advances.
    const tradeBtn = screen.getByRole('button', { name: /^trade$/i });
    if (!tradeBtn.hasAttribute('disabled')) {
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /end your turn/i }));
      });
      for (let k = 0; k < 12; k++) {
        await act(async () => {
          vi.advanceTimersByTime(10000);
        });
        if (screen.queryByText('Turn 2')) break;
      }
      expect(screen.getByText('Turn 2')).toBeTruthy();
      // The human is back on turn and can act again.
      expect(screen.getByRole('button', { name: /roll the dice/i })).toBeEnabled();
    }
  }, 180000);

  it('autopilot mode plays on without a human and turns advance', async () => {
    const { container } = render(
      <GameScreen
        seats={buildSeats('Spectator', true)}
        seed={7}
        autopilot={true}
        onQuit={vi.fn()}
      />,
    );
    // Each timer advance fires one chained bot move (React flushes the next
    // timer between advances). A full game is ~1100 moves; here we verify
    // the loop runs cleanly through several turns. Full-game completion is
    // covered by tests/bot-fullgame.test.ts and the Playwright E2E suite.
    for (let i = 0; i < 150; i++) {
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      if (screen.queryByText('Turn 4')) break;
    }
    expect(screen.queryByText('Turn 4')).toBeTruthy();
    const logText = container.querySelector('.if-log')?.textContent ?? '';
    expect(logText).toMatch(/placed a settlement/);
    expect(logText).toMatch(/rolled \d \+ \d = \d+/);
    // No error toast appeared during autonomous play.
    expect(container.querySelector('.if-toasts')?.textContent).toBe('');
  }, 300000);
});
