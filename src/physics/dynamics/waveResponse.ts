import { DEG } from '../core/constants';
import { rk4Step } from '../core/numeric';
import { HMAX_FACTOR } from '../environment/waves';
import type { Equilibrium, MooringModel } from '../mooring/model';
import { linearSteadyState, mooringInWave, surgeEquation, waveSetup, type MooringState, type WaveSetup } from './surge';

/**
 * Wave-frequency peak loads around an equilibrium (see surge.ts for the equation of motion). Steps:
 *   1. wave and boat parameters (waveSetup);
 *   2. a table of the mooring over surge × bow lift, so the time loop only interpolates;
 *   3. integrate the surge equation from its linear steady state over 24 waves, keeping extremes of the last 16;
 *   4. if the boat surged beyond the table, widen it and repeat.
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

/** Bilinear table of the mooring state over surge x ∈ [−range, range] and imposed bow lift ζ ∈ [−lift, lift]. */
class MooringTable {
  private static readonly NX = 19;
  private static readonly NZ = 7;
  private readonly cells: MooringState[][];
  readonly f0: number;

  constructor(m: MooringModel, eq: Equilibrium, s: WaveSetup, readonly range: number, readonly lift: number) {
    const { NX, NZ } = MooringTable;
    const xs = Array.from({ length: NX }, (_, i) => -range + (2 * range * i) / (NX - 1));
    this.cells = xs.map((x) => Array.from({ length: NZ }, (_, j) => mooringInWave(m, eq, s, x, -lift + (2 * lift * j) / (NZ - 1))));
    this.f0 = mooringInWave(m, eq, s, 0, 0).restoring;
  }

  /** Interpolate any quantity of the mooring state at (x, ζ), clamped to the table. */
  at(get: (st: MooringState) => number, x: number, z: number): number {
    const { NX, NZ } = MooringTable;
    const fx = Math.min(Math.max((x + this.range) / (2 * this.range), 0), 1) * (NX - 1);
    const fz = this.lift > 0 ? Math.min(Math.max((z + this.lift) / (2 * this.lift), 0), 1) * (NZ - 1) : 0;
    const i = Math.min(NX - 2, Math.floor(fx));
    const j = Math.min(NZ - 2, Math.floor(fz));
    const tx = fx - i;
    const tz = fz - j;
    const v = (ii: number, jj: number): number => get(this.cells[ii][jj]);
    return (1 - tx) * ((1 - tz) * v(i, j) + tz * v(i, j + 1)) + tx * ((1 - tz) * v(i + 1, j) + tz * v(i + 1, j + 1));
  }
}

interface SurgeExtremes {
  xMax: number;
  chainMax: number;
  chainMin: number;
  anchorMax: number;
  upliftMax: number;
  dzMax: number;
  linesMax: number[];
}

/** Integrate the surge equation on a table and record the extremes once the start has settled. */
function simulateSurge(m: MooringModel, s: WaveSetup, table: MooringTable, a: number, start: { x0: number; v0: number }): SurgeExtremes {
  const w = s.omega;
  const T = (2 * Math.PI) / w;
  const dt = T / 80;
  const lift = a * s.liftPerAmp;
  const f = surgeEquation(s, () => a, (x, zeta) => table.at((st) => st.restoring, x, zeta) - table.f0);
  let y = [start.x0, start.v0];
  const out: SurgeExtremes = { xMax: 0, chainMax: 0, chainMin: Infinity, anchorMax: 0, upliftMax: 0, dzMax: 0, linesMax: m.lines.map(() => 0) };
  const steps = Math.round((24 * T) / dt);
  for (let n = 0; n < steps; n++) {
    const t = n * dt;
    y = rk4Step(f, t, y, dt);
    const x = y[0];
    out.xMax = Math.max(out.xMax, Math.abs(x));
    if (t + dt < 8 * T) continue;
    const zeta = lift * Math.cos(w * (t + dt));
    const tc = table.at((st) => st.rode.tensionTop, x, zeta);
    out.chainMax = Math.max(out.chainMax, tc);
    out.chainMin = Math.min(out.chainMin, tc);
    out.anchorMax = Math.max(out.anchorMax, table.at((st) => st.rode.tensionAnchor, x, zeta));
    out.upliftMax = Math.max(out.upliftMax, table.at((st) => st.rode.angleAnchor / DEG, x, zeta));
    out.dzMax = Math.max(out.dzMax, table.at((st) => st.dz, x, zeta));
    out.linesMax.forEach((_, i) => (out.linesMax[i] = Math.max(out.linesMax[i], table.at((st) => st.lines[i].tension, x, zeta))));
  }
  return out;
}

/** Wave-frequency peak loads around an equilibrium for a wave of heightFactor × Hs (default: the largest wave). */
export function waveResponse(m: MooringModel, eq: Equilibrium, heightFactor = HMAX_FACTOR): WaveResponse | null {
  const s = waveSetup(m, eq);
  if (!s) return null;
  const height = m.waves!.spec.hs * heightFactor;
  const a = height / 2;
  const xi = a * s.surgePerAmp;
  const lift = a * s.liftPerAmp;
  const start = linearSteadyState(s, xi);

  let range = 2.5 * Math.max(start.amplitude, xi) + 0.3;
  let run = simulateSurge(m, s, new MooringTable(m, eq, s, range, lift), a, start);
  for (let retry = 0; retry < 3 && run.xMax > 0.9 * range; retry++) {
    range = 1.5 * run.xMax + 0.3;
    run = simulateSurge(m, s, new MooringTable(m, eq, s, range, lift), a, start);
  }

  return {
    ...s.info,
    height,
    amplitude: a,
    waterSurge: xi,
    boatSurge: run.xMax,
    bowLift: lift,
    bowMotion: run.dzMax,
    chainMax: Math.max(run.chainMax, eq.rode.tensionTop),
    chainMin: Math.max(0, run.chainMin),
    anchorMax: Math.max(run.anchorMax, eq.rode.tensionAnchor),
    upliftMaxDeg: Math.max(run.upliftMax, eq.rode.angleAnchor / DEG),
    linesMax: run.linesMax.map((t, i) => Math.max(t, eq.lines[i].tension)),
  };
}
