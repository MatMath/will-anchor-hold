import type { ScenarioResult, Status } from '../physics';
import { badge, esc, force, pct, type Units } from './format';
import type { AppState } from './state';

/** Sticky status strip: one chip per element (sustained → gust, peaks when waves / fishtail are on) and a wind summary. */

type Rated = { status: Status; ratio: number };

const chip = (name: string, a: Rated, b: Rated, cls: string): string =>
  `<div class="chip"><span class="key ${cls}" aria-hidden="true"></span><span class="chip-name">${name}</span>${badge(a.status, pct(a.ratio))}<span class="arrow" aria-label="then in gust">→</span>${badge(b.status, pct(b.ratio))}</div>`;

const lineName = (s: AppState, i: number): string => (s.lineCount === 1 ? 'Line' : i === 0 ? 'Port line' : 'Stbd line');

export function statusHtml(s: AppState, r: ScenarioResult, resultIsFull: boolean): string {
  const u = s.units as Units;
  // With waves / fishtailing the chips show the peaks.
  const A = r.sustained.peak;
  const B = r.gust.peak;
  const chips = [chip('Chain', A.chain, B.chain, 'k-chain')];
  if (A.snubber && B.snubber) chips.push(chip('Snubber', A.snubber, B.snubber, 'k-snub'));
  A.lines.forEach((l, i) => chips.push(chip(lineName(s, i), l, B.lines[i], `k-line${i + 1}`)));
  chips.push(chip('Anchor', A.anchor, B.anchor, 'k-anchor'));
  const dynNote = !resultIsFull
    ? ' · <em>adding waves / fishtail…</em>'
    : B.source !== 'static'
      ? ` · peaks include <strong>${esc(B.source)}</strong>`
      : '';
  return `<div class="chips">${chips.join('')}</div><div class="wind-sum">Wind <strong>${force(r.sustained.eq.wind.force, u)}</strong> → gust <strong>${force(r.gust.eq.wind.force, u)}</strong> · side shift <strong>${Math.abs(r.sustained.drift.dy).toFixed(1)} m</strong> → <strong>${Math.abs(r.gust.drift.dy).toFixed(1)} m</strong>${dynNote}</div>`;
}
