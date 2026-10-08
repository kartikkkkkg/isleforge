/* Shared presentational primitives. No game logic — only rendering. */

import type { ResourceType } from '@isleforge/game-engine';
import { RES_NAME } from '../game/log';

export const RES_COLORS: Record<ResourceType, string> = {
  wood: '#9c6b30',
  brick: '#c05a2e',
  grain: '#d9a91f',
  wool: '#ddd6c4',
  ore: '#7d8898',
};

export function ResIcon({ resource, size = 20 }: { resource: ResourceType; size?: number }) {
  const c = RES_COLORS[resource];
  const s = size;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true">
      {resource === 'wood' && (
        <g>
          <rect x="3" y="9" width="18" height="7" rx="3.5" fill={c} />
          <ellipse cx="5.5" cy="12.5" rx="2" ry="3" fill="#6e4a1e" />
          <ellipse cx="5.5" cy="12.5" rx="1" ry="1.6" fill="#c99a5b" />
        </g>
      )}
      {resource === 'brick' && (
        <g>
          <rect x="3" y="7" width="18" height="11" rx="1.5" fill={c} />
          <line x1="3" y1="12.5" x2="21" y2="12.5" stroke="#7e3a1c" strokeWidth="1.6" />
          <line x1="9" y1="7" x2="9" y2="12.5" stroke="#7e3a1c" strokeWidth="1.6" />
          <line x1="15" y1="12.5" x2="15" y2="18" stroke="#7e3a1c" strokeWidth="1.6" />
        </g>
      )}
      {resource === 'grain' && (
        <g fill={c}>
          <rect x="11" y="10" width="2" height="11" rx="1" />
          <ellipse cx="12" cy="7" rx="3" ry="4.5" />
          <ellipse cx="8.5" cy="9" rx="2.2" ry="3.2" transform="rotate(-30 8.5 9)" />
          <ellipse cx="15.5" cy="9" rx="2.2" ry="3.2" transform="rotate(30 15.5 9)" />
        </g>
      )}
      {resource === 'wool' && (
        <g>
          <circle cx="9" cy="13" r="4" fill={c} />
          <circle cx="14" cy="11" r="4.6" fill={c} />
          <circle cx="16.5" cy="14.5" r="3.4" fill={c} />
          <circle cx="10.5" cy="9.5" r="1.1" fill="#3a3f45" />
          <circle cx="14.5" cy="9.3" r="1.1" fill="#3a3f45" />
        </g>
      )}
      {resource === 'ore' && (
        <g>
          <polygon points="12,3 18,9 15,20 9,20 6,9" fill={c} />
          <polygon points="12,3 15,9 12,12 9,9" fill="#aeb8c6" />
          <line x1="9" y1="9" x2="15" y2="9" stroke="#3d4654" strokeWidth="1.4" />
        </g>
      )}
    </svg>
  );
}

export function Avatar({ name, color, size = 40 }: { name: string; color: string; size?: number }) {
  return (
    <div
      className="if-avatar"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(150deg, ${color}, ${color}88)`,
        fontSize: size * 0.42,
      }}
      aria-hidden="true"
    >
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}

export function CostLine({ cost }: { cost: Partial<Record<ResourceType, number>> }) {
  const parts = (Object.keys(cost) as ResourceType[]).filter((k) => (cost[k] ?? 0) > 0);
  if (parts.length === 0) return <span className="if-cost">Free</span>;
  return (
    <span className="if-cost">
      {parts.map((r) => (
        <span key={r} className="if-cost__item" title={RES_NAME[r]}>
          <ResIcon resource={r} size={15} />
          <span>×{cost[r]}</span>
        </span>
      ))}
    </span>
  );
}

export function VpBadge({ vp, title = 'Victory points' }: { vp: number; title?: string }) {
  return (
    <span className="if-chip if-chip--gold" data-tip={title} tabIndex={0}>
      ★ {vp} VP
    </span>
  );
}
