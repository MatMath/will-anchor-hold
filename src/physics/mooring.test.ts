import { describe, expect, it } from 'vitest';
import {
  KNOT,
  WORKED_EXAMPLE,
  anchorDistanceForPretension,
  buildModel,
  driftStep,
  liftOffWind,
  maxAnchorDistance,
  lineLengthForPretension,
  runScenario,
  solveEquilibrium,
  solveRest,
  sweep,
  windLoad,
  type Equilibrium,
  type ScenarioInput,
} from './index';

const model = buildModel(WORKED_EXAMPLE);
const rest = solveRest(model);

/** ΣF and ΣM about midships from the returned force vectors. */
function balance(eq: Equilibrium): [number, number, number] {
  const P = [eq.pose.x, eq.pose.y];
  const forces: Array<[number[], number[]]> = [
    [eq.wind.point, eq.wind.vector],
    [eq.bow, eq.chainForce],
    ...eq.lines.map((l) => [l.cleat, l.force] as [number[], number[]]),
  ];
  let fx = 0;
  let fy = 0;
  let mz = 0;
  for (const [p, f] of forces) {
    fx += f[0];
    fy += f[1];
    mz += (p[0] - P[0]) * f[1] - (p[1] - P[1]) * f[0];
  }
  return [fx, fy, mz];
}

describe('rest state', () => {
  it('the example line length gives ≈ 1 kN of chain pretension', () => {
    expect(rest.converged).toBe(true);
    expect(rest.rode.h).toBeCloseTo(1000, -1);
    expect(rest.pose.y).toBeCloseTo(0, 9);
    expect(rest.pose.psi).toBeCloseTo(0, 9);
  });

  it('chain pull equals the stern lines’ fore-aft pull', () => {
    const lineX = rest.lines.reduce((s, l) => s + l.force[0], 0);
    expect(-lineX).toBeCloseTo(rest.rode.h, 3);
  });

  it('lineLengthForPretension hits its target', () => {
    for (const target of [300, 1000, 2500]) {
      const len = lineLengthForPretension(WORKED_EXAMPLE, target);
      const r = solveRest(buildModel({ ...WORKED_EXAMPLE, lines: { ...WORKED_EXAMPLE.lines, length: len } }));
      expect(r.rode.h).toBeCloseTo(target, 0);
    }
  });
});

describe('equilibrium under wind', () => {
  const eq = solveEquilibrium(model, 30 * KNOT, 90, { initial: rest.pose });

  it('converges and balances forces and moment', () => {
    expect(eq.converged).toBe(true);
    const [fx, fy, mz] = balance(eq);
    expect(Math.abs(fx)).toBeLessThan(1e-3);
    expect(Math.abs(fy)).toBeLessThan(1e-3);
    expect(Math.abs(mz)).toBeLessThan(1e-2);
  });

  it('chain and lines share the whole wind load', () => {
    expect(eq.shareChain + eq.shareLines).toBeCloseTo(1, 6);
  });

  it('starboard beam wind pushes the boat to port, and tensions exceed the wind force', () => {
    expect(eq.pose.y).toBeGreaterThan(0);
    expect(eq.rode.tensionTop).toBeGreaterThan(eq.wind.force);
    const maxLine = Math.max(...eq.lines.map((l) => l.tension));
    expect(maxLine).toBeGreaterThan(0.5 * eq.wind.force);
  });

  it('is mirror-symmetric for port vs starboard wind', () => {
    const mirror = solveEquilibrium(model, 30 * KNOT, 270, { initial: rest.pose });
    expect(mirror.pose.y).toBeCloseTo(-eq.pose.y, 5);
    expect(mirror.pose.psi).toBeCloseTo(-eq.pose.psi, 7);
    expect(mirror.rode.tensionTop).toBeCloseTo(eq.rode.tensionTop, 2);
    expect(mirror.lines[0].tension).toBeCloseTo(eq.lines[1].tension, 2);
    expect(mirror.lines[1].tension).toBeCloseTo(eq.lines[0].tension, 2);
  });

  it('head wind loads the chain, stern wind loads the lines; neither shifts the boat sideways', () => {
    const head = solveEquilibrium(model, 30 * KNOT, 0, { initial: rest.pose });
    const stern = solveEquilibrium(model, 30 * KNOT, 180, { initial: rest.pose });
    expect(head.pose.y).toBeCloseTo(0, 6);
    expect(head.rode.h).toBeGreaterThan(rest.rode.h);
    expect(stern.lines[0].tension).toBeGreaterThan(rest.lines[0].tension);
    expect(stern.rode.h).toBeLessThan(rest.rode.h + 1e-6);
    expect(head.lines[0].tension).toBeCloseTo(head.lines[1].tension, 3);
  });

  it('lets a slack mooring drift until something tightens', () => {
    const slack: ScenarioInput = { ...WORKED_EXAMPLE, anchor: { ...WORKED_EXAMPLE.anchor, distance: 50 } };
    const m = buildModel(slack);
    const r = solveRest(m);
    expect(r.rode.slack).toBe(true);
    expect(r.lines.every((l) => l.slack)).toBe(true);
    const e = solveEquilibrium(m, 25 * KNOT, 90, { initial: r.pose });
    expect(e.converged).toBe(true);
    const [fx, fy] = balance(e);
    expect(Math.hypot(fx, fy)).toBeLessThan(1e-2);
  });
});

describe('scenario + sweep', () => {
  it('gust loads exceed sustained loads', () => {
    const r = runScenario(WORKED_EXAMPLE);
    expect(r.gust.chain.tension).toBeGreaterThan(r.sustained.chain.tension);
    expect(r.gust.eq.wind.force / r.sustained.eq.wind.force).toBeGreaterThan(1.9);
    expect(Math.abs(r.gust.drift.dy)).toBeGreaterThan(Math.abs(r.sustained.drift.dy));
  });

  it('chain tension and side shift grow with wind speed', () => {
    const pts = sweep(WORKED_EXAMPLE, [10, 20, 30, 40, 50, 60]);
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i].chain).toBeGreaterThan(pts[i - 1].chain);
      expect(pts[i].sideShift).toBeGreaterThan(pts[i - 1].sideShift);
    }
  });

  it('worked example regression (see docs/worked-example.md)', () => {
    const r = runScenario(WORKED_EXAMPLE);
    const s = r.sustained;
    expect(s.eq.wind.force / 1000).toBeCloseTo(4.47, 1);
    expect(s.chain.tension / 1000).toBeCloseTo(7.5, 0);
    expect(s.drift.dy).toBeCloseTo(3.4, 0);
    expect(s.anchor.pull).toBe('upward');
    expect(s.chain.mbl).toBe(49000); // DIN 766 table, 10 mm
    expect(s.anchor.upliftFactor).toBeCloseTo(1 - 0.0315 * (s.anchor.upliftDeg - 3), 9);
    expect(s.anchor.ratio).toBeCloseTo(1.1, 1);
  });
});

describe('slider helpers', () => {
  it('max anchor distance = stern line + boat + roller + chain', () => {
    expect(maxAnchorDistance(WORKED_EXAMPLE)).toBeCloseTo(6.455 + 12.8 + 0.3 + 40, 9);
  });

  it('balanced anchor distance reproduces the target pretension (worked example ≈ 58 m for 1 kN)', () => {
    const d = anchorDistanceForPretension(WORKED_EXAMPLE, 1000)!;
    expect(d).toBeCloseTo(58, 1);
    const r = solveRest(buildModel({ ...WORKED_EXAMPLE, anchor: { ...WORKED_EXAMPLE.anchor, distance: d } }));
    expect(r.rode.h).toBeCloseTo(1000, 0);
    expect(d).toBeLessThan(maxAnchorDistance(WORKED_EXAMPLE));
  });

  it('balanced distance grows with the target pretension', () => {
    const a = anchorDistanceForPretension(WORKED_EXAMPLE, 300)!;
    const b = anchorDistanceForPretension(WORKED_EXAMPLE, 3000)!;
    expect(b).toBeGreaterThan(a);
  });

  it('lift-off wind: chain on the seabed just below, fully lifted just above', () => {
    const v = liftOffWind(WORKED_EXAMPLE)!;
    expect(v).toBeGreaterThan(5);
    expect(v).toBeLessThan(30); // fully lifted at 30 kn in the worked example
    const m = buildModel(WORKED_EXAMPLE);
    const rest = solveRest(m);
    const below = solveEquilibrium(m, (v - 0.3) * KNOT, 90, { initial: rest.pose });
    const above = solveEquilibrium(m, (v + 0.3) * KNOT, 90, { initial: rest.pose });
    expect(below.rode.grounded).toBeGreaterThan(0);
    expect(above.rode.grounded).toBe(0);
  });

  it('lift-off wind is null when a long chain never lifts', () => {
    const long: ScenarioInput = { ...WORKED_EXAMPLE, chain: { ...WORKED_EXAMPLE.chain, length: 120 }, anchor: { ...WORKED_EXAMPLE.anchor, distance: 130 } };
    expect(liftOffWind(long, 20)).toBeNull();
  });
});

describe('slack mooring with long stern lines (regression)', () => {
  // Anchor at 52 m with 25–26 m stern lines: chain and lines are slack at rest, so the boat must drift
  // ~20 m sideways before anything tightens. The old drift search could jump over the narrow band where
  // the stiff lines are just taut and silently return the rest position.
  const at = (len: number): ScenarioInput => ({ ...WORKED_EXAMPLE, windKn: 20, anchor: { ...WORKED_EXAMPLE.anchor, distance: 52 }, lines: { ...WORKED_EXAMPLE.lines, length: len } });

  it('converges at 20 kn for every line length from 20 to 40 m', () => {
    for (let len = 20; len <= 40; len += 1) {
      const m = buildModel(at(len));
      const r = solveRest(m);
      expect(r.rode.slack).toBe(true);
      const e = solveEquilibrium(m, 20 * KNOT, 90, { initial: r.pose });
      expect(e.converged, `line ${len} m`).toBe(true);
      expect(e.pose.y).toBeGreaterThan(15);
      const [fx, fy, mz] = balance(e);
      expect(Math.hypot(fx, fy)).toBeLessThan(1e-2);
      expect(Math.abs(mz)).toBeLessThan(1e-1);
    }
  });

  it('lift-off wind changes smoothly with line length (25 m vs 26 m)', () => {
    const a = liftOffWind(at(25));
    const b = liftOffWind(at(26));
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(Math.abs(a! - b!)).toBeLessThan(1);
  });

  it('driftStep finds where a stiff line takes up, however narrow', () => {
    // Pushed with 5 N until s = 10 m, then a 10 kN/m line: equilibrium at s = 10.0005 m.
    const f = (s: number): number => (s < 10 ? 5 : 5 - 1e4 * (s - 10));
    expect(driftStep(f, 1000)).toBeCloseTo(10.0005, 6);
    expect(driftStep(() => 1, 100)).toBe(0);
  });
});

describe('no stern lines: swinging at anchor', () => {
  const swing = (dir: number): ScenarioInput => ({ ...WORKED_EXAMPLE, windFromDeg: dir, lines: { ...WORKED_EXAMPLE.lines, count: 0 } });

  it('the boat turns head to wind (apparent wind 0°) whatever the wind direction', () => {
    for (const dir of [0, 45, 90, 135, 180, 270, 315]) {
      const r = runScenario(swing(dir));
      const e = r.sustained.eq;
      expect(e.converged).toBe(true);
      expect(Math.sin((e.wind.angleDeg * Math.PI) / 180)).toBeCloseTo(0, 6);
      expect(Math.cos((e.wind.angleDeg * Math.PI) / 180)).toBeCloseTo(1, 6);
      expect(e.lines).toHaveLength(0);
      const [fx, fy, mz] = balance(e);
      expect(Math.hypot(fx, fy)).toBeLessThan(1e-3);
      expect(Math.abs(mz)).toBeLessThan(1e-2);
    }
  });

  it('the chain carries the whole head-on wind load', () => {
    const r = runScenario(swing(90));
    const e = r.sustained.eq;
    expect(e.shareChain).toBeCloseTo(1, 6);
    expect(e.rode.h).toBeCloseTo(windLoad(WORKED_EXAMPLE.windage, 30 * KNOT, 0).force, 3);
    expect((e.pose.psi * 180) / Math.PI).toBeCloseTo(-90, 6); // starboard-beam wind: bow swings 90° to starboard
    expect(r.sustained.snatch.k).toBeGreaterThan(0);
    expect(r.rest.converged).toBe(true);
  });

  it('beam wind loads the chain far less swinging than Med-moored', () => {
    const med = runScenario(WORKED_EXAMPLE).sustained.chain.tension;
    const free = runScenario(swing(90)).sustained.chain.tension;
    expect(free).toBeLessThan(med / 3);
  });
});
