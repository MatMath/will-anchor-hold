import type { AnimFrame, MooringAnimation, ScenarioResult, SweepPoint } from '../physics';
import { loadState, type AppState } from '../ui/state';
import type { ViewBox } from '../ui/svg';

/**
 * The app's single source of truth, shared by the app modules:
 *   state (user inputs, persisted) → derived data (analysis results) → render.
 * Inputs change only through store.update(); derived data only through scheduler.ts.
 */

/** Peak loads (waves / fishtail) at one wind speed, from the background sweep. */
export interface PeakPoint {
  windKn: number;
  chain: number;
  anchor: number;
  holding: number;
  lines: number[];
}

export interface AnimationRun {
  sim: MooringAnimation;
  /** Frame on screen, or null when the animation is not playing. */
  frame: AnimFrame | null;
  series: Array<{ t: number; wind: number; chain: number; anchor: number; lines: number[]; anchorRatio: number; yaw: number; wave: number }>;
  raf: number;
  last: number;
  done: boolean;
  planView: ViewBox;
  sideXMax: number;
  peakRef: number;
}

export interface AppContext {
  state: AppState;
  /** Latest analysis, or the error that stopped it. */
  result: ScenarioResult | null;
  /** False while `result` is the fast static analysis and the wave / fishtail one is pending. */
  resultIsFull: boolean;
  error: string | null;
  /** Static loads vs wind speed (chart). */
  points: SweepPoint[];
  peakPoints: PeakPoint[];
  /** Mean wind (kn) at which the whole chain lifts off the seabed; null = never (up to 100 kn). */
  liftKn: number | null;
  /** Anchor slider snap point: whole-metre distance, exact balanced distance, and the pretension at the snap. */
  snap: { distance: number | null; exact: number | null; pretension: number };
  anim: AnimationRun | null;
  /** Pointer interactions: views frozen while dragging so they don't rescale under the pointer. */
  view: { planFrozen?: ViewBox; sideFrozen?: ViewBox; dragging: 'anchor' | 'depth' | null };
}

export const ctx: AppContext = {
  state: loadState(),
  result: null,
  resultIsFull: true,
  error: null,
  points: [],
  peakPoints: [],
  liftKn: null,
  snap: { distance: null, exact: null, pretension: 0 },
  anim: null,
  view: { dragging: null },
};

export const $ = <T extends Element = HTMLElement>(sel: string): T => document.querySelector<T>(sel)!;
