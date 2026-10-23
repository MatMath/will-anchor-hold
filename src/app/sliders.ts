import { maxAnchorDistance } from '../physics';
import { toScenario } from '../ui/state';
import { $, ctx } from './context';
import { SNAP_PRETENSION } from './scheduler';

/** Slider decorations: lift-off zones on the wind slider, chain status colour, anchor snap marker and range. */

/** Anchor → quay limits: from the anchor under the bow out to line + boat + chain pulled straight. */
export function anchorRange(): [number, number] {
  const max = maxAnchorDistance(toScenario(ctx.state));
  return [Math.floor(max - ctx.state.chainLength), Math.floor(max)];
}
export const snapTolerance = (): number => {
  const [lo, hi] = anchorRange();
  return Math.max(0.3, (hi - lo) * 0.025);
};

/** Position on a range track (CSS length) for a value, allowing for the 18 px thumb. */
const trackPos = (v: number, lo: number, hi: number): string =>
  `calc(9px + (100% - 18px) * ${Math.min(1, Math.max(0, (v - lo) / (hi - lo))).toFixed(4)})`;

/** The range slider paired with a number box (by the box's id). */
const sliderFor = (id: string): HTMLInputElement | null | undefined =>
  document.querySelector<HTMLInputElement>(`#${id}`)?.parentElement?.querySelector<HTMLInputElement>('input[type=range]');

export function paintSliders(): void {
  paintWindSlider(sliderFor('play-wind'));
  paintChainSlider(sliderFor('play-chain'));
  paintAnchorSlider(sliderFor('play-anchor'));
}

/** Wind: green → amber (chain fully lifted in gusts) → red (fully lifted at the mean wind). */
function paintWindSlider(wind: HTMLInputElement | null | undefined): void {
  if (!wind) return;
  const lo = Number(wind.min);
  const hi = Number(wind.max);
  const liftHint = $('#lift-hint');
  if (ctx.liftKn === null) {
    wind.style.setProperty('--track', 'var(--good)');
    wind.style.removeProperty('--thumb');
    liftHint.textContent = 'Chain stays on the seabed up to 100 kn.';
    return;
  }
  const gustLift = ctx.liftKn / ctx.state.gustFactor;
  const a = trackPos(gustLift, lo, hi);
  const b = trackPos(ctx.liftKn, lo, hi);
  wind.style.setProperty('--track', `linear-gradient(to right, var(--good) 0 ${a}, var(--warning) ${a} ${b}, var(--critical) ${b} 100%)`);
  const zone = ctx.state.windKn >= ctx.liftKn ? 'var(--critical)' : ctx.state.windKn >= gustLift ? 'var(--warning)' : 'var(--good)';
  wind.style.setProperty('--thumb', zone);
  liftHint.innerHTML =
    ctx.liftKn === 0
      ? '<strong>Chain is fully lifted even at rest.</strong>'
      : `Chain fully lifted from <strong>${ctx.liftKn.toFixed(1)} kn</strong> (in gusts from ${gustLift.toFixed(1)} kn).`;
}

/** Chain out: amber / red while the chain is fully lifted in the gust / at the mean wind. */
function paintChainSlider(chain: HTMLInputElement | null | undefined): void {
  if (!chain || !ctx.result) return;
  const lifted = (r: { grounded: number; slack: boolean }): boolean => r.grounded <= 1e-9 && !r.slack;
  const sus = lifted(ctx.result.sustained.eq.rode);
  const gst = lifted(ctx.result.gust.eq.rode);
  const color = sus ? 'var(--critical)' : gst ? 'var(--warning)' : '';
  chain.classList.toggle('is-lifted', Boolean(color));
  if (color) {
    chain.style.setProperty('--track', color);
    chain.style.setProperty('--thumb', color);
  } else {
    chain.style.removeProperty('--track');
    chain.style.removeProperty('--thumb');
  }
  $('#chain-hint').innerHTML = sus
    ? '<span class="hint-red">✕ Fully lifted at the mean wind: anchor pulled upward.</span>'
    : gst
      ? '<span class="hint-amber">! Fully lifted in gusts.</span>'
      : 'Part of the chain stays on the seabed.';
}

/** Anchor → quay: range follows the rigging limits; a marker shows the balanced distance it snaps to. */
function paintAnchorSlider(anchor: HTMLInputElement | null | undefined): void {
  const [lo, hi] = anchorRange();
  document.querySelectorAll<HTMLInputElement>('[data-key=anchorDistance]').forEach((el) => {
    el.max = String(hi);
    if (el.type === 'range') el.min = String(lo);
  });
  if (!anchor) return;
  if (ctx.snap.distance !== null) {
    const p = trackPos(ctx.snap.distance, lo, hi);
    anchor.style.setProperty('--track', `linear-gradient(to right, var(--track-bg) 0 calc(${p} - 1.5px), var(--ink) calc(${p} - 1.5px) calc(${p} + 1.5px), var(--track-bg) calc(${p} + 1.5px) 100%)`);
    anchor.style.setProperty('--thumb', Math.abs(ctx.state.anchorDistance - ctx.snap.distance) < 0.05 ? 'var(--ink)' : 'var(--accent)');
    $('#snap-hint').innerHTML = `Snaps to <strong>${ctx.snap.distance} m</strong>: ${(ctx.snap.pretension / 1000).toFixed(2)} kN pretension at rest (exactly ${SNAP_PRETENSION / 1000} kN at ${ctx.snap.exact?.toFixed(1)} m). Max ${hi} m (all pulled straight).`;
  } else {
    anchor.style.removeProperty('--track');
    anchor.style.removeProperty('--thumb');
    $('#snap-hint').textContent =
      ctx.state.lineCount === 0
        ? `No stern lines: the boat swings on its anchor, so there is no balanced point. Max ${hi} m.`
        : `No balanced point inside the range. Max ${hi} m.`;
  }
}
