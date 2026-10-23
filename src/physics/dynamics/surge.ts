import { brent, type Derivative } from '../core/numeric';
import { apparentAngle, shiftPose, toEarth, type Pose, type Vec2 } from '../core/vec';
import { bowBuoyancyStiffness, lengthAlongWave, rigidHullResponse } from '../environment/waveLoads';
import { surfaceOrbitRatio, waveNumber } from '../environment/waves';
import { windDirectionVector } from '../environment/wind';
import { solveRode, type RodeState } from '../mooring/catenary';
import { mooringAt } from '../mooring/forces';
import type { Equilibrium, LineResult, MooringModel } from '../mooring/model';
import { effectiveMass, stiffnessAlong } from '../mooring/stiffness';

/**
 * The boat surging in waves on its mooring — one degree of freedom along the wave direction:
 *
 *   m·ẍ = m·a_w + c·(u_w − ẋ) − (F(x, ζ) − F0)
 *
 * m = mass + added mass; the water (velocity u_w, acceleration a_w) drives the boat; c is linear damping on
 * the motion relative to the water; F is the full, non-linear mooring restoring force with the boat surged
 * by x and the bow lifted towards ζ by the wave (mooringInWave). Shared by the peak analysis
 * (waveResponse.ts) and the animation.
 */

/** Damping ratio assumed for the boat on its mooring (hull drag + rode drag). */
export const MOORING_DAMPING = 0.15;

/** Wave and boat parameters around one equilibrium. */
export interface WaveSetup {
  /** Wave travel direction (= downwind), earth frame. */
  dir: Vec2;
  omega: number;
  /** Water surge amplitude and imposed bow lift for a wave of amplitude a = 1 m (scale by a). */
  surgePerAmp: number;
  liftPerAmp: number;
  /** Mass + added mass (kg), damping (N·s/m), bow buoyancy stiffness (N/m). */
  mass: number;
  damping: number;
  kb: number;
  info: {
    period: number;
    /** Wavelength, m. */
    length: number;
    /** Angle between the waves and the bow, degrees. */
    betaDeg: number;
    /** Mean drift force in the equilibrium, N. */
    drift: number;
    /** Linearised mooring stiffness along the waves, N/m, and the boat's natural surge period on it, s. */
    stiffness: number;
    naturalPeriod: number;
    buoyancyStiffness: number;
  };
}

export function waveSetup(m: MooringModel, eq: Equilibrium): WaveSetup | null {
  const w = m.waves;
  if (!w || w.spec.hs <= 0 || eq.windSpeed <= 0) return null;
  const T = w.spec.tp;
  const omega = (2 * Math.PI) / T;
  const k = waveNumber(T, w.depth);
  const betaDeg = apparentAngle(eq.windFromDeg, eq.pose.psi);
  const hull = rigidHullResponse(k, lengthAlongWave(w.hull, (betaDeg * Math.PI) / 180));
  const kh = Math.max(stiffnessAlong(m, eq), 1);
  const mass = effectiveMass(m.displacement, betaDeg);
  const omegaN = Math.sqrt(kh / mass);
  const kb = bowBuoyancyStiffness(w.hull);
  return {
    dir: windDirectionVector(eq.windFromDeg),
    omega,
    surgePerAmp: hull.surge * surfaceOrbitRatio(k, w.depth),
    liftPerAmp: hull.bowVertical,
    mass,
    damping: 2 * MOORING_DAMPING * Math.sqrt(kh * mass),
    kb,
    info: { period: T, length: (2 * Math.PI) / k, betaDeg, drift: eq.waveDrift, stiffness: kh, naturalPeriod: (2 * Math.PI) / omegaN, buoyancyStiffness: kb },
  };
}

export interface MooringState {
  /** Restoring force along the wave direction, N (positive pushes the boat back up-wave). */
  restoring: number;
  /** Actual bow rise, m. */
  dz: number;
  rode: RodeState;
  lines: LineResult[];
  chainForce: Vec2;
  pose: Pose;
}

/**
 * Mooring with the boat surged x along the waves and a wave trying to lift the bow by zeta.
 * Buoyancy (stiffness kb) lifts the bow against the chain's extra vertical pull, so the bow rises dz where
 * kb·(zeta − dz) = V(dz) − V(0).
 */
export function mooringInWave(m: MooringModel, eq: Equilibrium, s: Pick<WaveSetup, 'dir' | 'kb'>, x: number, zeta: number): MooringState {
  const pose = shiftPose(eq.pose, s.dir, x);
  const dz = bowRise(m, pose, s.kb, zeta);
  const at = mooringAt(m, pose, dz);
  const f = at.lines.reduce<[number, number]>((acc, l) => [acc[0] + l.force[0], acc[1] + l.force[1]], [at.chainForce[0], at.chainForce[1]]);
  return { restoring: -(f[0] * s.dir[0] + f[1] * s.dir[1]), dz, rode: at.rode, lines: at.lines, chainForce: at.chainForce, pose };
}

/** Vertical balance at the bow: how far it actually rises when a wave tries to lift it by zeta. */
function bowRise(m: MooringModel, pose: Pose, kb: number, zeta: number): number {
  if (Math.abs(zeta) <= 1e-6) return 0;
  const bow = toEarth(pose, [m.bowX, 0]);
  const dist = Math.hypot(m.anchor[0] - bow[0], m.anchor[1] - bow[1]);
  const v0 = solveRode(m.rode, dist).v;
  const g = (d: number): number => kb * (zeta - d) - (solveRode({ ...m.rode, z: m.rode.z + d }, dist).v - v0);
  return brent(g, Math.min(0, zeta), Math.max(0, zeta), 1e-4);
}

/**
 * The surge equation as a first-order system y = [x, v] for the integrator.
 * amplitude(t): wave amplitude at time t (constant for the peak analysis, grouped in the animation).
 * deltaForce(x, ζ): mooring restoring force minus its value at equilibrium.
 */
export function surgeEquation(s: WaveSetup, amplitude: (t: number) => number, deltaForce: (x: number, zeta: number) => number): Derivative {
  const w = s.omega;
  return (t, [x, v]) => {
    const a = amplitude(t);
    const xi = a * s.surgePerAmp;
    const lift = a * s.liftPerAmp;
    const uw = xi * w * Math.cos(w * t);
    const aw = -xi * w * w * Math.sin(w * t);
    return [v, aw + (s.damping * (uw - v) - deltaForce(x, lift * Math.cos(w * t))) / s.mass];
  };
}

/**
 * Linear steady state of the surge equation for a water surge ξ = xi·sin(ωt), used to start a simulation
 * without a transient: (k − mω² + icω)·X = (−mω² + icω)·Ξ with Ξ = −i·xi. Returns x(0), v(0) and |X|.
 */
export function linearSteadyState(s: WaveSetup, xi: number): { x0: number; v0: number; amplitude: number } {
  const w = s.omega;
  const k = s.info.stiffness;
  const [nr, ni] = [-s.mass * w * w, s.damping * w];
  const [dr, di] = [k - s.mass * w * w, s.damping * w];
  const den = dr * dr + di * di;
  const [hr, hi] = [(nr * dr + ni * di) / den, (ni * dr - nr * di) / den]; // H = N / D
  const X: Vec2 = [hi * xi, -hr * xi]; // H · (−i·xi)
  return { x0: X[0], v0: -w * X[1], amplitude: Math.hypot(X[0], X[1]) };
}

/**
 * Response of a damped mass on a spring driven by moving water, relative to the water's own motion:
 * x/ξ = ω²/√((ωn² − ω²)² + (2ζ·ωn·ω)²). → 1 for a soft mooring (ωn ≪ ω), → ω²/ωn² for a stiff one.
 */
export function waterFollowing(omega: number, omegaN: number, zeta = MOORING_DAMPING): number {
  const w2 = omega * omega;
  const n2 = omegaN * omegaN;
  return w2 / Math.sqrt((n2 - w2) ** 2 + (2 * zeta * omegaN * omega) ** 2);
}
