/* Flow modals driven by engine phases: discard selection, Harvest/Embargo
   resource picks, and raider steal-target selection. */

import { useState } from 'react';
import type { GameState, ResourceType } from '@isleforge/game-engine';
import { RESOURCES } from '@isleforge/game-engine';
import { Modal } from './Modal';
import { ResIcon } from './ui';
import { RES_NAME } from '../game/log';

/* ── Discard (rolled 7) ─────────────────────────────────────────── */
export function DiscardModal({
  state,
  humanId,
  onConfirm,
}: {
  state: GameState;
  humanId: string;
  onConfirm: (resources: Record<ResourceType, number>) => void;
}) {
  const need = state.pendingDiscards?.[humanId] ?? 0;
  const me = state.players.find((p) => p.id === humanId);
  const [sel, setSel] = useState<Record<ResourceType, number>>({
    wood: 0,
    brick: 0,
    grain: 0,
    wool: 0,
    ore: 0,
  });
  const chosen = Object.values(sel).reduce((a, b) => a + b, 0);

  const bump = (r: ResourceType, d: number) =>
    setSel((p) => ({
      ...p,
      [r]: Math.min(me?.resources[r] ?? 0, Math.max(0, p[r] + d)),
    }));

  return (
    <Modal title="Raider! Discard cards">
      <p className="if-modal__text">
        A 7 was rolled. Discard <b>{need}</b> of your{' '}
        {Object.values(me?.resources ?? {}).reduce((a: number, b) => a + (b ?? 0), 0)} cards
        ({chosen}/{need} chosen).
      </p>
      <div className="if-discard-grid">
        {RESOURCES.map((r: ResourceType) => (
          <div key={r} className="if-discard-row">
            <ResIcon resource={r} size={24} />
            <span className="if-discard-row__name">{RES_NAME[r]}</span>
            <span className="if-discard-row__have">have {me?.resources[r] ?? 0}</span>
            <button className="if-icon-btn" onClick={() => bump(r, -1)} disabled={sel[r] <= 0} aria-label={`Discard one fewer ${RES_NAME[r]}`}>
              −
            </button>
            <span className="if-amount__val">{sel[r]}</span>
            <button
              className="if-icon-btn"
              onClick={() => bump(r, 1)}
              disabled={sel[r] >= (me?.resources[r] ?? 0) || chosen >= need}
              aria-label={`Discard one more ${RES_NAME[r]}`}
            >
              +
            </button>
          </div>
        ))}
      </div>
      <div className="if-modal__foot" style={{ padding: '16px 0 0', border: 'none' }}>
        <button
          className="if-btn if-btn--primary"
          disabled={chosen !== need}
          onClick={() => onConfirm(sel)}
        >
          Discard {need} cards
        </button>
      </div>
    </Modal>
  );
}

/* ── Harvest: pick any 2 resources ──────────────────────────────── */
export function HarvestModal({
  bank,
  onConfirm,
  onClose,
}: {
  bank: Record<ResourceType, number>;
  onConfirm: (resources: [ResourceType, ResourceType]) => void;
  onClose: () => void;
}) {
  const [picks, setPicks] = useState<ResourceType[]>([]);
  const toggle = (r: ResourceType) =>
    setPicks((p) => {
      if (p.includes(r)) return p.filter((x) => x !== r);
      if (p.length >= 2) return [p[1]!, r];
      return [...p, r];
    });
  return (
    <Modal title="Harvest — take 2 resources" onClose={onClose}>
      <p className="if-modal__text">Choose any 2 resources from the bank ({picks.length}/2).</p>
      <div className="if-pickgrid">
        {RESOURCES.map((r: ResourceType) => (
          <button
            key={r}
            className={`if-pickgrid__opt${picks.includes(r) ? ' if-pickgrid__opt--active' : ''}`}
            onClick={() => toggle(r)}
            disabled={(bank[r] ?? 0) <= picks.filter((x) => x === r).length}
            aria-pressed={picks.includes(r)}
            aria-label={RES_NAME[r]}
          >
            <ResIcon resource={r} size={30} />
            <span>{RES_NAME[r]}</span>
            <span className="if-pickgrid__bank">bank: {bank[r] ?? 0}</span>
          </button>
        ))}
      </div>
      <div className="if-modal__foot" style={{ padding: '16px 0 0', border: 'none' }}>
        <button className="if-btn if-btn--ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="if-btn if-btn--primary"
          disabled={picks.length !== 2}
          onClick={() => onConfirm([picks[0]!, picks[1]!])}
        >
          Take resources
        </button>
      </div>
    </Modal>
  );
}

/* ── Embargo: pick 1 resource to take from everyone ─────────────── */
export function EmbargoModal({
  onConfirm,
  onClose,
}: {
  onConfirm: (resource: ResourceType) => void;
  onClose: () => void;
}) {
  const [pick, setPick] = useState<ResourceType | null>(null);
  return (
    <Modal title="Embargo — seize a resource" onClose={onClose}>
      <p className="if-modal__text">Take <b>all</b> of one resource from every opponent.</p>
      <div className="if-pickgrid">
        {RESOURCES.map((r: ResourceType) => (
          <button
            key={r}
            className={`if-pickgrid__opt${pick === r ? ' if-pickgrid__opt--active' : ''}`}
            onClick={() => setPick(r)}
            aria-pressed={pick === r}
            aria-label={RES_NAME[r]}
          >
            <ResIcon resource={r} size={30} />
            <span>{RES_NAME[r]}</span>
          </button>
        ))}
      </div>
      <div className="if-modal__foot" style={{ padding: '16px 0 0', border: 'none' }}>
        <button className="if-btn if-btn--ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="if-btn if-btn--primary"
          disabled={!pick}
          onClick={() => pick && onConfirm(pick)}
        >
          Seize {pick ? RES_NAME[pick] : ''}
        </button>
      </div>
    </Modal>
  );
}

/* ── Steal: choose a victim adjacent to the raider ─────────────── */
export function StealModal({
  victims,
  onPick,
}: {
  victims: { id: string; name: string }[];
  onPick: (victimId: string) => void;
}) {
  return (
    <Modal title="Steal a resource">
      <p className="if-modal__text">Choose a player adjacent to the raider to steal from.</p>
      <div className="if-victims">
        {victims.map((v) => (
          <button key={v.id} className="if-btn if-btn--ghost" onClick={() => onPick(v.id)}>
            Steal from {v.name}
          </button>
        ))}
      </div>
    </Modal>
  );
}
