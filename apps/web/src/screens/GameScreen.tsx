/* GameScreen — orchestrates engine + UI. Owns UI-only state
   (selection, modals, toasts, animations); game state comes from the engine. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  legalCommands,
  type Command,
  type GameState,
  type ResourceType,
} from '@isleforge/game-engine';
import {
  useIsleforgeGame,
  activeActor,
  type Seat,
} from '../game/useGame';
import { chooseBotMove, botAcceptsTrade, createBotRng } from '../game/bot';
import { formatLog, type LogEntry } from '../game/log';
import { GameBoard, playerCssColor, type BoardMode, type PlaceKind } from '../components/Board';
import { TopBar } from '../components/TopBar';
import { PlayerPanel } from '../components/PlayerPanel';
import { ControlDeck } from '../components/ControlDeck';
import { LogChatTabs } from '../components/GameLog';
import { TradeModal } from '../components/TradeModal';
import { DiscardModal, HarvestModal, EmbargoModal, StealModal } from '../components/CardModals';
import { GameMenuModal, RulesModal, GameEndModal } from '../components/MenuModals';

interface GameScreenProps {
  seats: Seat[];
  seed?: number | undefined;
  autopilot: boolean;
  onQuit: () => void;
}

type ModalKind =
  | null
  | 'trade'
  | 'menu'
  | 'rules'
  | 'end'
  | 'harvest'
  | 'embargo'
  | 'steal';

const qs = () => new URLSearchParams(window.location.search);
const BOT_DELAY = qs().has('fast') ? 80 : 700;

export function GameScreen({ seats, seed, autopilot, onQuit }: GameScreenProps) {
  const api = useIsleforgeGame(seats, seed);
  const { state } = api;
  const humanId = api.humanId;
  const botRng = useRef(createBotRng((seed ?? 1) * 7919 + 13));
  const [modal, setModal] = useState<ModalKind>(null);
  const [buildSelection, setBuildSelection] = useState<PlaceKind | null>(null);
  const [diceRolling, setDiceRolling] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; text: string; error?: boolean }[]>([]);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const [pendingCard, setPendingCard] = useState<string | null>(null);
  const startTime = useRef(Date.now());
  const toastId = useRef(1);

  const playerName = useCallback(
    (id: string | null | undefined): string => {
      if (!id) return '—';
      const idx = Number(id.slice(1)) - 1;
      return seats[idx]?.name ?? id;
    },
    [seats],
  );

  const colorOf = useCallback(
    (playerId?: string): string => {
      if (!playerId) return '#9aa4b2';
      const idx = Number(playerId.slice(1)) - 1;
      const c = seats[idx]?.color ?? 'slate';
      return playerCssColor(c as Parameters<typeof playerCssColor>[0]);
    },
    [seats],
  );

  /* ── toasts ─────────────────────────────────────────────────── */
  const toast = useCallback((text: string, error?: boolean) => {
    const id = toastId.current++;
    setToasts((t) => [...t.slice(-2), { id, text, error }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3600);
  }, []);

  useEffect(() => {
    if (api.error) toast(api.error, true);
  }, [api.error, toast]);

  /* ── dispatch wrapper: tracks fresh pieces for animation ────── */
  const dispatch = useCallback(
    (cmd: Command) => {
      const events = api.dispatch(cmd);
      if (events) {
        const fresh = new Set<string>();
        for (const e of events) {
          if (e.type === 'ROAD_BUILT') fresh.add(e.data.edgeId);
          if (e.type === 'SETTLEMENT_BUILT' || e.type === 'CITY_BUILT') fresh.add(e.data.cornerId);
          if (e.type === 'RAIDER_MOVED') fresh.add(e.data.toTileKey);
        }
        if (fresh.size > 0) {
          setFreshIds(fresh);
          setTimeout(() => setFreshIds(new Set()), 700);
        }
      }
      return events;
    },
    [api],
  );

  /* ── bot runner ─────────────────────────────────────────────── */
  useEffect(() => {
    if (state.phase === 'gameover') return;
    const actor = activeActor(state);
    if (!actor || !api.isBot(actor)) return;
    const t = setTimeout(() => {
      const cmd = chooseBotMove(api.game.getState(), actor, botRng.current);
      if (cmd) {
        const evs = dispatch(cmd);
        // Bots auto-answer incoming human trade proposals after a beat.
        if (evs) {
          for (const e of evs) {
            if (e.type === 'TRADE_PROPOSED' && api.isBot(e.data.toPlayerId)) {
              const tradeId = e.data.tradeId;
              const toId = e.data.toPlayerId;
              setTimeout(() => {
                const st = api.game.getState();
                const tr = st.pendingTrades.find((x) => x.id === tradeId);
                if (!tr) return;
                const ok = botAcceptsTrade(tr.offer, tr.request, botRng.current);
                dispatch({
                  type: ok ? 'TRADE_ACCEPT' : 'TRADE_DECLINE',
                  playerId: toId,
                  tradeId,
                });
              }, 900);
            }
          }
        }
      }
    }, BOT_DELAY);
    return () => clearTimeout(t);
  }, [state, api, dispatch]);

  /* ── human legal commands (only computed on the human's turn) ─ */
  const actor = activeActor(state);
  const humanActive = !!humanId && actor === humanId;
  const legal: Command[] = useMemo(
    () => (humanActive && humanId ? legalCommands(state, humanId) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, humanActive, humanId],
  );

  /* ── board mode ─────────────────────────────────────────────── */
  const boardMode: BoardMode = useMemo(() => {
    if (!humanId || actor !== humanId) return { kind: 'idle' };
    if (state.phase === 'setup' && state.setup) {
      const build: PlaceKind = state.setup.expecting === 'settlement' ? 'settlement' : 'road';
      const targets = new Set(
        legal
          .filter((c) =>
            build === 'settlement' ? c.type === 'PLACE_SETTLEMENT' : c.type === 'PLACE_ROAD',
          )
          .map((c) =>
            c.type === 'PLACE_SETTLEMENT' || c.type === 'BUILD_SETTLEMENT' || c.type === 'BUILD_CITY'
              ? (c as { cornerId: string }).cornerId
              : (c as { edgeId: string }).edgeId,
          ),
      );
      return { kind: 'place', build, targets };
    }
    if (state.phase === 'raider' && !state.pendingSteal) {
      const targets = new Set(
        state.board.tiles.map((t) => t.key).filter((k) => k !== state.raiderTileKey),
      );
      return { kind: 'raider', targets };
    }
    if (state.phase === 'play' && buildSelection) {
      const want =
        buildSelection === 'road'
          ? 'BUILD_ROAD'
          : buildSelection === 'settlement'
            ? 'BUILD_SETTLEMENT'
            : 'BUILD_CITY';
      const targets = new Set(
        legal
          .filter((c) => c.type === want)
          .map((c) => (c as { edgeId?: string; cornerId?: string }).edgeId ?? (c as { cornerId: string }).cornerId),
      );
      return { kind: 'place', build: buildSelection, targets };
    }
    return { kind: 'idle' };
  }, [state, legal, humanId, actor, buildSelection]);

  /* ── actions ────────────────────────────────────────────────── */
  const onPlace = useCallback(
    (build: PlaceKind, id: string) => {
      if (!humanId) return;
      let cmd: Command | null = null;
      if (state.phase === 'setup') {
        cmd =
          build === 'road'
            ? { type: 'PLACE_ROAD', playerId: humanId, edgeId: id }
            : { type: 'PLACE_SETTLEMENT', playerId: humanId, cornerId: id };
      } else {
        cmd =
          build === 'road'
            ? { type: 'BUILD_ROAD', playerId: humanId, edgeId: id }
            : build === 'settlement'
              ? { type: 'BUILD_SETTLEMENT', playerId: humanId, cornerId: id }
              : { type: 'BUILD_CITY', playerId: humanId, cornerId: id };
      }
      if (dispatch(cmd)) {
        const st = api.game.getState();
        const me = st.players.find((p) => p.id === humanId);
        // Keep road placement active while Trailblazer free roads remain.
        if (!(build === 'road' && (me?.freeRoads ?? 0) > 0)) setBuildSelection(null);
      }
    },
    [dispatch, humanId, state.phase, api],
  );

  const onMoveRaider = useCallback(
    (tileKey: string) => {
      if (!humanId) return;
      const evs = dispatch({ type: 'MOVE_RAIDER', playerId: humanId, tileKey });
      if (evs && api.game.getState().pendingSteal) setModal('steal');
    },
    [dispatch, humanId, api],
  );

  const stealVictims = useMemo(() => {
    if (!humanId || state.phase !== 'raider' || !state.pendingSteal || actor !== humanId) return [];
    const ids = new Set(
      legalCommands(state, humanId)
        .filter((c) => c.type === 'STEAL_RESOURCE')
        .map((c) => (c as { targetPlayerId: string }).targetPlayerId),
    );
    return [...ids].map((id) => ({ id, name: playerName(id) }));
  }, [state, humanId, actor, playerName]);

  useEffect(() => {
    if (modal === 'steal' && stealVictims.length === 0 && state.pendingSteal) {
      // No victims (or already resolved) — close the picker.
      setModal(null);
    }
  }, [modal, stealVictims.length, state.pendingSteal]);

  const onRoll = useCallback(() => {
    if (!humanId) return;
    setDiceRolling(true);
    dispatch({ type: 'ROLL_DICE', playerId: humanId });
    setTimeout(() => setDiceRolling(false), 650);
  }, [dispatch, humanId]);

  const onPlayCard = useCallback(
    (cardUid: string) => {
      if (!humanId) return;
      const me = api.game.getState().players.find((p) => p.id === humanId);
      const card = me?.devCards.find((c) => c.uid === cardUid);
      if (!card) return;
      if (card.type === 'harvest') {
        setPendingCard(cardUid);
        setModal('harvest');
        return;
      }
      if (card.type === 'embargo') {
        setPendingCard(cardUid);
        setModal('embargo');
        return;
      }
      dispatch({ type: 'PLAY_DEVELOPMENT_CARD', playerId: humanId, cardUid });
      if (card.type === 'trailblazer') setBuildSelection('road');
    },
    [dispatch, humanId, api],
  );

  const onBankTrade = useCallback(
    (give: ResourceType, receive: ResourceType, times: number) => {
      if (!humanId) return;
      for (let k = 0; k < times; k++) {
        const evs = dispatch({ type: 'TRADE_BANK', playerId: humanId, give, receive });
        if (!evs) break;
      }
    },
    [dispatch, humanId],
  );

  /* ── derived UI state ───────────────────────────────────────── */
  const entries: LogEntry[] = useMemo(
    () => formatLog(state.events, state),
    [state],
  );

  const showDiscard =
    !!humanId && state.phase === 'discard' && (state.pendingDiscards?.[humanId] ?? 0) > 0;

  const showStealPicker =
    modal === 'steal' || (!!humanId && state.phase === 'raider' && state.pendingSteal && actor === humanId && stealVictims.length > 0);

  useEffect(() => {
    if (state.phase === 'gameover') setModal('end');
  }, [state.phase]);

  const opponents = state.players.filter((p) => p.id !== humanId);
  const human = state.players.find((p) => p.id === humanId);

  const newGame = useCallback(
    (seed?: number) => {
      api.newGame(seed);
      setModal(null);
      setBuildSelection(null);
      setPendingCard(null);
      startTime.current = Date.now();
    },
    [api],
  );

  return (
    <div className="if-app">
      <div className="if-toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`if-toast${t.error ? ' if-toast--error' : ''}`}>
            {t.text}
          </div>
        ))}
      </div>

      <TopBar
        state={state}
        playerName={playerName}
        onOpenMenu={() => setModal('menu')}
        onOpenRules={() => setModal('rules')}
      />

      <div className="if-main">
        <aside className="if-sidecol if-sidecol--left" aria-label="Opponents">
          {opponents.map((p) => (
            <PlayerPanel
              key={p.id}
              player={p}
              state={state}
              isHuman={false}
              isBot={api.isBot(p.id)}
            />
          ))}
        </aside>

        <main className="if-boardcol">
          <GameBoard
            state={state}
            mode={boardMode}
            onPlace={onPlace}
            onMoveRaider={onMoveRaider}
            freshIds={freshIds}
            colorOf={colorOf}
          />
        </main>

        <aside className="if-sidecol if-sidecol--right" aria-label="You and game feed">
          {human && (
            <PlayerPanel player={human} state={state} isHuman isBot={false} compact />
          )}
          <LogChatTabs entries={entries} colorOf={colorOf} />
        </aside>
      </div>

      {autopilot ? (
        <div className="if-autopilot-bar">
          <span className="if-chip if-chip--gold">AI Battle — sit back and watch</span>
          <button className="if-btn if-btn--ghost if-btn--sm" onClick={() => newGame()}>
            Restart
          </button>
          <button className="if-btn if-btn--ghost if-btn--sm" onClick={onQuit}>
            Menu
          </button>
        </div>
      ) : (
        humanId && (
          <ControlDeck
            state={state}
            humanId={humanId}
            legal={legal}
            diceRolling={diceRolling}
            canAct={humanActive}
            buildSelection={buildSelection}
            onRoll={onRoll}
            onEndTurn={() => humanId && dispatch({ type: 'END_TURN', playerId: humanId })}
            onSelectBuild={setBuildSelection}
            onBuyCard={() => humanId && dispatch({ type: 'BUY_DEVELOPMENT_CARD', playerId: humanId })}
            onOpenTrade={() => setModal('trade')}
            onPlayCard={onPlayCard}
          />
        )
      )}

      {/* modals */}
      {modal === 'menu' && (
        <GameMenuModal
          onClose={() => setModal(null)}
          onOpenRules={() => setModal('rules')}
          onRestart={() => newGame()}
          onResign={() => humanId && dispatch({ type: 'RESIGN', playerId: humanId })}
          onQuitToMenu={onQuit}
        />
      )}
      {modal === 'rules' && <RulesModal onClose={() => setModal(null)} />}
      {modal === 'trade' && humanId && (
        <TradeModal
          state={state}
          humanId={humanId}
          playerName={playerName}
          onBankTrade={onBankTrade}
          onPropose={(toPlayerId, offer, request) => {
            const evs = dispatch({ type: 'TRADE_PROPOSE', playerId: humanId, toPlayerId, offer, request });
            const prop = evs?.find((e) => e.type === 'TRADE_PROPOSED');
            if (prop && prop.type === 'TRADE_PROPOSED' && api.isBot(prop.data.toPlayerId)) {
              const tradeId = prop.data.tradeId;
              const toId = prop.data.toPlayerId;
              setTimeout(() => {
                const st = api.game.getState();
                const tr = st.pendingTrades.find((x) => x.id === tradeId);
                if (!tr) return;
                const ok = botAcceptsTrade(tr.offer, tr.request, botRng.current);
                dispatch({ type: ok ? 'TRADE_ACCEPT' : 'TRADE_DECLINE', playerId: toId, tradeId });
                toast(ok ? `${playerName(toId)} accepted your trade.` : `${playerName(toId)} declined your trade.`);
              }, 900);
            }
          }}
          onAccept={(tradeId) => humanId && dispatch({ type: 'TRADE_ACCEPT', playerId: humanId, tradeId })}
          onDecline={(tradeId) => humanId && dispatch({ type: 'TRADE_DECLINE', playerId: humanId, tradeId })}
          onClose={() => setModal(null)}
        />
      )}
      {showDiscard && humanId && (
        <DiscardModal
          state={state}
          humanId={humanId}
          onConfirm={(resources) => dispatch({ type: 'DISCARD_RESOURCES', playerId: humanId, resources })}
        />
      )}
      {modal === 'harvest' && pendingCard && (
        <HarvestModal
          bank={state.bank}
          onConfirm={(resources) => {
            if (humanId && pendingCard) {
              dispatch({ type: 'PLAY_DEVELOPMENT_CARD', playerId: humanId, cardUid: pendingCard, params: { resources } });
            }
            setPendingCard(null);
            setModal(null);
          }}
          onClose={() => {
            setPendingCard(null);
            setModal(null);
          }}
        />
      )}
      {modal === 'embargo' && pendingCard && (
        <EmbargoModal
          onConfirm={(resource) => {
            if (humanId && pendingCard) {
              dispatch({ type: 'PLAY_DEVELOPMENT_CARD', playerId: humanId, cardUid: pendingCard, params: { resource } });
            }
            setPendingCard(null);
            setModal(null);
          }}
          onClose={() => {
            setPendingCard(null);
            setModal(null);
          }}
        />
      )}
      {showStealPicker && (
        <StealModal
          victims={stealVictims}
          onPick={(victimId) => {
            if (humanId) dispatch({ type: 'STEAL_RESOURCE', playerId: humanId, targetPlayerId: victimId });
            setModal(null);
          }}
        />
      )}
      {modal === 'end' && (
        <GameEndModal
          state={state}
          playerName={playerName}
          durationMs={Date.now() - startTime.current}
          onPlayAgain={() => newGame()}
          onViewReplay={() => toast('Replays arrive in Milestone 9.')}
          onQuitToMenu={onQuit}
        />
      )}

      {/* incoming trade banner */}
      {!autopilot &&
        humanId &&
        state.pendingTrades.some((t) => t.toPlayerId === humanId) && (
          <button className="if-trade-banner" onClick={() => setModal('trade')}>
            ⇄ {playerName(state.pendingTrades.find((t) => t.toPlayerId === humanId)?.fromPlayerId)}{' '}
            proposed a trade — review
          </button>
        )}
    </div>
  );
}
