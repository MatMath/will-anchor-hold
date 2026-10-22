import { G, RHO_SEAWATER } from './constants';
import type { BoatType } from './windage';

/**
 * Wind waves arriving from the wind direction, and what they do to a moored boat.
 *
 * Two effects, both quasi-static (see docs/validation.md, "Waves"):
 *
 * 1. Mean wave drift force — a steady push downwind from waves reflected by the hull. For a reflecting
 *    wall of length W it is ½·ρ·g·A²·W per wave amplitude A (WikiWaves, "Wave drift forces"); in an
 *    irregular sea A² averages to Hs²/8, so F = ρ·g·Hs²·W·Kr²/16. Only the part of the wave energy above
 *    the hull's draft d is reflected: Kr² = 1 − e^(−2kd) (deep-water power transmission past a barrier).
 *
 * 2. Wave-frequency motion — the boat rides the waves and drags the rode and lines with it:
 *    - the hull is treated as rigid and fitted to the wave over its length, giving bow heave/pitch and
 *      surge amplitudes that fall off when the wave is short compared with the hull;
 *    - horizontally the boat is a mass on the mooring spring driven by the water: its excursion is the
 *      water's times ω²/√((ωn² − ω²)² + (2ζωnω)²). A soft mooring follows the water; a stiff one is held and
 *      sees the boat's inertia force instead;
 *    - vertically the bow is lifted by buoyancy, which acts as a spring in series with the chain.
 */

export interface WaveSpec {
  /** Significant wave height, m. */
  hs: number;
  /** Peak period, s. */
  tp: number;
}

/** Height of the largest wave in ~1000 waves (Rayleigh distribution), relative to Hs. */
export const HMAX_FACTOR = 1.86;

/**
 * Default peak period for a young, steep wind sea in an anchorage: Tp = 3.6·√Hs, the steep end of the
 * DNV-RP-C205 range (3.6–5·√Hs). That is a wave steepness of about 1/20.
 */
export const defaultWavePeriod = (hs: number): number => 3.6 * Math.sqrt(Math.max(hs, 0));

/** Wave number k (rad/m) from the dispersion relation ω² = g·k·tanh(k·h). */
export function waveNumber(period: number, depth: number): number {
  const w = (2 * Math.PI) / period;
  let k = (w * w) / G; // deep-water guess
  for (let i = 0; i < 50; i++) {
    const t = Math.tanh(k * depth);
    const f = G * k * t - w * w;
    const df = G * t + G * k * depth * (1 - t * t);
    const dk = f / df;
    k -= dk;
    if (Math.abs(dk) < 1e-12 * k) break;
  }
  return k;
}

/** Underwater hull dimensions used by the wave model. */
export interface HullWater {
  /** Waterline length, m. */
  lwl: number;
  /** Waterline beam (overall, both hulls for a catamaran), m. */
  bwl: number;
  /** Canoe-body draft that reflects waves (fin keel and rudder are too thin to count), m. */
  draft: number;
  /** Waterplane area, m². */
  awp: number;
}

export function hullWater(type: BoatType, loa: number, beam: number): HullWater {
  const lwl = 0.9 * loa;
  return type === 'catamaran'
    ? { lwl, bwl: 0.95 * beam, draft: 0.065 * loa, awp: 2 * 0.7 * lwl * 0.18 * beam }
    : { lwl, bwl: 0.85 * beam, draft: 0.045 * loa, awp: 0.7 * lwl * 0.85 * beam };
}

/** Width of hull the waves see: waterline length across a beam sea, waterline beam across a head sea. */
export const wettedWidth = (h: HullWater, betaRad: number): number =>
  h.lwl * Math.abs(Math.sin(betaRad)) + h.bwl * Math.abs(Math.cos(betaRad));

/** Length of hull along the wave direction. */
export const lengthAlongWave = (h: HullWater, betaRad: number): number =>
  h.lwl * Math.abs(Math.cos(betaRad)) + h.bwl * Math.abs(Math.sin(betaRad));

/** Fraction of wave energy reflected by a hull of draft d: 1 − e^(−2kd). */
export const reflectedEnergy = (k: number, draft: number): number => 1 - Math.exp(-2 * k * draft);

/**
 * Mean wave drift force, N, along the wave direction, for a hull at angle β (rad) to the waves.
 * F = ρ·g·Hs²·W(β)·Kr²/16.
 */
export function driftForce(w: WaveSpec, hull: HullWater, depth: number, betaRad: number): number {
  if (w.hs <= 0) return 0;
  const k = waveNumber(w.tp, depth);
  return (RHO_SEAWATER * G * w.hs * w.hs * wettedWidth(hull, betaRad) * reflectedEnergy(k, hull.draft)) / 16;
}

/**
 * Motion of a rigid hull of length Lh fitted (least squares) to a wave of amplitude a and number k:
 * u = k·Lh/2; heave = a·sin(u)/u; pitch moves the ends by a·3(sin u − u·cos u)/u². Bow vertical motion
 * combines the two (90° apart). Returns ratios to the wave amplitude.
 */
export function rigidHullResponse(k: number, hullLength: number): { heave: number; bowVertical: number; surge: number } {
  const u = (k * hullLength) / 2;
  if (u < 1e-6) return { heave: 1, bowVertical: 1, surge: 1 };
  const heave = Math.sin(u) / u;
  const pitch = (3 * (Math.sin(u) - u * Math.cos(u))) / (u * u);
  return { heave: Math.abs(heave), bowVertical: Math.hypot(heave, pitch), surge: Math.abs(heave) };
}

/** Horizontal water-particle amplitude at the surface relative to the wave amplitude (finite depth). */
export const surfaceOrbitRatio = (k: number, depth: number): number => 1 / Math.tanh(k * depth);

/** Damping ratio assumed for the boat on its mooring (hull drag + rode drag). */
export const MOORING_DAMPING = 0.15;

/**
 * Response of a damped mass on a spring driven by moving water, relative to the water's own motion:
 * x/ξ = ω²/√((ωn² − ω²)² + (2ζ·ωn·ω)²). → 1 for a soft mooring (ωn ≪ ω), → ω²/ωn² for a stiff one.
 */
export function waterFollowing(omega: number, omegaN: number, zeta = MOORING_DAMPING): number {
  const w2 = omega * omega;
  const n2 = omegaN * omegaN;
  return w2 / Math.sqrt((n2 - w2) ** 2 + (2 * zeta * omegaN * omega) ** 2);
}

/** Vertical stiffness of the bow from buoyancy, N/m: heave ρgA plus pitch ρgA/4 in series → ρgA/5. */
export const bowBuoyancyStiffness = (hull: HullWater): number => (RHO_SEAWATER * G * hull.awp) / 5;
