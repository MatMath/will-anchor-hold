import { esc } from './format';
import type { AppState, Key } from './state';

/**
 * Tiny declarative form helpers. Every control carries data-key="<state key>"; main.ts listens
 * for input events on the document and writes the parsed value back to the state.
 * Several controls may share a key (e.g. a slider and a number box); syncControls keeps them aligned.
 */

export interface NumOpts {
  min?: number;
  max?: number;
  step?: number;
  /** Show a range slider next to the number box, with these bounds (defaults to min/max). */
  slider?: boolean | [number, number];
  hint?: string;
  /** State key of the boolean flag that makes this value auto-calculated. */
  auto?: Key;
  id?: string;
}

let uid = 0;

export function num(key: Key, label: string, unit: string, o: NumOpts = {}): string {
  const id = o.id ?? `f-${key}-${++uid}`;
  const attrs = `${o.min !== undefined ? ` min="${o.min}"` : ''}${o.max !== undefined ? ` max="${o.max}"` : ''} step="${o.step ?? 'any'}"`;
  const [smin, smax] = Array.isArray(o.slider) ? o.slider : [o.min ?? 0, o.max ?? 100];
  const slider = o.slider
    ? `<input type="range" data-key="${key}" min="${smin}" max="${smax}" step="${o.step ?? 1}" aria-label="${esc(label)}" tabindex="-1">`
    : '';
  const auto = o.auto
    ? `<button type="button" class="auto-btn" data-auto="${o.auto}" title="Use the calculated value">auto</button>`
    : '';
  return `<div class="field${o.slider ? ' has-slider' : ''}">
    <label for="${id}">${esc(label)}${unit ? ` <span class="unit">${esc(unit)}</span>` : ''}</label>
    <div class="field-row">${slider}<input id="${id}" type="number" inputmode="decimal" data-key="${key}"${attrs}>${auto}</div>
    ${o.hint ? `<small class="hint">${o.hint}</small>` : ''}
  </div>`;
}

export function select(key: Key, label: string, options: ReadonlyArray<readonly [string | number, string]>, hint?: string): string {
  const id = `f-${key}-${++uid}`;
  const isNum = typeof options[0]?.[0] === 'number';
  return `<div class="field">
    <label for="${id}">${esc(label)}</label>
    <div class="field-row"><select id="${id}" data-key="${key}"${isNum ? ' data-type="number"' : ''}>${options
      .map(([v, t]) => `<option value="${v}">${esc(t)}</option>`)
      .join('')}</select></div>
    ${hint ? `<small class="hint">${hint}</small>` : ''}
  </div>`;
}

export function check(key: Key, label: string, hint?: string): string {
  const id = `f-${key}-${++uid}`;
  return `<div class="field field-check">
    <label for="${id}"><input id="${id}" type="checkbox" data-key="${key}"> ${esc(label)}</label>
    ${hint ? `<small class="hint">${hint}</small>` : ''}
  </div>`;
}

/** Segmented control (exclusive buttons). */
export function segmented(key: Key, label: string, options: ReadonlyArray<readonly [string | number, string]>): string {
  const isNum = typeof options[0]?.[0] === 'number';
  return `<div class="segmented" role="group" aria-label="${esc(label)}">${options
    .map(
      ([v, t]) =>
        `<button type="button" data-seg="${key}" data-value="${v}"${isNum ? ' data-type="number"' : ''} aria-pressed="false">${esc(t)}</button>`,
    )
    .join('')}</div>`;
}

/** Push state values into every bound control, except the one the user is typing in. */
export function syncControls(root: ParentNode, s: AppState): void {
  const active = document.activeElement;
  root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-key]').forEach((el) => {
    const key = el.dataset.key as Key;
    const v = s[key];
    if (el instanceof HTMLInputElement && el.type === 'checkbox') {
      el.checked = Boolean(v);
      return;
    }
    if (el === active && el instanceof HTMLInputElement && el.type === 'number') return;
    const str = String(v);
    if (el.value !== str) el.value = str;
  });
  root.querySelectorAll<HTMLButtonElement>('[data-seg]').forEach((b) => {
    const v = s[b.dataset.seg as Key];
    b.setAttribute('aria-pressed', String(String(v) === b.dataset.value));
  });
  root.querySelectorAll<HTMLButtonElement>('[data-auto]').forEach((b) => {
    const on = Boolean(s[b.dataset.auto as Key]);
    b.setAttribute('aria-pressed', String(on));
    b.closest('.field')?.classList.toggle('is-auto', on);
  });
  root.querySelectorAll<HTMLElement>('[data-show-if]').forEach((el) => {
    const [k, want] = el.dataset.showIf!.split('=');
    const v = s[k as Key];
    el.hidden = want === undefined ? !v : String(v) !== want;
  });
}

/** Parse a control's value into the type the state field has. */
export function readControl(el: HTMLInputElement | HTMLSelectElement): unknown {
  if (el instanceof HTMLInputElement && el.type === 'checkbox') return el.checked;
  if (el instanceof HTMLInputElement && (el.type === 'number' || el.type === 'range')) {
    const v = parseFloat(el.value);
    return Number.isFinite(v) ? v : undefined;
  }
  if (el.dataset.type === 'number') return Number(el.value);
  return el.value;
}
