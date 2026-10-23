import { DEG, G, knotsToMs } from '../core/constants';
import { rk4Step } from '../core/numeric';
import { headToWindPsi, type Pose, type Vec2 } from '../core/vec';
import { HMAX_FACTOR } from '../environment/waves';
import { anchorHolding } from '../materials/anchor';
import type { RodeState } from '../mooring/catenary';
import { solveEquilibrium, solveRest } from '../mooring/equilibrium';
import type { Equilibrium, LineResult, MooringModel } from '../mooring/model';
import { gustLevel, gustSchedule, smooth, type GustEvent } from '../dynamics/gusts';
import { mooringInWave, surgeEquation, waveSetup, type MooringState } from '../dynamics/surge';
import { buildModel } from './buildModel';
import type { ScenarioInput } from './inputs';

/**
 * Time simulation for the animation: a series of gusts with waves and fishtailing. Each step:
 *   1. wind speed and fishtail heading for this instant (gust timeline, yaw sine);
 *   2. quasi-static equilibrium for that wind, held at that heading when swinging at anchor;
 *   3. the wave surge integrated on top (the same equation as the peak analysis, dynamics/surge.ts);
 *   4. a frame with the state for drawing, plus the largest values since the previous frame.
 * Wave groups bring the largest wave (1.86·Hs) with each gust peak.
 */

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
  stepMax: StepMax;
}

export interface StepMax {
  chain: number;
  anchor: number;
  anchorRatio: number;
  lines: number[];
  yawDeg: number;
  waveHeight: number;
}

type Instant = Omit<AnimFrame, 'stepMax'>;

/** The wave part of one step: mooring state with the boat surged, and the wave at the bow. */
interface WaveStep {
  state: MooringState;
  amp: number;
  phase: number;
  eta: number;
}

export class MooringAnimation {
  readonly model: MooringModel;
  readonly rest: Equilibrium;
  readonly events: GustEvent[];
  readonly duration: number;
  readonly wavelength: number;
  private t = 0;
  private pose: Pose;
  /** Surge state [x, v] relative to the quasi-static pose. */
  private surge: number[] = [0, 0];
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
    this.wavelength = w ? (w.spec.tp ** 2 * G) / (2 * Math.PI) : 0;
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

  /** Advance by dt seconds of simulated time (in sub-steps short enough for the waves) and return the new frame. */
  step(dt: number): AnimFrame {
    const T = this.model.waves?.spec.tp ?? 1;
    const n = Math.max(1, Math.ceil(dt / (T / 24)));
    const max: StepMax = { chain: 0, anchor: 0, anchorRatio: 0, lines: this.model.lines.map(() => 0), yawDeg: 0, waveHeight: 0 };
    let last: Instant | null = null;
    for (let i = 0; i < n; i++) {
      last = this.advance(dt / n);
      this.track(max, last);
    }
    return { ...last!, stepMax: max };
  }

  private track(max: StepMax, f: Instant): void {
    const holding = anchorHolding(this.inp.anchor.mass, this.inp.anchor.holdingRatio, f.upliftDeg);
    max.chain = Math.max(max.chain, f.chain);
    max.anchor = Math.max(max.anchor, f.anchor);
    max.anchorRatio = Math.max(max.anchorRatio, holding > 0 ? f.anchor / holding : Infinity);
    f.lineTensions.forEach((t, j) => (max.lines[j] = Math.max(max.lines[j], t)));
    max.yawDeg = Math.max(max.yawDeg, Math.abs(f.yawDeg));
    max.waveHeight = Math.max(max.waveHeight, 2 * f.waveAmp);
  }

  private advance(dt: number): Instant {
    const t0 = this.t;
    const t1 = t0 + dt;
    const windKn = this.windKnAt(t1);
    const yawDeg = this.yawAt(t1);
    const base = this.quasiStatic(windKn, yawDeg);
    const wave = this.waveSurge(base, t0, dt);
    this.t = t1;
    const st = wave.state;
    return {
      t: t1,
      windKn,
      yawDeg: this.yawAmp > 0 ? yawDeg : 0,
      eta: wave.eta,
      waveAmp: wave.amp,
      wavePhase: wave.phase,
      surge: this.surge[0],
      bowRise: st.dz,
      base,
      pose: st.pose,
      rode: st.rode,
      lines: st.lines,
      chainForce: st.chainForce,
      chain: st.rode.tensionTop,
      anchor: st.rode.tensionAnchor,
      upliftDeg: st.rode.angleAnchor / DEG,
      lineTensions: st.lines.map((l) => l.tension),
    };
  }

  /** Equilibrium for this wind; a swinging boat is held at its fishtail heading. */
  private quasiStatic(windKn: number, yawDeg: number): Equilibrium {
    const V = knotsToMs(windKn);
    const holdHeading = this.swinging && this.yawAmp > 0 && V > 0;
    const base = solveEquilibrium(this.model, V, this.inp.windFromDeg, {
      initial: this.pose,
      fixedPsi: holdHeading ? headToWindPsi(this.inp.windFromDeg) + yawDeg * DEG : undefined,
    });
    this.pose = base.pose;
    return base;
  }

  /** Integrate the boat's surge in the waves over [t0, t0 + dt] around the quasi-static pose. */
  private waveSurge(base: Equilibrium, t0: number, dt: number): WaveStep {
    const s = waveSetup(this.model, base);
    const still = mooringInWave(this.model, base, s ?? { dir: [1, 0], kb: 1 }, 0, 0);
    if (!s) return { state: still, amp: 0, phase: 0, eta: 0 };
    const amplitude = (t: number): number => this.waveAmpAt(t);
    const f = surgeEquation(s, amplitude, (x, zeta) => mooringInWave(this.model, base, s, x, zeta).restoring - still.restoring);
    this.surge = rk4Step(f, t0, this.surge, dt);
    const t1 = t0 + dt;
    const amp = amplitude(t1);
    const phase = s.omega * t1;
    const state = mooringInWave(this.model, base, s, this.surge[0], amp * s.liftPerAmp * Math.cos(phase));
    return { state, amp, phase, eta: amp * Math.cos(phase) };
  }
}
