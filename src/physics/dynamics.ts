import { DEG } from './constants';
import {
  apparentAngle,
  effectiveMass,
  mooringAt,
  solveEquilibrium,
  toEarth,
  stiffnessAlong,
  type Equilibrium,
  type LineResult,
  type MooringModel,
  type Pose,
} from './mooring';
import { solveRode, type RodeState } from './catenary';
import { brent } from './numeric';
import { windDirectionVector } from './wind';
import {
  HMAX_FACTOR,
  MOORING_DAMPING,
  bowBuoyancyStiffness,
  lengthAlongWave,
  rigidHullResponse,
  surfaceOrbitRatio,
  waveNumber,
} from './waves';

/**
 * Loads on top of the steady equilibrium: wave-frequency motion and fishtailing (sheering) at anchor.
 * Both are evaluated quasi-statically around a solved equilibrium; see waves.ts and docs/validation.md.
 */

export interface WaveResponse {
  /** Wave height used for the peak (largest wave = 1.86·Hs by default), m, and its amplitude. */
  height: number;
  amplitude: number;
  period: number;
  /** Wavelength, m. */
  length: number;
  /** Angle between the waves and the bow, degrees. */
  betaDeg: number;
  /** Mean drift force in the equilibrium, N. */
  drift: number;
  /** Water's horizontal surface motion amplitude, m, and the boat's largest surge excursion from equilibrium, m. */
  waterSurge: number;
  boatSurge: number;
  /** Linearised mooring stiffness along the waves, N/m, and the boat's natural surge period on it, s. */
  stiffness: number;
  naturalPeriod: number;
  /** Bow vertical motion the wave imposes (rigid hull on the wave), m; buoyancy stiffness at the bow, N/m; largest actual bow rise, m. */
  bowLift: number;
  buoyancyStiffness: number;
  bowMotion: number;
  /** Extremes over the simulated waves. */
  chainMax: number;
  chainMin: number;
  anchorMax: number;
  upliftMaxDeg: number;
  linesMax: number[];
}

/** Wave and boat parameters shared by the peak analysis and the animation. */
export interface WaveSetup {
  dir: [number, number];
  omega: number;
  /** Water surge amplitude and imposed bow lift for a wave of amplitude a = 1 m (scale by a). */
  surgePerAmp: number;
  liftPerAmp: number;
  mass: number;
  damping: number;
  kb: number;
  info: Pick<WaveResponse, 'period' | 'length' | 'betaDeg' | 'drift' | 'stiffness' | 'naturalPeriod' | 'buoyancyStiffness'>;
}

export function waveSetup(m: MooringModel, eq: Equilibrium): WaveSetup | null {
  const w = m.waves;
  if (!w || w.spec.hs <= 0 || eq.windSpeed <= 0) return null;
  const T = w.spec.tp;
  const omega = (2 * Math.PI) / T;
  const k = waveNumber(T, w.depth);
  const betaDeg = apparentAngle(eq.windFromDeg, eq.pose.psi);
  const hull = rigidHullResponse(k, lengthAlongWave(w.hull, betaDeg * DEG));
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
    info: {
      period: T,
      length: (2 * Math.PI) / k,
      betaDeg,
      drift: eq.waveDrift,
      stiffness: kh,
      naturalPeriod: (2 * Math.PI) / omegaN,
      buoyancyStiffness: kb,
    },
  };
}

export interface MooringState {
  /** Restoring force along the wave direction, N (positive pushes the boat back up-wave). */
  restoring: number;
  /** Actual bow rise, m. */
  dz: number;
  rode: RodeState;
  lines: LineResult[];
  pose: Pose;
}

/**
 * Mooring with the boat surged x along the waves and a wave trying to lift the bow by zeta.
 * Buoyancy (stiffness kb) lifts the bow against the chain's extra vertical pull, so the bow rises dz where
 * kb·(zeta − dz) = V(dz) − V(0).
 */
export function mooringInWave(m: MooringModel, eq: Equilibrium, s: Pick<WaveSetup, 'dir' | 'kb'>, x: number, zeta: number): MooringState {
  const pose = { x: eq.pose.x + s.dir[0] * x, y: eq.pose.y + s.dir[1] * x, psi: eq.pose.psi };
  let dz = 0;
  if (Math.abs(zeta) > 1e-6) {
    const bow = toEarth(pose, [m.bowX, 0]);
    const dist = Math.hypot(m.anchor[0] - bow[0], m.anchor[1] - bow[1]);
    const v0 = solveRode(m.rode, dist).v;
    // Buoyancy lifts by kb per metre the bow is held below the wave; the chain pulls back with V(dz) − V(0).
    const g = (d: number): number => s.kb * (zeta - d) - (solveRode({ ...m.rode, z: m.rode.z + d }, dist).v - v0);
    dz = brent(g, Math.min(0, zeta), Math.max(0, zeta), 1e-4);
  }
  const at = mooringAt(m, pose, dz);
  const f = at.lines.reduce<[number, number]>((acc, l) => [acc[0] + l.force[0], acc[1] + l.force[1]], [at.chainForce[0], at.chainForce[1]]);
  return { restoring: -(f[0] * s.dir[0] + f[1] * s.dir[1]), dz, rode: at.rode, lines: at.lines, pose };
}

/**
 * Wave-frequency peak loads around an equilibrium for a wave of heightFactor × Hs (default: the largest wave).
 *
 * Time-domain, one degree of freedom: the boat (mass + added mass) is driven along the waves by the water,
 * with linear damping on its motion relative to the water, against the real, non-linear mooring force.
 * This captures the snatch when slack chain comes tight. The bow is lifted quasi-statically against
 * buoyancy (see mooringInWave). Uses a pre-computed table of the mooring over (surge, bow lift).
 */
export function waveResponse(m: MooringModel, eq: Equilibrium, heightFactor = HMAX_FACTOR): WaveResponse | null {
  const s = waveSetup(m, eq);
  if (!s) return null;
  const height = m.waves!.spec.hs * heightFactor;
  const a = height / 2;
  const xi = a * s.surgePerAmp;
  const lift = a * s.liftPerAmp;

  const w = s.omega;
  const T = (2 * Math.PI) / w;
  // Linear steady state (soft or stiff spring driven by the water), used to start without a transient:
  // (k − mω² + icω)·X = (−mω² + icω)·Ξ, with water surge ξ = xi·sin(ωt) = Re(−i·xi·e^{iωt}).
  const k = s.info.stiffness;
  const [nr, ni] = [-s.mass * w * w, s.damping * w];
  const [dr, di] = [k - s.mass * w * w, s.damping * w];
  const den = dr * dr + di * di;
  const [hr, hi] = [(nr * dr + ni * di) / den, (ni * dr - nr * di) / den]; // H = N / D
  const X: [number, number] = [hi * xi, -hr * xi]; // H · (−i·xi)
  const xLin = Math.hypot(X[0], X[1]);

  let xr = 2.5 * Math.max(xLin, xi) + 0.3;
  let run = simulate(xr);
  for (let retry = 0; retry < 3 && run.xMax > 0.9 * xr; retry++) {
    xr = 1.5 * run.xMax + 0.3;
    run = simulate(xr);
  }

  function simulate(range: number) {
    // Table of the mooring over surge x and imposed bow lift ζ.
    const nx = 19;
    const nz = 7;
    const xs = Array.from({ length: nx }, (_, i) => -range + (2 * range * i) / (nx - 1));
    const table = xs.map((x) => Array.from({ length: nz }, (_, j) => mooringInWave(m, eq, s!, x, -lift + (2 * lift * j) / (nz - 1))));
    const f0 = mooringInWave(m, eq, s!, 0, 0).restoring;
    const interp = (get: (st: MooringState) => number, x: number, z: number): number => {
      const fx = Math.min(Math.max((x + range) / (2 * range), 0), 1) * (nx - 1);
      const fz = lift > 0 ? Math.min(Math.max((z + lift) / (2 * lift), 0), 1) * (nz - 1) : 0;
      const i = Math.min(nx - 2, Math.floor(fx));
      const j = Math.min(nz - 2, Math.floor(fz));
      const tx = fx - i;
      const tz = fz - j;
      const v = (ii: number, jj: number): number => get(table[ii][jj]);
      return (1 - tx) * ((1 - tz) * v(i, j) + tz * v(i, j + 1)) + tx * ((1 - tz) * v(i + 1, j) + tz * v(i + 1, j + 1));
    };
    // m·ẍ = m·a_w + c·(u_w − ẋ) − (F(x, ζ) − F0), RK4 over 24 waves; statistics over the last 16.
    const dt = T / 80;
    const acc = (t: number, x: number, v: number): number => {
      const uw = xi * w * Math.cos(w * t);
      const aw = -xi * w * w * Math.sin(w * t);
      return aw + (s!.damping * (uw - v) - (interp((st) => st.restoring, x, lift * Math.cos(w * t)) - f0)) / s!.mass;
    };
    let x = X[0];
    let v = -w * X[1];
    const out = { xMax: 0, chainMax: 0, chainMin: Infinity, anchorMax: 0, upliftMax: 0, dzMax: 0, linesMax: m.lines.map(() => 0) };
    const steps = Math.round((24 * T) / dt);
    for (let n = 0; n < steps; n++) {
      const t = n * dt;
      const k1x = v;
      const k1v = acc(t, x, v);
      const k2x = v + (dt / 2) * k1v;
      const k2v = acc(t + dt / 2, x + (dt / 2) * k1x, k2x);
      const k3x = v + (dt / 2) * k2v;
      const k3v = acc(t + dt / 2, x + (dt / 2) * k2x, k3x);
      const k4x = v + dt * k3v;
      const k4v = acc(t + dt, x + dt * k3x, k4x);
      x += (dt / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
      v += (dt / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);
      out.xMax = Math.max(out.xMax, Math.abs(x));
      if (t + dt < 8 * T) continue;
      const zeta = lift * Math.cos(w * (t + dt));
      const tc = interp((st) => st.rode.tensionTop, x, zeta);
      out.chainMax = Math.max(out.chainMax, tc);
      out.chainMin = Math.min(out.chainMin, tc);
      out.anchorMax = Math.max(out.anchorMax, interp((st) => st.rode.tensionAnchor, x, zeta));
      out.upliftMax = Math.max(out.upliftMax, interp((st) => st.rode.angleAnchor / DEG, x, zeta));
      out.dzMax = Math.max(out.dzMax, interp((st) => st.dz, x, zeta));
      out.linesMax.forEach((_, i) => (out.linesMax[i] = Math.max(out.linesMax[i], interp((st) => st.lines[i].tension, x, zeta))));
    }
    return out;
  }

  const { xMax, chainMax, chainMin, anchorMax, upliftMax, dzMax, linesMax } = run;
  return {
    ...s.info,
    height,
    amplitude: a,
    waterSurge: xi,
    boatSurge: xMax,
    bowLift: lift,
    bowMotion: dzMax,
    chainMax: Math.max(chainMax, eq.rode.tensionTop),
    chainMin: Math.max(0, chainMin),
    anchorMax: Math.max(anchorMax, eq.rode.tensionAnchor),
    upliftMaxDeg: Math.max(upliftMax, eq.rode.angleAnchor / DEG),
    linesMax: linesMax.map((t, i) => Math.max(t, eq.lines[i].tension)),
  };
}

export interface FishtailExtreme {
  amplitudeDeg: number;
  /** +1: bow swung to port of head-to-wind, −1: to starboard. The worse of the two is kept. */
  side: 1 | -1;
  eq: Equilibrium;
}

/**
 * Fishtailing (sheering): a boat swinging on its anchor does not stay head to wind. The topsides act as a
 * poor sail and it swings ±A either side, showing its side to the wind at each end of the swing.
 * Quasi-static: the boat is held at heading ψ0 ± A and its position re-solved; the worse side is returned.
 */
export function fishtailExtreme(m: MooringModel, base: Equilibrium, amplitudeDeg: number): FishtailExtreme | null {
  if (m.lines.length > 0 || amplitudeDeg <= 0 || base.windSpeed <= 0) return null;
  let worst: FishtailExtreme | null = null;
  for (const side of [1, -1] as const) {
    const eq = solveEquilibrium(m, base.windSpeed, base.windFromDeg, {
      fixedPsi: base.pose.psi + side * amplitudeDeg * DEG,
      initial: base.pose,
    });
    if (!worst || eq.rode.tensionTop > worst.eq.rode.tensionTop) worst = { amplitudeDeg, side, eq };
  }
  return worst;
}
