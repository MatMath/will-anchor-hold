import { knotsToMs } from '../core/constants';
import { brent } from '../core/numeric';
import { ropeStrain } from '../materials/rope';
import { spanForTension } from '../mooring/catenary';
import { solveEquilibrium, solveRest } from '../mooring/equilibrium';
import type { Equilibrium } from '../mooring/model';
import { buildModel } from './buildModel';
import type { ScenarioInput } from './inputs';

/** Rigging helpers used by the sliders: line length or anchor distance for a pretension, limits, chain lift-off. */

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
