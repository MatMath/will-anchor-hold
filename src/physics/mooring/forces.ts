import { cross, len, scale, sub, toEarth, apparentAngle, type Pose, type Vec2 } from '../core/vec';
import { driftForce } from '../environment/waveLoads';
import { windDirectionVector, windLoad } from '../environment/wind';
import { ropeTension } from '../materials/rope';
import { solveRode } from './catenary';
import type { Environment, ForceState, LineResult, MooringModel } from './model';

/**
 * The horizontal forces on the boat, one contributor per physical effect. Each returns the forces it
 * applies (point + vector, earth frame) and its own diagnostics; evaluateForces() sums them into the
 * generalised force (Fx, Fy, Mz about midships).
 *
 * To add an effect (current, a second anchor, a riding sail…), write a contributor here and add it to
 * evaluateForces(); the equilibrium solver, stiffness and dynamics pick it up automatically.
 */

export interface AppliedForce {
  point: Vec2;
  force: Vec2;
}

/** Wind on the topsides and rig, at the centre of effort, straight downwind. */
export function windOnHull(m: MooringModel, pose: Pose, env: Environment) {
  const wl = windLoad(m.windage, env.windSpeed, apparentAngle(env.windFromDeg, pose.psi));
  const vector = scale(windDirectionVector(env.windFromDeg), wl.force);
  const point = toEarth(pose, [m.ceX, 0]);
  return { load: { ...wl, vector, point }, applied: [{ point, force: vector }] };
}

/** Mean wave drift at midships, along the wind (waves come from the wind; none without wind). */
export function waveDriftOnHull(m: MooringModel, pose: Pose, env: Environment) {
  const beta = (apparentAngle(env.windFromDeg, pose.psi) * Math.PI) / 180;
  const drift = m.waves && env.windSpeed > 0 ? driftForce(m.waves.spec, m.waves.hull, m.waves.depth, beta) : 0;
  const vector = scale(windDirectionVector(env.windFromDeg), drift);
  const applied: AppliedForce[] = drift > 0 ? [{ point: [pose.x, pose.y], force: vector }] : [];
  return { drift, vector, applied };
}

/** Chain (catenary) at the bow roller, towards the anchor. dzBow raises the roller (wave heave/pitch). */
export function chainOnBow(m: MooringModel, pose: Pose, dzBow = 0) {
  const bow = toEarth(pose, [m.bowX, 0]);
  const toAnchor = sub(m.anchor, bow);
  const dist = len(toAnchor);
  const rode = solveRode(dzBow ? { ...m.rode, z: m.rode.z + dzBow } : m.rode, dist);
  const force = dist > 0 ? scale(toAnchor, rode.h / dist) : ([0, 0] as Vec2);
  return { bow, rode, force, applied: [{ point: bow, force }] };
}

/** Elastic stern lines from their cleats to the shore points (horizontal components). */
export function sternLinesOnCleats(m: MooringModel, pose: Pose) {
  const lines: LineResult[] = m.lines.map((ln) => {
    const cleat = toEarth(pose, ln.attach);
    const toShore = sub(ln.shore, cleat);
    const dh = len(toShore);
    const dz = ln.attachHeight - ln.shoreHeight;
    const d = Math.hypot(dh, dz);
    const strain = d / ln.length - 1;
    const tension = ropeTension(ln.rope, strain, ln.mbl);
    const force = dh > 0 ? scale(toShore, (tension * (dh / d)) / dh) : ([0, 0] as Vec2);
    return { cleat, shore: ln.shore, length: d, strain, tension, force, slack: tension <= 0 };
  });
  return { lines, applied: lines.map((l) => ({ point: l.cleat, force: l.force })) };
}

/** Sum of forces and of their moments about `origin`: [Fx, Fy, Mz]. */
export function generalisedForce(origin: Vec2, applied: readonly AppliedForce[]): [number, number, number] {
  let fx = 0;
  let fy = 0;
  let mz = 0;
  for (const { point, force } of applied) {
    fx += force[0];
    fy += force[1];
    mz += cross(sub(point, origin), force);
  }
  return [fx, fy, mz];
}

export interface Evaluation {
  /** Generalised force [Fx, Fy, Mz] about midships. */
  f: [number, number, number];
  state: ForceState;
}

/** All forces on the boat at `pose`, and their sum. */
export function evaluateForces(m: MooringModel, pose: Pose, env: Environment, dzBow = 0): Evaluation {
  const wind = windOnHull(m, pose, env);
  const drift = waveDriftOnHull(m, pose, env);
  const chain = chainOnBow(m, pose, dzBow);
  const lines = sternLinesOnCleats(m, pose);
  const f = generalisedForce([pose.x, pose.y], [...wind.applied, ...drift.applied, ...chain.applied, ...lines.applied]);
  return {
    f,
    state: {
      pose,
      windSpeed: env.windSpeed,
      windFromDeg: env.windFromDeg,
      wind: wind.load,
      waveDrift: drift.drift,
      waveDriftVector: drift.vector,
      bow: chain.bow,
      rode: chain.rode,
      chainForce: chain.force,
      lines: lines.lines,
    },
  };
}

/** Mooring forces only (no wind or waves) with the boat placed at `pose` and the bow raised by dzBow. */
export function mooringAt(m: MooringModel, pose: Pose, dzBow = 0): Pick<ForceState, 'rode' | 'lines' | 'bow' | 'chainForce'> {
  const { state } = evaluateForces(m, pose, { windSpeed: 0, windFromDeg: 0 }, dzBow);
  return { rode: state.rode, lines: state.lines, bow: state.bow, chainForce: state.chainForce };
}
