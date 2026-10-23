import { KGF, LINE_EFFICIENCY, holdingStatus, loadStatus, type MooringAnimation } from '../physics';
import type { AnimationRun } from '../app/context';
import { badge, esc, force, pct, type Units } from './format';
import type { AppState } from './state';

/**
 * Live chart of the gust animation: a wind strip on top and the mooring loads below (two panels, each
 * with its own axis), MBL thresholds, gust markers, and a summary of the maxima so far.
 */

const $ = <T extends Element = HTMLElement>(sel: string): T => document.querySelector<T>(sel)!;

function gustIndex(sim: MooringAnimation, t: number): number {
  return sim.events.filter((e) => e.start <= t).length;
}

type Sample = AnimationRun['series'][number];

const W = 640;
const M = { l: 48, r: 14 };
/** Wind strip (top) and loads panel (bottom): two panels, each with its own axis. */
const WIND = { top: 14, bot: 64 };
const LOAD = { top: 90, bot: 236 };

/** Round up to 1, 2, 2.5, 5 × 10ⁿ. */
const nice = (v: number): number => {
  const e = 10 ** Math.floor(Math.log10(Math.max(v, 1e-9)));
  const b = v / e;
  return (b <= 1 ? 1 : b <= 2 ? 2 : b <= 2.5 ? 2.5 : b <= 5 ? 5 : 10) * e;
};

/** Scales shared by the panels. */
interface AnimScales {
  run: AnimationRun;
  s: AppState;
  u: Units;
  X: (t: number) => number;
  windMax: number;
  Yw: (kn: number) => number;
  conv: (n: number) => number;
  loadMax: number;
  Yl: (n: number) => number;
  chainMbl: number;
}

const sternLineNames = (s: AppState): string[] => (s.lineCount === 0 ? [] : s.lineCount === 1 ? ['Stern line'] : ['Port line', 'Stbd line']);

export function renderAnimChart(run: AnimationRun, s: AppState): void {
  const sc = scales(run, s);
  $('#anim-chart').innerHTML = [...windPanel(sc), ...loadPanel(sc), ...gustMarkers(sc), ...seriesPaths(sc), ...timeAxis(sc)].join('');
  $('#anim-legend').innerHTML = legendHtml(s);
  $('#anim-status').innerHTML = statusHtml(run, s);
  if (run.series.length) $('#anim-facts').innerHTML = summaryHtml(run, s);
}

function scales(run: AnimationRun, s: AppState): AnimScales {
  const u = s.units as Units;
  const conv = (n: number): number => (u === 'kgf' ? n / KGF : n / 1000);
  const windMax = nice(s.windKn * s.gustFactor * 1.1);
  const maxLoad = Math.max(1, run.peakRef, ...run.series.map((p) => Math.max(p.chain, p.anchor, ...p.lines)));
  const loadMax = nice(conv(maxLoad) * 1.08);
  return {
    run,
    s,
    u,
    X: (t) => M.l + (t / run.sim.duration) * (W - M.l - M.r),
    windMax,
    Yw: (kn) => WIND.bot - (kn / windMax) * (WIND.bot - WIND.top),
    conv,
    loadMax,
    Yl: (n) => LOAD.bot - (conv(n) / loadMax) * (LOAD.bot - LOAD.top),
    chainMbl: s.chainMbl * 1000,
  };
}

function windPanel({ windMax, Yw }: AnimScales): string[] {
  const g: string[] = [];
  for (let i = 0; i <= 2; i++) {
    const v = (windMax * i) / 2;
    g.push(`<line class="c-grid" x1="${M.l}" x2="${W - M.r}" y1="${Yw(v)}" y2="${Yw(v)}"/><text class="c-tick" x="${M.l - 6}" y="${Yw(v) + 4}" text-anchor="end">${v.toFixed(0)}</text>`);
  }
  g.push(`<text class="c-axis-title" x="${M.l}" y="${WIND.top - 4}">Wind, kn</text>`);
  return g;
}

/** Load grid and the chain's 30% / 50% MBL lines when they fall inside the range. */
function loadPanel({ u, conv, loadMax, Yl, chainMbl }: AnimScales): string[] {
  const g: string[] = [];
  for (let i = 0; i <= 4; i++) {
    const v = (loadMax * i) / 4;
    const y = LOAD.bot - (v / loadMax) * (LOAD.bot - LOAD.top);
    g.push(`<line class="c-grid" x1="${M.l}" x2="${W - M.r}" y1="${y}" y2="${y}"/><text class="c-tick" x="${M.l - 6}" y="${y + 4}" text-anchor="end">${v >= 100 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, '')}</text>`);
  }
  g.push(`<text class="c-axis-title" x="${M.l}" y="${LOAD.top - 6}">Load, ${u}</text>`);
  for (const [frac, cls, lab] of [
    [0.3, 'c-thr-amber', 'chain 30% MBL'],
    [0.5, 'c-thr-red', 'chain 50% MBL'],
  ] as const) {
    if (conv(frac * chainMbl) > loadMax) continue;
    const y = Yl(frac * chainMbl);
    g.push(`<line class="c-thr ${cls}" x1="${M.l}" x2="${W - M.r}" y1="${y}" y2="${y}"/><text class="c-thr-lbl" x="${W - M.r - 4}" y="${y - 4}" text-anchor="end">${lab}</text>`);
  }
  return g;
}

/** A faint line through both panels at the top of each gust. */
function gustMarkers({ run, X }: AnimScales): string[] {
  return run.sim.events.map((e) => {
    const x = X(e.start + e.rise + e.hold / 2);
    return `<line class="c-gust" x1="${x}" x2="${x}" y1="${WIND.top}" y2="${LOAD.bot}"/>`;
  });
}

function seriesPaths({ run, X, Yw, Yl }: AnimScales): string[] {
  const { series } = run;
  if (!series.length) return [];
  const path = (get: (p: Sample) => number, Y: (v: number) => number): string => series.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(get(p)).toFixed(1)}`).join('');
  const g = [`<path class="c-line s-wind" d="${path((p) => p.wind, Yw)}"/>`, `<path class="c-line s-anchor" d="${path((p) => p.anchor, Yl)}"/>`];
  series[0].lines.forEach((_, i) => g.push(`<path class="c-line s-line${i + 1}" d="${path((p) => p.lines[i], Yl)}"/>`));
  g.push(`<path class="c-line s-chain" d="${path((p) => p.chain, Yl)}"/>`);
  const now = series[series.length - 1].t;
  if (!run.done) g.push(`<line class="c-now" x1="${X(now)}" x2="${X(now)}" y1="${WIND.top}" y2="${LOAD.bot}"/>`);
  return g;
}

function timeAxis({ run, X }: AnimScales): string[] {
  const g = [`<line class="c-axis" x1="${M.l}" x2="${W - M.r}" y1="${LOAD.bot}" y2="${LOAD.bot}"/>`];
  for (let t = 0; t <= run.sim.duration; t += 30) g.push(`<text class="c-tick" x="${X(t)}" y="${LOAD.bot + 16}" text-anchor="middle">${t}</text>`);
  g.push(`<text class="c-axis-title" x="${W - M.r}" y="${LOAD.bot + 16}" text-anchor="end">s</text>`);
  return g;
}

function legendHtml(s: AppState): string {
  const key = (cls: string, name: string): string =>
    `<span class="legend-item"><svg width="18" height="8" aria-hidden="true"><line class="c-line ${cls}" x1="1" x2="17" y1="4" y2="4"/></svg>${esc(name)}</span>`;
  return [key('s-chain', 'Chain (bow)'), ...sternLineNames(s).map((n, i) => key(`s-line${i + 1}`, n)), key('s-anchor', 'Anchor load'), key('s-wind', 'Wind')].join('');
}

function statusHtml(run: AnimationRun, s: AppState): string {
  const { sim, series } = run;
  const last = series[series.length - 1];
  const gi = last ? Math.min(sim.events.length, gustIndex(sim, last.t)) : 0;
  return run.done
    ? `<span class="badge-plain">Finished · ${sim.events.length} gusts</span>`
    : `<span class="badge-plain">Gust ${Math.max(1, gi)} / ${sim.events.length} · ${last ? last.t.toFixed(0) : 0} s · ×${s.animSpeed}</span>`;
}

/** Largest loads so far, with their safety colours. */
function summaryHtml(run: AnimationRun, s: AppState): string {
  const { series } = run;
  const u = s.units as Units;
  const chainMbl = s.chainMbl * 1000;
  const maxOf = (get: (p: Sample) => number): Sample => series.reduce((a, b) => (get(b) > get(a) ? b : a));
  const pc = maxOf((p) => p.chain);
  const pa = maxOf((p) => p.anchorRatio);
  const chainRatio = pc.chain / chainMbl;
  const effLine = s.lineMbl * 1000 * LINE_EFFICIENCY;
  const facts: Array<[string, string]> = [
    ['Max chain', `${force(pc.chain, u)} ${badge(loadStatus(chainRatio), pct(chainRatio))}`],
    ['Max anchor / holding', `${force(pa.anchor, u)} ${badge(holdingStatus(pa.anchorRatio), pct(pa.anchorRatio))}`],
  ];
  sternLineNames(s).forEach((n, i) => {
    const p = maxOf((q) => q.lines[i]);
    facts.push([`Max ${n.toLowerCase()}`, `${force(p.lines[i], u)} ${badge(loadStatus(p.lines[i] / effLine), pct(p.lines[i] / effLine))}`]);
  });
  facts.push(['Max wind', `${Math.max(...series.map((p) => p.wind)).toFixed(0)} kn`]);
  if (series.some((p) => p.wave > 0)) facts.push(['Largest wave', `${Math.max(...series.map((p) => p.wave)).toFixed(2)} m`]);
  if (series.some((p) => p.yaw !== 0)) facts.push(['Fishtail', `±${Math.max(...series.map((p) => Math.abs(p.yaw))).toFixed(0)}°`]);
  return facts.map(([k, v]) => `<div><span>${k}</span><strong>${v}</strong></div>`).join('');
}
