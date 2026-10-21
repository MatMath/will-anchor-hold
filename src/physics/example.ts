import { chainEA, chainMbl } from './chain';
import { ropeMbl } from './rope';
import { LINE_EFFICIENCY, sternCleatSpacing, type ScenarioInput } from './scenario';

/**
 * The worked example in docs/worked-example.md: a 12.8 m monohull Med-moored with 40 m of 10 mm
 * DIN 766 chain in 6 m of water, two 14 mm nylon stern lines, 30 kn on the starboard beam.
 * The stern-line length (6.455 m) gives ≈ 1 kN of chain pretension at rest.
 */
export const WORKED_EXAMPLE: ScenarioInput = {
  loa: 12.8,
  displacement: 10500,
  rollerHeight: 1.3,
  rollerOverhang: 0.3,
  windage: { sideArea: 30, frontArea: 12, cdSide: 1.0, cdFront: 0.8 },
  ceX: -0.3,
  windKn: 30,
  windFromDeg: 90,
  gustFactor: 1.4,
  depth: 6,
  chain: { kgPerM: 2.25, length: 40, mbl: chainMbl('G30', 10), ea: chainEA(10) },
  snubber: null,
  anchor: { mass: 20, holdingRatio: 40, distance: 58, offset: 0 },
  lines: {
    count: 2,
    rope: 'nylon3',
    mbl: ropeMbl('nylon3', 14),
    efficiency: LINE_EFFICIENCY,
    length: 6.455,
    cleatSpacing: sternCleatSpacing('monohull', 4.2), // 3.36 m
    cleatInset: 0.3,
    cleatHeight: 1.2,
    shoreSpread: 4,
    shoreHeight: 0.5,
    crossed: false,
    single: 'centre',
  },
  snatchSpeed: 0.5,
};
