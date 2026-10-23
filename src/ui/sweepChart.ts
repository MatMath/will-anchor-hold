import { KGF, LINE_EFFICIENCY, upliftFactor, type ScenarioResult, type SweepPoint } from '../physics';
import { esc } from './format';
import type { AppState } from './state';

/**
 * Loads vs wind speed. One y-axis (kN/kgf, or % of each element's limit), 2px lines, legend + selective
 * end labels, crosshair tooltip that lists every series at the hovered speed, and a table view.
 */

export interface SweepSeries {
  id: string;
  name: string;
  cls: string;
  /** Value in N for each point. */
  values: number[];
  /** Limit for the % view (MBL, or estimated holding). */
  limit: (i: number) => number;
}

export interface SweepChartInput {
  s: AppState;
  points: SweepPoint[];
  series: SweepSeries[];
}

const W = 640;
const H = 300;
const M = { l: 48, r: 92, t: 14, b: 36 };

function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const e = Math.floor(Math.log10(v));
  const b = v / 10 ** e;
  const m = b <= 1 ? 1 : b <= 2 ? 2 : b <= 2.5 ? 2.5 : b <= 5 ? 5 : 10;
  return m * 10 ** e;
}

/** The chart's data in display units and its scales — shared by the drawing, the table and the tooltip. */
interface Chart {
  p: SweepChartInput;
  pctMode: boolean;
  unit: string;
  /** Values per series in display units (kN, kgf or % of limit). */
  data: number[][];
  yMax: number;
  x0: number;
  x1: number;
  X: (kn: number) => number;
  Y: (v: number) => number;
}

export function renderSweep(host: HTMLElement, p: SweepChartInput): void {
  const c = chartOf(p);
  const svg = [...axes(c), ...thresholds(c), ...nowMarker(c), ...seriesPaths(c), ...endLabels(c), ...hoverTargets()].join('');
  host.innerHTML = `<div class="legend">${legendHtml(c)}</div>
    <div class="chart-wrap"><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Chain and stern line tension versus wind speed">${svg}</svg><div class="tooltip" hidden></div></div>
    <details class="table-view"><summary>Show as table</summary>${tableHtml(c)}</details>`;
  bindTooltip(host, c);
}

function chartOf(p: SweepChartInput): Chart {
  const { s, points, series } = p;
  const pctMode = s.sweepMode === 'pct';
  const conv = (n: number, i: number, sr: SweepSeries): number =>
    pctMode ? (100 * n) / Math.max(1e-9, sr.limit(i)) : s.units === 'kgf' ? n / KGF : n / 1000;
  const data = series.map((sr) => sr.values.map((v, i) => conv(v, i, sr)));
  const yMax = niceMax(Math.max(pctMode ? 60 : 0, ...data.flat().filter(Number.isFinite)) * 1.05);
  const x0 = points[0]?.windKn ?? 10;
  const x1 = points[points.length - 1]?.windKn ?? 60;
  return {
    p,
    pctMode,
    unit: pctMode ? '% of limit' : s.units,
    data,
    yMax,
    x0,
    x1,
    X: (kn) => M.l + ((kn - x0) / (x1 - x0)) * (W - M.l - M.r),
    Y: (v) => H - M.b - (Math.min(v, yMax * 1.02) / yMax) * (H - M.t - M.b),
  };
}

/** Grid, ticks and axis titles. */
function axes({ p, unit, yMax, x0, x1, X, Y }: Chart): string[] {
  const s = p.s;
  const g: string[] = [];
  for (let i = 0; i <= 5; i++) {
    const v = (yMax * i) / 5;
    const y = Y(v);
    g.push(`<line class="c-grid" x1="${M.l}" x2="${W - M.r}" y1="${y}" y2="${y}"/>`);
    g.push(`<text class="c-tick" x="${M.l - 6}" y="${y + 4}" text-anchor="end">${fmtTick(v)}</text>`);
  }
  for (let kn = x0; kn <= x1; kn += 10) g.push(`<text class="c-tick" x="${X(kn)}" y="${H - M.b + 16}" text-anchor="middle">${kn}</text>`);
  g.push(`<line class="c-axis" x1="${M.l}" x2="${W - M.r}" y1="${Y(0)}" y2="${Y(0)}"/>`);
  g.push(`<text class="c-axis-title" x="${(M.l + W - M.r) / 2}" y="${H - 4}" text-anchor="middle">Mean wind speed (kn)${s.sweepGust ? ` — loads at gust ×${s.gustFactor}` : ''}</text>`);
  g.push(`<text class="c-axis-title" x="12" y="${M.t + (H - M.t - M.b) / 2}" text-anchor="middle" transform="rotate(-90 12 ${M.t + (H - M.t - M.b) / 2})">${esc(unit)}</text>`);
  return g;
}

/** Amber and red limits, in the % view. */
function thresholds({ pctMode, yMax, Y }: Chart): string[] {
  if (!pctMode) return [];
  const g: string[] = [];
  for (const [v, lab, cls] of [
    [30, 'amber 30%', 'c-thr-amber'],
    [50, 'red 50%', 'c-thr-red'],
  ] as const) {
    if (v > yMax) continue;
    g.push(`<line class="c-thr ${cls}" x1="${M.l}" x2="${W - M.r}" y1="${Y(v)}" y2="${Y(v)}"/>`);
    // Amber sits under its line and red above, so the two labels never overlap.
    g.push(`<text class="c-thr-lbl" x="${M.l + 4}" y="${v === 30 ? Y(v) + 12 : Y(v) - 4}">${lab}</text>`);
  }
  return g;
}

function nowMarker({ p, x0, x1, X }: Chart): string[] {
  const kn = p.s.windKn;
  if (kn < x0 || kn > x1) return [];
  return [`<line class="c-now" x1="${X(kn)}" x2="${X(kn)}" y1="${M.t}" y2="${H - M.b}"/>`, `<text class="c-tick" x="${X(kn) + 4}" y="${M.t + 10}">now ${kn} kn</text>`];
}

function seriesPaths({ p, data, X, Y }: Chart): string[] {
  return p.series.map((sr, si) => {
    const d = data[si]
      .map((v, i) => (Number.isFinite(v) ? `${i && Number.isFinite(data[si][i - 1]) ? 'L' : 'M'}${X(p.points[i].windKn).toFixed(1)},${Y(v).toFixed(1)}` : ''))
      .join('');
    return `<path class="c-line ${sr.cls}" d="${d}"/>`;
  });
}

/** Direct end labels only when they don't collide (legend + tooltip carry the rest). */
function endLabels({ p, data, Y }: Chart): string[] {
  const ends: Array<{ y: number; name: string; v: number }> = [];
  p.series.forEach((sr, si) => {
    const last = data[si][data[si].length - 1];
    if (Number.isFinite(last)) ends.push({ y: Y(last), name: sr.name, v: last });
  });
  ends.sort((a, b) => a.y - b.y);
  return ends
    .filter((e, i) => !((i > 0 && e.y - ends[i - 1].y < 13) || (i < ends.length - 1 && ends[i + 1].y - e.y < 13)))
    .map((e) => `<text class="c-end" x="${W - M.r + 6}" y="${e.y + 4}">${esc(e.name)} ${fmtTick(e.v)}</text>`);
}

/** Crosshair (hidden until hover) and the transparent hit area over the plot. */
const hoverTargets = (): string[] => [
  `<line class="c-cross" x1="0" x2="0" y1="${M.t}" y2="${H - M.b}" visibility="hidden"/>`,
  `<rect class="c-hit" x="${M.l}" y="${M.t}" width="${W - M.l - M.r}" height="${H - M.t - M.b}"/>`,
];

const lineKey = (cls: string, w: number): string => `<svg width="${w}" height="8" aria-hidden="true"><line class="c-line ${cls}" x1="1" x2="${w - 1}" y1="4" y2="4"/></svg>`;

const legendHtml = ({ p }: Chart): string => p.series.map((sr) => `<span class="legend-item">${lineKey(sr.cls, 18)}${esc(sr.name)}</span>`).join('');

/** The same data as a table (every 5 kn). */
function tableHtml({ p, unit, data }: Chart): string {
  const { points, series } = p;
  const rows = points
    .filter((_, i) => i % 5 === 0)
    .map((pt) => {
      const i = points.indexOf(pt);
      return `<tr><td>${pt.windKn}</td>${data.map((d) => `<td>${fmtTick(d[i])}</td>`).join('')}<td>${pt.sideShift.toFixed(2)}</td><td>${pt.suspended.toFixed(1)}</td></tr>`;
    })
    .join('');
  return `<table class="data-table"><thead><tr><th>Wind (kn)</th>${series.map((sr) => `<th>${esc(sr.name)} (${esc(unit)})</th>`).join('')}<th>Side shift (m)</th><th>Chain lifted (m)</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/** Crosshair + tooltip listing every series at the nearest wind speed. Labels go in with textContent. */
function bindTooltip(host: HTMLElement, c: Chart): void {
  const { p, data, pctMode, x0, x1, X } = c;
  const { s, points, series } = p;
  const svg = host.querySelector<SVGSVGElement>('svg.chart')!;
  const tip = host.querySelector<HTMLElement>('.tooltip')!;
  const cross = svg.querySelector<SVGLineElement>('.c-cross')!;
  const hit = svg.querySelector<SVGRectElement>('.c-hit')!;
  const move = (ev: PointerEvent): void => {
    const r = svg.getBoundingClientRect();
    const sx = ((ev.clientX - r.left) / r.width) * W;
    const kn = x0 + ((sx - M.l) / (W - M.l - M.r)) * (x1 - x0);
    let i = 0;
    for (let j = 1; j < points.length; j++) if (Math.abs(points[j].windKn - kn) < Math.abs(points[i].windKn - kn)) i = j;
    const x = X(points[i].windKn);
    cross.setAttribute('x1', String(x));
    cross.setAttribute('x2', String(x));
    cross.setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.replaceChildren();
    const head = document.createElement('div');
    head.className = 'tt-head';
    head.textContent = `${points[i].windKn} kn${s.sweepGust ? ` (gust ${(points[i].windKn * s.gustFactor).toFixed(0)} kn)` : ''}`;
    tip.append(head);
    series.forEach((sr, si) => {
      const row = document.createElement('div');
      row.className = 'tt-row';
      row.innerHTML = lineKey(sr.cls, 14);
      const v = document.createElement('strong');
      v.textContent = `${fmtTick(data[si][i])} ${pctMode ? '%' : s.units}`;
      const n = document.createElement('span');
      n.textContent = sr.name;
      row.append(v, n);
      tip.append(row);
    });
    const extra = document.createElement('div');
    extra.className = 'tt-row tt-muted';
    extra.textContent = `side shift ${points[i].sideShift.toFixed(2)} m · ${points[i].suspended.toFixed(1)} m lifted`;
    tip.append(extra);
    const left = (x / W) * r.width;
    tip.style.left = `${Math.min(left + 12, r.width - tip.offsetWidth - 4)}px`;
    if (left + 12 + tip.offsetWidth > r.width) tip.style.left = `${Math.max(0, left - tip.offsetWidth - 12)}px`;
    tip.style.top = `${8}px`;
  };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerdown', move);
  hit.addEventListener('pointerleave', () => {
    tip.hidden = true;
    cross.setAttribute('visibility', 'hidden');
  });
}

function fmtTick(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}K`;
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1).replace(/\.0$/, '');
  return v.toFixed(1);
}

/** Peak loads at one wind speed (waves / fishtail), from the background sweep. */
export interface PeakSample {
  windKn: number;
  chain: number;
  anchor: number;
  holding: number;
}

/**
 * The chart's series: chain, each stern line and the anchor (static), plus dashed chain and anchor peaks
 * when waves / fishtail are on (computed every 5 kn, interpolated between). Limits feed the "% of limit" view.
 */
export function sweepSeries(s: AppState, r: ScenarioResult, points: SweepPoint[], peaks: readonly PeakSample[]): SweepSeries[] {
  const effLine = s.lineMbl * 1000 * LINE_EFFICIENCY;
  const series: SweepSeries[] = [
    { id: 'chain', name: 'Chain (bow)', cls: 's-chain', values: points.map((p) => p.chain), limit: () => s.chainMbl * 1000 },
    ...points[0].lines.map((_, i) => ({
      id: `line${i}`,
      name: s.lineCount === 1 ? 'Stern line' : i === 0 ? 'Port line' : 'Stbd line',
      cls: `s-line${i + 1}`,
      values: points.map((p) => p.lines[i]),
      limit: () => effLine,
    })),
    {
      id: 'anchor',
      name: 'Anchor load',
      cls: 's-anchor',
      values: points.map((p) => p.anchor),
      limit: (i: number) => r.sustained.anchor.holdingFlat * upliftFactor(points[i].upliftDeg),
    },
  ];
  if (peaks.length > 1) {
    const at = (kn: number, get: (p: PeakSample) => number): number => {
      let j = 0;
      while (j < peaks.length - 2 && kn > peaks[j + 1].windKn) j++;
      const a = peaks[j];
      const b = peaks[j + 1];
      const f = Math.min(1, Math.max(0, (kn - a.windKn) / (b.windKn - a.windKn)));
      return get(a) + f * (get(b) - get(a));
    };
    series.push(
      { id: 'chainPeak', name: 'Chain peak', cls: 's-chain c-dash', values: points.map((p) => at(p.windKn, (q) => q.chain)), limit: () => s.chainMbl * 1000 },
      { id: 'anchorPeak', name: 'Anchor peak', cls: 's-anchor c-dash', values: points.map((p) => at(p.windKn, (q) => q.anchor)), limit: (i: number) => at(points[i].windKn, (q) => q.holding) },
    );
  }
  return series;
}
