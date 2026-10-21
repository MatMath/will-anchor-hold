/**
 * Windage estimator: rough side and frontal areas of the parts of a yacht above the water,
 * from its main dimensions. Each item is editable in the UI; these are starting values only.
 */

export type BoatType = 'monohull' | 'catamaran';

export interface WindageItem {
  id: string;
  name: string;
  enabled: boolean;
  /** Side-profile area, m². */
  side: number;
  /** Frontal area, m². */
  front: number;
  /** Longitudinal position of the item's area centre, m from midships, + forward. */
  x: number;
}

export interface BoatDims {
  type: BoatType;
  loa: number;
  beam: number;
  /** Mean hull freeboard, m. */
  freeboard: number;
  /** Mast head height above the water, m. */
  mastHeight: number;
}

const r2 = (v: number): number => Math.round(v * 100) / 100;

export function estimateWindageItems(d: BoatDims): WindageItem[] {
  const { loa: L, beam: B, freeboard: f, mastHeight: Hm } = d;
  const k = L / 12.8; // scale for fittings sized on a 12.8 m boat
  const mastAboveDeck = Math.max(0, Hm - f);
  const forestay = mastAboveDeck * 0.95;
  const items: WindageItem[] =
    d.type === 'monohull'
      ? [
          { id: 'hull', name: 'Hull topsides', enabled: true, side: 0.9 * L * f, front: 0.85 * B * f, x: 0 },
          { id: 'cabin', name: 'Coachroof / deckhouse', enabled: true, side: 0.4 * L * 0.6, front: 0.55 * B * 0.6, x: -0.05 * L },
          { id: 'mast', name: 'Mast + standing rigging', enabled: true, side: mastAboveDeck * 0.3, front: mastAboveDeck * 0.2, x: 0.1 * L },
          { id: 'genoa', name: 'Furled headsail', enabled: true, side: forestay * 0.15, front: forestay * 0.15, x: 0.3 * L },
          { id: 'boom', name: 'Boom + stack-pack / furled main', enabled: true, side: 0.38 * L * 0.45, front: 0.5 * 0.45, x: -0.09 * L },
          { id: 'dodger', name: 'Sprayhood / dodger', enabled: true, side: 1.4 * k * 0.75 * 0.7, front: 0.6 * B * 0.75, x: -0.12 * L },
          { id: 'bimini', name: 'Bimini', enabled: true, side: 2.2 * k * 0.45, front: 0.65 * B * 0.45, x: -0.28 * L },
          { id: 'dinghy', name: 'Dinghy on davits', enabled: true, side: 2.8 * k * 0.55, front: 1.5 * k * 0.55, x: -0.5 * L - 0.5 * k },
          { id: 'arch', name: 'Solar arch / davit frame', enabled: false, side: 0.6 * k, front: 1.0 * k, x: -0.47 * L },
          { id: 'rails', name: 'Pulpits, stanchions, lifelines', enabled: true, side: 0.09 * L, front: 0.18 * B, x: 0 },
        ]
      : [
          { id: 'hull', name: 'Hulls (windward) + bridgedeck', enabled: true, side: 0.95 * L * f, front: 0.6 * B * f, x: 0 },
          { id: 'cabin', name: 'Saloon / coachroof', enabled: true, side: 0.45 * L * 1.1, front: 0.8 * B * 1.1, x: -0.05 * L },
          { id: 'mast', name: 'Mast + standing rigging', enabled: true, side: mastAboveDeck * 0.3, front: mastAboveDeck * 0.25, x: 0.05 * L },
          { id: 'genoa', name: 'Furled headsail', enabled: true, side: forestay * 0.15, front: forestay * 0.15, x: 0.25 * L },
          { id: 'boom', name: 'Boom + stack-pack / furled main', enabled: true, side: 0.38 * L * 0.45, front: 0.5 * 0.45, x: -0.12 * L },
          { id: 'bimini', name: 'Hard-top bimini / flybridge', enabled: true, side: 0.25 * L * 0.5, front: 0.7 * B * 0.5, x: -0.2 * L },
          { id: 'dinghy', name: 'Dinghy on davits', enabled: true, side: 3.0 * k * 0.6, front: 1.6 * k * 0.6, x: -0.5 * L - 0.4 * k },
          { id: 'arch', name: 'Solar arch / davit frame', enabled: false, side: 0.6 * k, front: 1.2 * k, x: -0.47 * L },
          { id: 'rails', name: 'Pulpits, stanchions, lifelines', enabled: true, side: 0.09 * L, front: 0.2 * B, x: 0 },
        ];
  return items.map((it) => ({ ...it, side: r2(it.side), front: r2(it.front), x: r2(it.x) }));
}

export interface WindageTotals {
  side: number;
  front: number;
  /** Centre of effort for beam wind: side-area-weighted x, m from midships (+ forward). */
  ceX: number;
}

export function sumWindage(items: readonly WindageItem[]): WindageTotals {
  let side = 0;
  let front = 0;
  let moment = 0;
  for (const it of items) {
    if (!it.enabled) continue;
    side += it.side;
    front += it.front;
    moment += it.side * it.x;
  }
  return { side, front, ceX: side > 0 ? moment / side : 0 };
}
