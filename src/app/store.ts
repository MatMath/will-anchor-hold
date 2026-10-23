import { estimateWindageItems } from '../physics';
import { boatDefaults, resolve, saveState, type AppState, type Key } from '../ui/state';
import { stopAnimation } from './animation';
import { ctx } from './context';
import { schedule } from './scheduler';

/** Input state changes: the pure update rules, and the side effects (persist, recompute). */

/** Value keys that switch their "auto" flag off when edited by hand. */
export const AUTO_OF: Partial<Record<Key, Key>> = {
  sideArea: 'windageAuto',
  frontArea: 'windageAuto',
  ceX: 'windageAuto',
  chainKgPerM: 'chainKgAuto',
  chainMbl: 'chainMblAuto',
  snubberMbl: 'snubberMblAuto',
  lineMbl: 'lineMblAuto',
  holdingRatio: 'holdingAuto',
  wavePeriod: 'wavePeriodAuto',
};

/** Boat dimensions that re-estimate the windage items (unless the user edited them). */
const DIM_KEYS: Key[] = ['loa', 'beam', 'freeboard', 'mastHeight', 'boatType'];

/** Inputs that only change how results are shown; they don't restart the animation. */
const VIEW_KEYS: Key[] = ['units', 'animSpeed', 'planZoom', 'exaggeration', 'vExag', 'viewCase', 'sweepMode', 'sweepGust'];

/**
 * The new state after a user edit (pure): applies the patch, then the knock-on rules —
 * boat-type defaults, re-estimated windage items, and every auto-calculated value (resolve()).
 */
export function applyPatch(state: AppState, patch: Partial<AppState>): AppState {
  let next = { ...state, ...patch };
  if ('boatType' in patch && patch.boatType !== state.boatType) next = { ...next, ...boatDefaults(next.boatType, next.loa) };
  if (DIM_KEYS.some((k) => k in patch) && !next.windageItemsEdited) {
    const enabled = new Map(state.windageItems.map((i) => [i.id, i.enabled]));
    next.windageItems = estimateWindageItems({ type: next.boatType, loa: next.loa, beam: next.beam, freeboard: next.freeboard, mastHeight: next.mastHeight }).map(
      (i) => ({ ...i, enabled: enabled.get(i.id) ?? i.enabled }),
    );
  }
  return resolve(next);
}

/** The one way inputs change: update state, persist it, and schedule a recompute. */
export function update(patch: Partial<AppState>): void {
  // A running animation uses the inputs it started with; view-only changes don't stop it.
  if (ctx.anim && !ctx.anim.done && Object.keys(patch).some((k) => !VIEW_KEYS.includes(k as Key))) stopAnimation();
  ctx.state = applyPatch(ctx.state, patch);
  saveState(ctx.state);
  schedule();
}

/** Replace the whole state (worked example, reset). */
export function replaceState(next: AppState): void {
  ctx.state = next;
  saveState(ctx.state);
  schedule();
}
