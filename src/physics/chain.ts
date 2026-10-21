import { G, RHO_SEAWATER, RHO_STEEL } from './constants';

/**
 * Galvanised short-link anchor chain.
 *
 * Grade 30 uses the published DIN 766 table (Certex "Chain DIN 766A" datasheet). Sizes not in the table
 * are scaled by d² from the nearest listed size. Grade 40 / 70 have no table here and use the grade
 * definition: grade = mean stress at break over both legs of a link, MBL = σ_grade · 2 · π·d²/4.
 * See docs/validation.md.
 */
export type ChainGrade = 'G30' | 'G40' | 'G70';

export const CHAIN_GRADES: Record<ChainGrade, { name: string; stress: number }> = {
  G30: { name: 'DIN 766 / ISO 4565 (Grade 30)', stress: 300 },
  G40: { name: 'Grade 40 high-test', stress: 400 },
  G70: { name: 'Grade 70 (e.g. Aqua7, G7)', stress: 700 },
};

/** DIN 766 (Grade 3): diameter mm, minimum breaking force kN, weight kg/m. Source: Certex datasheet. */
export const DIN766: ReadonlyArray<{ d: number; mblKN: number; kgPerM: number }> = [
  { d: 4, mblKN: 5.88, kgPerM: 0.32 },
  { d: 5, mblKN: 12.35, kgPerM: 0.5 },
  { d: 6, mblKN: 17.65, kgPerM: 0.75 },
  { d: 7, mblKN: 24.71, kgPerM: 1.0 },
  { d: 8, mblKN: 31.38, kgPerM: 1.35 },
  { d: 10, mblKN: 49.0, kgPerM: 2.25 },
  { d: 12, mblKN: 68.64, kgPerM: 3.1 },
  { d: 16, mblKN: 123.56, kgPerM: 5.8 },
  { d: 20, mblKN: 196.0, kgPerM: 9.0 },
];

/** Table row for a diameter: exact, or the nearest row (to be scaled by d²). */
const nearest = (dMm: number): (typeof DIN766)[number] =>
  DIN766.reduce((a, b) => (Math.abs(b.d - dMm) < Math.abs(a.d - dMm) ? b : a));

/** Chain weight in air (kg/m): DIN 766 table value, or scaled by d² from the nearest size. */
export function chainWeightPerMetre(dMm: number): number {
  const row = nearest(dMm);
  return row.d === dMm ? row.kgPerM : row.kgPerM * (dMm / row.d) ** 2;
}

/** Minimum breaking load, N. */
export function chainMbl(grade: ChainGrade, dMm: number): number {
  if (grade === 'G30') {
    const row = nearest(dMm);
    return row.mblKN * 1000 * (row.d === dMm ? 1 : (dMm / row.d) ** 2);
  }
  return (CHAIN_GRADES[grade].stress * 2 * (Math.PI * dMm * dMm)) / 4;
}

/**
 * Axial stiffness EA of studless link chain, N: 85.4·d² kN with d in mm. Within 1.4% of the DNV-OS-E302
 * value for grade R3 at 10 mm (c·π·d², c ≈ 27 − 0.02d). Far softer than a steel bar because the links bend.
 */
export const chainEA = (dMm: number): number => 85.4e3 * dMm * dMm;

/** Submerged weight per metre, N/m: weight in air minus buoyancy of the steel. */
export const submergedWeight = (kgPerM: number): number => kgPerM * G * (1 - RHO_SEAWATER / RHO_STEEL);
