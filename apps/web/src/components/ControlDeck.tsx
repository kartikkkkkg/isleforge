/* ControlDeck — the human player's command center:
   resources, dev-card hand, dice, and the action bar (roll / build / trade / end). */

import { memo, useState } from 'react';
import {
  type Command,
  type DevCardType,
  type GameState,
  type ResourceType,
} from '@isleforge/game-engine';
import { RESOURCES } from '@isleforge/game-engine';
import { ResIcon, CostLine } from './ui';
import { CARD_NAME, RES_NAME } from '../game/log';
import { buildOptions, type BuildKind } from '../game/buildinfo';

export const CARD_BLURB: Record<DevCardType, string> = {
  guardian: 'Move the raider and steal a resource. 3+ played earns the Largest Army.',
  trailblazer: 'Place 2 roads for free.',
  harvest: 'Take any 2 resources from the bank.',
  embargo: 'Take all of one resource from every opponent.',
  landmark: 'Worth 1 victory point. Revealed when the game ends.',
};

function CardIcon({ type, size = 26 }: { type: DevCardType; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {type === 'guardian' && (
        <g>
          <path d="M12 2 L20 6 V12 C20 17 16 20.5 12 22 C8 20.5 4 17 4 12 V6 Z" fill="#3d4b5c" stroke="#d8a94e" strokeWidth="1.6" />
          <path d="M12 6 L15 9.5 V14 H9 V9.5 Z" fill="#d8a94e" />
        </g>
      )}
      {type === 'trailblazer' && (
        <g stroke="#d8a94e" strokeWidth="2.2" strokeLinecap="round" fill="none">
          <path d="M4 18 L10 12 L7 9 L14 4" />
          <path d="M13 5 L17 4 L16 8" />
          <circle cx="5" cy="19" r="2" fill="#d8a94e" stroke="none" />
        </g>
      )}
      {type === 'harvest' && (
        <g fill="#d9a91f">
          <ellipse cx="12" cy="8" rx="4" ry="5.5" />
          <rect x="11" y="12" width="2" height="9" rx="1" />
          <ellipse cx="7" cy="11" rx="2.4" ry="3.4" transform="rotate(-28 7 11)" />
          <ellipse cx="17" cy="11" rx="2.4" ry="3.4" transform="rotate(28 17 11)" />
        </g>
      )}
      {type === 'embargo' && (
        <g>
          <circle cx="12" cy="12" r="8.5" fill="none" stroke="#c05a2e" strokeWidth="2.4" />
          <line x1="6" y1="18" x2="18" y2="6" stroke="#c05a2e" strokeWidth="2.4" />
        </g>
      )}
      {type === 'landmark' && (
        <g>
          <polygon points="12,3 21,20 3,20" fill="none" stroke="#f0c76a" strokeWidth="2.2" strokeLinejoin="round" />
          <polygon points="12,8 16.5,17 7.5,17" fill="#f0c76a" opacity="0.85" />
        </g>
      )}
    </svg>
  );
}

function Dice({ dice, rolling }: { dice: [number, number] | null; rolling: boolean }) {
  if (!dice) {
    return (
      <div className="if-dice" aria-label="Dice not rolled yet">
        <div className="if-die">?</div>
        <div className="if-die">?</div>
      </div>
    );
  }
  return (
    <div className="if-dice" aria-label={`Dice show ${dice[0]} and ${dice[1]}`}>
      {[dice[0], dice[1]].map((d, k) => (
        <div key={k} className={`if-die${rolling ? ' if-die--rolling' : ''}`}>
          {d}
        </div>
      ))}
    </div>
  );
}

interface ControlDeckProps {
  state: GameState;
  humanId: string;
  legal: Command[];
  diceRolling: boolean;
  canAct: boolean;
  buildSelection: 'road' | 'settlement' | 'city' | null;
  onRoll: () => void;
  onEndTurn: () => void;
  onSelectBuild: (kind: 'road' | 'settlement' | 'city' | null) => void;
  onBuyCard: () => void;
  onOpenTrade: () => void;
  onPlayCard: (cardUid: string) => void;
}

export const ControlDeck = memo(function ControlDeck({
  state,
  humanId,
  legal,
  diceRolling,
  canAct,
  buildSelection,
  onRoll,
  onEndTurn,
  onSelectBuild,
  onBuyCard,
  onOpenTrade,
  onPlayCard,
}: ControlDeckProps) {
  const [buildOpen, setBuildOpen] = useState(false);
  const me = state.players.find((p) => p.id === humanId);
  const options = buildOptions(state, humanId, legal);
  const canRoll = canAct && state.phase === 'roll';
  const canEndTurn = canAct && state.phase === 'play';
  const canTrade = canAct && state.phase === 'play';

  const setupHint =
    state.phase === 'setup' && state.currentPlayerId === humanId
      ? state.setup?.expecting === 'settlement'
        ? 'Place your settlement on a glowing corner.'
        : 'Place a road on a glowing edge.'
      : null;

  return (
    <div className="if-deck" aria-label="Your controls">
      {/* resources */}
      <div className="if-resources" role="group" aria-label="Your resources">
        {RESOURCES.map((r: ResourceType) => (
          <div key={r} className="if-resource" data-tip={RES_NAME[r]} tabIndex={0}>
            <ResIcon resource={r} size={22} />
            <span className="if-resource__count" aria-label={`${RES_NAME[r]}: ${me?.resources[r] ?? 0}`}>
              {me?.resources[r] ?? 0}
            </span>
          </div>
        ))}
      </div>

      {/* dev cards */}
      <div className="if-hand" role="group" aria-label="Your development cards">
        {(me?.devCards.length ?? 0) === 0 && (
          <span className="if-hand__empty">No development cards</span>
        )}
        {me?.devCards.map((c) => {
          const playable = c.playable && canAct && state.phase === 'play' && !state.devCardPlayedThisTurn && c.type !== 'landmark';
          return (
            <button
              key={c.uid}
              className={`if-card${playable ? ' if-card--playable' : ''}`}
              data-tip={`${CARD_NAME[c.type]} — ${CARD_BLURB[c.type]}${c.playable ? '' : ' (bought this turn — playable next turn)'}`}
              aria-label={`${CARD_NAME[c.type]} development card${playable ? ', playable' : ''}`}
              disabled={!playable}
              onClick={() => onPlayCard(c.uid)}
            >
              <CardIcon type={c.type} />
              <span className="if-card__name">{CARD_NAME[c.type]}</span>
              {!c.playable && <span className="if-card__new">NEW</span>}
            </button>
          );
        })}
      </div>

      {/* dice + actions */}
      <div className="if-actions">
        <Dice dice={state.dice} rolling={diceRolling} />
        <div className="if-actions__btns">
          {setupHint && <span className="if-hint">{setupHint}</span>}
          {canRoll && (
            <button className="if-btn if-btn--primary if-btn--pulse" onClick={onRoll} aria-label="Roll the dice">
              Roll Dice
            </button>
          )}
          <div className="if-buildwrap">
            <button
              className={`if-btn if-btn--ghost${buildOpen ? ' if-btn--active' : ''}`}
              onClick={() => setBuildOpen((o) => !o)}
              disabled={!canAct || state.phase !== 'play'}
              aria-expanded={buildOpen}
              aria-label="Build menu"
              data-tip="Build roads, settlements, cities, or buy cards"
            >
              Build
            </button>
            {buildOpen && (
              <div className="if-buildmenu" role="menu" aria-label="Build options">
                {options.map((o) => (
                  <button
                    key={o.kind}
                    role="menuitem"
                    className={`if-buildmenu__item${buildSelection === o.kind ? ' if-buildmenu__item--active' : ''}`}
                    disabled={!o.enabled}
                    data-tip={o.reason ?? undefined}
                    onClick={() => {
                      if (o.kind === 'devCard') {
                        onBuyCard();
                        setBuildOpen(false);
                      } else {
                        onSelectBuild(buildSelection === o.kind ? null : (o.kind as 'road' | 'settlement' | 'city'));
                      }
                    }}
                  >
                    <span className="if-buildmenu__label">{o.label}</span>
                    <CostLine cost={o.cost} />
                    {o.reason && <span className="if-buildmenu__reason">{o.reason}</span>}
                    {o.kind !== 'devCard' && o.enabled && buildSelection === o.kind && (
                      <span className="if-buildmenu__cancel">Click a glowing spot — click again to cancel</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className="if-btn if-btn--ghost"
            onClick={onOpenTrade}
            disabled={!canTrade}
            data-tip={canTrade ? 'Trade with the bank or other players' : 'Trading is available on your turn'}
            aria-label="Trade"
          >
            ⇄ Trade
          </button>
          {canEndTurn && (
            <button className="if-btn if-btn--primary" onClick={onEndTurn} aria-label="End your turn">
              End Turn →
            </button>
          )}
        </div>
      </div>
    </div>
  );
});
