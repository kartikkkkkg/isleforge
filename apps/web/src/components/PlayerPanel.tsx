/* PlayerPanel — per-player card. Opponents never see hidden info:
   resource totals only, dev-card counts only (never types). */

import { memo } from 'react';
import {
  victoryPoints,
  type GameState,
  type PlayerState,
} from '@isleforge/game-engine';
import { Avatar, VpBadge } from './ui';
import { playerCssColor } from './Board';

interface PlayerPanelProps {
  player: PlayerState;
  state: GameState;
  isHuman: boolean;
  isBot: boolean;
  compact?: boolean;
}

export const PlayerPanel = memo(function PlayerPanel({
  player,
  state,
  isHuman,
  isBot,
  compact,
}: PlayerPanelProps) {
  const vp = victoryPoints(player, state);
  const isTurn = state.currentPlayerId === player.id && state.phase !== 'gameover';
  const color = playerCssColor(player.color);
  const resourceTotal = (Object.values(player.resources) as number[]).reduce(
    (a, b) => a + (b ?? 0),
    0,
  );
  const hasLongestRoad = state.longestRoad.playerId === player.id;
  const hasLargestArmy = state.largestArmy.playerId === player.id;

  return (
    <div
      className={`if-player${isTurn ? ' if-player--turn' : ''}${player.resigned ? ' if-player--resigned' : ''}${compact ? ' if-player--compact' : ''}`}
      style={{ ['--if-pc' as string]: color }}
      aria-label={`${player.name}, ${vp.public} victory points${isTurn ? ', current turn' : ''}`}
    >
      <div className="if-player__head">
        <Avatar name={player.name} color={color} size={compact ? 32 : 40} />
        <div className="if-player__ids">
          <div className="if-player__name">
            {player.name}
            {isHuman && <span className="if-chip if-chip--gold if-chip--mini">YOU</span>}
            {isBot && <span className="if-chip if-chip--mini">BOT</span>}
          </div>
          <VpBadge vp={vp.public} />
        </div>
        {isTurn && <span className="if-chip if-chip--turn">TURN</span>}
      </div>

      {!compact && (
        <div className="if-player__stats">
          <span className="if-player__stat" data-tip="Resource cards in hand" tabIndex={0}>
            <b>{resourceTotal}</b> cards
          </span>
          <span className="if-player__stat" data-tip="Development cards held (types hidden)" tabIndex={0}>
            <b>{player.devCards.length}</b> dev
          </span>
          <span className="if-player__stat" data-tip="Road segments built" tabIndex={0}>
            <b>{player.roads.length}</b> road
          </span>
          <span className="if-player__stat" data-tip="Guardians played" tabIndex={0}>
            <b>{player.guardiansPlayed}</b> army
          </span>
        </div>
      )}

      <div className="if-player__titles">
        {hasLongestRoad && (
          <span className="if-chip if-chip--gold" data-tip={`Longest Road — ${state.longestRoad.length} segments (+2 VP)`} tabIndex={0}>
            ◈ Longest Road
          </span>
        )}
        {hasLargestArmy && (
          <span className="if-chip if-chip--gold" data-tip={`Largest Army — ${state.largestArmy.count} guardians (+2 VP)`} tabIndex={0}>
            ✦ Largest Army
          </span>
        )}
        {player.resigned && <span className="if-chip">Resigned</span>}
      </div>
    </div>
  );
});
