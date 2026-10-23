import { estimateWindageItems } from '../physics';
import { readControl } from '../ui/controls';
import { DEFAULT_STATE, clearSaved, resolve, round, workedExampleState, type AppState, type Key } from '../ui/state';
import { toUser, type ViewBox } from '../ui/svg';
import { dialAngle } from '../ui/windDial';
import { startAnimation, stopAnimation } from './animation';
import { $, ctx } from './context';
import { renderSweepChart } from './render';
import { computeSweep, schedule } from './scheduler';
import { anchorRange, snapTolerance } from './sliders';
import { AUTO_OF, replaceState, update } from './store';

/**
 * User interactions. Every handler turns an event into a state patch and calls update(); nothing here
 * computes or renders directly (except re-drawing the chart for view-only switches).
 */

export function bindInteractions(): void {
  document.addEventListener('input', onInput);
  document.addEventListener('click', onClick);
  bindWindDial($('#dial'));
  bindAnchorDrag($<SVGSVGElement>('#plan'));
  bindDepthDrag($<SVGSVGElement>('#side'));
}

// ── Form controls ─────────────────────────────────────────────

function onInput(ev: Event): void {
  const el = ev.target as HTMLInputElement | HTMLSelectElement;
  if (el.dataset.witem !== undefined) return onWindageItemInput(el);
  const key = el.dataset.key as Key | undefined;
  if (!key) return;
  let v = readControl(el);
  if (v === undefined) return;
  // The anchor slider snaps to the balanced (1 kN pretension) distance when close to it.
  if (key === 'anchorDistance' && el.type === 'range' && ctx.snap.distance !== null && Math.abs((v as number) - ctx.snap.distance) <= snapTolerance()) v = ctx.snap.distance;
  const patch: Partial<AppState> = { [key]: v } as Partial<AppState>;
  const autoKey = AUTO_OF[key];
  if (autoKey) (patch as Record<string, unknown>)[autoKey] = false;
  update(patch);
}

/** A cell of the windage helper table (tick box, side/front area, position). */
function onWindageItemInput(el: HTMLInputElement | HTMLSelectElement): void {
  const i = Number(el.dataset.witem);
  const f = el.dataset.wfield as 'enabled' | 'side' | 'front' | 'x';
  const items = ctx.state.windageItems.map((it) => ({ ...it }));
  if (f === 'enabled') items[i].enabled = (el as HTMLInputElement).checked;
  else {
    const v = parseFloat(el.value);
    if (!Number.isFinite(v)) return;
    items[i][f] = v;
  }
  update({ windageItems: items, windageItemsEdited: f === 'enabled' ? ctx.state.windageItemsEdited : true, windageAuto: true });
}

// ── Buttons ───────────────────────────────────────────────────

/** Buttons by id → what they do. */
const ACTIONS: Record<string, () => void> = {
  'btn-example': () => {
    replaceState(workedExampleState(ctx.state));
    toast('Loaded the worked example (see the bottom of the page)');
  },
  'btn-reset': () => {
    if (!confirm('Reset all inputs to the defaults?')) return;
    clearSaved();
    replaceState(resolve({ ...DEFAULT_STATE, units: ctx.state.units }));
  },
  'btn-reestimate': () =>
    update({
      windageItemsEdited: false,
      windageAuto: true,
      windageItems: estimateWindageItems({ type: ctx.state.boatType, loa: ctx.state.loa, beam: ctx.state.beam, freeboard: ctx.state.freeboard, mastHeight: ctx.state.mastHeight }),
    }),
  'btn-animate': () => (ctx.anim && !ctx.anim.done ? stopAnimation() : startAnimation()),
};

function onClick(ev: Event): void {
  const t = ev.target as HTMLElement;
  const seg = t.closest<HTMLButtonElement>('[data-seg]');
  if (seg) return onSegment(seg);
  const auto = t.closest<HTMLButtonElement>('[data-auto]');
  if (auto) {
    const k = auto.dataset.auto as Key;
    return update({ [k]: !ctx.state[k] } as Partial<AppState>);
  }
  const button = t.closest<HTMLElement>('button[id]');
  if (button && ACTIONS[button.id]) ACTIONS[button.id]();
}

/** Segmented control (exclusive buttons): set its value; chart-only switches redraw the chart at once. */
function onSegment(seg: HTMLButtonElement): void {
  const key = seg.dataset.seg as Key;
  const raw = seg.dataset.value!;
  const v = seg.dataset.type === 'number' ? Number(raw) : raw === 'true' ? true : raw === 'false' ? false : raw;
  update({ [key]: v } as Partial<AppState>);
  if (key === 'sweepGust' || key === 'sweepMode' || key === 'units') {
    if (key === 'sweepGust') computeSweep();
    renderSweepChart();
  }
}

let toastTimer: number | undefined;
function toast(msg: string): void {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), 3200);
}

// ── Wind dial ─────────────────────────────────────────────────

function bindWindDial(dial: HTMLElement): void {
  dial.addEventListener('pointerdown', (ev) => {
    dial.setPointerCapture(ev.pointerId);
    update({ windDir: dialAngle(dial, ev) });
  });
  dial.addEventListener('pointermove', (ev) => {
    if (dial.hasPointerCapture(ev.pointerId)) update({ windDir: dialAngle(dial, ev) });
  });
  dial.addEventListener('keydown', (ev) => {
    const d = ev.key === 'ArrowRight' || ev.key === 'ArrowUp' ? 5 : ev.key === 'ArrowLeft' || ev.key === 'ArrowDown' ? -5 : 0;
    if (!d) return;
    ev.preventDefault();
    update({ windDir: (ctx.state.windDir + d + 360) % 360 });
  });
}

// ── Dragging in the diagrams (views are frozen while dragging so they don't rescale under the pointer) ──

const currentView = (svg: SVGSVGElement): ViewBox => {
  const b = svg.viewBox.baseVal;
  return { x: b.x, y: b.y, w: b.width, h: b.height };
};

function endDrag(): void {
  if (!ctx.view.dragging) return;
  ctx.view.dragging = null;
  ctx.view.planFrozen = undefined;
  ctx.view.sideFrozen = undefined;
  schedule();
}

/** Plan view: drag (or arrow-key) the anchor to set its distance from the quay and sideways offset. */
function bindAnchorDrag(plan: SVGSVGElement): void {
  plan.addEventListener('pointerdown', (ev) => {
    if (!(ev.target as Element).closest('.drag-anchor')) return;
    ctx.view.dragging = 'anchor';
    ctx.view.planFrozen = currentView(plan);
    plan.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  });
  plan.addEventListener('pointermove', (ev) => {
    if (ctx.view.dragging !== 'anchor') return;
    const [x, y] = toUser(plan, ev);
    const [minD, maxD] = anchorRange();
    update({ anchorDistance: Math.min(maxD, Math.max(minD, Math.round(x))), anchorOffset: round(-y * 2, 0) / 2 });
  });
  plan.addEventListener('pointerup', endDrag);
  plan.addEventListener('pointercancel', endDrag);
  plan.addEventListener('keydown', (ev) => {
    if (!(ev.target as Element).closest('.drag-anchor')) return;
    const step = 0.5;
    const map: Record<string, [number, number]> = { ArrowRight: [step, 0], ArrowLeft: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const d = map[ev.key];
    if (!d) return;
    ev.preventDefault();
    update({ anchorDistance: Math.round(ctx.state.anchorDistance + d[0] * 2), anchorOffset: ctx.state.anchorOffset + d[1] });
  });
}

/** Side view: drag (or arrow-key) the water surface to set the depth. */
function bindDepthDrag(side: SVGSVGElement): void {
  let start = { y: 0, depth: 0 };
  side.addEventListener('pointerdown', (ev) => {
    if (!(ev.target as Element).closest('.drag-depth')) return;
    ctx.view.dragging = 'depth';
    ctx.view.sideFrozen = currentView(side);
    start = { y: toUser(side, ev)[1], depth: ctx.state.depth };
    side.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  });
  side.addEventListener('pointermove', (ev) => {
    if (ctx.view.dragging !== 'depth') return;
    const y = toUser(side, ev)[1];
    const maxDepth = ctx.state.chainLength - ctx.state.rollerHeight - 0.5;
    update({ depth: Math.min(maxDepth, Math.max(0.5, round(start.depth - (y - start.y) / ctx.state.vExag, 1))) });
  });
  side.addEventListener('pointerup', endDrag);
  side.addEventListener('pointercancel', endDrag);
  side.addEventListener('keydown', (ev) => {
    if (!(ev.target as Element).closest('.drag-depth')) return;
    const d = ev.key === 'ArrowUp' ? 0.1 : ev.key === 'ArrowDown' ? -0.1 : 0;
    if (!d) return;
    ev.preventDefault();
    update({ depth: Math.max(0.5, round(ctx.state.depth + d, 1)) });
  });
}
