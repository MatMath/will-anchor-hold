import { G } from './constants';
import { interp } from './numeric';

/**
 * Very rough anchor holding estimate: holding = ratio × anchor weight, reduced when the chain lifts
 * the shank off the seabed. Real holding depends on how well the anchor is set, the exact soil,
 * and the scope; treat this as an order-of-magnitude check, not a rating.
 */
export type AnchorType = 'newgen' | 'plough' | 'claw' | 'fluke';
export type Bottom = 'sand' | 'clay' | 'mud' | 'silt' | 'weed' | 'gravel';

export const ANCHOR_TYPES: Record<AnchorType, string> = {
  newgen: 'New-generation (Rocna, Mantus, Spade, Vulcan…)',
  plough: 'Plough / Delta / CQR',
  claw: 'Claw (Bruce type)',
  fluke: 'Fluke (Danforth, Fortress)',
};

export const BOTTOMS: Record<Bottom, string> = {
  sand: 'Sand (firm)',
  clay: 'Clay (stiff)',
  mud: 'Mud (soft)',
  silt: 'Alluvium / silt (very soft)',
  weed: 'Weed over sand',
  gravel: 'Gravel / shingle',
};

/** Holding ratio: holding force (kgf) per kg of anchor, once well set. */
export const HOLDING_RATIO: Record<AnchorType, Record<Bottom, number>> = {
  newgen: { sand: 40, clay: 35, mud: 15, silt: 8, weed: 8, gravel: 15 },
  plough: { sand: 25, clay: 20, mud: 8, silt: 5, weed: 5, gravel: 10 },
  claw: { sand: 15, clay: 12, mud: 6, silt: 3, weed: 4, gravel: 8 },
  fluke: { sand: 40, clay: 25, mud: 25, silt: 15, weed: 3, gravel: 5 },
};

/**
 * Fraction of holding left when the chain pulls up at the anchor shackle (angle above the seabed).
 * Drag-embedment anchors lose holding fast: roughly −25% at 5°, −50% at 10°, −70% at 15°.
 */
const UPLIFT_CURVE: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [5, 0.75],
  [10, 0.5],
  [15, 0.3],
  [20, 0.2],
  [30, 0.1],
  [90, 0.05],
];

export const upliftFactor = (angleDeg: number): number =>
  angleDeg <= 0 ? 1 : Math.max(0.05, interp(UPLIFT_CURVE, Math.min(angleDeg, 90)));

/** Estimated holding, N. */
export const anchorHolding = (massKg: number, ratio: number, upliftDeg: number): number =>
  massKg * ratio * G * upliftFactor(upliftDeg);
