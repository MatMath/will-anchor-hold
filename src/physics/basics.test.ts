import { describe, expect, it } from 'vitest';
import {
  G,
  KNOT,
  anchorHolding,
  chainEA,
  chainMbl,
  chainWeightPerMetre,
  dragArea,
  estimateWindageItems,
  projectedArea,
  ropeMbl,
  ropeStrain,
  ropeTension,
  submergedWeight,
  sumWindage,
  upliftFactor,
  windDirectionVector,
  windLoad,
  type Windage,
} from './index';

const W: Windage = { sideArea: 30, frontArea: 12, cdSide: 1.0, cdFront: 0.8 };

describe('wind', () => {
  it('worked example: 30 kn beam-on on 30 m² with Cd 1.0 gives 4.38 kN', () => {
    const v = 30 * KNOT; // 15.433 m/s
    const f = windLoad(W, v, 90).force;
    expect(f).toBeCloseTo(0.5 * 1.225 * 1.0 * 30 * v * v, 9);
    expect(f).toBeCloseTo(4376.7, 0);
  });

  it('gust factor 1.4 on speed doubles the force (×1.96)', () => {
    const f1 = windLoad(W, 30 * KNOT, 90).force;
    const f2 = windLoad(W, 1.4 * 30 * KNOT, 90).force;
    expect(f2 / f1).toBeCloseTo(1.96, 9);
  });

  it('uses frontal area and Cd head-on, side area and Cd beam-on', () => {
    expect(projectedArea(W, 0)).toBeCloseTo(12, 9);
    expect(projectedArea(W, 90)).toBeCloseTo(30, 9);
    expect(dragArea(W, 0)).toBeCloseTo(9.6, 9);
    expect(dragArea(W, 180)).toBeCloseTo(9.6, 9);
    expect(windLoad(W, 10, 0).cd).toBeCloseTo(0.8, 9);
  });

  it('interpolates as a box at 45°', () => {
    const s = Math.SQRT1_2;
    expect(projectedArea(W, 45)).toBeCloseTo(30 * s + 12 * s, 9);
    expect(dragArea(W, 45)).toBeCloseTo(30 * s + 9.6 * s, 9);
  });

  it('is symmetric port/starboard', () => {
    expect(windLoad(W, 12, 60).force).toBeCloseTo(windLoad(W, 12, 300).force, 9);
  });

  it('wind from starboard beam blows to port (+y); from ahead blows aft (−x)', () => {
    const [x1, y1] = windDirectionVector(90);
    expect(x1).toBeCloseTo(0, 12);
    expect(y1).toBeCloseTo(1, 12);
    const [x2, y2] = windDirectionVector(0);
    expect(x2).toBeCloseTo(-1, 12);
    expect(y2).toBeCloseTo(0, 12);
  });
});

describe('windage helper', () => {
  it('gives plausible totals for a 12.8 m monohull and a larger frontal area for a catamaran', () => {
    const mono = sumWindage(estimateWindageItems({ type: 'monohull', loa: 12.8, beam: 4.2, freeboard: 1.4, mastHeight: 18 }));
    const cat = sumWindage(estimateWindageItems({ type: 'catamaran', loa: 12.8, beam: 7, freeboard: 1.4, mastHeight: 19 }));
    expect(mono.side).toBeGreaterThan(25);
    expect(mono.side).toBeLessThan(45);
    expect(mono.front / mono.side).toBeLessThan(0.6);
    expect(cat.front).toBeGreaterThan(mono.front);
    expect(Math.abs(mono.ceX)).toBeLessThan(2);
  });

  it('ignores disabled items in the totals', () => {
    const items = estimateWindageItems({ type: 'monohull', loa: 12.8, beam: 4.2, freeboard: 1.4, mastHeight: 18 });
    const all = sumWindage(items).side;
    const noDinghy = sumWindage(items.map((i) => (i.id === 'dinghy' ? { ...i, enabled: false } : i))).side;
    expect(all - noDinghy).toBeCloseTo(items.find((i) => i.id === 'dinghy')!.side, 9);
  });
});

describe('chain', () => {
  it('MBL from grade stress over both link legs', () => {
    expect(chainMbl('G30', 8)).toBeCloseTo(32170, -1); // ≈ 32 kN, DIN 766 catalogue 3200 kgf
    expect(chainMbl('G30', 10)).toBeCloseTo(50265, -1);
    expect(chainMbl('G70', 10) / chainMbl('G30', 10)).toBeCloseTo(700 / 320, 9);
  });

  it('weights from table, scaled by d² otherwise', () => {
    expect(chainWeightPerMetre(10)).toBe(2.25);
    expect(chainWeightPerMetre(11)).toBeCloseTo(2.25 * 1.21, 9);
  });

  it('submerged weight = 87% of weight in air', () => {
    expect(submergedWeight(2.25)).toBeCloseTo(2.25 * G * (1 - 1025 / 7850), 9);
    expect(submergedWeight(2.25)).toBeCloseTo(19.18, 2);
  });

  it('EA per DNV studless formula', () => {
    expect(chainEA(8)).toBeCloseTo(5.4656e6, -2);
  });
});

describe('rope', () => {
  it('MBL ∝ d²', () => {
    expect(ropeMbl('nylon3', 14)).toBeCloseTo(0.205 * 196 * 1000, 6);
  });

  it('strain and tension are inverse functions; slack carries no load', () => {
    for (const type of ['nylon3', 'polyesterBraid', 'dyneema'] as const) {
      const mbl = ropeMbl(type, 12);
      for (const t of [100, 2000, 9000, 20000]) {
        expect(ropeTension(type, ropeStrain(type, t, mbl), mbl)).toBeCloseTo(t, 6);
      }
    }
    expect(ropeTension('nylon3', -0.01, 1e4)).toBe(0);
    expect(ropeTension('nylon3', 0, 1e4)).toBe(0);
  });

  it('nylon stretches ~10× more than Dyneema at the same load fraction', () => {
    const n = ropeStrain('nylon3', 3000, 10000);
    const d = ropeStrain('dyneema', 3000, 10000);
    expect(n / d).toBeGreaterThan(10);
  });
});

describe('anchor holding', () => {
  it('flat pull: ratio × weight', () => {
    expect(anchorHolding(20, 40, 0)).toBeCloseTo(20 * 40 * G, 9);
  });

  it('drops with uplift angle', () => {
    expect(upliftFactor(0)).toBe(1);
    expect(upliftFactor(5)).toBeCloseTo(0.75, 9);
    expect(upliftFactor(10)).toBeCloseTo(0.5, 9);
    expect(upliftFactor(7.5)).toBeCloseTo(0.625, 9);
    expect(upliftFactor(80)).toBeGreaterThanOrEqual(0.05);
  });
});
