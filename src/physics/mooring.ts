import { norm, solveLinear } from './numeric';
import { solveRode, type Rode, type RodeState } from './catenary';
import { ropeTension, type RopeType } from './rope';
import { windDirectionVector, windLoad, type Windage, type WindLoad } from './wind';

/**
 * Quasi-static, planar (3 degrees of freedom) equilibrium of a Med-moored boat.
 *
 * Earth frame: shore (quay face) along the y axis at x = 0, sea at x > 0, y to port, z up.
 * At rest the bow points along +x. Boat frame: origin at midships on the centreline, u forward, v to port.
 * The boat pose is (x, y, ψ): position of midships and heading, ψ > 0 turns the bow to port.
 *
 * Forces in the horizontal plane:
 *  - wind, at the centre of effort (u = ceX), magnitude ½ρ·CdA(apparent angle)·V², along the wind;
 *  - chain, at the bow roller, horizontal tension H from the catenary, towards the anchor;
 *  - stern lines, at their cleats, horizontal component of the elastic line tension, towards the shore point.
 * No current, so the water exerts no steady force. Moments are taken about midships.
 */

export type Vec2 = [number, number];

export interface SternLine {
  /** Attachment (cleat) on the boat, boat frame, m. */
  attach: Vec2;
  /** Cleat height above water, m. */
  attachHeight: number;
  /** Shore point, earth frame, m. */
  shore: Vec2;
  /** Shore point height above water, m. */
  shoreHeight: number;
  /** Unstretched length cleat → shore point, m. */
  length: number;
  rope: RopeType;
  /** Effective MBL (catalogue MBL × knot/splice efficiency), N. */
  mbl: number;
}

export interface MooringModel {
  loa: number;
  /** Bow roller position in the boat frame (u, m). */
  bowX: number;
  windage: Windage;
  /** Centre of effort of the side area, u (m). */
  ceX: number;
  rode: Rode;
  /** Anchor position, earth frame, m. */
  anchor: Vec2;
  lines: SternLine[];
  /** Displacement, kg (only used for the indicative snatch-load estimate). */
  displacement: number;
}

export interface Pose {
  x: number;
  y: number;
  psi: number;
}

export interface LineResult {
  cleat: Vec2;
  shore: Vec2;
  /** Stretched length, m. */
  length: number;
  strain: number;
  tension: number;
  /** Horizontal force on the boat, N. */
  force: Vec2;
  slack: boolean;
}

export interface Equilibrium {
  pose: Pose;
  converged: boolean;
  iterations: number;
  /** Force residual, N (should be ~0). */
  residual: number;
  windSpeed: number;
  windFromDeg: number;
  wind: WindLoad & { vector: Vec2; point: Vec2 };
  bow: Vec2;
  rode: RodeState;
  /** Horizontal chain force on the boat, N. */
  chainForce: Vec2;
  lines: LineResult[];
  /** Fraction of the wind force carried by the chain / by the stern lines (projected on the wind direction). */
  shareChain: number;
  shareLines: number;
}

const rot = (psi: number, p: Vec2): Vec2 => {
  const c = Math.cos(psi);
  const s = Math.sin(psi);
  return [c * p[0] - s * p[1], s * p[0] + c * p[1]];
};
const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const scale = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k];
const cross = (a: Vec2, b: Vec2): number => a[0] * b[1] - a[1] * b[0];
const len = (a: Vec2): number => Math.hypot(a[0], a[1]);

export const toEarth = (pose: Pose, local: Vec2): Vec2 => add([pose.x, pose.y], rot(pose.psi, local));

/** Apparent wind angle on the (possibly rotated) boat, degrees clockwise from the bow, in [0, 360). */
export const apparentAngle = (fromDeg: number, psi: number): number => {
  const a = (fromDeg + (psi * 180) / Math.PI) % 360;
  return a < 0 ? a + 360 : a;
};

interface Evaluation {
  /** Generalised force [Fx, Fy, Mz]. */
  f: [number, number, number];
  eq: Omit<Equilibrium, 'converged' | 'iterations' | 'residual' | 'shareChain' | 'shareLines'>;
}

function evaluate(m: MooringModel, pose: Pose, windSpeed: number, windFromDeg: number): Evaluation {
  const P: Vec2 = [pose.x, pose.y];
  let fx = 0;
  let fy = 0;
  let mz = 0;
  const apply = (point: Vec2, force: Vec2): void => {
    fx += force[0];
    fy += force[1];
    mz += cross(sub(point, P), force);
  };

  // Wind
  const wl = windLoad(m.windage, windSpeed, apparentAngle(windFromDeg, pose.psi));
  const dir = windDirectionVector(windFromDeg);
  const windVec = scale(dir, wl.force);
  const ce = toEarth(pose, [m.ceX, 0]);
  apply(ce, windVec);

  // Chain
  const bow = toEarth(pose, [m.bowX, 0]);
  const toAnchor = sub(m.anchor, bow);
  const dist = len(toAnchor);
  const rode = solveRode(m.rode, dist);
  const chainForce = dist > 0 ? scale(toAnchor, rode.h / dist) : ([0, 0] as Vec2);
  apply(bow, chainForce);

  // Stern lines
  const lines: LineResult[] = m.lines.map((ln) => {
    const cleat = toEarth(pose, ln.attach);
    const toShore = sub(ln.shore, cleat);
    const dh = len(toShore);
    const dz = ln.attachHeight - ln.shoreHeight;
    const d = Math.hypot(dh, dz);
    const strain = d / ln.length - 1;
    const tension = ropeTension(ln.rope, strain, ln.mbl);
    const force = dh > 0 ? scale(toShore, (tension * (dh / d)) / dh) : ([0, 0] as Vec2);
    apply(cleat, force);
    return { cleat, shore: ln.shore, length: d, strain, tension, force, slack: tension <= 0 };
  });

  return {
    f: [fx, fy, mz],
    eq: {
      pose,
      windSpeed,
      windFromDeg,
      wind: { ...wl, vector: windVec, point: ce },
      bow,
      rode,
      chainForce,
      lines,
    },
  };
}

export interface SolveOptions {
  initial?: Pose;
  maxIter?: number;
}

/** Guess for the at-rest pose: boat on the x axis, stern lines at their unstretched length. */
export function initialPose(m: MooringModel): Pose {
  const ln = m.lines[0];
  if (!ln) return { x: m.anchor[0] / 2, y: 0, psi: 0 };
  const dz = ln.attachHeight - ln.shoreHeight;
  const horiz = Math.sqrt(Math.max(0, ln.length ** 2 - dz ** 2));
  const dy = ln.shore[1] - ln.attach[1];
  const dx = Math.sqrt(Math.max(0, horiz ** 2 - dy ** 2));
  return { x: ln.shore[0] + dx - ln.attach[0], y: 0, psi: 0 };
}

/**
 * Find the pose where wind + chain + lines balance (ΣFx = ΣFy = ΣMz = 0).
 * Damped Newton with a finite-difference Jacobian; when the mooring is slack (no stiffness)
 * it falls back to a line search along the net force, i.e. lets the boat drift until something tightens.
 */
export function solveEquilibrium(
  m: MooringModel,
  windSpeed: number,
  windFromDeg: number,
  opts: SolveOptions = {},
): Equilibrium {
  const L = Math.max(1, m.loa / 2); // length scale for rotation and moments
  const toPose = (q: number[]): Pose => ({ x: q[0], y: q[1], psi: q[2] / L });
  const resid = (q: number[]): number[] => {
    const f = evaluate(m, toPose(q), windSpeed, windFromDeg).f;
    return [f[0], f[1], f[2] / L];
  };
  const p0 = opts.initial ?? initialPose(m);
  let q = [p0.x, p0.y, p0.psi * L];
  let r = resid(q);
  let rn = norm(r);
  const fRef = Math.max(1, windLoad(m.windage, windSpeed, 90).force);
  const tol = 1e-4 + 1e-9 * fRef;
  const maxIter = opts.maxIter ?? 100;
  const maxStep = Math.max(2, 0.5 * m.loa);
  let it = 0;

  for (; it < maxIter && rn > tol; it++) {
    // Newton step
    const J: number[][] = [[], [], []];
    for (let j = 0; j < 3; j++) {
      const h = 1e-6 * Math.max(1, Math.abs(q[j]));
      const qj = [...q];
      qj[j] += h;
      const rj = resid(qj);
      for (let i = 0; i < 3; i++) J[i][j] = (rj[i] - r[i]) / h;
    }
    let dq = solveLinear(J, r.map((v) => -v));
    let accepted = false;
    if (dq) {
      const sn = norm(dq);
      if (sn > maxStep) dq = dq.map((v) => (v * maxStep) / sn);
      for (let t = 1, k = 0; k < 30; k++, t /= 2) {
        const qn = q.map((v, i) => v + t * dq![i]);
        const rr = resid(qn);
        const rrn = norm(rr);
        if (rrn < (1 - 1e-4 * t) * rn) {
          q = qn;
          r = rr;
          rn = rrn;
          accepted = true;
          break;
        }
      }
    }
    if (accepted) continue;

    // Drift step: move along the net force until the imbalance drops.
    const d = r.map((v) => v / rn);
    const g = (s: number): number => norm(resid(q.map((v, i) => v + s * d[i])));
    let best = 0;
    let bestN = rn;
    for (let s = 1e-4; s <= 4 * m.loa + 200; s *= 2) {
      const n = g(s);
      if (n < bestN) {
        best = s;
        bestN = n;
      } else if (best > 0) break;
    }
    if (best === 0) break;
    // Golden-section refine around the best step.
    let a = best / 2;
    let b = best * 2;
    const phi = (Math.sqrt(5) - 1) / 2;
    for (let k = 0; k < 40; k++) {
      const c = b - phi * (b - a);
      const e = a + phi * (b - a);
      if (g(c) < g(e)) b = e;
      else a = c;
    }
    const s = g((a + b) / 2) < bestN ? (a + b) / 2 : best;
    q = q.map((v, i) => v + s * d[i]);
    r = resid(q);
    rn = norm(r);
  }

  const ev = evaluate(m, toPose(q), windSpeed, windFromDeg);
  const wf = ev.eq.wind.force;
  const dir = windDirectionVector(windFromDeg);
  const along = (f: Vec2): number => -(f[0] * dir[0] + f[1] * dir[1]);
  const lineSum = ev.eq.lines.reduce<Vec2>((acc, l) => add(acc, l.force), [0, 0]);
  return {
    ...ev.eq,
    converged: rn <= tol * 10,
    iterations: it,
    residual: rn,
    shareChain: wf > 0 ? along(ev.eq.chainForce) / wf : 0,
    shareLines: wf > 0 ? along(lineSum) / wf : 0,
  };
}

/**
 * Stiffness of the mooring against a push along the wind direction, N/m, at a given equilibrium.
 * Solves K·δ = f̂ for the 3-DOF restoring stiffness (rotation free) and returns 1 / (f̂·δ).
 */
export function stiffnessAlong(m: MooringModel, eq: Equilibrium): number {
  const L = Math.max(1, m.loa / 2);
  const base: number[] = [eq.pose.x, eq.pose.y, eq.pose.psi * L];
  const moor = (q: number[]): number[] => {
    const f = evaluate(m, { x: q[0], y: q[1], psi: q[2] / L }, 0, eq.windFromDeg).f;
    return [f[0], f[1], f[2] / L];
  };
  const r0 = moor(base);
  const K: number[][] = [[], [], []];
  for (let j = 0; j < 3; j++) {
    const h = 1e-5;
    const qj = [...base];
    qj[j] += h;
    const rj = moor(qj);
    for (let i = 0; i < 3; i++) K[i][j] = -(rj[i] - r0[i]) / h;
  }
  const dir = windDirectionVector(eq.windFromDeg);
  const delta = solveLinear(K, [dir[0], dir[1], 0]);
  if (!delta) return 0;
  const compliance = dir[0] * delta[0] + dir[1] * delta[1];
  return compliance > 0 ? 1 / compliance : 0;
}

/**
 * Indicative snatch load: the extra force when the boat, moving at `speed` (m/s) along the wind
 * direction, is stopped by the mooring acting as a spring: ΔF = v·√(m_eff·k).
 * m_eff includes hydrodynamic added mass (≈ 100% of displacement sideways, ≈ 10% fore-aft).
 */
export function snatchLoad(m: MooringModel, eq: Equilibrium, speed: number): { k: number; mEff: number; force: number } {
  const k = stiffnessAlong(m, eq);
  const a = (apparentAngle(eq.windFromDeg, eq.pose.psi) * Math.PI) / 180;
  const addedMass = 0.1 + 0.9 * Math.sin(a) ** 2;
  const mEff = m.displacement * (1 + addedMass);
  return { k, mEff, force: speed * Math.sqrt(mEff * k) };
}
