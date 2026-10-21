import { KGF, type Status } from '../physics';

export type Units = 'kN' | 'kgf';

/** Force in the chosen unit, with the unit. */
export function force(n: number, units: Units): string {
  if (!Number.isFinite(n)) return '—';
  if (units === 'kgf') return `${Math.round(n / KGF).toLocaleString('en')} kgf`;
  const kn = n / 1000;
  return `${kn < 10 ? kn.toFixed(2) : kn.toFixed(1)} kN`;
}

/** Force value only (no unit) for compact labels. */
export function forceShort(n: number, units: Units): string {
  if (!Number.isFinite(n)) return '—';
  if (units === 'kgf') return Math.round(n / KGF).toLocaleString('en');
  const kn = n / 1000;
  return kn < 10 ? kn.toFixed(1) : kn.toFixed(0);
}

export const pct = (r: number): string => (Number.isFinite(r) ? `${Math.round(r * 100)}%` : '—');
export const m = (v: number, d = 2): string => `${v.toFixed(d)} m`;
export const deg = (v: number, d = 1): string => `${v.toFixed(d)}°`;

export const STATUS_ICON: Record<Status, string> = { green: '✓', amber: '!', red: '✕' };
export const STATUS_LABEL: Record<Status, string> = { green: 'OK', amber: 'Caution', red: 'Danger' };

export function badge(status: Status, text: string): string {
  return `<span class="badge badge-${status}" title="${STATUS_LABEL[status]}"><span class="badge-icon" aria-hidden="true">${STATUS_ICON[status]}</span>${text}<span class="sr-only"> (${STATUS_LABEL[status]})</span></span>`;
}

export const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
