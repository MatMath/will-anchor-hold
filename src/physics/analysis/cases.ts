import { DEG, knotsToMs } from '../core/constants';
import { toEarth, type Pose } from '../core/vec';
import { fishtailExtreme, type FishtailExtreme } from '../dynamics/fishtail';
import { waveResponse, type WaveResponse } from '../dynamics/waveResponse';
import { solveEquilibrium, solveRest } from '../mooring/equilibrium';
import type { Equilibrium, MooringModel } from '../mooring/model';
import { snatchLoad } from '../mooring/stiffness';
import { buildModel } from './buildModel';
import type { ScenarioInput } from './inputs';
import { anchorCheck, element, eqLoads, loadsOf, worstOf, type AnchorCheck, type ElementLoad, type Loads } from './loads';

/**
 * The analysis pipeline behind the results:
 *   validate → build model → solve at rest → sustained and gust cases → warnings.
 * Each case: equilibrium → drift from rest → element loads → (optional) fishtail and wave peaks.
 */

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

/** Static loads only (dynamics skipped). */
export const staticLoads = (inp: ScenarioInput, eq: Equilibrium): Pick<CaseResult, 'fishtail' | 'waves' | 'peak'> => ({
  fishtail: null,
  waves: null,
  peak: { ...eqLoads(inp, eq), source: 'static' },
});

/** True when fishtailing or waves add loads on top of the static equilibrium. */
export const hasDynamics = (inp: ScenarioInput): boolean =>
  Boolean((inp.waves && inp.waves.hs > 0) || (inp.fishtail && inp.fishtail.amplitudeDeg > 0 && inp.lines.count === 0));

export function evaluateCase(inp: ScenarioInput, model: MooringModel, rest: Equilibrium, windKn: number, initial?: Pose, dynamics = true): CaseResult {
  const eq = solveEquilibrium(model, knotsToMs(windKn), inp.windFromDeg, { initial: initial ?? rest.pose });
  const upliftDeg = eq.rode.angleAnchor / DEG;
  return {
    eq,
    windKn,
    drift: driftFromRest(model, rest, eq),
    chain: element(eq.rode.tensionTop, inp.chain.mbl),
    snubber: inp.snubber ? element(eq.rode.tensionTop, inp.snubber.mbl) : null,
    lines: eq.lines.map((l) => element(l.tension, inp.lines.mbl * inp.lines.efficiency)),
    anchor: { ...anchorCheck(inp, eq.rode.tensionAnchor, upliftDeg), pull: eq.rode.vAnchor > 1e-6 ? 'upward' : 'horizontal' },
    snatch: snatchLoad(model, eq, inp.snatchSpeed),
    ...(dynamics ? dynamicLoads(inp, model, eq) : staticLoads(inp, eq)),
  };
}

/** How far the boat has moved and turned from its at-rest position. */
function driftFromRest(model: MooringModel, rest: Equilibrium, eq: Equilibrium): CaseResult['drift'] {
  const sternU = model.lines[0]?.attach[0] ?? -model.loa / 2;
  const sternY = (p: Pose): number => p.y + Math.sin(p.psi) * sternU;
  return {
    dx: eq.pose.x - rest.pose.x,
    dy: eq.pose.y - rest.pose.y,
    dPsiDeg: (eq.pose.psi - rest.pose.psi) / DEG,
    bowDy: eq.bow[1] - rest.bow[1],
    sternDy: sternY(eq.pose) - sternY(rest.pose),
  };
}

/** Inputs that cannot be solved at all. */
export function validateInput(inp: ScenarioInput): void {
  const z = inp.depth + inp.rollerHeight;
  if (inp.chain.length <= z) throw new Error(`Chain (${inp.chain.length} m) is shorter than depth + roller height (${z.toFixed(1)} m).`);
}

/** Full analysis. With dynamics = false, fishtail and wave loads are skipped (fast, for live slider drags). */
export function runScenario(inp: ScenarioInput, dynamics = true): ScenarioResult {
  validateInput(inp);
  const model = buildModel(inp);
  const rest = solveRest(model);
  const sustained = evaluateCase(inp, model, rest, inp.windKn, undefined, dynamics);
  const gust = evaluateCase(inp, model, rest, inp.windKn * inp.gustFactor, sustained.eq.pose, dynamics);
  const result = { model, rest, sustained, gust, warnings: [] as string[] };
  result.warnings = WARNINGS.map((rule) => rule({ inp, dynamics, ...result })).filter((w): w is string => typeof w === 'string' && w.length > 0);
  return result;
}

/** One check on a finished analysis: returns a warning, or nothing. Add a rule here to add a warning. */
type WarningRule = (ctx: ScenarioResult & { inp: ScenarioInput; dynamics: boolean }) => string | null | undefined | false;

const sternClearance = ({ model, gust }: ScenarioResult): number =>
  model.lines.length === 0 ? toEarth(gust.eq.pose, [-model.loa / 2, 0])[0] : Math.min(...gust.eq.lines.map((l) => l.cleat[0]));

const WARNINGS: WarningRule[] = [
  ({ rest, sustained, gust }) =>
    (!rest.converged || !sustained.eq.converged || !gust.eq.converged) && 'The equilibrium solver did not fully converge — check the geometry (lengths, distances).',
  ({ model, rest }) =>
    model.lines.length === 0
      ? 'No stern lines: the boat swings on its anchor and lies head to wind. Allow swinging room — it can sweep a circle of chain span + boat length.'
      : rest.rode.slack && rest.lines.every((l) => l.slack)
        ? 'No pretension at rest: chain and stern lines are both slack, so the boat is free to drift until they tighten.'
        : rest.lines.every((l) => l.slack) && 'Stern lines are slack at rest — the anchor is pulling the boat off the quay. Check line length and anchor distance.',
  ({ inp, rest }) =>
    rest.rode.h > 0.3 * inp.chain.mbl && 'Very high pretension at rest: the chain is nearly straight. Shorten the anchor distance or lengthen the chain/lines.',
  ({ inp, gust }) =>
    gust.eq.rode.suspended >= inp.chain.length - 1e-6 && 'In the gust, all the chain is lifted off the seabed: the anchor is pulled upward and may break out.',
  ({ dynamics, gust }) =>
    dynamics && gust.peak.chain.ratio > 2 * gust.chain.ratio && `Waves / fishtailing more than double the chain load (${gust.peak.source}). Lengthen the scope or fit a nylon snubber.`,
  ({ inp }) => inp.snubber && inp.snubber.length > inp.depth && 'The snubber is longer than the water depth: the hook may touch the seabed when the rode is slack.',
  (ctx) => sternClearance(ctx) < 0.5 && 'In the gust the stern comes within 0.5 m of the quay.',
];
