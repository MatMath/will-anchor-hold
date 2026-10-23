import {
  anchorDistanceForPretension,
  buildModel,
  hasDynamics,
  liftOffWind,
  runScenario,
  solveRest,
  sweep,
} from '../physics';
import { toScenario } from '../ui/state';
import { ctx } from './context';
import { render, renderSweepChart } from './render';
import { paintSliders } from './sliders';

/** Derived data: runs the analyses that turn the state into results, and decides when. */

/** Chain pretension at rest that defines the anchor slider's balanced snap point, N. */
export const SNAP_PRETENSION = 1000;

let pending = false;
let frame = 0;
let fallback: number | undefined;
let sweepTimer: number | undefined;
let peakToken = 0;

/**
 * Recompute after an input change, in two stages:
 *   1. next frame — fast static analysis and render (keeps slider drags smooth);
 *   2. once input settles (150 ms) — waves / fishtail analysis, sweeps, slider hints, background peak sweep.
 */
export function schedule(): void {
  if (!pending) {
    pending = true;
    // rAF coalesces slider drags; the timer covers background tabs where rAF is paused.
    const run = (): void => {
      if (!pending) return;
      pending = false;
      cancelAnimationFrame(frame);
      window.clearTimeout(fallback);
      compute(false);
      render();
    };
    frame = requestAnimationFrame(run);
    fallback = window.setTimeout(run, 80);
  }
  window.clearTimeout(sweepTimer);
  sweepTimer = window.setTimeout(() => {
    if (!ctx.resultIsFull) {
      compute(true);
      render();
    }
    computeSweep();
    renderSweepChart();
    computeDerived();
    paintSliders();
    startPeakSweep();
  }, 150);
}

/** full = include waves and fishtail (slower); otherwise only when the scenario has none. */
export function compute(full: boolean): void {
  try {
    const inp = toScenario(ctx.state);
    const quick = !full && hasDynamics(inp);
    ctx.result = runScenario(inp, !quick);
    ctx.resultIsFull = !quick;
    ctx.error = null;
  } catch (e) {
    ctx.result = null;
    ctx.error = e instanceof Error ? e.message : String(e);
  }
}

/** Slower derived values (bisections), refreshed after input settles. */
export function computeDerived(): void {
  if (!ctx.result) {
    ctx.liftKn = null;
    ctx.snap.distance = null;
    return;
  }
  const inp = toScenario(ctx.state);
  try {
    ctx.liftKn = liftOffWind(inp);
  } catch {
    ctx.liftKn = null;
  }
  try {
    const d = ctx.state.lineCount === 0 ? null : anchorDistanceForPretension(inp, SNAP_PRETENSION);
    ctx.snap.exact = d;
    ctx.snap.distance = d === null ? null : Math.round(d);
    ctx.snap.pretension = ctx.snap.distance === null ? 0 : solveRest(buildModel({ ...inp, anchor: { ...inp.anchor, distance: ctx.snap.distance } })).rode.h;
  } catch {
    ctx.snap.distance = null;
  }
}

export function computeSweep(): void {
  if (!ctx.result) {
    ctx.points = [];
    return;
  }
  const speeds = Array.from({ length: 51 }, (_, i) => 10 + i);
  ctx.points = sweep(toScenario(ctx.state), speeds, ctx.state.sweepGust ? ctx.state.gustFactor : 1);
}

/** Peak loads vs wind speed, a few ctx.points per timeout so the page stays responsive. */
export function startPeakSweep(): void {
  const token = ++peakToken;
  ctx.peakPoints = [];
  const inp = toScenario(ctx.state);
  if (!ctx.result || !hasDynamics(inp)) return;
  const speeds = Array.from({ length: 11 }, (_, i) => 10 + 5 * i);
  const factor = ctx.state.sweepGust ? ctx.state.gustFactor : 1;
  const acc: typeof ctx.peakPoints = [];
  const next = (i: number): void => {
    if (token !== peakToken) return;
    if (i >= speeds.length) {
      ctx.peakPoints = acc;
      renderSweepChart();
      return;
    }
    try {
      const p = sweep(inp, [speeds[i]], factor, true)[0];
      acc.push({ windKn: speeds[i], chain: p.chainPeak, anchor: p.anchorPeak, holding: p.holdingPeak, lines: p.linesPeak });
    } catch {
      acc.push({ windKn: speeds[i], chain: NaN, anchor: NaN, holding: NaN, lines: [] });
    }
    window.setTimeout(() => next(i + 1), 0);
  };
  window.setTimeout(() => next(0), 30);
}

