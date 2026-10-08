/* Render the real Board component to a static SVG for a preview screenshot.
   Run: npx vite-node scripts/render-preview.ts (from apps/web) */
import { readFileSync, writeFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { Game, type GameState } from '@isleforge/game-engine';
import { GameBoard } from '../src/components/Board';
import { chooseBotMove, createBotRng } from '../src/game/bot';
import { activeActor } from '../src/game/useGame';

const game = new Game({
  seed: 42,
  players: [
    { id: 'p1', name: 'Kartik', color: 'tide' },
    { id: 'p2', name: 'Coral', color: 'ember' },
    { id: 'p3', name: 'Marina', color: 'moss' },
    { id: 'p4', name: 'Reef', color: 'dune' },
  ],
});
const rng = createBotRng(42);
// Play a mid-game: full setup + ~14 turns of bot moves.
let moves = 0;
while (game.getState().phase !== 'gameover' && moves < 260) {
  const state = game.getState();
  if (!state.setup && state.turnNumber > 14) break;
  const actor = activeActor(state)!;
  const cmd = chooseBotMove(state, actor, rng);
  if (!cmd) break;
  game.dispatch(cmd);
  moves++;
}
const state: GameState = game.getState();
console.log('phase:', state.phase, 'turn:', state.turnNumber, 'moves:', moves);

const colorOf = (pid: string) =>
  ({ p1: '#2dd4bf', p2: '#fb7185', p3: '#a3e635', p4: '#fbbf24' })[pid] ?? '#fff';

const svg = renderToStaticMarkup(
  React.createElement(GameBoard, {
    state,
    mode: { kind: 'idle' },
    onPlace: () => {},
    onMoveRaider: () => {},
    freshIds: new Set<string>(),
    colorOf,
  }),
);
// Inline the real stylesheets so the static render matches the browser.
const css = ['src/styles/tokens.css', 'src/styles/board.css']
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n')
  // Strip @media / @keyframes wrappers cairosvg can't parse is unnecessary;
  // keep it simple: cairosvg handles plain rules, var() included.
  .replace(/@media[^{]+\{([^{}]*\{[^{}]*\}[^{}]*)\}/g, '$1');
const styled = svg.replace(
  /<svg([^>]*)>/,
  `<svg$1><style>${css.replace(/</g, '&lt;')}</style>`,
);
const inner = styled.match(/<svg[\s\S]*<\/svg>/)?.[0] ?? styled;
// Bake terrain fills as presentation attributes so renderers without full
// CSS cascade support (e.g. cairosvg) still show the board correctly.
// In a real browser the stylesheet rules override these attributes.
const withFills = inner
  .replace(
    /class="if-hex if-hex--(forest|hills|fields|pasture|mountains|desert)"/g,
    'class="if-hex if-hex--$1" fill="url(#if-grad-$1)"',
  )
  .replace(
    /<circle class="if-token"/g,
    '<circle class="if-token" fill="#f4ead2" stroke="#2a2118" stroke-width="2"',
  );
writeFileSync('/tmp/board-preview.svg', withFills);
console.log('wrote /tmp/board-preview.svg', withFills.length, 'bytes');
