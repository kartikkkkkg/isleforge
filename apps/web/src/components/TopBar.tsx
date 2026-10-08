/* TopBar: brand, game info, turn indicator, timer placeholder, menu. */

import { memo } from 'react';
import type { GameState } from '@isleforge/game-engine';
import { activeActor } from '../game/useGame';

const PHASE_LABEL: Record<string, string> = {
  setup: 'Setup',
  roll: 'Roll the dice',
  discard: 'Discard cards',
  raider: 'Move the raider',
  play: 'Build & trade',
  gameover: 'Game over',
};

interface TopBarProps {
  state: GameState;
  playerName: (id: string | null) => string;
  onOpenMenu: () => void;
  onOpenRules: () => void;
}

export const TopBar = memo(function TopBar({ state, playerName, onOpenMenu, onOpenRules }: TopBarProps) {
  // During setup the engine keeps currentPlayerId stale; the setup cursor is authoritative.
  const actorId = activeActor(state) ?? state.currentPlayerId;
  const turnName = state.phase === 'gameover' ? '—' : playerName(actorId);
  return (
    <header className="if-topbar">
      <div className="if-brand">
        <svg className="if-brand__mark" viewBox="0 0 32 32" aria-hidden="true">
          <polygon points="16,2 28,9 28,23 16,30 4,23 4,9" fill="none" stroke="#d8a94e" strokeWidth="2.5" />
          <polygon points="16,9 22,12.5 22,19.5 16,23 10,19.5 10,12.5" fill="#d8a94e" opacity="0.85" />
        </svg>
        <span className="if-brand__name">ISLEFORGE</span>
      </div>

      <div className="if-topbar__info">
        <span className="if-chip" data-tip="Current turn number" tabIndex={0}>
          Turn {state.turnNumber}
        </span>
        <span className="if-chip if-chip--gold" data-tip="Current game phase" tabIndex={0}>
          {PHASE_LABEL[state.phase] ?? state.phase}
        </span>
        {state.phase !== 'gameover' && (
          <span className="if-topbar__turn" aria-live="polite">
            <span className="if-turn-dot" />
            {turnName}'s turn
          </span>
        )}
      </div>

      <div className="if-topbar__right">
        <span className="if-chip" data-tip="Turn timer (coming with multiplayer)" tabIndex={0} aria-label="Turn timer, not active in local play">
          ⏱ --:--
        </span>
        <button className="if-icon-btn" onClick={onOpenRules} data-tip="Game rules" aria-label="Game rules">
          ?
        </button>
        <button className="if-icon-btn" onClick={onOpenMenu} data-tip="Game menu" aria-label="Game menu">
          ☰
        </button>
      </div>
    </header>
  );
});
