import { brent, norm, solveLinear } from './numeric';
import { slackSpan, solveRode, spanForTension, type Rode, type RodeState } from './catenary';
import { ropeTension, type RopeType } from './rope';
import { windDirectionVector, windLoad, type Windage, type WindLoad } from './wind';
import { driftForce, type HullWater, type WaveSpec } from './waves';

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
 *  - with waves on, the mean wave drift force at midships, along the wind (waves come from the wind).
 * No current, so otherwise the water exerts no steady force. Moments are taken about midships.
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
  /** Displacement, kg (snatch, wave and fishtail dynamics). */
  displacement: number;
  /** Waves from the wind direction, or null when off. Only act when there is wind. */
  waves?: { spec: WaveSpec; hull: HullWater; depth: number } | null;
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
  /** Mean wave drift force, N (0 without waves), and its vector. */
  waveDrift: number;
  waveDriftVector: Vec2;
  bow: Vec2;
  rode: RodeState;
  /** Horizontal chain force on the boat, N. */
  chainForce: Vec2;
  lines: LineResult[];
  /** Fraction of the wind (+ wave drift) force carried by the chain / by the stern lines (projected on the wind direction). */
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

/** dzBow raises the bow roller (wave heave/pitch), changing the rode's vertical span. */
function evaluate(m: MooringModel, pose: Pose, windSpeed: number, windFromDeg: number, dzBow = 0): Evaluation {
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

  // Mean wave drift, at midships
  const beta = (apparentAngle(windFromDeg, pose.psi) * Math.PI) / 180;
  const waveDrift = m.waves && windSpeed > 0 ? driftForce(m.waves.spec, m.waves.hull, m.waves.depth, beta) : 0;
  const waveDriftVector = scale(dir, waveDrift);
  if (waveDrift > 0) apply(P, waveDriftVector);

  // Chain
  const bow = toEarth(pose, [m.bowX, 0]);
  const toAnchor = sub(m.anchor, bow);
  const dist = len(toAnchor);
  const rode = solveRode(dzBow ? { ...m.rode, z: m.rode.z + dzBow } : m.rode, dist);
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
      waveDrift,
      waveDriftVector,
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
  /** Hold the heading at this value (rad) and solve for position only — e.g. a fishtailing boat at the end of its swing. */
  fixedPsi?: number;
}

/** Mooring forces with the boat placed at `pose` and the bow raised by dzBow, without re-solving equilibrium. */
export function mooringAt(m: MooringModel, pose: Pose, dzBow = 0): { rode: RodeState; lines: LineResult[]; bow: Vec2; chainForce: Vec2 } {
  const ev = evaluate(m, pose, 0, 0, dzBow).eq;
  return { rode: ev.rode, lines: ev.lines, bow: ev.bow, chainForce: ev.chainForce };
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
  const fixed = opts.fixedPsi;
  const n = fixed === undefined ? 3 : 2;
  const toPose = (q: number[]): Pose => ({ x: q[0], y: q[1], psi: fixed ?? q[2] / L });
  const resid = (q: number[]): number[] => {
    const f = evaluate(m, toPose(q), windSpeed, windFromDeg).f;
    return n === 3 ? [f[0], f[1], f[2] / L] : [f[0], f[1]];
  };
  // Swinging at anchor (no stern lines): start head to wind (or at the held heading), downwind of the anchor.
  let p0 = m.lines.length === 0 && windSpeed > 0 ? swingingPose(m, windSpeed, windFromDeg, fixed) : (opts.initial ?? initialPose(m));
  if (fixed !== undefined && m.lines.length > 0) p0 = { ...p0, psi: fixed };
  let q = n === 3 ? [p0.x, p0.y, p0.psi * L] : [p0.x, p0.y];
  let r = resid(q);
  let rn = norm(r);
  const fRef = Math.max(1, windLoad(m.windage, windSpeed, 90).force);
  const tol = 1e-4 + 1e-9 * fRef;
  const maxIter = opts.maxIter ?? 100;
  const maxStep = Math.max(2, 0.5 * m.loa);
  let it = 0;

  for (; it < maxIter && rn > tol; it++) {
    // Newton step
    const J: number[][] = Array.from({ length: n }, () => []);
    for (let j = 0; j < n; j++) {
      const h = 1e-6 * Math.max(1, Math.abs(q[j]));
      const qj = [...q];
      qj[j] += h;
      const rj = resid(qj);
      for (let i = 0; i < n; i++) J[i][j] = (rj[i] - r[i]) / h;
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

    // Drift step: let the boat move along the net force until the mooring takes it up.
    const d = r.map((v) => v / rn);
    const along = (s: number): number => {
      const rs = resid(q.map((v, i) => v + s * d[i]));
      return rs.reduce((acc, v, i) => acc + v * d[i], 0);
    };
    const s = driftStep(along, 4 * m.loa + 400);
    if (s < 1e-9) break;
    q = q.map((v, i) => v + s * d[i]);
    r = resid(q);
    rn = norm(r);
  }

  const ev = evaluate(m, toPose(q), windSpeed, windFromDeg);
  const wf = ev.eq.wind.force + ev.eq.waveDrift;
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
 * Drift step for a slack (or nearly slack) mooring: how far to move along the net-force direction d.
 *
 * f(s) is the net force projected on d after moving s along it; f(0) = |net force| > 0. While the mooring
 * is slack the boat is pushed on (f > 0); once a line or the chain takes up, the restoring force grows
 * until f turns negative. The step is the root of f — the equilibrium along that direction — found by
 * doubling until f changes sign and then Brent. Unlike minimising |net force|, this cannot jump over the
 * narrow band where stiff lines are just taut. Returns 0 if nothing takes up within sMax.
 */
export function driftStep(f: (s: number) => number, sMax: number): number {
  let s0 = 0;
  let s1 = 1e-4;
  let f1 = f(s1);
  while (f1 > 0 && s1 < sMax) {
    s0 = s1;
    s1 *= 2;
    f1 = f(s1);
  }
  if (f1 > 0) return 0;
  return brent(f, s0, s1, 1e-10);
}

/**
 * Pose of a boat swinging on its anchor alone: it weathervanes until the wind force, acting at the
 * centre of effort, passes through the bow roller, i.e. bow pointing into the wind (apparent wind 0°),
 * and lies downwind of the anchor at the chain span for the head-on wind load.
 */
export function swingingPose(m: MooringModel, windSpeed: number, windFromDeg: number, heldPsi?: number): Pose {
  const deg = ((((-windFromDeg + 180) % 360) + 360) % 360) - 180; // bow turned to face the wind, in [-180, 180)
  const psi = heldPsi ?? (deg * Math.PI) / 180;
  const down = windDirectionVector(windFromDeg);
  const h = windLoad(m.windage, windSpeed, apparentAngle(windFromDeg, psi)).force;
  const span = spanForTension(m.rode, h);
  const bow: Vec2 = [m.anchor[0] + down[0] * span, m.anchor[1] + down[1] * span];
  const toBow = rot(psi, [m.bowX, 0]);
  return { x: bow[0] - toBow[0], y: bow[1] - toBow[1], psi };
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
  // Swinging on the anchor alone, nothing resists rotation about the bow: use the translational block.
  const delta = solveLinear(K, [dir[0], dir[1], 0]) ?? solveLinear([K[0].slice(0, 2), K[1].slice(0, 2)], [dir[0], dir[1]]);
  if (!delta) return 0;
  const compliance = dir[0] * delta[0] + dir[1] * delta[1];
  return compliance > 0 ? 1 / compliance : 0;
}

/** Mass plus hydrodynamic added mass for motion along a direction at angle (deg) to the bow: ~10% fore-aft, ~100% sideways. */
export function effectiveMass(displacement: number, angleDeg: number): number {
  const a = (angleDeg * Math.PI) / 180;
  return displacement * (1 + 0.1 + 0.9 * Math.sin(a) ** 2);
}

/**
 * Indicative snatch load: the extra force when the boat, moving at `speed` (m/s) along the wind
 * direction, is stopped by the mooring acting as a spring: ΔF = v·√(m_eff·k).
 * m_eff includes hydrodynamic added mass (≈ 100% of displacement sideways, ≈ 10% fore-aft).
 */
export function snatchLoad(m: MooringModel, eq: Equilibrium, speed: number): { k: number; mEff: number; force: number } {
  const k = stiffnessAlong(m, eq);
  const mEff = effectiveMass(m.displacement, apparentAngle(eq.windFromDeg, eq.pose.psi));
  return { k, mEff, force: speed * Math.sqrt(mEff * k) };
}
