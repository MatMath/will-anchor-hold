import {
  toEarth,
  windDirectionVector,
  type AnimFrame,
  type Equilibrium,
  type MooringAnimation,
  type ScenarioResult,
} from '../physics';
import { syncControls } from '../ui/controls';
import { esc } from '../ui/format';
import { errorHtml, factsHtml, warningsHtml } from '../ui/notices';
import { statusHtml } from '../ui/statusBar';
import { renderPlan } from '../ui/planView';
import { resultsTable } from '../ui/results';
import { renderSide } from '../ui/sideView';
import { renderSweep, sweepSeries } from '../ui/sweepChart';
import { renderDial } from '../ui/windDial';
import { $, ctx } from './context';
import { paintSliders } from './sliders';

/** Render: state + derived data → DOM. No calculation happens here. */

export function gustIndex(sim: MooringAnimation, t: number): number {
  return sim.events.filter((e) => e.start <= t).length;
}

function shownEq(r: ScenarioResult): { eq: Equilibrium; label: string; frame?: AnimFrame } {
  if (ctx.anim?.frame) {
    const f = ctx.anim.frame;
    const eq: Equilibrium = { ...f.base, pose: f.pose, rode: f.rode, lines: f.lines, chainForce: f.chainForce };
    const parts = [`Gust ${Math.max(1, gustIndex(ctx.anim.sim, f.t))}/${ctx.anim.sim.events.length}`, `${f.windKn.toFixed(0)} kn`];
    if (f.yawDeg) parts.push(`yaw ${f.yawDeg >= 0 ? '+' : ''}${f.yawDeg.toFixed(0)}°`);
    if (f.waveAmp) parts.push(`wave ${(2 * f.waveAmp).toFixed(1)} m`);
    return { eq, label: parts.join(' · '), frame: f };
  }
  if (ctx.state.viewCase === 'rest') return { eq: r.rest, label: 'At rest (no wind)' };
  if (ctx.state.viewCase === 'gust') return { eq: r.gust.eq, label: `Gust — ${r.gust.windKn.toFixed(0)} kn` };
  return { eq: r.sustained.eq, label: `Sustained — ${r.sustained.windKn.toFixed(0)} kn` };
}

/** Render everything from the current state and results. */
export function render(): void {
  renderControls();
  if (!ctx.result) {
    $('#status').innerHTML = '';
    $('#warnings').innerHTML = errorHtml(ctx.error ?? 'unknown error');
    return;
  }
  const r = ctx.result;
  const shown = shownEq(r);
  $('#status').innerHTML = statusHtml(ctx.state, r, ctx.resultIsFull);
  renderDiagrams(r, shown);
  $('#facts').innerHTML = factsHtml(ctx.state, shown.eq.rode);
  $('#warnings').innerHTML = warningsHtml(ctx.state, r);
  $('#results').innerHTML = resultsTable(ctx.state, r);
}

/** Inputs reflect the state (values, auto flags, visibility), plus the dial, slider decorations and windage table. */
function renderControls(): void {
  syncControls(document, ctx.state);
  paintSliders();
  renderDial($('#dial'), ctx.state.windDir, ctx.state.windKn);
  renderWindageItems();
}

/** Plan and side views of the case on screen (or the animation frame), with waves while animating. */
function renderDiagrams(r: ScenarioResult, { eq, label, frame: af }: ReturnType<typeof shownEq>): void {
  const a = ctx.anim && !ctx.anim.done ? ctx.anim : null;
  // Arrow scale: the largest force in the gust case (or the animation's peak), so it stays steady.
  const forceRef = Math.max(r.gust.eq.wind.force, r.gust.eq.rode.h, ...r.gust.eq.lines.map((l) => Math.hypot(l.force[0], l.force[1])), a ? a.peakRef : 0, 1);
  const waveDraw =
    af && ctx.anim && r.model.waves && af.waveAmp > 0
      ? { lambda: ctx.anim.sim.wavelength, phase: af.wavePhase, amp: af.waveAmp, dir: windDirectionVector(ctx.state.windDir) as [number, number] }
      : undefined;
  renderPlan($<SVGSVGElement>('#plan'), { s: ctx.state, model: r.model, rest: r.rest, eq, forceRef, label, frozen: ctx.view.planFrozen ?? (a ? a.planView : undefined), waves: waveDraw });

  const xMax = Math.max(r.gust.eq.rode.x, r.rest.rode.x, eq.rode.x);
  const sideWave = waveDraw && af ? sideWaveOf(r, af, waveDraw) : undefined;
  renderSide($<SVGSVGElement>('#side'), { s: ctx.state, rode: r.model.rode, rest: r.rest.rode, st: eq.rode, xMax: a ? Math.max(xMax, a.sideXMax) : xMax, frozen: ctx.view.sideFrozen, wave: sideWave });
}

/** The wave seen along the rode in the side view: cos(angle between rode and waves) shortens the wavelength. */
function sideWaveOf(r: ScenarioResult, af: AnimFrame, w: { lambda: number; dir: [number, number] }) {
  const bow = toEarth(af.pose, [r.model.bowX, 0]);
  const c = [bow[0] - r.model.anchor[0], bow[1] - r.model.anchor[1]];
  const cl = Math.hypot(c[0], c[1]) || 1;
  return { amp: af.waveAmp, k: (2 * Math.PI) / w.lambda, cosGamma: (c[0] * w.dir[0] + c[1] * w.dir[1]) / cl, phase: af.wavePhase, dz: af.bowRise };
}

export function renderSweepChart(): void {
  const host = $('#sweep');
  if (!ctx.result || !ctx.points.length) {
    host.innerHTML = '';
    return;
  }
  renderSweep(host, { s: ctx.state, points: ctx.points, series: sweepSeries(ctx.state, ctx.result, ctx.points, ctx.peakPoints) });
}

function renderWindageItems(): void {
  const t = $<HTMLTableElement>('#witems');
  if (document.activeElement && t.contains(document.activeElement)) return;
  t.innerHTML = `<thead><tr><th>On</th><th>Item</th><th>Side m²</th><th>Front m²</th><th>x m</th></tr></thead><tbody>${ctx.state.windageItems
    .map(
      (it, i) => `<tr${it.enabled ? '' : ' class="off"'}>
      <td><input type="checkbox" data-witem="${i}" data-wfield="enabled"${it.enabled ? ' checked' : ''} aria-label="Include ${esc(it.name)}"></td>
      <td>${esc(it.name)}</td>
      <td><input type="number" step="0.1" min="0" data-witem="${i}" data-wfield="side" value="${it.side}" aria-label="${esc(it.name)} side area"></td>
      <td><input type="number" step="0.1" min="0" data-witem="${i}" data-wfield="front" value="${it.front}" aria-label="${esc(it.name)} frontal area"></td>
      <td><input type="number" step="0.1" data-witem="${i}" data-wfield="x" value="${it.x}" aria-label="${esc(it.name)} position from midships"></td>
    </tr>`,
    )
    .join('')}</tbody>`;
}
