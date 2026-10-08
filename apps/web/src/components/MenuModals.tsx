/* Menu, rules, and game-end modals. */

import { useState } from 'react';
import {
  victoryPoints,
  type GameState,
} from '@isleforge/game-engine';
import { Modal, ConfirmModal } from './Modal';
import { Avatar, VpBadge } from './ui';
import { playerCssColor } from './Board';

/* ── Game menu ─────────────────────────────────────────────────── */
export function GameMenuModal({
  onClose,
  onOpenRules,
  onRestart,
  onResign,
  onQuitToMenu,
}: {
  onClose: () => void;
  onOpenRules: () => void;
  /** Omitted for online games (no restart there). */
  onRestart?: () => void;
  onResign: () => void;
  onQuitToMenu: () => void;
}) {
  const [confirm, setConfirm] = useState<'restart' | 'resign' | null>(null);
  if (confirm === 'restart' && onRestart) {
    return (
      <ConfirmModal
        title="Restart game?"
        message="The current game will be discarded and a new island will be forged."
        confirmLabel="Restart"
        onConfirm={onRestart}
        onClose={() => setConfirm(null)}
      />
    );
  }
  if (confirm === 'resign') {
    return (
      <ConfirmModal
        title="Resign?"
        message="You will resign from this game. Your buildings stay on the board."
        confirmLabel="Resign"
        danger
        onConfirm={onResign}
        onClose={() => setConfirm(null)}
      />
    );
  }
  return (
    <Modal title="Game menu" onClose={onClose}>
      <div className="if-menu-list">
        <button className="if-btn if-btn--ghost if-menu-list__btn" onClick={onClose}>
          Resume game
        </button>
        <button className="if-btn if-btn--ghost if-menu-list__btn" onClick={onOpenRules}>
          How to play
        </button>
        {onRestart && (
          <button className="if-btn if-btn--ghost if-menu-list__btn" onClick={() => setConfirm('restart')}>
            Restart game
          </button>
        )}
        <button className="if-btn if-btn--danger if-menu-list__btn" onClick={() => setConfirm('resign')}>
          Resign
        </button>
        <button className="if-btn if-btn--ghost if-menu-list__btn" onClick={onQuitToMenu}>
          Quit to menu
        </button>
      </div>
    </Modal>
  );
}

/* ── Rules ─────────────────────────────────────────────────────── */
const RULES_SECTIONS: [string, string][] = [
  ['Goal', 'Be the first to reach 10 victory points.'],
  ['Setup', 'Place settlements and roads in turn order, then reversed. Your second settlement grants starting resources from adjacent tiles.'],
  ['Turns', 'Roll the dice, collect resources from your tiles, then build, trade, and play cards in any order.'],
  ['Building', 'Road: 1 Wood + 1 Brick. Settlement: 1 Wood + 1 Brick + 1 Grain + 1 Wool. City (upgrades a settlement): 2 Grain + 3 Ore.'],
  ['The 7', 'Everyone holding more than 7 cards discards half. Then the roller moves the Raider, blocks a tile, and steals a card.'],
  ['Trading', 'Trade 4:1 with the bank, 3:1 or 2:1 with harbors, or propose deals to other players.'],
  ['Development cards', 'Cost 1 Grain + 1 Wool + 1 Ore. Guardian moves the raider (3+ earns Largest Army). Trailblazer grants 2 free roads. Harvest takes 2 resources. Embargo seizes one resource from everyone. Landmark is a hidden victory point.'],
  ['Longest Road', '5+ connected roads earn 2 VP. Opponents’ buildings break your road.'],
  ['Victory', 'Settlements 1 VP, cities 2 VP, Longest Road 2 VP, Largest Army 2 VP, Landmarks 1 VP each. First to 10 wins immediately.'],
];

export function RulesModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="How to play" onClose={onClose} wide>
      <div className="if-rules">
        {RULES_SECTIONS.map(([h, b]) => (
          <div key={h} className="if-rules__section">
            <h3>{h}</h3>
            <p>{b}</p>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/* ── Game end ──────────────────────────────────────────────────── */
export function GameEndModal({
  state,
  playerName,
  durationMs,
  onPlayAgain,
  onViewReplay,
  onQuitToMenu,
}: {
  state: GameState;
  playerName: (id: string) => string;
  durationMs: number;
  onPlayAgain: () => void;
  onViewReplay: () => void;
  onQuitToMenu: () => void;
}) {
  const ranked = [...state.players]
    .map((p) => ({ p, vp: victoryPoints(p, state).total }))
    .sort((a, b) => b.vp - a.vp);
  const winner = ranked[0];
  const mins = Math.floor(durationMs / 60000);
  const secs = Math.floor((durationMs % 60000) / 1000);

  return (
    <Modal title="Game over" wide>
      <div className="if-end">
        <div className="if-end__winner" aria-live="polite">
          <span className="if-end__crown" aria-hidden="true">♛</span>
          <h3>{winner ? playerName(winner.p.id) : '—'} wins!</h3>
          <p>
            {winner?.vp} victory points · {state.turnNumber} turns · {mins}m {secs}s
          </p>
        </div>
        <div className="if-end__ranks">
          {ranked.map(({ p, vp }, idx) => (
            <div key={p.id} className={`if-end__rank${idx === 0 ? ' if-end__rank--first' : ''}`}>
              <span className="if-end__pos">#{idx + 1}</span>
              <Avatar name={playerName(p.id)} color={playerCssColor(p.color)} size={32} />
              <span className="if-end__name">{playerName(p.id)}</span>
              <span className="if-end__stats">
                {p.settlements.length} settlements · {p.cities.length} cities · {p.roads.length} roads ·{' '}
                {p.guardiansPlayed} guardians
              </span>
              <VpBadge vp={vp} />
            </div>
          ))}
        </div>
        <div className="if-modal__foot" style={{ padding: '16px 0 0', border: 'none' }}>
          <button className="if-btn if-btn--ghost" onClick={onQuitToMenu}>
            Menu
          </button>
          <button className="if-btn if-btn--ghost" onClick={onViewReplay}>
            View Replay
          </button>
          <button className="if-btn if-btn--primary" onClick={onPlayAgain} autoFocus>
            Play Again
          </button>
        </div>
      </div>
    </Modal>
  );
}
