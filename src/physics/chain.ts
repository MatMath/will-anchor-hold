import { G, RHO_SEAWATER, RHO_STEEL } from './constants';

/**
 * Galvanised short-link anchor chain.
 *
 * MBL follows the chain-grade definition: grade = mean stress at break over the cross-section of
 * both legs of a link, so MBL = σ_grade · 2 · π·d²/4.
 *   DIN 766 / ISO 4565 calibrated chain is about σ = 320 N/mm² (8 mm → 32 kN).
 */
export type ChainGrade = 'G30' | 'G40' | 'G70';

export const CHAIN_GRADES: Record<ChainGrade, { name: string; stress: number }> = {
  G30: { name: 'DIN 766 / ISO 4565 (Grade 30)', stress: 320 },
  G40: { name: 'Grade 40 high-test', stress: 400 },
  G70: { name: 'Grade 70 (e.g. Aqua7, G7)', stress: 700 },
};

/** Typical weight in air of DIN 766 calibrated chain, kg/m. */
export const CHAIN_WEIGHTS: ReadonlyArray<{ d: number; kgPerM: number }> = [
  { d: 6, kgPerM: 0.75 },
  { d: 8, kgPerM: 1.35 },
  { d: 10, kgPerM: 2.25 },
  { d: 12, kgPerM: 3.2 },
  { d: 13, kgPerM: 3.8 },
  { d: 14, kgPerM: 4.4 },
];

/** Chain weight in air (kg/m): table value, or scaled by d² from the nearest entry. */
export function chainWeightPerMetre(dMm: number): number {
  const exact = CHAIN_WEIGHTS.find((c) => c.d === dMm);
  if (exact) return exact.kgPerM;
  const nearest = CHAIN_WEIGHTS.reduce((a, b) => (Math.abs(b.d - dMm) < Math.abs(a.d - dMm) ? b : a));
  return nearest.kgPerM * (dMm / nearest.d) ** 2;
}

/** Minimum breaking load, N. */
export const chainMbl = (grade: ChainGrade, dMm: number): number =>
  CHAIN_GRADES[grade].stress * 2 * (Math.PI * dMm * dMm) / 4;

/**
 * Axial stiffness EA of studless link chain, N. DNV-OS-E301: EA = 0.854·10⁸·d² kN (d in m),
 * i.e. 85.4·d² kN with d in mm. Far softer than a steel bar because the links bend.
 */
export const chainEA = (dMm: number): number => 85.4e3 * dMm * dMm;

/** Submerged weight per metre, N/m: weight in air minus buoyancy of the steel. */
export const submergedWeight = (kgPerM: number): number => kgPerM * G * (1 - RHO_SEAWATER / RHO_STEEL);
