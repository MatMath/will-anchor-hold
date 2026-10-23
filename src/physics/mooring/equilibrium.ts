import { solveNonlinear } from '../core/numeric';
import { add, dot, rot, type Pose, type Vec2, apparentAngle, headToWindPsi } from '../core/vec';
import { windDirectionVector, windLoad } from '../environment/wind';
import { slackSpan, spanForTension } from './catenary';
import { evaluateForces } from './forces';
import type { Environment, Equilibrium, ForceState, MooringModel } from './model';

/**
 * Quasi-static, planar equilibrium of the boat: find the pose where wind + waves + chain + lines balance
 * (ΣFx = ΣFy = ΣMz = 0). Steps:
 *   1. choose the degrees of freedom (x, y, ψ — or x, y with the heading held);
 *   2. pick a starting pose;
 *   3. solve the residual with the generic damped-Newton solver (core/numeric);
 *   4. evaluate the forces at the solution and report how the load is shared.
 */

export interface SolveOptions {
  initial?: Pose;
  maxIter?: number;
  /** Hold the heading at this value (rad) and solve for position only — e.g. a fishtailing boat at the end of its swing. */
  fixedPsi?: number;
}

/**
 * Guess for the at-rest pose: boat on the x axis, stern lines at their unstretched length.
 * With no stern lines the boat lies bow to the anchor with the chain just taut (no load).
 */
export function initialPose(m: MooringModel): Pose {
  const ln = m.lines[0];
  if (!ln) return { x: m.anchor[0] - slackSpan(m.rode) - m.bowX, y: m.anchor[1], psi: 0 };
  const dz = ln.attachHeight - ln.shoreHeight;
  const horiz = Math.sqrt(Math.max(0, ln.length ** 2 - dz ** 2));
  const dy = ln.shore[1] - ln.attach[1];
  const dx = Math.sqrt(Math.max(0, horiz ** 2 - dy ** 2));
  return { x: ln.shore[0] + dx - ln.attach[0], y: 0, psi: 0 };
}

/**
 * Pose of a boat swinging on its anchor alone: it weathervanes until the wind force, acting at the
 * centre of effort, passes through the bow roller, i.e. bow pointing into the wind (apparent wind 0°),
 * and lies downwind of the anchor at the chain span for the head-on wind load.
 */
export function swingingPose(m: MooringModel, windSpeed: number, windFromDeg: number, heldPsi?: number): Pose {
  const psi = heldPsi ?? headToWindPsi(windFromDeg);
  const down = windDirectionVector(windFromDeg);
  const h = windLoad(m.windage, windSpeed, apparentAngle(windFromDeg, psi)).force;
  const span = spanForTension(m.rode, h);
  const bow: Vec2 = [m.anchor[0] + down[0] * span, m.anchor[1] + down[1] * span];
  const toBow = rot(psi, [m.bowX, 0]);
  return { x: bow[0] - toBow[0], y: bow[1] - toBow[1], psi };
}

/** Degrees of freedom: q = (x, y, ψ·L) — heading scaled by half the length so all unknowns are metres. */
interface Dofs {
  toPose(q: number[]): Pose;
  toQ(p: Pose): number[];
  /** Generalised force → residual of the same size (moment scaled by 1/L). */
  residual(f: [number, number, number]): number[];
}

function dofsFor(m: MooringModel, fixedPsi?: number): Dofs {
  const L = Math.max(1, m.loa / 2);
  return fixedPsi === undefined
    ? {
        toPose: (q) => ({ x: q[0], y: q[1], psi: q[2] / L }),
        toQ: (p) => [p.x, p.y, p.psi * L],
        residual: (f) => [f[0], f[1], f[2] / L],
      }
    : {
        toPose: (q) => ({ x: q[0], y: q[1], psi: fixedPsi }),
        toQ: (p) => [p.x, p.y],
        residual: (f) => [f[0], f[1]],
      };
}

/** Where the solver starts: head to wind when swinging at anchor (that is where it must end up), else the given pose. */
function startingPose(m: MooringModel, env: Environment, opts: SolveOptions): Pose {
  if (m.lines.length === 0 && env.windSpeed > 0) return swingingPose(m, env.windSpeed, env.windFromDeg, opts.fixedPsi);
  const p0 = opts.initial ?? initialPose(m);
  return opts.fixedPsi !== undefined ? { ...p0, psi: opts.fixedPsi } : p0;
}

/** Fraction of the environmental force (wind + wave drift) each part of the mooring resists. */
function loadShare(s: ForceState): { shareChain: number; shareLines: number } {
  const total = s.wind.force + s.waveDrift;
  const dir = windDirectionVector(s.windFromDeg);
  const against = (f: Vec2): number => -dot(f, dir);
  const lineSum = s.lines.reduce<Vec2>((acc, l) => add(acc, l.force), [0, 0]);
  return {
    shareChain: total > 0 ? against(s.chainForce) / total : 0,
    shareLines: total > 0 ? against(lineSum) / total : 0,
  };
}

export function solveEquilibrium(m: MooringModel, windSpeed: number, windFromDeg: number, opts: SolveOptions = {}): Equilibrium {
  const env: Environment = { windSpeed, windFromDeg };
  const dofs = dofsFor(m, opts.fixedPsi);
  const residual = (q: number[]): number[] => dofs.residual(evaluateForces(m, dofs.toPose(q), env).f);

  const fRef = Math.max(1, windLoad(m.windage, windSpeed, 90).force);
  const tol = 1e-4 + 1e-9 * fRef;
  const sol = solveNonlinear(residual, dofs.toQ(startingPose(m, env, opts)), {
    tol,
    maxIter: opts.maxIter ?? 100,
    maxStep: Math.max(2, 0.5 * m.loa),
    driftMax: 4 * m.loa + 400,
  });

  const { state } = evaluateForces(m, dofs.toPose(sol.x), env);
  return { ...state, converged: sol.norm <= tol * 10, iterations: sol.iterations, residual: sol.norm, ...loadShare(state) };
}

/** At rest: no wind, starting from the stern lines at their natural length. */
export function solveRest(m: MooringModel): Equilibrium {
  return solveEquilibrium(m, 0, 90, { initial: initialPose(m) });
}
