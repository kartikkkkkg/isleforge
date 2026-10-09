/* Avatar — original built-in geometric avatars for M5.
   Stored as avatar_id; rendered as inline SVG. No marketplace yet. */

export const AVATAR_IDS = [
  'compass',
  'anchor',
  'kraken',
  'lighthouse',
  'helm',
  'map',
  'flag',
  'wave',
] as const;
export type AvatarId = (typeof AVATAR_IDS)[number];

const AVATAR_LABELS: Record<AvatarId, string> = {
  compass: 'Compass',
  anchor: 'Anchor',
  kraken: 'Kraken',
  lighthouse: 'Lighthouse',
  helm: 'Helm',
  map: 'Treasure map',
  flag: 'Flag',
  wave: 'Wave',
};

export function avatarLabel(id: string): string {
  return (AVATAR_LABELS as Record<string, string>)[id] ?? id;
}

function AvatarArt({ id }: { id: AvatarId }) {
  const gold = '#d8a94e';
  const sea = '#0d1b22';
  const foam = '#e8e3d5';
  switch (id) {
    case 'compass':
      return (
        <>
          <circle cx="32" cy="32" r="22" fill="none" stroke={gold} strokeWidth="4" />
          <polygon points="32,14 38,32 32,50 26,32" fill={gold} />
          <polygon points="14,32 32,26 50,32 32,38" fill={foam} opacity="0.85" />
          <circle cx="32" cy="32" r="4" fill={sea} stroke={gold} strokeWidth="2" />
        </>
      );
    case 'anchor':
      return (
        <>
          <circle cx="32" cy="14" r="5" fill="none" stroke={gold} strokeWidth="4" />
          <line x1="32" y1="19" x2="32" y2="50" stroke={gold} strokeWidth="4" />
          <line x1="20" y1="26" x2="44" y2="26" stroke={gold} strokeWidth="4" />
          <path d="M14 38 Q14 52 32 52 Q50 52 50 38" fill="none" stroke={gold} strokeWidth="4" />
          <polygon points="14,38 10,30 18,34" fill={gold} />
          <polygon points="50,38 54,30 46,34" fill={gold} />
        </>
      );
    case 'kraken':
      return (
        <>
          <circle cx="32" cy="26" r="12" fill={gold} />
          <circle cx="27" cy="24" r="3" fill={sea} />
          <circle cx="37" cy="24" r="3" fill={sea} />
          {[18, 26, 34, 42].map((x) => (
            <path key={x} d={`M${x} 36 q0 12 -6 16 q8 2 10 -6 q2 -6 0 -10`} fill="none" stroke={gold} strokeWidth="3.5" />
          ))}
        </>
      );
    case 'lighthouse':
      return (
        <>
          <polygon points="26,52 38,52 35,20 29,20" fill={foam} />
          <polygon points="27,44 37,44 36,36 28,36" fill={gold} opacity="0.55" />
          <rect x="27" y="12" width="10" height="8" fill={gold} />
          <polygon points="25,12 39,12 32,6" fill={gold} />
          <polygon points="37,16 52,10 50,16 37,20" fill={gold} opacity="0.7" />
        </>
      );
    case 'helm':
      return (
        <>
          <circle cx="32" cy="32" r="18" fill="none" stroke={gold} strokeWidth="4" />
          <circle cx="32" cy="32" r="6" fill="none" stroke={gold} strokeWidth="3" />
          {[0, 45, 90, 135].map((a) => (
            <line
              key={a}
              x1="32" y1="32"
              x2={32 + 24 * Math.cos((a * Math.PI) / 180)}
              y2={32 + 24 * Math.sin((a * Math.PI) / 180)}
              stroke={gold} strokeWidth="3.5"
            />
          ))}
        </>
      );
    case 'map':
      return (
        <>
          <polygon points="18,12 46,18 42,52 14,46" fill={foam} opacity="0.9" />
          <path d="M22 20 L34 34 L28 42" fill="none" stroke="#b03a2e" strokeWidth="3" strokeDasharray="5 3" />
          <circle cx="38" cy="24" r="4" fill="none" stroke="#b03a2e" strokeWidth="3" />
          <polygon points="38,20 40,24 38,28 36,24" fill="#b03a2e" />
        </>
      );
    case 'flag':
      return (
        <>
          <line x1="20" y1="10" x2="20" y2="54" stroke={gold} strokeWidth="4" />
          <polygon points="20,10 48,18 20,28" fill={gold} />
          <circle cx="20" cy="10" r="3" fill={foam} />
        </>
      );
    case 'wave':
      return (
        <>
          <path d="M8 36 q8 -14 16 0 t16 0 t16 0" fill="none" stroke={gold} strokeWidth="4" />
          <path d="M8 46 q8 -14 16 0 t16 0 t16 0" fill="none" stroke={foam} strokeWidth="3" opacity="0.7" />
          <circle cx="48" cy="16" r="6" fill={gold} opacity="0.85" />
        </>
      );
  }
}

export function Avatar({
  id,
  size = 40,
  label,
}: {
  id: string;
  size?: number;
  label?: string;
}) {
  const safe = (AVATAR_IDS as readonly string[]).includes(id) ? (id as AvatarId) : 'compass';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label={label ?? avatarLabel(safe)}
      className="if-avatar"
    >
      <circle cx="32" cy="32" r="30" fill="#132a33" stroke="#d8a94e" strokeOpacity="0.35" strokeWidth="2" />
      <AvatarArt id={safe} />
    </svg>
  );
}
