import { describe, expect, it } from 'vitest';
import {
  G,
  HMAX_FACTOR,
  KNOT,
  MooringAnimation,
  RHO_SEAWATER,
  WORKED_EXAMPLE,
  buildModel,
  defaultWavePeriod,
  driftForce,
  fishtailExtreme,
  gustLevel,
  gustSchedule,
  hullWater,
  rigidHullResponse,
  runScenario,
  solveEquilibrium,
  waterFollowing,
  waveNumber,
  waveResponse,
  type ScenarioInput,
} from './index';

const waves = (hs: number): ScenarioInput['waves'] => ({ hs, tp: defaultWavePeriod(hs) });
const swing: ScenarioInput = { ...WORKED_EXAMPLE, lines: { ...WORKED_EXAMPLE.lines, count: 0 }, anchor: { ...WORKED_EXAMPLE.anchor, distance: 200 } };

describe('wave basics', () => {
  it('dispersion: deep-water limit and finite depth', () => {
    const T = 3;
    const deep = waveNumber(T, 1000);
    expect(deep).toBeCloseTo((2 * Math.PI / T) ** 2 / G, 9);
    const k = waveNumber(T, 3);
    expect(G * k * Math.tanh(k * 3)).toBeCloseTo((2 * Math.PI / T) ** 2, 9);
    expect(k).toBeGreaterThan(deep); // waves shorten in shallow water
  });

  it('default period gives a steep young wind sea, steepness ≈ 1/20', () => {
    for (const hs of [0.3, 0.5, 1, 1.5]) {
      const lambda = (2 * Math.PI) / waveNumber(defaultWavePeriod(hs), 1000);
      expect(hs / lambda).toBeCloseTo(1 / 20.2, 2);
    }
  });

  it('mean drift force: full-reflection limit ρg·Hs²·W/16, ∝ Hs², larger beam-on', () => {
    const hull = { lwl: 11.5, bwl: 3.6, draft: 100, awp: 30 }; // very deep draft: everything reflects
    const f = driftForce({ hs: 1, tp: 3 }, hull, 1000, Math.PI / 2);
    expect(f).toBeCloseTo((RHO_SEAWATER * G * 1 * 11.5) / 16, 3);
    const real = hullWater('monohull', 12.8, 4.2);
    const a = driftForce({ hs: 0.5, tp: 2.5 }, real, 6, Math.PI / 2);
    const b = driftForce({ hs: 1.0, tp: 2.5 }, real, 6, Math.PI / 2);
    expect(b / a).toBeCloseTo(4, 9);
    expect(driftForce({ hs: 1, tp: 3 }, real, 6, 0)).toBeLessThan(driftForce({ hs: 1, tp: 3 }, real, 6, Math.PI / 2));
  });

  it('rigid hull on the wave: follows long waves, pitches at λ = L, ignores very short waves', () => {
    const long = rigidHullResponse(1e-4, 12);
    expect(long.heave).toBeCloseTo(1, 6);
    expect(long.bowVertical).toBeCloseTo(1, 6);
    const pitch = rigidHullResponse(Math.PI / 6, 12); // λ = 12 m = hull: no heave, pure pitch
    expect(pitch.heave).toBeCloseTo(0, 9);
    expect(pitch.bowVertical).toBeCloseTo(3 / Math.PI, 9);
    expect(rigidHullResponse(20, 12).bowVertical).toBeLessThan(0.05);
  });

  it('a soft mooring lets the boat follow the water; a stiff one holds it (inertia force only)', () => {
    expect(waterFollowing(2, 0.01)).toBeCloseTo(1, 3);
    expect(waterFollowing(1, 20)).toBeCloseTo(1 / 400, 4);
  });
});

describe('waves in the scenario', () => {
  it('waves off: peak = static, results unchanged', () => {
    const r = runScenario(WORKED_EXAMPLE);
    expect(r.sustained.waves).toBeNull();
    expect(r.sustained.fishtail).toBeNull();
    expect(r.sustained.peak.chain.tension).toBe(r.sustained.chain.tension);
    expect(r.sustained.peak.source).toBe('static');
  });

  it('waves add a mean drift force and raise the peak above the static load', () => {
    const r = runScenario({ ...WORKED_EXAMPLE, waves: waves(0.5) });
    const s = r.sustained;
    expect(s.eq.waveDrift).toBeGreaterThan(0);
    expect(s.waves!.height).toBeCloseTo(0.5 * HMAX_FACTOR, 9);
    expect(s.peak.chain.tension).toBeGreaterThan(s.chain.tension);
    expect(s.waves!.chainMin).toBeLessThan(s.chain.tension);
  });

  it('tiny waves: the simulated surge matches the linear spring–mass response', () => {
    const inp = { ...swing, waves: waves(0.5) };
    const m = buildModel({ ...inp, waves: { hs: 0.02, tp: defaultWavePeriod(0.5) } });
    const eq = solveEquilibrium(m, 20 * KNOT, 90);
    const wr = waveResponse(m, eq, 1)!;
    const omega = (2 * Math.PI) / wr.period;
    const omegaN = (2 * Math.PI) / wr.naturalPeriod;
    // m ẍ + c ẋ + k x = m·a_w + c·u_w  →  |x/ξ| = |−mω² + icω| / |k − mω² + icω|
    const z = 0.15;
    const lin = Math.hypot(omega * omega, 2 * z * omegaN * omega) / Math.hypot(omegaN ** 2 - omega ** 2, 2 * z * omegaN * omega);
    expect(wr.boatSurge / wr.waterSurge).toBeCloseTo(lin, 1);
  });

  it('a nylon snubber cuts the wave snatch load', () => {
    const base = { ...swing, waves: waves(1), fishtail: { amplitudeDeg: 25, periodS: 30 } };
    const chain = runScenario(base).sustained.peak.chain.tension;
    const snub = runScenario({ ...base, snubber: { rope: 'nylon3', length: 6, mbl: 40000 } }).sustained.peak.chain.tension;
    expect(snub).toBeLessThan(chain / 2);
  });
});

describe('fishtailing', () => {
  it('only applies when swinging at anchor, and is symmetric port/starboard', () => {
    const m = buildModel({ ...WORKED_EXAMPLE, fishtail: { amplitudeDeg: 25, periodS: 30 } });
    const eq = solveEquilibrium(m, 30 * KNOT, 90);
    expect(fishtailExtreme(m, eq, 25)).toBeNull(); // stern lines stop it
    const ms = buildModel(swing);
    const eqs = solveEquilibrium(ms, 30 * KNOT, 0);
    const p = solveEquilibrium(ms, 30 * KNOT, 0, { fixedPsi: eqs.pose.psi + 0.4 });
    const s = solveEquilibrium(ms, 30 * KNOT, 0, { fixedPsi: eqs.pose.psi - 0.4 });
    expect(p.rode.tensionTop).toBeCloseTo(s.rode.tensionTop, 3);
  });

  it('load grows with the swing; ±60° gives 2–3.5× (Practical Sailor: 120° of yaw → 2–3×)', () => {
    const ratio = (amp: number): number => {
      const r = runScenario({ ...swing, fishtail: { amplitudeDeg: amp, periodS: 30 } });
      return r.sustained.fishtail!.chain.tension / r.sustained.chain.tension;
    };
    const r15 = ratio(15);
    const r30 = ratio(30);
    const r60 = ratio(60);
    expect(r15).toBeGreaterThan(1);
    expect(r30).toBeGreaterThan(r15);
    expect(r60).toBeGreaterThan(r30);
    expect(r60).toBeGreaterThan(2);
    expect(r60).toBeLessThan(3.5);
  });
});

describe('validation against Practical Sailor anchor-load measurements', () => {
  // 45 ft monohull, all chain, no snubber, 30 kn: max snatch ~900 lbf (4.0 kN); "severe" ~1500 lbf
  // (6.7 kN) at short scope; snatch loads "almost disappeared" at 10:1. Model: 12.8 m, ±25° fishtail,
  // small chop (Hs 0.2 m), largest wave.
  const at = (scope: number): number =>
    runScenario({ ...swing, chain: { ...WORKED_EXAMPLE.chain, length: scope * 7.3 }, waves: waves(0.2), fishtail: { amplitudeDeg: 25, periodS: 30 } }).sustained.peak.chain.tension;

  it('moderate scope (5.5:1): peak ≈ 4 kN', () => {
    const p = at(5.5);
    expect(p).toBeGreaterThan(2.5e3);
    expect(p).toBeLessThan(6e3);
  });

  it('short scope (4:1): severe, ≈ 6.7 kN', () => {
    const p = at(4.1);
    expect(p).toBeGreaterThan(5e3);
    expect(p).toBeLessThan(9e3);
  });

  it('snatch fades as scope grows: 10:1 well below 4:1', () => {
    expect(at(10)).toBeLessThan(0.7 * at(4.1));
  });
});

describe('gust animation', () => {
  it('10 gust events; the strongest reaches the full gust speed', () => {
    const g = gustSchedule(10);
    expect(g.events).toHaveLength(10);
    expect(Math.max(...g.events.map((e) => e.strength))).toBe(1);
    const a = new MooringAnimation(WORKED_EXAMPLE);
    let maxWind = 0;
    for (let t = 0; t < a.duration; t += 0.25) maxWind = Math.max(maxWind, a.windKnAt(t));
    expect(maxWind).toBeCloseTo(WORKED_EXAMPLE.windKn * WORKED_EXAMPLE.gustFactor, 1);
    expect(gustLevel(g.events, 0)).toBe(0);
  });

  it('without waves or fishtail it reproduces the quasi-static gust load', () => {
    const a = new MooringAnimation(WORKED_EXAMPLE);
    let maxChain = 0;
    while (a.time < a.duration) maxChain = Math.max(maxChain, a.step(0.25).chain);
    expect(maxChain / runScenario(WORKED_EXAMPLE).gust.chain.tension).toBeCloseTo(1, 2);
  });

  it('with waves and fishtail: yaws ± the amplitude and peaks near the analysed peak', () => {
    const inp = { ...swing, waves: waves(0.3), fishtail: { amplitudeDeg: 25, periodS: 30 } };
    const a = new MooringAnimation(inp);
    let maxChain = 0;
    let maxYaw = 0;
    while (a.time < a.duration) {
      const f = a.step(1 / 12);
      maxChain = Math.max(maxChain, f.chain);
      maxYaw = Math.max(maxYaw, Math.abs(f.yawDeg));
      expect(Number.isFinite(f.chain)).toBe(true);
    }
    expect(maxYaw).toBeCloseTo(25, 0);
    const peak = runScenario(inp).gust.peak.chain.tension;
    expect(maxChain / peak).toBeGreaterThan(0.6);
    expect(maxChain / peak).toBeLessThan(1.6);
  });
});
