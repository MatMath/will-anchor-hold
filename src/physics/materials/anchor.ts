import { G } from '../core/constants';

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
 * No loss up to 3° (US Navy mooring manual, via OTC 7491), then a straight line fitted to the yacht
 * scope tests ("at 5:1 about 80% … compared to 10:1", Sailing Foundation 1995, i.e. ~11.5° vs ~5.7°):
 * about −3.15% per degree, floored at 10%. API RP 2SK (offshore anchors) is milder; yacht anchors bury
 * less deeply, so this sits between. See docs/validation.md.
 */
export const UPLIFT_NO_LOSS_DEG = 3;
export const UPLIFT_LOSS_PER_DEG = 0.0315;

export const upliftFactor = (angleDeg: number): number =>
  angleDeg <= UPLIFT_NO_LOSS_DEG ? 1 : Math.max(0.1, 1 - UPLIFT_LOSS_PER_DEG * (angleDeg - UPLIFT_NO_LOSS_DEG));

/** Estimated holding, N. */
export const anchorHolding = (massKg: number, ratio: number, upliftDeg: number): number =>
  massKg * ratio * G * upliftFactor(upliftDeg);
