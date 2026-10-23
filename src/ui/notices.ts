import type { RodeState, ScenarioResult } from '../physics';
import { esc, force, type Units } from './format';
import type { AppState } from './state';

/** Text blocks around the diagrams: chain facts, set-up warnings and the dynamic-load note. */

export function factsHtml(s: AppState, rode: RodeState): string {
  const u = s.units as Units;
  return [
    ['Bow tension', force(rode.tensionTop, u)],
    ['At anchor', force(rode.tensionAnchor, u)],
    ['Lifted', `${rode.suspended.toFixed(1)} of ${s.chainLength} m`],
    ['Uplift at anchor', `${((rode.angleAnchor * 180) / Math.PI).toFixed(1)}°`],
    ['Anchor pull', rode.vAnchor > 0 ? '<strong class="warn-text">⚠ upward</strong>' : 'horizontal'],
  ]
    .map(([k, v]) => `<div><span>${k}</span><strong>${v}</strong></div>`)
    .join('');
}

export function warningsHtml(s: AppState, r: ScenarioResult): string {
  const u = s.units as Units;
  const w = r.warnings.map((t) => `<li>${esc(t)}</li>`).join('');
  const peak = r.gust.eq.wind.force + 2 * (r.gust.eq.wind.force - r.sustained.eq.wind.force);
  return `
    ${w ? `<div class="alert alert-amber"><strong>Check the set-up</strong><ul>${w}</ul></div>` : ''}
    <div class="alert alert-info">
      ${r.gust.peak.source !== 'static'
        ? `<strong>⚠ Peaks include ${esc(r.gust.peak.source)}.</strong> They are quasi-static estimates plus a simplified surge simulation; real snatch loads scatter widely.`
        : '<strong>⚠ These are static loads.</strong> A gust or a wave snatch load can be several times the static load. Turn on <strong>waves</strong> and, when swinging, <strong>fishtailing</strong> to see them.'}
      A sudden gust on an elastic mooring can overshoot to about <strong>${force(peak, u)}</strong> of wind load (2 × the gust increment).
      A ${s.snatchSpeed} m/s surge stopped by the mooring adds about <strong>${force(r.gust.snatch.force, u)}</strong>.
      ${s.snubberOn ? 'Your snubber lowers the mooring stiffness and so the snatch load.' : 'A nylon <strong>snubber</strong>, or longer nylon stern lines, adds elasticity and cuts snatch loads sharply. Try one in the Snubber section.'}
    </div>`;
}

export const errorHtml = (message: string): string => `<div class="alert alert-red"><strong>Cannot solve:</strong> ${esc(message)}</div>`;
