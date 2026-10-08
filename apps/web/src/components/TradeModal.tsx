/* TradeModal — bank/port trading and player trade proposals.
   All validation via the engine (bankTradeRatio, TRADE_* commands).
   Player tab is multiplayer-ready: proposals are engine TradeOffers. */

import { useMemo, useState } from 'react';
import {
  bankTradeRatio,
  type GameState,
  type ResourceType,
} from '@isleforge/game-engine';
import { RESOURCES } from '@isleforge/game-engine';
import { Modal } from './Modal';
import { ResIcon } from './ui';
import { RES_NAME } from '../game/log';

function ResourcePicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ResourceType;
  onChange: (r: ResourceType) => void;
}) {
  return (
    <div className="if-respicker" role="radiogroup" aria-label={label}>
      {RESOURCES.map((r: ResourceType) => (
        <button
          key={r}
          role="radio"
          aria-checked={value === r}
          className={`if-respicker__opt${value === r ? ' if-respicker__opt--active' : ''}`}
          onClick={() => onChange(r)}
          data-tip={RES_NAME[r]}
          aria-label={RES_NAME[r]}
        >
          <ResIcon resource={r} size={22} />
        </button>
      ))}
    </div>
  );
}

function AmountStepper({
  value,
  min,
  max,
  onChange,
  label,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  label: string;
}) {
  return (
    <div className="if-amount" role="group" aria-label={label}>
      <button
        className="if-icon-btn"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        aria-label={`Decrease ${label}`}
      >
        −
      </button>
      <span className="if-amount__val" aria-live="polite">
        {value}
      </span>
      <button
        className="if-icon-btn"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label={`Increase ${label}`}
      >
        +
      </button>
    </div>
  );
}

interface TradeModalProps {
  state: GameState;
  humanId: string;
  playerName: (id: string) => string;
  onBankTrade: (give: ResourceType, receive: ResourceType, times: number) => void;
  onPropose: (toPlayerId: string, offer: Record<ResourceType, number>, request: Record<ResourceType, number>) => void;
  onAccept: (tradeId: string) => void;
  onDecline: (tradeId: string) => void;
  onClose: () => void;
}

const emptyCount = (): Record<ResourceType, number> => ({
  wood: 0,
  brick: 0,
  grain: 0,
  wool: 0,
  ore: 0,
});

export function TradeModal({
  state,
  humanId,
  playerName,
  onBankTrade,
  onPropose,
  onAccept,
  onDecline,
  onClose,
}: TradeModalProps) {
  const [tab, setTab] = useState<'bank' | 'players'>('bank');
  const me = state.players.find((p) => p.id === humanId);

  // bank tab
  const [give, setGive] = useState<ResourceType>('wood');
  const [receive, setReceive] = useState<ResourceType>('ore');
  const [times, setTimes] = useState(1);
  const ratio = bankTradeRatio(state, humanId, give);
  const maxTimes = Math.max(
    1,
    Math.floor((me?.resources[give] ?? 0) / ratio),
  );
  const bankSummary =
    ratio === 4
      ? 'Bank rate 4:1'
      : ratio === 3
        ? 'Harbor rate 3:1 — your port'
        : `Harbor rate 2:1 — your ${RES_NAME[give]} port`;

  // player tab
  const [offer, setOffer] = useState(emptyCount());
  const [request, setRequest] = useState(emptyCount());
  const [target, setTarget] = useState(
    state.players.find((p) => p.id !== humanId && !p.resigned)?.id ?? '',
  );
  const incoming = state.pendingTrades.filter((t) => t.toPlayerId === humanId);
  const outgoing = state.pendingTrades.filter((t) => t.fromPlayerId === humanId);

  const bump = (
    setter: React.Dispatch<React.SetStateAction<Record<ResourceType, number>>>,
    r: ResourceType,
    d: number,
    cap: number,
  ) =>
    setter((prev) => ({
      ...prev,
      [r]: Math.min(cap, Math.max(0, (prev[r] ?? 0) + d)),
    }));

  const offerTotal = useMemo(
    () => Object.values(offer).reduce((a, b) => a + b, 0),
    [offer],
  );
  const requestTotal = useMemo(
    () => Object.values(request).reduce((a, b) => a + b, 0),
    [request],
  );

  return (
    <Modal title="Trade" onClose={onClose} wide>
      <div className="if-tabs" role="tablist" aria-label="Trade type">
        <button
          role="tab"
          aria-selected={tab === 'bank'}
          className={`if-tabs__tab${tab === 'bank' ? ' if-tabs__tab--active' : ''}`}
          onClick={() => setTab('bank')}
        >
          Bank & Harbor
        </button>
        <button
          role="tab"
          aria-selected={tab === 'players'}
          className={`if-tabs__tab${tab === 'players' ? ' if-tabs__tab--active' : ''}`}
          onClick={() => setTab('players')}
        >
          Players {incoming.length > 0 && <span className="if-badge-dot">{incoming.length}</span>}
        </button>
      </div>

      {tab === 'bank' && (
        <div className="if-trade-bank">
          <p className="if-modal__text">{bankSummary}</p>
          <div className="if-trade-row">
            <div>
              <span className="if-field__label">Give</span>
              <ResourcePicker label="Resource to give" value={give} onChange={setGive} />
            </div>
            <div>
              <span className="if-field__label">Receive</span>
              <ResourcePicker label="Resource to receive" value={receive} onChange={setReceive} />
            </div>
            <div>
              <span className="if-field__label">Times</span>
              <AmountStepper value={times} min={1} max={Math.min(maxTimes, 5)} onChange={setTimes} label="times" />
            </div>
          </div>
          <div className="if-trade-summary" aria-live="polite">
            {ratio * times} {RES_NAME[give]} → {times} {RES_NAME[receive]}
            <span className="if-trade-summary__sub">
              (you have {me?.resources[give] ?? 0} {RES_NAME[give]})
            </span>
          </div>
          <div className="if-modal__foot" style={{ padding: '16px 0 0', border: 'none' }}>
            <button className="if-btn if-btn--ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              className="if-btn if-btn--primary"
              disabled={give === receive || (me?.resources[give] ?? 0) < ratio * times}
              onClick={() => {
                onBankTrade(give, receive, times);
                onClose();
              }}
            >
              Confirm Trade
            </button>
          </div>
        </div>
      )}

      {tab === 'players' && (
        <div className="if-trade-players">
          {incoming.length > 0 && (
            <div className="if-trade-section">
              <h3 className="if-trade-section__title">Incoming offers</h3>
              {incoming.map((t) => (
                <div key={t.id} className="if-trade-offer">
                  <div className="if-trade-offer__text">
                    <b>{playerName(t.fromPlayerId)}</b> offers{' '}
                    {fmtCount(t.offer)} for {fmtCount(t.request)}
                  </div>
                  <div className="if-trade-offer__btns">
                    <button className="if-btn if-btn--sm if-btn--primary" onClick={() => onAccept(t.id)}>
                      Accept
                    </button>
                    <button className="if-btn if-btn--sm if-btn--ghost" onClick={() => onDecline(t.id)}>
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {outgoing.length > 0 && (
            <div className="if-trade-section">
              <h3 className="if-trade-section__title">Awaiting response</h3>
              {outgoing.map((t) => (
                <div key={t.id} className="if-trade-offer">
                  <div className="if-trade-offer__text">
                    You offered {fmtCount(t.offer)} for {fmtCount(t.request)} to{' '}
                    <b>{playerName(t.toPlayerId)}</b>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="if-trade-section">
            <h3 className="if-trade-section__title">Make an offer</h3>
            <label className="if-field">
              <span className="if-field__label">To player</span>
              <select className="if-select" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Trade partner">
                {state.players
                  .filter((p) => p.id !== humanId && !p.resigned)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            <div className="if-trade-grid">
              <div>
                <span className="if-field__label">You give</span>
                {RESOURCES.map((r: ResourceType) => (
                  <div key={r} className="if-trade-stepper">
                    <ResIcon resource={r} size={18} />
                    <AmountStepper
                      value={offer[r]}
                      min={0}
                      max={me?.resources[r] ?? 0}
                      onChange={(v) => bump(setOffer, r, v - offer[r], me?.resources[r] ?? 0)}
                      label={`${RES_NAME[r]} to offer`}
                    />
                  </div>
                ))}
              </div>
              <div>
                <span className="if-field__label">You want</span>
                {RESOURCES.map((r: ResourceType) => (
                  <div key={r} className="if-trade-stepper">
                    <ResIcon resource={r} size={18} />
                    <AmountStepper
                      value={request[r]}
                      min={0}
                      max={19}
                      onChange={(v) => bump(setRequest, r, v - request[r], 19)}
                      label={`${RES_NAME[r]} to request`}
                    />
                  </div>
                ))}
              </div>
            </div>
            <div className="if-modal__foot" style={{ padding: '16px 0 0', border: 'none' }}>
              <button className="if-btn if-btn--ghost" onClick={onClose}>
                Cancel
              </button>
              <button
                className="if-btn if-btn--primary"
                disabled={offerTotal === 0 || requestTotal === 0 || !target}
                onClick={() => {
                  onPropose(target, offer, request);
                  onClose();
                }}
              >
                Send Offer
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function fmtCount(r: Record<ResourceType, number>): string {
  const parts = (Object.keys(r) as ResourceType[])
    .filter((k) => (r[k] ?? 0) > 0)
    .map((k) => `${r[k]} ${RES_NAME[k]}`);
  return parts.length > 0 ? parts.join(', ') : 'nothing';
}
