import { MooringAnimation } from '../physics';
import { renderAnimChart } from '../ui/animChart';
import { renderPlan } from '../ui/planView';
import { toScenario } from '../ui/state';
import { $, ctx } from './context';
import { render } from './render';

/**
 * Gust animation controller: start / tick / stop. The simulation itself is physics/analysis/animation.ts;
 * each tick advances it by real elapsed time × speed, records the frame and re-renders.
 */

export function startAnimation(): void {
  stopAnimation();
  if (!ctx.result) return;
  const r = ctx.result;
  const inp = toScenario(ctx.state);
  let sim: MooringAnimation;
  try {
    sim = new MooringAnimation(inp, 10);
  } catch {
    return;
  }
  // Freeze the plan view around the gust case (and the fishtail extreme) so it does not jump every frame.
  const svg = $<SVGSVGElement>('#plan');
  const views = [r.gust.eq, ...(r.gust.fishtail ? [r.gust.fishtail.eq] : [])].map((eq) => {
    renderPlan(svg, { s: ctx.state, model: r.model, rest: r.rest, eq, forceRef: Math.max(1, r.gust.peak.chain.tension), label: '' });
    const b = svg.viewBox.baseVal;
    return { x0: b.x, y0: b.y, x1: b.x + b.width, y1: b.y + b.height };
  });
  const box = views.reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }));
  const pad = r.gust.fishtail ? 0.3 : 0.12;
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  ctx.anim = {
    sim,
    frame: null,
    series: [],
    raf: 0,
    last: performance.now(),
    done: false,
    planView: { x: box.x0 - w * pad, y: box.y0 - h * pad, w: w * (1 + 2 * pad), h: h * (1 + 2 * pad) },
    sideXMax: Math.max(r.gust.eq.rode.x, r.gust.fishtail?.eq.rode.x ?? 0) + 1.5,
    peakRef: Math.max(r.gust.peak.chain.tension, r.gust.chain.tension),
  };
  $('#anim-card').hidden = false;
  $('#btn-animate').textContent = '■ Stop';
  queueTick();
}

function queueTick(): void {
  if (!ctx.anim || ctx.anim.done) return;
  let fired = false;
  const go = (): void => {
    if (fired) return;
    fired = true;
    cancelAnimationFrame(ctx.anim?.raf ?? 0);
    tick();
  };
  ctx.anim.raf = requestAnimationFrame(go);
  window.setTimeout(go, 60); // background tabs pause rAF
}

function tick(): void {
  if (!ctx.anim || ctx.anim.done) return;
  const now = performance.now();
  const dtReal = Math.min(0.5, Math.max(1 / 240, (now - ctx.anim.last) / 1000)); // hidden tabs tick ~1 Hz
  ctx.anim.last = now;
  const f = ctx.anim.sim.step(dtReal * ctx.state.animSpeed);
  ctx.anim.frame = f;
  const m = f.stepMax; // peaks since the last frame, so spikes between frames are not missed
  ctx.anim.series.push({ t: f.t, wind: f.windKn, chain: m.chain, anchor: m.anchor, lines: m.lines, anchorRatio: m.anchorRatio, yaw: m.yawDeg, wave: m.waveHeight });
  render();
  renderAnimChart(ctx.anim!, ctx.state);
  if (ctx.anim.sim.time >= ctx.anim.sim.duration) {
    ctx.anim.done = true;
    ctx.anim.frame = null;
    $('#btn-animate').textContent = '▶ Animate 10 gusts';
    render();
    renderAnimChart(ctx.anim!, ctx.state);
    return;
  }
  queueTick();
}

/** Stop a running animation; its chart stays on screen. */
export function stopAnimation(): void {
  if (!ctx.anim || ctx.anim.done) return;
  ctx.anim.done = true;
  ctx.anim.frame = null;
  cancelAnimationFrame(ctx.anim.raf);
  $('#btn-animate').textContent = '▶ Animate 10 gusts';
  render();
  renderAnimChart(ctx.anim!, ctx.state);
}

