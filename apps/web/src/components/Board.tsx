/* GameBoard — SVG rendering of live engine state. Pure presentation:
   geometry parsed from engine ids, legality supplied by the parent. */

import { memo, useMemo } from 'react';
import type {
  GameState,
  PlayerColor,
  ResourceType,
  TerrainType,
} from '@isleforge/game-engine';

export type PlaceKind = 'road' | 'settlement' | 'city';
export type BoardMode =
  | { kind: 'idle' }
  | { kind: 'place'; build: PlaceKind; targets: Set<string> }
  | { kind: 'raider'; targets: Set<string> };

interface BoardProps {
  state: GameState;
  mode: BoardMode;
  onPlace: (build: PlaceKind, id: string) => void;
  onMoveRaider: (tileKey: string) => void;
  freshIds: Set<string>;
  colorOf: (playerId: string) => string;
}

export const S = 52; // hex size in px
const SQRT3 = Math.sqrt(3);

const parseCorner = (id: string): [number, number] => {
  const [x, y] = id.split(',').map(Number);
  return [(x || 0) * S, (y || 0) * S];
};

const parseEdge = (id: string): [[number, number], [number, number]] => {
  const [a, b] = id.split('|');
  return [parseCorner(a ?? ''), parseCorner(b ?? '')];
};

const tileCenter = (q: number, r: number): [number, number] => [
  SQRT3 * (q + r / 2) * S,
  1.5 * r * S,
];

const hexPoints = (q: number, r: number): string => {
  const [cx, cy] = tileCenter(q, r);
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${(cx + S * Math.cos(a)).toFixed(1)},${(cy + S * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
};

/* ── Terrain decoration (original IsleForge vector motifs) ───────── */
function TerrainDeco({ terrain, cx, cy }: { terrain: TerrainType; cx: number; cy: number }) {
  const u = S / 52;
  switch (terrain) {
    case 'forest':
      return (
        <g className="if-hex-deco" fill="#1d5736">
          <path d={`M${cx - 22 * u},${cy + 12 * u} l${10 * u},${-20 * u} l${10 * u},${20 * u} z`} />
          <path d={`M${cx - 2 * u},${cy + 14 * u} l${9 * u},${-18 * u} l${9 * u},${18 * u} z`} />
          <path d={`M${cx + 14 * u},${cy + 10 * u} l${8 * u},${-15 * u} l${8 * u},${15 * u} z`} />
        </g>
      );
    case 'hills':
      return (
        <g className="if-hex-deco" fill="none" stroke="#7e3d20" strokeWidth={3 * u} strokeLinecap="round">
          <path d={`M${cx - 24 * u},${cy + 10 * u} Q${cx - 12 * u},${cy - 12 * u} ${cx},${cy + 10 * u}`} />
          <path d={`M${cx - 2 * u},${cy + 12 * u} Q${cx + 10 * u},${cy - 6 * u} ${cx + 22 * u},${cy + 12 * u}`} />
        </g>
      );
    case 'fields':
      return (
        <g className="if-hex-deco" stroke="#8f7418" strokeWidth={2.5 * u} strokeLinecap="round">
          <line x1={cx - 24 * u} y1={cy - 6 * u} x2={cx + 24 * u} y2={cy - 6 * u} />
          <line x1={cx - 24 * u} y1={cy + 4 * u} x2={cx + 24 * u} y2={cy + 4 * u} />
          <line x1={cx - 24 * u} y1={cy + 14 * u} x2={cx + 24 * u} y2={cy + 14 * u} />
        </g>
      );
    case 'pasture':
      return (
        <g className="if-hex-deco" fill="#57793c">
          <circle cx={cx - 14 * u} cy={cy + 6 * u} r={4 * u} />
          <circle cx={cx + 4 * u} cy={cy + 12 * u} r={5 * u} />
          <circle cx={cx + 16 * u} cy={cy - 2 * u} r={3.5 * u} />
          <circle cx={cx - 2 * u} cy={cy - 8 * u} r={3 * u} />
        </g>
      );
    case 'mountains':
      return (
        <g className="if-hex-deco">
          <path d={`M${cx - 24 * u},${cy + 12 * u} L${cx - 10 * u},${cy - 12 * u} L${cx + 4 * u},${cy + 12 * u} Z`} fill="#475061" />
          <path d={`M${cx - 4 * u},${cy + 12 * u} L${cx + 10 * u},${cy - 8 * u} L${cx + 24 * u},${cy + 12 * u} Z`} fill="#3d4654" />
          <path d={`M${cx - 10 * u},${cy - 12 * u} l${-5 * u},${8 * u} l${5 * u},${-3 * u} l${5 * u},${3 * u} l${-5 * u},${-8 * u} z`} fill="#dfe6ee" opacity={0.85} />
        </g>
      );
    case 'desert':
      return (
        <g className="if-hex-deco" fill="none" stroke="#a8905c" strokeWidth={3 * u} strokeLinecap="round">
          <path d={`M${cx - 24 * u},${cy + 8 * u} Q${cx},${cy - 6 * u} ${cx + 24 * u},${cy + 8 * u}`} />
          <circle cx={cx + 10 * u} cy={cy - 12 * u} r={6 * u} fill="#a8905c" stroke="none" />
        </g>
      );
  }
}

const RES_DOT: Record<ResourceType, string> = {
  wood: '#8a5a2b',
  brick: '#c05a2e',
  grain: '#d9a91f',
  wool: '#e8e4da',
  ore: '#5a6472',
};

function PortMarker({ edgeId, kind, tiles }: { edgeId: string; kind: string; tiles: { key: string; q: number; r: number }[] }) {
  const [[x1, y1], [x2, y2]] = parseEdge(edgeId);
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  // Find an adjacent tile to push the badge outward.
  let dx = 0;
  let dy = -1;
  for (const t of tiles) {
    const [cx, cy] = tileCenter(t.q, t.r);
    const d = Math.hypot(mx - cx, my - cy);
    if (d < S * 1.2 && d > 1) {
      dx = (mx - cx) / d;
      dy = (my - cy) / d;
      break;
    }
  }
  const bx = mx + dx * S * 0.34;
  const by = my + dy * S * 0.34;
  const label = kind === 'three' ? '3:1' : '2:1';
  return (
    <g className="if-port" aria-label={kind === 'three' ? '3 to 1 port' : `2 to 1 ${kind} port`}>
      <circle className="if-port__badge" cx={bx} cy={by} r={S * 0.24} />
      {kind !== 'generic' && (
        <circle cx={bx} cy={by - S * 0.13} r={S * 0.07} fill={RES_DOT[kind as ResourceType] ?? '#fff'} stroke="#0a1418" strokeWidth={1.5} />
      )}
      <text className="if-port__label" x={bx} y={by + (kind === 'three' ? 0 : S * 0.1)} fontSize={S * 0.2}>
        {label}
      </text>
    </g>
  );
}

function NumberToken({ n, cx, cy }: { n: number; cx: number; cy: number }) {
  const hot = n === 6 || n === 8;
  const pips = 6 - Math.abs(7 - n);
  const r = S * 0.3;
  return (
    <g>
      <circle className="if-token" cx={cx} cy={cy} r={r} />
      <text className={`if-token__num${hot ? ' if-token__num--hot' : ''}`} x={cx} y={cy - r * 0.18} fontSize={r * 0.95}>
        {n}
      </text>
      <g className={hot ? 'if-token__pips--hot' : 'if-token__pips'}>
        {Array.from({ length: pips }).map((_, k) => (
          <circle
            key={k}
            cx={cx + (k - (pips - 1) / 2) * r * 0.34}
            cy={cy + r * 0.52}
            r={r * 0.09}
          />
        ))}
      </g>
    </g>
  );
}

function RaiderToken({ cx, cy, fresh }: { cx: number; cy: number; fresh: boolean }) {
  const u = S / 52;
  return (
    <g className={`if-raider${fresh ? ' if-raider--moving' : ''}`} aria-label="Raider">
      <circle cx={cx} cy={cy} r={15 * u} fill="#14100c" stroke="#d8a94e" strokeWidth={2.5 * u} />
      {/* hooded silhouette */}
      <path
        d={`M${cx - 8 * u},${cy + 7 * u} Q${cx},${cy - 14 * u} ${cx + 8 * u},${cy + 7 * u} Z`}
        fill="#2b241c"
      />
      <circle cx={cx - 3.5 * u} cy={cy - 1 * u} r={1.8 * u} fill="#e8b93c" />
      <circle cx={cx + 3.5 * u} cy={cy - 1 * u} r={1.8 * u} fill="#e8b93c" />
    </g>
  );
}

function HouseShape({ x, y, size, fill, fresh, label }: { x: number; y: number; size: number; fill: string; fresh: boolean; label: string }) {
  const w = size;
  const h = size * 0.72;
  return (
    <g className={`if-building${fresh ? ' if-building--fresh' : ''}`} aria-label={label}>
      <rect x={x - w / 2} y={y - h / 2 + h * 0.28} width={w} height={h * 0.72} rx={w * 0.08} fill={fill} stroke="#10161a" strokeWidth={2.5} />
      <polygon
        points={`${x - w / 2 - w * 0.08},${y - h / 2 + h * 0.32} ${x},${y - h / 2 - h * 0.18} ${x + w / 2 + w * 0.08},${y - h / 2 + h * 0.32}`}
        fill={fill}
        stroke="#10161a"
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
    </g>
  );
}

function CityShape({ x, y, size, fill, fresh, label }: { x: number; y: number; size: number; fill: string; fresh: boolean; label: string }) {
  const w = size * 1.35;
  const h = size * 0.95;
  return (
    <g className={`if-building${fresh ? ' if-building--fresh' : ''}`} aria-label={label}>
      <rect x={x - w / 2} y={y - h / 2 + h * 0.3} width={w} height={h * 0.7} rx={w * 0.08} fill={fill} stroke="#10161a" strokeWidth={2.5} />
      <rect x={x - w * 0.14} y={y - h / 2 - h * 0.22} width={w * 0.28} height={h * 0.55} fill={fill} stroke="#10161a" strokeWidth={2.5} />
      <polygon
        points={`${x - w / 2 - w * 0.07},${y - h / 2 + h * 0.34} ${x},${y - h / 2 - h * 0.12} ${x + w / 2 + w * 0.07},${y - h / 2 + h * 0.34}`}
        fill={fill}
        stroke="#10161a"
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
      <rect x={x - w * 0.32} y={y - h * 0.05} width={w * 0.12} height={h * 0.3} fill="#10161a" opacity={0.55} />
      <rect x={x + w * 0.2} y={y - h * 0.05} width={w * 0.12} height={h * 0.3} fill="#10161a" opacity={0.55} />
    </g>
  );
}

/* ── Placement target ──────────────────────────────────────────── */
function Target({
  id,
  kind,
  build,
  onActivate,
}: {
  id: string;
  kind: 'corner' | 'edge';
  build: PlaceKind;
  onActivate: (id: string) => void;
}) {
  const label = `Build ${build} here`;
  const keyHandler = (ev: React.KeyboardEvent) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      onActivate(id);
    }
  };
  if (kind === 'edge') {
    const [[x1, y1], [x2, y2]] = parseEdge(id);
    return (
      <g
        className="if-target"
        tabIndex={0}
        role="button"
        aria-label={label}
        onClick={() => onActivate(id)}
        onKeyDown={keyHandler}
      >
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={S * 0.34} />
        <line className="if-target__halo" x1={x1} y1={y1} x2={x2} y2={y2} strokeLinecap="round" />
      </g>
    );
  }
  const [x, y] = parseCorner(id);
  return (
    <g
      className="if-target"
      tabIndex={0}
      role="button"
      aria-label={label}
      onClick={() => onActivate(id)}
      onKeyDown={keyHandler}
    >
      <circle cx={x} cy={y} r={S * 0.32} fill="transparent" />
      <circle className="if-target__halo" cx={x} cy={y} r={S * 0.2} />
    </g>
  );
}

/* ── Main board ────────────────────────────────────────────────── */
export const GameBoard = memo(function GameBoard({
  state,
  mode,
  onPlace,
  onMoveRaider,
  freshIds,
  colorOf,
}: BoardProps) {
  const geom = useMemo(() => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const cid of Object.keys(state.board.corners)) {
      const [x, y] = parseCorner(cid);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    const pad = S * 0.85;
    return {
      minX: minX - pad,
      minY: minY - pad,
      w: maxX - minX + pad * 2,
      h: maxY - minY + pad * 2,
    };
  }, [state.board]);

  const ownership = useMemo(() => {
    const cornerOwner = new Map<string, string>();
    const edgeOwner = new Map<string, string>();
    for (const p of state.players) {
      for (const c of p.settlements) cornerOwner.set(c, p.id);
      for (const c of p.cities) cornerOwner.set(c, p.id);
      for (const e of p.roads) edgeOwner.set(e, p.id);
    }
    return { cornerOwner, edgeOwner };
  }, [state.players]);

  const tileList = useMemo(
    () => state.board.tiles.map((t) => ({ key: t.key, q: t.q, r: t.r })),
    [state.board],
  );

  const raiderPos = useMemo(() => {
    const t = state.board.tiles.find((x) => x.key === state.raiderTileKey);
    return t ? tileCenter(t.q, t.r) : ([0, 0] as [number, number]);
  }, [state.board, state.raiderTileKey]);

  const placing = mode.kind === 'place';
  const raiderMode = mode.kind === 'raider';

  return (
    <div className={`if-board-wrap${placing ? ' if-board--placing' : ''}`}>
      <svg
        className="if-board"
        viewBox={`${geom.minX} ${geom.minY} ${geom.w} ${geom.h}`}
        role="img"
        aria-label="Archipelago game board"
      >
        <defs>
          {(
            [
              ['forest', '#2e7d4f', '#1d5736'],
              ['hills', '#b25a33', '#7e3d20'],
              ['fields', '#c9a227', '#8f7418'],
              ['pasture', '#7fae5c', '#57793c'],
              ['mountains', '#6b7686', '#475061'],
              ['desert', '#d9c08a', '#a8905c'],
            ] as [string, string, string][]
          ).map(([name, a, b]) => (
            <radialGradient key={name} id={`if-grad-${name}`} cx="42%" cy="38%" r="75%">
              <stop offset="0%" stopColor={a} />
              <stop offset="100%" stopColor={b} />
            </radialGradient>
          ))}
        </defs>

        {/* tiles */}
        {state.board.tiles.map((t) => {
          const [cx, cy] = tileCenter(t.q, t.r);
          const isRaiderTarget = raiderMode && (mode as { targets: Set<string> }).targets.has(t.key);
          const inner = (
            <>
              <polygon className={`if-hex if-hex--${t.terrain}`} points={hexPoints(t.q, t.r)} />
              <TerrainDeco terrain={t.terrain} cx={cx} cy={cy - S * 0.12} />
              {t.number !== null && (
                <NumberToken n={t.number} cx={cx} cy={cy + S * 0.16} />
              )}
            </>
          );
          return isRaiderTarget ? (
            <g
              key={t.key}
              className="if-raider-target"
              tabIndex={0}
              role="button"
              aria-label={`Move raider to ${t.terrain}`}
              onClick={() => onMoveRaider(t.key)}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') {
                  ev.preventDefault();
                  onMoveRaider(t.key);
                }
              }}
            >
              {inner}
              <polygon points={hexPoints(t.q, t.r)} fill="transparent" />
            </g>
          ) : (
            <g key={t.key}>{inner}</g>
          );
        })}

        {/* ports */}
        {state.board.ports.map((p) => (
          <PortMarker key={p.edgeId} edgeId={p.edgeId} kind={p.kind} tiles={tileList} />
        ))}

        {/* roads */}
        {state.players.flatMap((p) =>
          p.roads.map((eid) => {
            const [[x1, y1], [x2, y2]] = parseEdge(eid);
            const c = colorOf(p.id);
            const fresh = freshIds.has(eid);
            return (
              <g key={eid}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#10161a" strokeWidth={S * 0.17} strokeLinecap="round" />
                <line
                  className={`if-road${fresh ? ' if-road--fresh' : ''}`}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={c}
                  strokeWidth={S * 0.11}
                />
              </g>
            );
          }),
        )}

        {/* buildings */}
        {state.players.flatMap((p) =>
          [...p.settlements.map((c) => ({ c, city: false })), ...p.cities.map((c) => ({ c, city: true }))].map(
            ({ c, city }) => {
              const [x, y] = parseCorner(c);
              const fill = colorOf(p.id);
              const fresh = freshIds.has(c);
              const label = `${city ? 'City' : 'Settlement'} of ${p.name}`;
              return city ? (
                <CityShape key={c} x={x} y={y} size={S * 0.42} fill={fill} fresh={fresh} label={label} />
              ) : (
                <HouseShape key={c} x={x} y={y} size={S * 0.4} fill={fill} fresh={fresh} label={label} />
              );
            },
          ),
        )}

        {/* raider */}
        <RaiderToken cx={raiderPos[0]} cy={raiderPos[1] - S * 0.1} fresh={freshIds.has(state.raiderTileKey)} />

        {/* placement targets */}
        {placing &&
          [...(mode as { targets: Set<string> }).targets].map((id) => (
            <Target
              key={id}
              id={id}
              kind={(mode as { build: PlaceKind }).build === 'road' ? 'edge' : 'corner'}
              build={(mode as { build: PlaceKind }).build}
              onActivate={(tid) => onPlace((mode as { build: PlaceKind }).build, tid)}
            />
          ))}
      </svg>
    </div>
  );
});

export const playerCssColor = (color: PlayerColor): string => `var(--if-p-${color})`;
