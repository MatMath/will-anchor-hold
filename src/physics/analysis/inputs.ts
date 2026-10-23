import type { Windage } from '../environment/wind';
import type { BoatType } from '../environment/windage';
import type { RopeType } from '../materials/rope';

/** The calculation's inputs, in SI units (N, m, kg) except where noted — built from the UI state by ui/state.ts. */

export interface ScenarioInput {
  boatType: BoatType;
  loa: number;
  beam: number;
  displacement: number;
  /** Bow roller height above water, m. */
  rollerHeight: number;
  /** How far the roller sticks out ahead of the stem, m. */
  rollerOverhang: number;
  windage: Windage;
  /** Centre of effort, m from midships (+ forward). */
  ceX: number;

  windKn: number;
  /** Direction the wind comes FROM, degrees clockwise from the at-rest bow (90 = starboard beam). */
  windFromDeg: number;
  /** Gust speed / mean speed. */
  gustFactor: number;

  depth: number;
  chain: { kgPerM: number; length: number; mbl: number; ea: number };
  snubber: null | { rope: RopeType; length: number; mbl: number };
  anchor: {
    mass: number;
    /** Holding force (kgf) per kg of anchor for the chosen type and bottom. */
    holdingRatio: number;
    /** Horizontal distance from the shore (quay face) to the anchor, m. */
    distance: number;
    /** Sideways offset of the anchor from the boat's centreline at rest, m (+ to port). */
    offset: number;
  };
  lines: {
    /** 0 = no stern lines: the boat swings on its anchor. */
    count: 0 | 1 | 2;
    rope: RopeType;
    /** Catalogue MBL of one line, N. */
    mbl: number;
    /** Knot / splice / chafe efficiency, 0–1. */
    efficiency: number;
    /** Unstretched length of each line, cleat → shore point, m. */
    length: number;
    /** Distance between port and starboard stern cleats, m. */
    cleatSpacing: number;
    /** Distance of the cleats forward of the transom, m. */
    cleatInset: number;
    cleatHeight: number;
    /** Distance between the two shore points (0 = both to one ring or rock), m. */
    shoreSpread: number;
    shoreHeight: number;
    /** Lines cross over: port cleat to the starboard shore point and vice versa. */
    crossed: boolean;
    /** Which cleat a single line uses. */
    single: 'port' | 'centre' | 'starboard';
  };
  /** Wind waves from the wind direction: significant height (m) and peak period (s); null = flat water. */
  waves: null | { hs: number; tp: number };
  /** Fishtailing at anchor (only when there are no stern lines): swing ± amplitude, and its period (animation only). */
  fishtail: null | { amplitudeDeg: number; periodS: number };
  /** Boat speed used for the indicative snatch-load estimate, m/s. */
  snatchSpeed: number;
}

/** Knot / splice / chafe allowance applied to every stern line: 85% of the catalogue MBL. */
export const LINE_EFFICIENCY = 0.85;

/** Stern cleats are taken 80% of the beam apart on a monohull and the full beam apart on a multihull. */
export const sternCleatSpacing = (type: BoatType, beam: number): number => (type === 'catamaran' ? 1 : 0.8) * beam;
