import { G, RHO_SEAWATER } from '../core/constants';
import type { BoatType } from './windage';
import { waveNumber, type WaveSpec } from './waves';

/**
 * How waves act on a hull (see docs/validation.md, "Waves"):
 *
 * 1. Mean wave drift force — a steady push downwind from waves reflected by the hull. For a reflecting
 *    wall of length W it is ½·ρ·g·A²·W per wave amplitude A (WikiWaves, "Wave drift forces"); in an
 *    irregular sea A² averages to Hs²/8, so F = ρ·g·Hs²·W·Kr²/16. Only the part of the wave energy above
 *    the hull's draft d is reflected: Kr² = 1 − e^(−2kd) (deep-water power transmission past a barrier).
 *
 * 2. Wave-frequency motion — the hull is treated as rigid and fitted to the wave over its length, giving
 *    bow heave/pitch and surge amplitudes that fall off when the wave is short compared with the hull.
 *    Vertically the bow is lifted by buoyancy, which acts as a spring in series with the chain.
 */

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

/** Vertical stiffness of the bow from buoyancy, N/m: heave ρgA plus pitch ρgA/4 in series → ρgA/5. */
export const bowBuoyancyStiffness = (hull: HullWater): number => (RHO_SEAWATER * G * hull.awp) / 5;
