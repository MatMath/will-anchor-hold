import { DEG, knotsToMs } from './constants';
import { anchorHolding, upliftFactor } from './anchor';
import { submergedWeight } from './chain';
import { spanForTension } from './catenary';
import { brent } from './numeric';
import { ropeStrain, type RopeType } from './rope';
import type { Windage } from './wind';
import type { BoatType } from './windage';
import { hullWater } from './waves';
import { fishtailExtreme, waveResponse, type FishtailExtreme, type WaveResponse } from './dynamics';
import {
  initialPose,
  toEarth,
  snatchLoad,
  solveEquilibrium,
  type Equilibrium,
  type MooringModel,
  type Pose,
  type SternLine,
  type Vec2,
} from './mooring';

/** Everything the calculation needs, in SI units (N, m, kg) except where noted. */
export interface ScenarioInput {
  boatType: BoatType;
  loa: number;
  beam: number;
  displacement: number;
  /** Bow roller height above water, m. */
  rollerHeight: number;
  /** How far the roller sticks out ahead of the stem, m. */
  rollerOverhang: number;
  windage: Windage;
  /** Centre of effort, m from midships (+ forward). */
  ceX: number;

  windKn: number;
  /** Direction the wind comes FROM, degrees clockwise from the at-rest bow (90 = starboard beam). */
  windFromDeg: number;
  /** Gust speed / mean speed. */
  gustFactor: number;

  depth: number;
  chain: { kgPerM: number; length: number; mbl: number; ea: number };
  snubber: null | { rope: RopeType; length: number; mbl: number };
  anchor: {
    mass: number;
    /** Holding force (kgf) per kg of anchor for the chosen type and bottom. */
    holdingRatio: number;
    /** Horizontal distance from the shore (quay face) to the anchor, m. */
    distance: number;
    /** Sideways offset of the anchor from the boat's centreline at rest, m (+ to port). */
    offset: number;
  };
  lines: {
    /** 0 = no stern lines: the boat swings on its anchor. */
    count: 0 | 1 | 2;
    rope: RopeType;
    /** Catalogue MBL of one line, N. */
    mbl: number;
    /** Knot / splice / chafe efficiency, 0–1. */
    efficiency: number;
    /** Unstretched length of each line, cleat → shore point, m. */
    length: number;
    /** Distance between port and starboard stern cleats, m. */
    cleatSpacing: number;
    /** Distance of the cleats forward of the transom, m. */
    cleatInset: number;
    cleatHeight: number;
    /** Distance between the two shore points (0 = both to one ring or rock), m. */
    shoreSpread: number;
    shoreHeight: number;
    /** Lines cross over: port cleat to the starboard shore point and vice versa. */
    crossed: boolean;
    /** Which cleat a single line uses. */
    single: 'port' | 'centre' | 'starboard';
  };
  /** Wind waves from the wind direction: significant height (m) and peak period (s); null = flat water. */
  waves: null | { hs: number; tp: number };
  /** Fishtailing at anchor (only when there are no stern lines): swing ± amplitude, and its period (animation only). */
  fishtail: null | { amplitudeDeg: number; periodS: number };
  /** Boat speed used for the indicative snatch-load estimate, m/s. */
  snatchSpeed: number;
}

/** Knot / splice / chafe allowance applied to every stern line: 85% of the catalogue MBL. */
export const LINE_EFFICIENCY = 0.85;

/** Stern cleats are taken 80% of the beam apart on a monohull and the full beam apart on a multihull. */
export const sternCleatSpacing = (type: BoatType, beam: number): number => (type === 'catamaran' ? 1 : 0.8) * beam;

export type Status = 'green' | 'amber' | 'red';

/** Structural thresholds: amber above 30% MBL, red above 50% MBL. */
export const loadStatus = (ratio: number): Status => (ratio > 0.5 ? 'red' : ratio > 0.3 ? 'amber' : 'green');
/** Anchor holding is far less certain than a breaking load: amber above 50%, red above 80% of estimated holding. */
export const holdingStatus = (ratio: number): Status => (ratio > 0.8 ? 'red' : ratio > 0.5 ? 'amber' : 'green');

export function buildModel(inp: ScenarioInput): MooringModel {
  const L = inp.loa;
  const ln = inp.lines;
  const sternU = -L / 2 + ln.cleatInset;
  const half = ln.cleatSpacing / 2;
  const spread = ln.shoreSpread / 2;
  const line = (attach: Vec2, shore: Vec2): SternLine => ({
    attach,
    attachHeight: ln.cleatHeight,
    shore,
    shoreHeight: ln.shoreHeight,
    length: ln.length,
    rope: ln.rope,
    mbl: ln.mbl * ln.efficiency,
  });
  let lines: SternLine[];
  if (ln.count === 2) {
    const portShore: Vec2 = [0, ln.crossed ? -spread : spread];
    const stbdShore: Vec2 = [0, ln.crossed ? spread : -spread];
    lines = [line([sternU, half], portShore), line([sternU, -half], stbdShore)];
  } else if (ln.count === 0) {
    lines = [];
  } else {
    const v = ln.single === 'port' ? half : ln.single === 'starboard' ? -half : 0;
    lines = [line([sternU, v], [0, 0])];
  }
  return {
    loa: L,
    bowX: L / 2 + inp.rollerOverhang,
    windage: inp.windage,
    ceX: inp.ceX,
    rode: {
      length: inp.chain.length,
      w: submergedWeight(inp.chain.kgPerM),
      ea: inp.chain.ea,
      z: inp.depth + inp.rollerHeight,
      snubber: inp.snubber ?? undefined,
    },
    anchor: [inp.anchor.distance, inp.anchor.offset],
    lines,
    displacement: inp.displacement,
    waves:
      inp.waves && inp.waves.hs > 0
        ? { spec: { hs: inp.waves.hs, tp: inp.waves.tp }, hull: hullWater(inp.boatType, inp.loa, inp.beam), depth: inp.depth }
        : null,
  };
}

export interface ElementLoad {
  tension: number;
  mbl: number;
  ratio: number;
  status: Status;
}

export interface AnchorCheck {
  load: number;
  upliftDeg: number;
  pull: 'horizontal' | 'upward';
  holdingFlat: number;
  holding: number;
  upliftFactor: number;
  ratio: number;
  status: Status;
}

/** Loads of every element in one situation (static, fishtail extreme, or largest wave). */
export interface Loads {
  chain: ElementLoad;
  snubber: ElementLoad | null;
  lines: ElementLoad[];
  anchor: AnchorCheck;
}

export interface CaseResult {
  eq: Equilibrium;
  windKn: number;
  drift: {
    /** Movement of midships from the at-rest position, m (earth frame). */
    dx: number;
    dy: number;
    /** Heading change, degrees (+ = bow to port). */
    dPsiDeg: number;
    /** Sideways (y) movement of bow roller and stern, m. */
    bowDy: number;
    sternDy: number;
  };
  chain: ElementLoad;
  snubber: ElementLoad | null;
  lines: ElementLoad[];
  anchor: AnchorCheck;
  snatch: { k: number; mEff: number; force: number };
  /** Boat held at the end of its fishtail swing (swinging at anchor only). */
  fishtail: (FishtailExtreme & Loads) | null;
  /** Largest wave (1.86·Hs) acting on the static or fishtail equilibrium. */
  waves: (WaveResponse & Loads) | null;
  /** Worst of static, fishtail and waves for each element, and what drives it. */
  peak: Loads & { source: string };
}

export interface ScenarioResult {
  model: MooringModel;
  rest: Equilibrium;
  sustained: CaseResult;
  gust: CaseResult;
  warnings: string[];
}

const element = (tension: number, mbl: number): ElementLoad => {
  const ratio = mbl > 0 ? tension / mbl : Infinity;
  return { tension, mbl, ratio, status: loadStatus(ratio) };
};

function anchorCheck(inp: ScenarioInput, load: number, upliftDeg: number): AnchorCheck {
  const flat = anchorHolding(inp.anchor.mass, inp.anchor.holdingRatio, 0);
  const holding = anchorHolding(inp.anchor.mass, inp.anchor.holdingRatio, upliftDeg);
  const ratio = holding > 0 ? load / holding : Infinity;
  return {
    load,
    upliftDeg,
    pull: upliftDeg > 1e-6 ? 'upward' : 'horizontal',
    holdingFlat: flat,
    holding,
    upliftFactor: upliftFactor(upliftDeg),
    ratio,
    status: holdingStatus(ratio),
  };
}

function loadsOf(inp: ScenarioInput, chainT: number, lineT: number[], anchorT: number, upliftDeg: number): Loads {
  return {
    chain: element(chainT, inp.chain.mbl),
    snubber: inp.snubber ? element(chainT, inp.snubber.mbl) : null,
    lines: lineT.map((t) => element(t, inp.lines.mbl * inp.lines.efficiency)),
    anchor: anchorCheck(inp, anchorT, upliftDeg),
  };
}

const eqLoads = (inp: ScenarioInput, eq: Equilibrium): Loads =>
  loadsOf(inp, eq.rode.tensionTop, eq.lines.map((l) => l.tension), eq.rode.tensionAnchor, eq.rode.angleAnchor / DEG);

/** Element-by-element worst of several load sets. */
function worstOf(sets: Loads[]): Loads {
  const pick = <T extends { ratio: number }>(xs: T[]): T => xs.reduce((a, b) => (b.ratio > a.ratio ? b : a));
  return {
    chain: pick(sets.map((s) => s.chain)),
    snubber: sets[0].snubber ? pick(sets.map((s) => s.snubber!)) : null,
    lines: sets[0].lines.map((_, i) => pick(sets.map((s) => s.lines[i]))),
    anchor: pick(sets.map((s) => s.anchor)),
  };
}

/** Fishtail and wave loads on top of a solved equilibrium, and the resulting peak. */
export function dynamicLoads(inp: ScenarioInput, model: MooringModel, eq: Equilibrium): Pick<CaseResult, 'fishtail' | 'waves' | 'peak'> {
  const staticLoads = eqLoads(inp, eq);
  const ft = inp.fishtail ? fishtailExtreme(model, eq, inp.fishtail.amplitudeDeg) : null;
  const fishtail = ft ? { ...ft, ...eqLoads(inp, ft.eq) } : null;
  const base = ft?.eq ?? eq;
  const wr = waveResponse(model, base);
  const waves = wr ? { ...wr, ...loadsOf(inp, wr.chainMax, wr.linesMax, wr.anchorMax, wr.upliftMaxDeg) } : null;
  const sets = [staticLoads, ...(fishtail ? [fishtail] : []), ...(waves ? [waves] : [])];
  const parts = [fishtail ? `fishtail ±${fishtail.amplitudeDeg}°` : '', waves ? `largest wave ${waves.height.toFixed(1)} m` : ''].filter(Boolean);
  return { fishtail, waves, peak: { ...worstOf(sets), source: parts.length ? parts.join(' + ') : 'static' } };
}

const noDynamics = (inp: ScenarioInput, eq: Equilibrium): Pick<CaseResult, 'fishtail' | 'waves' | 'peak'> => ({
  fishtail: null,
  waves: null,
  peak: { ...eqLoads(inp, eq), source: 'static' },
});

/** True when fishtailing or waves add loads on top of the static equilibrium. */
export const hasDynamics = (inp: ScenarioInput): boolean =>
  Boolean((inp.waves && inp.waves.hs > 0) || (inp.fishtail && inp.fishtail.amplitudeDeg > 0 && inp.lines.count === 0));

export function evaluateCase(inp: ScenarioInput, model: MooringModel, rest: Equilibrium, windKn: number, initial?: Pose, dynamics = true): CaseResult {
  const eq = solveEquilibrium(model, knotsToMs(windKn), inp.windFromDeg, { initial: initial ?? rest.pose });
  const sternU = model.lines[0]?.attach[0] ?? -model.loa / 2;
  const sternY = (p: Pose): number => p.y + Math.sin(p.psi) * sternU;
  const upliftDeg = eq.rode.angleAnchor / DEG;
  return {
    eq,
    windKn,
    drift: {
      dx: eq.pose.x - rest.pose.x,
      dy: eq.pose.y - rest.pose.y,
      dPsiDeg: (eq.pose.psi - rest.pose.psi) / DEG,
      bowDy: eq.bow[1] - rest.bow[1],
      sternDy: sternY(eq.pose) - sternY(rest.pose),
    },
    chain: element(eq.rode.tensionTop, inp.chain.mbl),
    snubber: inp.snubber ? element(eq.rode.tensionTop, inp.snubber.mbl) : null,
    lines: eq.lines.map((l) => element(l.tension, inp.lines.mbl * inp.lines.efficiency)),
    anchor: { ...anchorCheck(inp, eq.rode.tensionAnchor, upliftDeg), pull: eq.rode.vAnchor > 1e-6 ? 'upward' : 'horizontal' },
    snatch: snatchLoad(model, eq, inp.snatchSpeed),
    ...(dynamics ? dynamicLoads(inp, model, eq) : noDynamics(inp, eq)),
  };
}

export function solveRest(model: MooringModel): Equilibrium {
  return solveEquilibrium(model, 0, 90, { initial: initialPose(model) });
}

/** Full analysis. With dynamics = false, fishtail and wave loads are skipped (fast, for live slider drags). */
export function runScenario(inp: ScenarioInput, dynamics = true): ScenarioResult {
  const warnings: string[] = [];
  const z = inp.depth + inp.rollerHeight;
  if (inp.chain.length <= z) throw new Error(`Chain (${inp.chain.length} m) is shorter than depth + roller height (${z.toFixed(1)} m).`);
  const model = buildModel(inp);
  const rest = solveRest(model);
  const sustained = evaluateCase(inp, model, rest, inp.windKn, undefined, dynamics);
  const gust = evaluateCase(inp, model, rest, inp.windKn * inp.gustFactor, sustained.eq.pose, dynamics);

  if (!rest.converged || !sustained.eq.converged || !gust.eq.converged)
    warnings.push('The equilibrium solver did not fully converge — check the geometry (lengths, distances).');
  const swinging = model.lines.length === 0;
  if (swinging)
    warnings.push('No stern lines: the boat swings on its anchor and lies head to wind. Allow swinging room — it can sweep a circle of chain span + boat length.');
  else if (rest.rode.slack && rest.lines.every((l) => l.slack))
    warnings.push('No pretension at rest: chain and stern lines are both slack, so the boat is free to drift until they tighten.');
  else if (rest.lines.every((l) => l.slack))
    warnings.push('Stern lines are slack at rest — the anchor is pulling the boat off the quay. Check line length and anchor distance.');
  if (rest.rode.h > 0.3 * inp.chain.mbl)
    warnings.push('Very high pretension at rest: the chain is nearly straight. Shorten the anchor distance or lengthen the chain/lines.');
  if (gust.eq.rode.suspended >= inp.chain.length - 1e-6)
    warnings.push('In the gust, all the chain is lifted off the seabed: the anchor is pulled upward and may break out.');
  if (dynamics && gust.peak.chain.ratio > 2 * gust.chain.ratio)
    warnings.push(`Waves / fishtailing more than double the chain load (${gust.peak.source}). Lengthen the scope or fit a nylon snubber.`);
  if (inp.snubber && inp.snubber.length > inp.depth)
    warnings.push('The snubber is longer than the water depth: the hook may touch the seabed when the rode is slack.');
  const sternX = swinging
    ? toEarth(gust.eq.pose, [-model.loa / 2, 0])[0]
    : Math.min(...gust.eq.lines.map((l) => l.cleat[0]));
  if (sternX < 0.5) warnings.push('In the gust the stern comes within 0.5 m of the quay.');
  return { model, rest, sustained, gust, warnings };
}

export interface SweepPoint {
  windKn: number;
  chain: number;
  anchor: number;
  lines: number[];
  /** Peaks with fishtail and the largest wave (equal to the static values when both are off). */
  chainPeak: number;
  anchorPeak: number;
  linesPeak: number[];
  /** Estimated holding at the anchor's peak-load uplift, N. */
  holdingPeak: number;
  windForce: number;
  sideShift: number;
  upliftDeg: number;
  suspended: number;
}

/** Loads vs wind speed (mean speed × `speedFactor`, e.g. the gust factor), solved by continuation. */
export function sweep(inp: ScenarioInput, speedsKn: number[], speedFactor = 1, dynamics = false): SweepPoint[] {
  const model = buildModel(inp);
  const rest = solveRest(model);
  let pose = rest.pose;
  return speedsKn.map((kn) => {
    const eq = solveEquilibrium(model, knotsToMs(kn * speedFactor), inp.windFromDeg, { initial: pose });
    pose = eq.pose;
    const { peak } = dynamics ? dynamicLoads(inp, model, eq) : noDynamics(inp, eq);
    return {
      windKn: kn,
      chain: eq.rode.tensionTop,
      anchor: eq.rode.tensionAnchor,
      lines: eq.lines.map((l) => l.tension),
      chainPeak: peak.chain.tension,
      anchorPeak: peak.anchor.load,
      linesPeak: peak.lines.map((l) => l.tension),
      holdingPeak: peak.anchor.holding,
      windForce: eq.wind.force,
      sideShift: eq.pose.y - rest.pose.y,
      upliftDeg: eq.rode.angleAnchor / DEG,
      suspended: eq.rode.suspended,
    };
  });
}

/**
 * Line length (unstretched) that gives a chosen horizontal chain pretension at rest, N.
 * Starts from the symmetric closed-form geometry, then refines with the full solver.
 */
export function lineLengthForPretension(inp: ScenarioInput, targetH: number): number {
  const model = buildModel(inp);
  const ln = model.lines[0];
  const bowX = inp.anchor.distance - spanForTension(model.rode, targetH);
  const cleatX = bowX - model.bowX + ln.attach[0];
  if (cleatX - ln.shore[0] < 0.3)
    throw new Error('The anchor is too close to the shore for this chain length and pretension: the stern would be on the quay.');
  const dh = Math.hypot(cleatX - ln.shore[0], ln.attach[1] - ln.shore[1]);
  const d = Math.hypot(dh, ln.attachHeight - ln.shoreHeight);
  const n = model.lines.length;
  const tension = (targetH / n) * (d / Math.max(1e-9, cleatX - ln.shore[0]));
  const guess = d / (1 + ropeStrain(ln.rope, tension, ln.mbl));
  if (!(guess > 0) || !Number.isFinite(guess)) return inp.lines.length;

  const f = (len: number): number => {
    const m = buildModel({ ...inp, lines: { ...inp.lines, length: len } });
    return solveRest(m).rode.h - targetH;
  };
  if (inp.anchor.offset === 0 && Math.abs(f(guess)) < 1e-3 * Math.max(1, targetH)) return guess;
  let lo = guess * 0.9;
  let hi = guess * 1.1;
  for (let k = 0; k < 20 && f(lo) < 0; k++) lo *= 0.9;
  for (let k = 0; k < 20 && f(hi) > 0; k++) hi *= 1.1;
  try {
    return brent(f, lo, hi, 1e-6);
  } catch {
    return guess;
  }
}

/**
 * Longest sensible anchor → quay distance: stern line + boat (with roller) + chain all pulled straight.
 * Beyond this the mooring cannot be rigged at all.
 */
export const maxAnchorDistance = (inp: ScenarioInput): number =>
  inp.lines.length + inp.loa + inp.rollerOverhang + inp.chain.length;

/**
 * Anchor → quay distance at which the chain pretension at rest equals `targetH` (N), for the current
 * chain and line lengths. Rest pretension rises monotonically with distance, so a bracketed root is found.
 * Returns null when the target cannot be reached inside the rigging limit.
 */
export function anchorDistanceForPretension(inp: ScenarioInput, targetH: number): number | null {
  const f = (d: number): number => solveRest(buildModel({ ...inp, anchor: { ...inp.anchor, distance: d } })).rode.h - targetH;
  const hi = maxAnchorDistance(inp);
  let lo = Math.max(inp.loa + 1, hi - inp.chain.length - inp.lines.length);
  if (f(hi) < 0) return null;
  for (let k = 0; k < 20 && f(lo) > 0; k++) lo = Math.max(1, lo - 5);
  try {
    return brent(f, lo, hi, 1e-4);
  } catch {
    return null;
  }
}

/** True when the whole chain is off the seabed (the anchor is pulled upward). */
const fullyLifted = (eq: Equilibrium): boolean => eq.rode.grounded <= 1e-9 && !eq.rode.slack;

/**
 * Mean wind speed (kn) at which the whole chain lifts off the seabed. 0 if it is already lifted at rest,
 * null if it stays on the seabed up to `maxKn`. Lift is monotonic in wind speed, so bisection is used.
 */
export function liftOffWind(inp: ScenarioInput, maxKn = 100): number | null {
  const model = buildModel(inp);
  const rest = solveRest(model);
  if (fullyLifted(rest)) return 0;
  const lifted = (kn: number): boolean =>
    fullyLifted(solveEquilibrium(model, knotsToMs(kn), inp.windFromDeg, { initial: rest.pose }));
  if (!lifted(maxKn)) return null;
  let lo = 0;
  let hi = maxKn;
  while (hi - lo > 0.05) {
    const mid = (lo + hi) / 2;
    if (lifted(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}
