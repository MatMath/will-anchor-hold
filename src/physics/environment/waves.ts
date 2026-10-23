import { G } from '../core/constants';

/**
 * Wind waves arriving from the wind direction: the sea state and its kinematics.
 * What the waves do to a hull is in waveLoads.ts; the boat's response in dynamics/.
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

/** Horizontal water-particle amplitude at the surface relative to the wave amplitude (finite depth). */
export const surfaceOrbitRatio = (k: number, depth: number): number => 1 / Math.tanh(k * depth);

