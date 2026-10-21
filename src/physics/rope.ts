import { interp } from './numeric';

/**
 * Typical fibre-rope data. MBL ≈ k·d² (d in mm, result in kN) and a load–strain curve given as
 * (load / MBL, strain) points for new, wet rope after bedding-in. Real ropes vary ±20% by maker.
 */
export type RopeType = 'nylon3' | 'nylonBraid' | 'polyester3' | 'polyesterBraid' | 'dyneema';

export interface RopeSpec {
  name: string;
  /** MBL coefficient, kN per mm². */
  mblK: number;
  /** (load fraction of MBL, strain) points, increasing. */
  curve: ReadonlyArray<readonly [number, number]>;
}

export const ROPES: Record<RopeType, RopeSpec> = {
  nylon3: {
    name: 'Nylon, 3-strand',
    mblK: 0.205,
    curve: [[0, 0], [0.1, 0.05], [0.2, 0.09], [0.3, 0.13], [0.5, 0.19], [1, 0.28]],
  },
  nylonBraid: {
    name: 'Nylon, double braid',
    mblK: 0.23,
    curve: [[0, 0], [0.1, 0.035], [0.2, 0.065], [0.3, 0.09], [0.5, 0.13], [1, 0.22]],
  },
  polyester3: {
    name: 'Polyester, 3-strand',
    mblK: 0.2,
    curve: [[0, 0], [0.1, 0.02], [0.2, 0.035], [0.3, 0.05], [0.5, 0.07], [1, 0.13]],
  },
  polyesterBraid: {
    name: 'Polyester, double braid',
    mblK: 0.26,
    curve: [[0, 0], [0.1, 0.012], [0.2, 0.022], [0.3, 0.03], [0.5, 0.045], [1, 0.09]],
  },
  dyneema: {
    name: 'Dyneema (SK78), 12-strand',
    mblK: 0.9,
    curve: [[0, 0], [0.1, 0.004], [0.2, 0.007], [0.3, 0.009], [0.5, 0.013], [1, 0.025]],
  },
};

/** Catalogue minimum breaking load, N. */
export const ropeMbl = (type: RopeType, diameterMm: number): number => ROPES[type].mblK * diameterMm * diameterMm * 1000;

/** Strain under tension T (N), for a rope whose (effective) MBL is mblN. */
export function ropeStrain(type: RopeType, tensionN: number, mblN: number): number {
  if (tensionN <= 0) return 0;
  return interp(ROPES[type].curve, tensionN / mblN);
}

/** Tension (N) at a given strain. Zero when slack (strain ≤ 0). */
export function ropeTension(type: RopeType, strain: number, mblN: number): number {
  if (strain <= 0) return 0;
  const inverse = ROPES[type].curve.map(([f, e]) => [e, f] as const);
  return interp(inverse, strain) * mblN;
}
