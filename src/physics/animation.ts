import { DEG, knotsToMs } from './constants';
import { mooringInWave, waveSetup, type WaveSetup } from './dynamics';
import { solveEquilibrium, type Equilibrium, type LineResult, type MooringModel, type Pose, type Vec2 } from './mooring';
import { buildModel, solveRest, type ScenarioInput } from './scenario';
import type { RodeState } from './catenary';
import { HMAX_FACTOR } from './waves';
import { anchorHolding } from './anchor';

/**
 * Time simulation for the animation: a series of gusts with waves and fishtailing.
 *
 * Each step the boat is first put in quasi-static equilibrium for the current wind (held at the current
 * fishtail heading when swinging at anchor); the wave surge is then integrated on top of that, as in
 * waveResponse() but step by step. Wave groups bring the largest wave (1.86·Hs) with each gust peak.
 */

export interface GustEvent {
  /** Start, rise, hold and fall times, s. */
  start: number;
  rise: number;
  hold: number;
  fall: number;
  /** Fraction of (gust − mean) reached, 0–1. */
  strength: number;
}

/** Deterministic pseudo-random numbers (mulberry32), so the animation is repeatable. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `count` gusts of varied strength and length; the strongest reaches the full gust speed. */
export function gustSchedule(count = 10, seed = 7): { events: GustEvent[]; duration: number } {
  const r = rng(seed);
  const events: GustEvent[] = [];
  let t = 8;
  for (let i = 0; i < count; i++) {
    const rise = 2 + 2 * r();
    const hold = 2 + 4 * r();
    const fall = 3 + 3 * r();
    const strength = i === Math.floor(count / 2) ? 1 : 0.55 + 0.45 * r();
    events.push({ start: t, rise, hold, fall, strength });
    t += rise + hold + fall + 6 + 8 * r();
  }
  return { events, duration: t + 4 };
}

const smooth = (u: number): number => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

/** How far into its gust the wind is at time t: 0 between gusts, up to `strength` at the top. */
export function gustLevel(events: readonly GustEvent[], t: number): number {
  let g = 0;
  for (const e of events) {
    const u = t - e.start;
    if (u < 0 || u > e.rise + e.hold + e.fall) continue;
    const s = u < e.rise ? smooth(u / e.rise) : u < e.rise + e.hold ? 1 : 1 - smooth((u - e.rise - e.hold) / e.fall);
    g = Math.max(g, s * e.strength);
  }
  return g;
}

export interface AnimFrame {
  t: number;
  windKn: number;
  /** Fishtail offset from head to wind, degrees (0 when not swinging or fishtail off). */
  yawDeg: number;
  /** Wave elevation at the bow, its amplitude and phase; boat surge and bow rise from the wave, m. */
  eta: number;
  waveAmp: number;
  wavePhase: number;
  surge: number;
  bowRise: number;
  /** Quasi-static equilibrium for this wind and heading (forces for the arrows). */
  base: Equilibrium;
  /** Actual pose and mooring state including the wave motion. */
  pose: Pose;
  rode: RodeState;
  lines: LineResult[];
  chainForce: Vec2;
  chain: number;
  anchor: number;
  upliftDeg: number;
  lineTensions: number[];
  /** Largest values over all internal steps since the previous frame (wave spikes between frames). */
  stepMax: { chain: number; anchor: number; anchorRatio: number; lines: number[]; yawDeg: number; waveHeight: number };
}

export class MooringAnimation {
  readonly model: MooringModel;
  readonly rest: Equilibrium;
  readonly events: GustEvent[];
  readonly duration: number;
  readonly wavelength: number;
  private t = 0;
  private pose: Pose;
  private x = 0;
  private v = 0;
  private readonly swinging: boolean;
  private readonly yawAmp: number;
  private readonly yawPeriod: number;

  constructor(private readonly inp: ScenarioInput, gusts = 10, seed = 7) {
    this.model = buildModel(inp);
    this.rest = solveRest(this.model);
    this.pose = this.rest.pose;
    const g = gustSchedule(gusts, seed);
    this.events = g.events;
    this.duration = g.duration;
    this.swinging = this.model.lines.length === 0;
    this.yawAmp = this.swinging && inp.fishtail ? inp.fishtail.amplitudeDeg : 0;
    this.yawPeriod = inp.fishtail?.periodS ?? 30;
    const w = this.model.waves;
    this.wavelength = w ? (w.spec.tp ** 2 * 9.80665) / (2 * Math.PI) : 0;
  }

  get time(): number {
    return this.t;
  }

  windKnAt(t: number): number {
    const ramp = smooth(t / 5);
    return ramp * this.inp.windKn * (1 + (this.inp.gustFactor - 1) * gustLevel(this.events, t));
  }

  /** Wave amplitude at t: groups around 0.7·Hs/2, with the largest wave (1.86·Hs) arriving at gust peaks. */
  waveAmpAt(t: number): number {
    const w = this.model.waves;
    if (!w) return 0;
    const T = w.spec.tp;
    const base = 0.75 + 0.25 * Math.sin((2 * Math.PI * t) / (7 * T));
    const g = gustLevel(this.events, t);
    return (w.spec.hs / 2) * (base + (HMAX_FACTOR - base) * g * g);
  }

  yawAt(t: number): number {
    return this.yawAmp * Math.sin((2 * Math.PI * t) / this.yawPeriod) * smooth(t / 5);
  }

  /** Advance by dt seconds of simulated time and return the state at the new time. */
  step(dt: number): AnimFrame {
    const T = this.model.waves?.spec.tp ?? 1;
    const n = Math.max(1, Math.ceil(dt / (T / 24)));
    let frame: Omit<AnimFrame, 'stepMax'> | null = null;
    const mx = { chain: 0, anchor: 0, anchorRatio: 0, lines: this.model.lines.map(() => 0), yawDeg: 0, waveHeight: 0 };
    for (let i = 0; i < n; i++) {
      const f = this.advance(dt / n);
      const holding = anchorHolding(this.inp.anchor.mass, this.inp.anchor.holdingRatio, f.upliftDeg);
      mx.chain = Math.max(mx.chain, f.chain);
      mx.anchor = Math.max(mx.anchor, f.anchor);
      mx.anchorRatio = Math.max(mx.anchorRatio, holding > 0 ? f.anchor / holding : Infinity);
      f.lineTensions.forEach((t, j) => (mx.lines[j] = Math.max(mx.lines[j], t)));
      mx.yawDeg = Math.max(mx.yawDeg, Math.abs(f.yawDeg));
      mx.waveHeight = Math.max(mx.waveHeight, 2 * f.waveAmp);
      frame = f;
    }
    return { ...frame!, stepMax: mx };
  }

  private advance(dt: number): Omit<AnimFrame, 'stepMax'> {
    const t0 = this.t;
    const t1 = t0 + dt;
    const windKn = this.windKnAt(t1);
    const V = knotsToMs(windKn);
    const yawDeg = this.yawAt(t1);
    const headPsi = this.swinging ? (((((-this.inp.windFromDeg + 180) % 360) + 360) % 360) - 180) * DEG : undefined;
    const base = solveEquilibrium(this.model, V, this.inp.windFromDeg, {
      initial: this.pose,
      fixedPsi: headPsi !== undefined && this.yawAmp > 0 && V > 0 ? headPsi + yawDeg * DEG : undefined,
    });
    this.pose = base.pose;

    const s: WaveSetup | null = waveSetup(this.model, base);
    const w = this.model.waves;
    let state = mooringInWave(this.model, base, s ?? { dir: [1, 0], kb: 1 }, 0, 0);
    let eta = 0;
    let amp = 0;
    let phase = 0;
    if (s && w) {
      const om = s.omega;
      const f0 = state.restoring;
      const forceAt = (t: number, x: number): number => {
        const a = this.waveAmpAt(t);
        return mooringInWave(this.model, base, s, x, a * s.liftPerAmp * Math.cos(om * t)).restoring - f0;
      };
      const acc = (t: number, x: number, v: number): number => {
        const xi = this.waveAmpAt(t) * s.surgePerAmp;
        const uw = xi * om * Math.cos(om * t);
        const aw = -xi * om * om * Math.sin(om * t);
        return aw + (s.damping * (uw - v) - forceAt(t, x)) / s.mass;
      };
      const { x, v } = this;
      const k1x = v;
      const k1v = acc(t0, x, v);
      const k2x = v + (dt / 2) * k1v;
      const k2v = acc(t0 + dt / 2, x + (dt / 2) * k1x, k2x);
      const k3x = v + (dt / 2) * k2v;
      const k3v = acc(t0 + dt / 2, x + (dt / 2) * k2x, k3x);
      const k4x = v + dt * k3v;
      const k4v = acc(t1, x + dt * k3x, k4x);
      this.x = x + (dt / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
      this.v = v + (dt / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);
      amp = this.waveAmpAt(t1);
      phase = om * t1;
      eta = amp * Math.cos(phase);
      state = mooringInWave(this.model, base, s, this.x, amp * s.liftPerAmp * Math.cos(phase));
    }
    this.t = t1;
    const chainForce = this.chainForceOf(state.pose, state.rode);
    return {
      t: t1,
      windKn,
      yawDeg: this.yawAmp > 0 ? yawDeg : 0,
      eta,
      waveAmp: amp,
      wavePhase: phase,
      surge: this.x,
      bowRise: state.dz,
      base,
      pose: state.pose,
      rode: state.rode,
      lines: state.lines,
      chainForce,
      chain: state.rode.tensionTop,
      anchor: state.rode.tensionAnchor,
      upliftDeg: state.rode.angleAnchor / DEG,
      lineTensions: state.lines.map((l) => l.tension),
    };
  }

  private chainForceOf(pose: Pose, rode: RodeState): Vec2 {
    const bx = pose.x + Math.cos(pose.psi) * this.model.bowX;
    const by = pose.y + Math.sin(pose.psi) * this.model.bowX;
    const dx = this.model.anchor[0] - bx;
    const dy = this.model.anchor[1] - by;
    const d = Math.hypot(dx, dy) || 1;
    return [(dx / d) * rode.h, (dy / d) * rode.h];
  }
}
