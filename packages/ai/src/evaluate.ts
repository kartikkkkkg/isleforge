/**
 * Modular strategic evaluators. Each takes a candidate action and returns a
 * { score, reasons } pair — higher is better. All read-only; all use public
 * information only. Reasons feed the ?debugAI=1 panel.
 */

import {
  COSTS,
  RESOURCES,
  VICTORY_POINT_TARGET,
  bankTradeRatio,
  tileResource,
  victoryPoints,
  type Command,
  type DevCard,
  type GameState,
  type PlayerState,
  type PublicGameState,
  type ResourceCount,
  type ResourceType,
} from '@isleforge/game-engine';
import {
  armyRaceTension,
  assessThreats,
  cornerYield,
  frontierCorners,
  pips,
  playerProduction,
  portAtCorner,
  publicVp,
  resourceTotal,
  roadRaceTension,
  touchesOpponentRoad,
  type AnyState,
  type OpponentThreat,
} from './analysis.js';
import type { EvalReason, ResourceValuation, Weights } from './types.js';

export interface EvalContext {
  weights: Weights;
  threats: OpponentThreat[];
  /** My total VP including hidden landmarks. */
  myVpTotal: number;
  myVpPublic: number;
  /** 0..1 urgency — 1 when one VP away from winning. */
  urgency: number;
  /** My expected production per resource. */
  production: ResourceCount;
  /** Marginal utility per resource (what I should chase). */
  marginal: ResourceValuation;
  /** Most threatening opponent (lowest turnsToWin), if any. */
  topThreat: OpponentThreat | null;
  frontier: Set<string>;
  roadTension: number;
  armyTension: number;
}

export interface Scored {
  score: number;
  reasons: EvalReason[];
}

const r = (label: string, points: number): EvalReason => ({ label, points });

function meOf(state: AnyState, playerId: string): PlayerState {
  const p = state.players.find((x) => x.id === playerId);
  if (!p) throw new Error(`AI: unknown player ${playerId}`);
  // victoryPoints/scoring only read public fields (buildings, bonuses);
  // devCards are never consulted, so the masked view is safe here.
  return p as PlayerState;
}

/** Marginal utility: scarce + build-blocking resources are worth more. */
function marginalUtility(
  state: AnyState,
  playerId: string,
  production: ResourceCount,
): ResourceValuation {
  const me = meOf(state, playerId);
  const out = {} as ResourceValuation;
  for (const res of RESOURCES) {
    let v = 1.0;
    if (production[res] <= 0.01) v += 0.7; // I produce none — scarce for me
    out[res] = v;
  }
  // Resources blocking my cheapest near-term builds are precious.
  const builds: (keyof typeof COSTS)[] = ['road', 'settlement', 'city', 'devCard'];
  for (const b of builds) {
    const cost = COSTS[b];
    let missing = 0;
    for (const res of RESOURCES) {
      const short = Math.max(0, cost[res] - me.resources[res]);
      if (short > 0) {
        out[res] += short * 0.9;
        missing += short;
      }
    }
    // Builds I can already afford need no extra weight.
    if (missing === 0) continue;
  }
  return out;
}

export function buildEvalContext(
  state: AnyState,
  playerId: string,
  weights: Weights,
): EvalContext {
  const me = meOf(state, playerId);
  const vp = victoryPoints(me, state as GameState);
  const urgency = Math.max(0, Math.min(1, (vp.total - 6) / 4));
  const production = playerProduction(state, playerId);
  const threats = assessThreats(state, playerId);
  return {
    weights,
    threats,
    myVpTotal: vp.total,
    myVpPublic: vp.public,
    urgency,
    production,
    marginal: marginalUtility(state, playerId, production),
    topThreat: threats[0] ?? null,
    frontier: frontierCorners(state, playerId),
    roadTension: roadRaceTension(state, playerId),
    armyTension: armyRaceTension(state, playerId),
  };
}

/** Urgency-scaled VP value: points matter more when close to winning. */
function vpValue(ctx: EvalContext, points: number): number {
  return points * ctx.weights.vp * (1 + ctx.urgency * (ctx.weights.vpUrgency / 22));
}

// ---------------------------------------------------------------------------
// Settlements
// ---------------------------------------------------------------------------

export function evaluateSettlement(
  state: AnyState,
  playerId: string,
  cornerId: string,
  ctx: EvalContext,
  setupSecond = false,
): Scored {
  const w = ctx.weights;
  const y = cornerYield(state.board, cornerId, state.raiderTileKey);
  const reasons: EvalReason[] = [];
  let score = 0;

  // Expected production, scarcity-weighted.
  let prodScore = 0;
  for (const res of RESOURCES) {
    prodScore += y.perResource[res] * ctx.marginal[res];
  }
  prodScore *= w.production;
  score += prodScore;
  reasons.push(r(`production ${y.total.toFixed(2)}/turn`, prodScore));

  const div = y.diversity * w.diversity;
  score += div;
  if (y.diversity >= 2) reasons.push(r(`${y.diversity} resource types`, div));

  const port = portAtCorner(state.board, cornerId);
  if (port) {
    const pv = w.port * (port.kind === 'three' ? 1 : 1.6);
    score += pv;
    reasons.push(r(`port (${port.kind === 'three' ? '3:1' : `2:1 ${port.kind}`})`, pv));
  }

  // Second setup placement should complement the first.
  if (setupSecond) {
    const me = meOf(state, playerId);
    const first = me.settlements[0];
    if (first) {
      const y0 = cornerYield(state.board, first, state.raiderTileKey);
      let complement = 0;
      for (const res of RESOURCES) {
        if (y0.perResource[res] <= 0.01 && y.perResource[res] > 0.01) complement += 2;
      }
      const cs = complement * w.diversity;
      score += cs;
      if (complement > 0) reasons.push(r('complements first settlement', cs));
    }
  }

  // Blocking: placing next to an opponent's network crowds them out.
  if (touchesOpponentRoad(state, playerId, cornerId)) {
    score += w.blocking;
    reasons.push(r('blocks opponent expansion', w.blocking));
  }

  // Don't settle on a raided tile's production (already excluded from yield,
  // but flag it when the yield is suspiciously low).
  if (y.total < 0.15) {
    score -= 12;
    reasons.push(r('poor production', -12));
  }

  score *= w.settlementBias;
  return { score, reasons };
}

// ---------------------------------------------------------------------------
// Roads
// ---------------------------------------------------------------------------

export function evaluateRoad(
  state: AnyState,
  playerId: string,
  edgeId: string,
  ctx: EvalContext,
): Scored {
  const w = ctx.weights;
  const reasons: EvalReason[] = [];
  let score = 1.5; // base: roads are rarely useless
  reasons.push(r('network growth', 1.5));

  // Does it reach toward open settlement spots?
  const ends = state.board.edges[edgeId]?.corners;
  let frontierHits = 0;
  if (ends) {
    for (const c of ends) if (ctx.frontier.has(c)) frontierHits++;
  }
  const exp = frontierHits * w.expansion;
  score += exp;
  if (frontierHits > 0) reasons.push(r(`toward ${frontierHits} open spot(s)`, exp));

  // Longest-road race.
  if (ctx.roadTension > 0.25) {
    const rs = ctx.roadTension * w.roadRace;
    score += rs;
    reasons.push(r('longest-road race', rs));
  }

  // Blocking / racing an opponent along the same corridor.
  if (ends && ends.some((c) => touchesOpponentRoad(state, playerId, c))) {
    const b = w.blocking * 0.6;
    score += b;
    reasons.push(r('contests opponent corridor', b));
  }

  // Toward a port corner.
  if (ends && ends.some((c) => portAtCorner(state.board, c))) {
    const pv = w.port * 0.5;
    score += pv;
    reasons.push(r('toward port', pv));
  }

  score *= w.roadBias;
  return { score, reasons };
}

// ---------------------------------------------------------------------------
// Cities
// ---------------------------------------------------------------------------

export function evaluateCity(
  state: AnyState,
  playerId: string,
  cornerId: string,
  ctx: EvalContext,
): Scored {
  const w = ctx.weights;
  const reasons: EvalReason[] = [];
  const y = cornerYield(state.board, cornerId, state.raiderTileKey);

  // Doubling production on this corner.
  let prodScore = 0;
  for (const res of RESOURCES) prodScore += y.perResource[res] * ctx.marginal[res];
  prodScore *= w.production * w.cityBias;
  let score = prodScore;
  reasons.push(r(`doubles ${y.total.toFixed(2)}/turn`, prodScore));

  const vv = vpValue(ctx, 1);
  score += vv;
  reasons.push(r('+1 VP', vv));

  if (y.total < 0.2) {
    score -= 8;
    reasons.push(r('weak tile for a city', -8));
  }
  return { score, reasons };
}

// ---------------------------------------------------------------------------
// Development cards
// ---------------------------------------------------------------------------

export function evaluateDevCardBuy(
  state: AnyState,
  playerId: string,
  ctx: EvalContext,
): Scored {
  const w = ctx.weights;
  const reasons: EvalReason[] = [];
  let score = w.cardBuy;
  reasons.push(r('card optionality', w.cardBuy));

  // Guardians are worth more mid army-race; any card is a lottery VP ticket.
  if (ctx.armyTension > 0.3) {
    const a = ctx.armyTension * w.armyRace * 0.8;
    score += a;
    reasons.push(r('army race', a));
  }
  if (ctx.urgency > 0.5) {
    const u = ctx.urgency * 8;
    score += u;
    reasons.push(r('VP lottery when close', u));
  }
  // Don't buy when the deck is nearly empty.
  if (state.devDeck.length < 4) {
    score -= 6;
    reasons.push(r('thin deck', -6));
  }
  return { score, reasons };
}

export function evaluateDevCardPlay(
  state: AnyState,
  playerId: string,
  card: DevCard,
  params: Command & { type: 'PLAY_DEVELOPMENT_CARD' },
  ctx: EvalContext,
): Scored {
  const w = ctx.weights;
  const reasons: EvalReason[] = [];
  let score = 0;

  switch (card.type) {
    case 'guardian': {
      // Progress to largest army + an immediate raider move follows.
      const a = (0.5 + ctx.armyTension) * w.armyRace * 2;
      score += a;
      reasons.push(r('army progress + raider move', a));
      // Extra when an opponent is about to win and must be slowed.
      if (ctx.topThreat && ctx.topThreat.turnsToWin <= 3) {
        score += w.raiderAggression * 1.5;
        reasons.push(r('slow the leader', w.raiderAggression * 1.5));
      }
      break;
    }
    case 'trailblazer': {
      // Two free roads: expansion + road race.
      const t = w.expansion * 2 + ctx.roadTension * w.roadRace;
      score += t;
      reasons.push(r('two free roads', t));
      break;
    }
    case 'harvest': {
      const pair = params.params?.resources;
      let v = 0;
      if (pair) {
        for (const res of pair) v += ctx.marginal[res];
      }
      const h = v * 6;
      score += h;
      reasons.push(r(`harvest ${pair?.join('+') ?? '?'}`, h));
      break;
    }
    case 'embargo': {
      const res = params.params?.resource;
      // Deny the leader's best production resource.
      let e = 2;
      if (res && ctx.topThreat) {
        const tp = playerProduction(state, ctx.topThreat.playerId);
        e += tp[res] * 30;
      }
      const es = e * (0.5 + w.raiderAggression / 8);
      score += es;
      reasons.push(r(`embargo ${res ?? '?'}`, es));
      break;
    }
    case 'landmark':
      // Landmarks are passive VP; playing is never useful.
      return { score: -100, reasons: [r('landmark is passive', -100)] };
  }
  return { score, reasons };
}

// ---------------------------------------------------------------------------
// Bank / port trades
// ---------------------------------------------------------------------------

export function evaluateBankTrade(
  state: AnyState,
  playerId: string,
  give: ResourceType,
  receive: ResourceType,
  ctx: EvalContext,
): Scored {
  const w = ctx.weights;
  const reasons: EvalReason[] = [];
  const ratio = bankTradeRatio(state as GameState, playerId, give);

  // What does the received resource unlock? Value it at marginal utility,
  // with a bonus when it completes a build we can afford right after.
  const me = meOf(state, playerId);
  const after: ResourceCount = { ...me.resources };
  after[give] -= ratio;
  after[receive] += 1;

  let unlockBonus = 0;
  for (const b of Object.keys(COSTS) as (keyof typeof COSTS)[]) {
    const cost = COSTS[b];
    let afford = true;
    for (const res of RESOURCES) if (after[res] < cost[res]) afford = false;
    if (afford) {
      // Which build would this be? Rough value by type.
      const bv = b === 'city' ? 14 : b === 'settlement' ? 12 : b === 'road' ? 6 : 8;
      unlockBonus = Math.max(unlockBonus, bv);
    }
  }

  const gain = ctx.marginal[receive] * 8 + unlockBonus;
  const cost = ctx.marginal[give] * ratio * 4;
  let score = (gain - cost) * (0.4 + w.tradeWillingness);
  reasons.push(r(`${ratio}:1 ${give}→${receive}`, score));
  if (unlockBonus > 0) reasons.push(r('unlocks a build', unlockBonus * 0.4));

  // Never trade away the last of a scarce resource cheaply.
  if (me.resources[give] <= ratio && ctx.production[give] <= 0.01) {
    score -= 10;
    reasons.push(r('last of a scarce resource', -10));
  }
  return { score, reasons };
}

// ---------------------------------------------------------------------------
// Raider
// ---------------------------------------------------------------------------

export function evaluateRaider(
  state: AnyState,
  playerId: string,
  tileKey: string,
  ctx: EvalContext,
): Scored {
  const w = ctx.weights;
  const reasons: EvalReason[] = [];
  const tile = state.board.tileByKey[tileKey];
  let score = 0;
  if (!tile) return { score: -100, reasons: [r('unknown tile', -100)] };

  // Never block my own production.
  const me = meOf(state, playerId);
  const myCorners = new Set([...me.settlements, ...me.cities]);
  const tileCorners = Object.keys(state.board.corners).filter((c) =>
    (state.board.corners[c]?.tiles ?? []).includes(tileKey),
  );
  if (tileCorners.some((c) => myCorners.has(c))) {
    return { score: -100, reasons: [r('blocks my own production', -100)] };
  }

  // Hit opponents: weight by their threat and their production on this tile.
  for (const t of ctx.threats) {
    const opp = meOf(state, t.playerId);
    let oppProd = 0;
    for (const c of [...opp.settlements, ...opp.cities]) {
      if (!tileCorners.includes(c)) continue;
      const y = cornerYield(state.board, c, '');
      const rt = tileResource(tile);
      if (rt) oppProd += y.perResource[rt] * (opp.settlements.includes(c) ? 1 : 2);
    }
    if (oppProd > 0.01) {
      const danger = t.turnsToWin <= 4 ? 2.2 : t.turnsToWin <= 8 ? 1.4 : 1.0;
      const v = oppProd * 26 * danger * (0.4 + w.raiderAggression / 6);
      score += v;
      reasons.push(r(`hits ${t.name} (${oppProd.toFixed(2)}/t)`, v));
    }
  }

  // Blocking a high-probability number has baseline value.
  if (tile.number !== null) {
    const pb = pips(tile.number) * 0.8;
    score += pb;
    reasons.push(r(`blocks ${tile.number}`, pb));
  }

  // Prefer stealing victims: handled by the steal evaluator; small bonus
  // when any opponent has a building here (steal chance).
  return { score, reasons };
}

/** Choose the best steal victim among legal STEAL_RESOURCE commands. */
export function evaluateSteal(
  target: OpponentThreat | undefined,
  ctx: EvalContext,
): Scored {
  if (!target) return { score: 1, reasons: [r('no preferred victim', 1)] };
  const danger = target.turnsToWin <= 4 ? 3 : target.turnsToWin <= 8 ? 1.6 : 1;
  const s = 4 * danger * (0.5 + ctx.weights.raiderAggression / 8);
  return { score: s, reasons: [r(`steal from ${target.name}`, s)] };
}

// ---------------------------------------------------------------------------
// Discard
// ---------------------------------------------------------------------------

/** Score a discard bundle: less negative = less painful. */
export function evaluateDiscard(
  state: AnyState,
  playerId: string,
  resources: ResourceCount,
  ctx: EvalContext,
): Scored {
  let pain = 0;
  const parts: string[] = [];
  for (const res of RESOURCES) {
    const n = resources[res] ?? 0;
    if (n > 0) {
      pain += n * ctx.marginal[res];
      parts.push(`${n} ${res}`);
    }
  }
  return { score: -pain, reasons: [r(`discard ${parts.join(', ')}`, -pain)] };
}

// ---------------------------------------------------------------------------
// Position (Expert lookahead)
// ---------------------------------------------------------------------------

/** Static evaluation of a position: higher = better for playerId. */
export function evaluatePosition(
  state: AnyState,
  playerId: string,
  weights: Weights,
): number {
  const me = meOf(state, playerId);
  const vp = victoryPoints(me, state as GameState);
  const prod = playerProduction(state, playerId);
  const threats = assessThreats(state, playerId);
  const bestThreatVp = threats.length > 0 ? threats[0]!.vp : 0;

  let s = vp.total * weights.vp;
  s += resourceTotal(prod) * weights.production * 4;
  // Ahead/behind vs the leader.
  s += (vp.public - bestThreatVp) * weights.vp * 0.8;
  // Network size.
  s += me.roads.length * weights.expansion * 0.5;
  // Card hand optionality.
  s += resourceTotal(me.resources) * 0.4;
  return s;
}

/**
 * Immediate-win check for a build command: would this exact command bring
 * total VP to the target? Uses the engine's own scoring on a projected
 * player (no engine simulation needed for the common cases).
 */
export function wouldWinWith(
  state: GameState,
  playerId: string,
  cmd: Command,
): boolean {
  const me = state.players.find((p) => p.id === playerId);
  if (!me) return false;
  const projected: typeof me = {
    ...me,
    settlements: [...me.settlements],
    cities: [...me.cities],
    roads: [...me.roads],
  };
  if (cmd.type === 'BUILD_SETTLEMENT' || cmd.type === 'PLACE_SETTLEMENT') {
    projected.settlements.push(cmd.cornerId);
  } else if (cmd.type === 'BUILD_CITY') {
    projected.settlements = projected.settlements.filter((c) => c !== cmd.cornerId);
    projected.cities.push(cmd.cornerId);
  } else if (cmd.type === 'BUILD_ROAD' || cmd.type === 'PLACE_ROAD') {
    projected.roads.push(cmd.edgeId);
  } else {
    return false;
  }
  const pst = { ...state, players: state.players.map((p) => (p.id === playerId ? projected : p)) };
  const vp = victoryPoints(projected, pst);
  if (vp.total >= VICTORY_POINT_TARGET) return true;
  // Longest-road swing could also decide it — cheap check via road count.
  return false;
}
