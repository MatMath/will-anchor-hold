import { describe, expect, it } from 'vitest';
import {
  chainEA,
  inelasticTouchdown,
  rodeProfile,
  rodeStiffness,
  ropeMbl,
  slackSpan,
  solveRode,
  spanForTension,
  submergedWeight,
  type Rode,
} from './index';

const w = submergedWeight(2.25); // 10 mm chain, ≈ 19.18 N/m
const rode: Rode = { length: 40, w, ea: chainEA(10), z: 7.3 };
const rigid: Rode = { ...rode, ea: 1e15 };

describe('catenary — closed-form checks (inelastic limit)', () => {
  it('worked example: H = 1000 N in 7.3 m → 28.54 m suspended, span 38.74 m', () => {
    const cf = inelasticTouchdown(w, 7.3, 1000);
    expect(cf.suspended).toBeCloseTo(28.54, 2);
    expect(cf.xSuspended).toBeCloseTo(27.28, 2);
    const x = 40 - cf.suspended + cf.xSuspended;
    const st = solveRode(rigid, x);
    expect(st.h).toBeCloseTo(1000, 3);
    expect(st.suspended).toBeCloseTo(cf.suspended, 6);
    expect(st.v).toBeCloseTo(cf.v, 3);
    expect(st.tensionTop).toBeCloseTo(Math.hypot(1000, cf.v), 3);
    expect(st.vAnchor).toBe(0);
    expect(st.angleAnchor).toBe(0);
  });

  it('whole chain lifts at H = w·(L² − Z²)/(2Z) ≈ 2.03 kN', () => {
    const hLift = (w * (40 * 40 - 7.3 * 7.3)) / (2 * 7.3);
    expect(hLift).toBeCloseTo(2032, 0);
    const below = solveRode(rigid, spanForTension(rigid, 0.99 * hLift));
    const above = solveRode(rigid, spanForTension(rigid, 1.05 * hLift));
    expect(below.grounded).toBeGreaterThan(0);
    expect(below.vAnchor).toBe(0);
    expect(above.grounded).toBe(0);
    expect(above.vAnchor).toBeGreaterThan(0);
    expect(above.angleAnchor).toBeGreaterThan(0);
  });
});

describe('catenary — elastic solver', () => {
  it('inverts spanForTension', () => {
    for (const h of [50, 500, 2000, 5000, 20000, 60000]) {
      expect(solveRode(rode, spanForTension(rode, h)).h / h).toBeCloseTo(1, 7);
    }
  });

  it('vertical balance: V_top − V_anchor = weight of the suspended chain', () => {
    for (const h of [300, 3000, 30000]) {
      const st = solveRode(rode, spanForTension(rode, h));
      expect(st.v - st.vAnchor).toBeCloseTo(w * st.suspended, 6);
    }
  });

  it('is slack (H = 0) when the boat is closer than the hanging-chain span', () => {
    const x0 = slackSpan(rode);
    expect(x0).toBeCloseTo(40 - 7.3, 2);
    const st = solveRode(rode, x0 - 1);
    expect(st.slack).toBe(true);
    expect(st.h).toBe(0);
    expect(st.tensionTop).toBeCloseTo(w * 7.3, 1);
  });

  it('tension rises monotonically with distance, and steeply once the chain is straight', () => {
    let prev = 0;
    for (let x = 33; x < 40.2; x += 0.25) {
      const h = solveRode(rode, x).h;
      expect(h).toBeGreaterThanOrEqual(prev);
      prev = h;
    }
    const straight = Math.sqrt(40 * 40 - 7.3 * 7.3);
    expect(solveRode(rode, straight + 0.05).h).toBeGreaterThan(10 * solveRode(rode, straight - 0.5).h);
  });

  it('profile starts at the anchor and ends at the fairlead', () => {
    for (const h of [500, 5000]) {
      const st = solveRode(rode, spanForTension(rode, h));
      const { chain } = rodeProfile(rode, st);
      expect(chain[0]).toEqual([0, 0]);
      const [x, z] = chain[chain.length - 1];
      expect(x).toBeCloseTo(st.x, 6);
      expect(z).toBeCloseTo(7.3, 6);
    }
  });
});

describe('snubber', () => {
  const snub: Rode = { ...rode, snubber: { length: 6, rope: 'nylon3', mbl: ropeMbl('nylon3', 14) } };

  it('reaches the same height (snubber + chain)', () => {
    const st = solveRode(snub, spanForTension(snub, 4000));
    expect(st.chainZ + st.snubberLength * Math.sin(st.angleTop)).toBeCloseTo(7.3, 6);
    expect(st.snubberStrain).toBeGreaterThan(0);
  });

  it('makes the rode softer at the same tension', () => {
    const h = 5000;
    const kChain = rodeStiffness(rode, spanForTension(rode, h));
    const kSnub = rodeStiffness(snub, spanForTension(snub, h));
    expect(kSnub).toBeLessThan(kChain);
  });
});
