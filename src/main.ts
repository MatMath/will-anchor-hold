import './styles.css';
import workedExampleMd from '../docs/worked-example.md?raw';
import {
  ANCHOR_TYPES,
  LINE_EFFICIENCY,
  BOTTOMS,
  CHAIN_GRADES,
  ROPES,
  estimateWindageItems,
  anchorDistanceForPretension,
  liftOffWind,
  maxAnchorDistance,
  buildModel,
  runScenario,
  solveRest,
  MooringAnimation,
  KGF,
  hasDynamics,
  holdingStatus,
  loadStatus,
  toEarth,
  windDirectionVector,
  type AnimFrame,
  sweep,
  upliftFactor,
  type Equilibrium,
  type ScenarioResult,
  type SweepPoint,
} from './physics';
import { check, num, readControl, segmented, select, syncControls } from './ui/controls';
import { badge, esc, force, pct, type Units } from './ui/format';
import { markdown } from './ui/markdown';
import { renderPlan } from './ui/planView';
import { resultsTable } from './ui/results';
import { renderSide } from './ui/sideView';
import {
  DEFAULT_STATE,
  boatDefaults,
  clearSaved,
  loadState,
  resolve,
  round,
  saveState,
  toScenario,
  workedExampleState,
  type AppState,
  type Key,
} from './ui/state';
import { toUser, type ViewBox } from './ui/svg';
import { renderSweep } from './ui/sweepChart';
import { dialAngle, renderDial } from './ui/windDial';

// ───────────────────────────── Layout ─────────────────────────────

const ropeOpts = Object.entries(ROPES).map(([k, v]) => [k, v.name] as const);
const diaOpts = (ds: number[]): Array<readonly [number, string]> => ds.map((d) => [d, `${d} mm`] as const);

const app = document.getElementById('app')!;
app.innerHTML = `
<header class="topbar">
  <div class="brand">
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm0 4v13m-5-9h10M4 14c0 4 4 6 8 6s8-2 8-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
    <h1>Med-mooring loads</h1>
  </div>
  <div class="top-actions">
    ${segmented('units', 'Force units', [['kN', 'kN'], ['kgf', 'kgf']])}
    <button type="button" class="btn" id="btn-example">Worked example</button>
    <button type="button" class="btn btn-ghost" id="btn-reset">Reset</button>
  </div>
</header>

<div class="status-strip" id="status" aria-live="polite"></div>

<main class="layout">
  <section class="col-vis">
    <div class="card play">
      <div class="play-grid">
        <div class="dial" id="dial" tabindex="0" role="slider" aria-label="Wind direction relative to the bow" aria-valuemin="0" aria-valuemax="359"></div>
        <div class="play-fields">
          ${num('windKn', 'Wind speed', 'kn', { min: 0, max: 80, step: 1, slider: [0, 60], id: 'play-wind', hint: '<span id="lift-hint"></span>' })}
          ${num('windDir', 'Wind from (relative to bow)', '°', { min: 0, max: 359, step: 5, slider: [0, 355] })}
          <div class="row-btns">
            ${segmented('viewCase', 'Case shown in the diagrams', [['rest', 'At rest'], ['sustained', 'Sustained'], ['gust', 'Gust']])}
            <button type="button" class="btn" id="btn-animate" title="Play 10 gusts with waves and fishtailing">▶ Animate 10 gusts</button>
            ${segmented('animSpeed', 'Animation speed', [[2, '×2'], [5, '×5'], [10, '×10']])}
          </div>
        </div>
      </div>
      <div class="play-sliders">
        ${num('chainLength', 'Chain out', 'm', { min: 5, max: 150, step: 1, slider: [10, 100], id: 'play-chain', hint: '<span id="chain-hint"></span>' })}
        ${num('anchorDistance', 'Anchor → quay', 'm', { min: 10, max: 200, step: 1, slider: [20, 120], id: 'play-anchor', hint: '<span id="snap-hint"></span>' })}
        <div data-show-if="lineCount!=0">${num('lineLength', 'Stern line length', 'm', { min: 1, max: 80, step: 1, slider: [1, 80] })}</div>
        ${num('depth', 'Water depth', 'm', { min: 0.5, max: 50, step: 0.1, slider: [1, 25] })}
      </div>
      <div class="play-dyn">
        <div class="dyn-item">
          ${check('wavesOn', 'Waves from the wind')}
          <div data-show-if="wavesOn">${num('waveHs', 'Wave height Hs', 'm', { min: 0.05, max: 4, step: 0.05, slider: [0.1, 2.5] })}</div>
        </div>
        <div class="dyn-item">
          ${check('fishtailOn', 'Fishtailing at anchor')}
          <div data-show-if="fishtailOn">${num('fishtailAmp', 'Swing either side of the wind', '±°', { min: 0, max: 80, step: 1, slider: [0, 70] })}</div>
          <small class="hint" data-show-if="lineCount!=0">Applies only when swinging at anchor: stern lines stop it.</small>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h2>Plan view</h2>
        <div class="tools">
          ${segmented('planZoom', 'Zoom', [['all', 'Whole mooring'], ['boat', 'Boat']])}
          ${segmented('exaggeration', 'Drift exaggeration', [[1, '×1'], [2, '×2'], [5, '×5']])}
        </div>
      </div>
      <svg id="plan" class="plan" role="img" aria-label="Top-down view of the boat, chain and stern lines with force arrows"></svg>
      <p class="caption">Drag the anchor to move it. Arrows show the horizontal forces on the boat, all to one scale. The dashed outline is the boat at rest; the darker chain is the part lying on the seabed.</p>
    </div>

    <div class="card">
      <div class="card-head">
        <h2>Chain — side view</h2>
        <div class="tools">${segmented('vExag', 'Vertical exaggeration', [[1, 'True scale'], [2, 'Height ×2'], [4, '×4']])}</div>
      </div>
      <svg id="side" class="side" role="img" aria-label="Side view of the chain catenary"></svg>
      <div class="facts" id="facts"></div>
    </div>

    <div class="card" id="anim-card" hidden>
      <div class="card-head">
        <h2>Live loads — 10 gusts</h2>
        <div class="tools anim-status" id="anim-status"></div>
      </div>
      <div class="legend" id="anim-legend"></div>
      <svg id="anim-chart" class="anim-chart" viewBox="0 0 640 260" role="img" aria-label="Wind speed and mooring loads during the gust animation"></svg>
      <div class="facts" id="anim-facts"></div>
      <p class="caption">Simulated time; the boat is put in equilibrium for each instant of wind and fishtail heading, and its surge in the waves is integrated on top. The largest waves arrive with the gust peaks.</p>
    </div>

    <div id="warnings"></div>

    <div class="card">
      <div class="card-head"><h2>Results</h2></div>
      <div class="table-scroll" id="results"></div>
    </div>

    <div class="card">
      <div class="card-head">
        <h2>Loads vs wind speed</h2>
        <div class="tools">
          ${segmented('sweepMode', 'Y axis', [['kN', 'Force'], ['pct', '% of limit']])}
          ${segmented('sweepGust', 'Mean or gust', [['false', 'Mean wind'], ['true', 'At gust']])}
        </div>
      </div>
      <div id="sweep"></div>
      <p class="caption">"% of limit" = chain and lines against their MBL; anchor against estimated holding (which falls as the chain lifts).</p>
    </div>
  </section>

  <aside class="col-inputs" aria-label="Inputs">
    <details class="card acc" open>
      <summary><h2>Boat</h2></summary>
      ${select('boatType', 'Type', [['monohull', 'Monohull sailboat'], ['catamaran', 'Catamaran']], 'Changing type loads typical dimensions for that type.')}
      <div class="grid2">
        ${num('loa', 'Length overall', 'm', { min: 5, max: 30, step: 0.1, slider: [6, 20] })}
        ${num('beam', 'Beam', 'm', { min: 1, max: 15, step: 0.1 })}
        ${num('displacement', 'Displacement', 'kg', { min: 500, max: 80000, step: 100 })}
        ${num('freeboard', 'Freeboard', 'm', { min: 0.3, max: 4, step: 0.05 })}
        ${num('mastHeight', 'Mast height above water', 'm', { min: 0, max: 40, step: 0.5 })}
        ${num('rollerHeight', 'Bow roller above water', 'm', { min: 0.2, max: 4, step: 0.05 })}
        ${num('rollerOverhang', 'Roller ahead of stem', 'm', { min: 0, max: 2, step: 0.05 })}
      </div>
    </details>

    <details class="card acc" open>
      <summary><h2>Windage</h2></summary>
      <div class="grid2">
        ${num('sideArea', 'Side-profile area', 'm²', { min: 1, max: 200, step: 0.5, auto: 'windageAuto' })}
        ${num('frontArea', 'Frontal area', 'm²', { min: 0.5, max: 100, step: 0.5, auto: 'windageAuto' })}
        ${num('cdSide', 'Cd side-on', '', { min: 0.3, max: 2, step: 0.05, hint: 'Typical 0.9–1.2 (blunt shape).' })}
        ${num('cdFront', 'Cd head-on', '', { min: 0.3, max: 2, step: 0.05, hint: 'Typical 0.7–0.9. Head-on loads are low mainly because the <em>area</em> is small.' })}
        ${num('ceX', 'Centre of effort, from midships', 'm (+ fwd)', { min: -15, max: 15, step: 0.1, auto: 'windageAuto' })}
      </div>
      <details class="sub">
        <summary>Windage helper — hull, cabin, mast, boom, bimini, dinghy…</summary>
        <p class="hint">Tick what is on board and adjust any area. Totals feed the inputs above while they show <em>auto</em>.</p>
        <div class="table-scroll"><table class="witems" id="witems"></table></div>
        <button type="button" class="btn btn-ghost" id="btn-reestimate">Re-estimate from boat dimensions</button>
      </details>
    </details>


    <details class="card acc" open>
      <summary><h2>Anchor &amp; chain</h2></summary>
      <div class="grid2">
        ${num('depth', 'Water depth', 'm', { min: 0.5, max: 50, step: 0.1 })}
        ${select('chainD', 'Chain diameter', diaOpts([6, 7, 8, 10, 12, 13, 14, 16]))}
        ${select('chainGrade', 'Chain grade (galvanised)', Object.entries(CHAIN_GRADES).map(([k, v]) => [k, v.name] as const))}
        ${num('chainKgPerM', 'Chain weight in air', 'kg/m', { min: 0.2, max: 10, step: 0.05, auto: 'chainKgAuto' })}
        ${num('chainMbl', 'Chain MBL', 'kN', { min: 1, max: 500, step: 0.1, auto: 'chainMblAuto', hint: 'Auto: published DIN 766 table for Grade 30; grade stress × 2 legs × πd²/4 for G40 / G70.' })}
        ${num('chainLength', 'Chain deployed', 'm', { min: 5, max: 150, step: 1 })}
        ${num('anchorDistance', 'Anchor → quay, horizontal', 'm', { min: 10, max: 200, step: 1 })}
        ${num('anchorOffset', 'Anchor offset sideways', 'm (+ port)', { min: -50, max: 50, step: 0.5 })}
      </div>
      <h3>Holding check</h3>
      <div class="grid2">
        ${select('anchorType', 'Anchor type', Object.entries(ANCHOR_TYPES))}
        ${num('anchorMass', 'Anchor mass', 'kg', { min: 2, max: 200, step: 1 })}
        ${select('bottom', 'Bottom', Object.entries(BOTTOMS))}
        ${num('holdingRatio', 'Holding ratio', 'kgf per kg', { min: 1, max: 150, step: 1, auto: 'holdingAuto', hint: 'Rough, well-set values. Reduced automatically when the chain lifts the shank.' })}
      </div>
    </details>

    <details class="card acc">
      <summary><h2>Snubber</h2></summary>
      ${check('snubberOn', 'Use a snubber (bridle) between bow and chain')}
      <div class="grid2" data-show-if="snubberOn">
        ${select('snubberType', 'Rope', ropeOpts)}
        ${select('snubberD', 'Diameter', diaOpts([10, 12, 14, 16, 18, 20, 22, 24]))}
        ${num('snubberLength', 'Length', 'm', { min: 0.5, max: 30, step: 0.5 })}
        ${num('snubberMbl', 'MBL', 'kN', { min: 1, max: 500, step: 0.1, auto: 'snubberMblAuto' })}
      </div>
    </details>

    <details class="card acc" open>
      <summary><h2>Stern lines</h2></summary>
      <div class="grid2">
        ${select('lineCount', 'Number of lines', [[0, 'None — swing at anchor'], [1, '1 line'], [2, '2 lines']], 'None: no stern line, the boat swings on its anchor and turns head to wind.')}
        <div data-show-if="lineCount=1">${select('singleAttach', 'Cleat used', [['port', 'Port quarter'], ['centre', 'Centre (bridle)'], ['starboard', 'Starboard quarter']])}</div>
        <div data-show-if="lineCount=2">${check('crossed', 'Lines crossed', 'Port cleat to the starboard ring and vice versa.')}</div>
        <div data-show-if="lineCount!=0">
        ${select('lineType', 'Rope', ropeOpts)}
        ${select('lineD', 'Diameter', diaOpts([8, 10, 12, 14, 16, 18, 20, 22, 24]))}
        ${num('lineMbl', 'MBL (catalogue, each)', 'kN', { min: 1, max: 500, step: 0.1, auto: 'lineMblAuto' })}
        ${num('lineLength', 'Length, cleat → shore point (each)', 'm', { min: 1, max: 80, step: 1 })}
        ${num('cleatInset', 'Cleats forward of transom', 'm', { min: 0, max: 3, step: 0.05 })}
        ${num('cleatHeight', 'Cleat height above water', 'm', { min: 0, max: 4, step: 0.05 })}
        ${num('shoreSpread', 'Shore points apart', 'm', { min: 0, max: 30, step: 0.5, hint: '0 = both lines to one ring or rock.' })}
        ${num('shoreHeight', 'Shore point above water', 'm', { min: -1, max: 5, step: 0.1 })}
        </div>
      </div>
    </details>

    <details class="card acc" open>
      <summary><h2>Waves &amp; fishtailing</h2></summary>
      ${check('wavesOn', 'Waves from the wind direction')}
      <div class="grid2" data-show-if="wavesOn">
        ${num('waveHs', 'Significant wave height Hs', 'm', { min: 0.05, max: 4, step: 0.05 })}
        ${num('wavePeriod', 'Wave period', 's', { min: 0.5, max: 15, step: 0.1, auto: 'wavePeriodAuto', hint: 'Auto: 3.6·√Hs, a steep young wind sea (steepness ≈ 1/20).' })}
      </div>
      <p class="hint" data-show-if="wavesOn">Peaks use the largest wave in about 1 000 (1.86 × Hs). The mean wave drift force adds to the wind load.</p>
      ${check('fishtailOn', 'Fishtailing (sheering) at anchor')}
      <div class="grid2" data-show-if="fishtailOn">
        ${num('fishtailAmp', 'Swing either side of the wind', '±°', { min: 0, max: 80, step: 1, hint: 'Well-mannered boat ±10°, typical fin keel ±20–30°, bad ±60° (Practical Sailor).' })}
        ${num('fishtailPeriod', 'Swing period (animation only)', 's', { min: 5, max: 180, step: 1 })}
      </div>
      <p class="hint" data-show-if="lineCount!=0">Fishtailing applies only when swinging at anchor (no stern lines).</p>
    </details>

    <details class="card acc">
      <summary><h2>Dynamic estimate</h2></summary>
      ${num('snatchSpeed', 'Boat speed stopped by the mooring', 'm/s', { min: 0, max: 3, step: 0.1, hint: 'Used only for the indicative snatch-load figure: ΔF = v·√(m·k).' })}
    </details>
    <details class="card acc" open>
      <summary><h2>Wind</h2></summary>
      <div class="grid2">
        ${num('windKn', 'Mean wind speed', 'kn', { min: 0, max: 80, step: 1 })}
        ${num('windDir', 'Direction from, relative to bow', '°', { min: 0, max: 359, step: 1, hint: '90 = starboard beam, 270 = port beam, 0 = on the bow.' })}
        ${num('gustFactor', 'Gust factor (on speed)', '×', { min: 1, max: 2.5, step: 0.05, hint: 'Gust speed ÷ mean speed. Force grows with its square.' })}
      </div>
      <p class="hint">No current is applied, so the water gives no steady sideways resistance.</p>
    </details>
  </aside>
</main>

<section class="card notes">
  <h2>Assumptions &amp; limits</h2>
  <ul>
    <li><strong>Quasi-static</strong>: forces are balanced at each wind speed; no inertia, no waves, no dynamic yawing (sheering). The boat's steady heading change <em>is</em> solved: sideways shift, fore-aft shift and rotation (3 degrees of freedom).</li>
    <li><strong>Wind</strong>: F = ½·ρ·Cd·A·V² with ρ = 1.225 kg/m³, applied at one centre of effort, acting straight downwind (no lift). Area and Cd blend as A·|sin θ| + A·|cos θ| with the apparent angle. Uniform wind, no height gradient.</li>
    <li><strong>No current</strong> and no hull resistance: in steady state only the chain and the lines hold the boat.</li>
    <li><strong>Waves</strong> (optional) come from the wind: a mean drift force plus a surge simulation of the boat riding the largest wave (1.86 × Hs), with the bow lifted against buoyancy. <strong>Fishtailing</strong> (swinging at anchor only) holds the boat ±A° off the wind. Both are simplified and indicative — see the validation notes.</li>
    <li><strong>Chain</strong>: elastic catenary (Irvine) on a flat, frictionless seabed, submerged weight throughout (the bit above water is slightly heavier). The anchor is a fixed point.</li>
    <li><strong>Stern lines</strong>: straight (no sag), with the typical load–stretch curve of the chosen rope. Real ropes differ ±20% from catalogue values; wet nylon is weaker and stretchier.</li>
    <li><strong>Anchor holding</strong> is an order-of-magnitude guide only. When the chain lifts the shank, holding is reduced: no loss up to 3°, then about 3% less per degree (fitted to yacht scope tests; see the validation notes). Thresholds: amber above 50%, red above 80% of the estimate.</li>
    <li><strong>Chain data</strong>: Grade 30 weights and breaking loads from the published DIN 766 table. The catenary was checked against NREL's MoorPy solver and an independent numerical integration.</li>
    <li><strong>Safety colours</strong> for chain, snubber and lines: amber above 30% MBL, red above 50% MBL. MBL is a breaking load, not a working load.</li>
  </ul>
  <details class="sub">
    <summary>Worked example — check the numbers by hand</summary>
    <div class="md">${markdown(workedExampleMd)}</div>
  </details>
</section>
<div class="toast" id="toast" role="status" hidden></div>
`;

// ───────────────────────────── State ─────────────────────────────

let state: AppState = loadState();
let result: ScenarioResult | null = null;
let error: string | null = null;
let points: SweepPoint[] = [];
/** Mean wind (kn) at which the whole chain lifts off the seabed; null = never (up to 100 kn). */
let liftKn: number | null = null;
/** Chain pretension at rest that defines the anchor slider's balanced snap point, N. */
const SNAP_PRETENSION = 1000;
/** Anchor → quay distance giving SNAP_PRETENSION at rest (slider snap point). */
let snapD: number | null = null;
/** Exact balanced distance and the rest pretension at the whole-metre snap point. */
let snapExact: number | null = null;
let snapH = 0;
/** Wind-speed sweep of peak loads (waves / fishtail), computed in the background at 5 kn steps. */
let peakPoints: Array<{ windKn: number; chain: number; anchor: number; holding: number; lines: number[] }> = [];
let peakToken = 0;
/** True when `result` includes the (slower) wave and fishtail analysis. */
let resultIsFull = true;
let anim: {
  sim: MooringAnimation;
  frame: AnimFrame | null;
  series: Array<{ t: number; wind: number; chain: number; anchor: number; lines: number[]; anchorRatio: number; yaw: number; wave: number }>;
  raf: number;
  last: number;
  done: boolean;
  planView: ViewBox;
  sideXMax: number;
  peakRef: number;
} | null = null;
let planFrozen: ViewBox | undefined;
let sideFrozen: ViewBox | undefined;

/** Value keys that switch their "auto" flag off when edited by hand. */
const AUTO_OF: Partial<Record<Key, Key>> = {
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
const DIM_KEYS: Key[] = ['loa', 'beam', 'freeboard', 'mastHeight', 'boatType'];

function update(patch: Partial<AppState>): void {
  // A running animation uses the inputs it started with; view-only changes don't stop it.
  if (anim && !anim.done && Object.keys(patch).some((k) => !['units', 'animSpeed', 'planZoom', 'exaggeration', 'vExag', 'viewCase', 'sweepMode', 'sweepGust'].includes(k))) stopAnimation();
  let next = { ...state, ...patch };
  if ('boatType' in patch && patch.boatType !== state.boatType) next = { ...next, ...boatDefaults(next.boatType, next.loa) };
  if (DIM_KEYS.some((k) => k in patch) && !next.windageItemsEdited) {
    const enabled = new Map(state.windageItems.map((i) => [i.id, i.enabled]));
    next.windageItems = estimateWindageItems({ type: next.boatType, loa: next.loa, beam: next.beam, freeboard: next.freeboard, mastHeight: next.mastHeight }).map(
      (i) => ({ ...i, enabled: enabled.get(i.id) ?? i.enabled }),
    );
  }
  state = resolve(next);
  saveState(state);
  schedule();
}

// ───────────────────────────── Compute + render ─────────────────────────────

let pending = false;
let frame = 0;
let fallback: number | undefined;
let sweepTimer: number | undefined;
function schedule(): void {
  if (!pending) {
    pending = true;
    // rAF coalesces slider drags; the timer covers background tabs where rAF is paused.
    const run = (): void => {
      if (!pending) return;
      pending = false;
      cancelAnimationFrame(frame);
      window.clearTimeout(fallback);
      compute(false);
      render();
    };
    frame = requestAnimationFrame(run);
    fallback = window.setTimeout(run, 80);
  }
  window.clearTimeout(sweepTimer);
  sweepTimer = window.setTimeout(() => {
    if (!resultIsFull) {
      compute(true);
      render();
    }
    computeSweep();
    renderSweepChart();
    computeDerived();
    paintSliders();
    startPeakSweep();
  }, 150);
}

/** full = include waves and fishtail (slower); otherwise only when the scenario has none. */
function compute(full: boolean): void {
  try {
    const inp = toScenario(state);
    const quick = !full && hasDynamics(inp);
    result = runScenario(inp, !quick);
    resultIsFull = !quick;
    error = null;
  } catch (e) {
    result = null;
    error = e instanceof Error ? e.message : String(e);
  }
}

/** Slower derived values (bisections), refreshed after input settles. */
function computeDerived(): void {
  if (!result) {
    liftKn = null;
    snapD = null;
    return;
  }
  const inp = toScenario(state);
  try {
    liftKn = liftOffWind(inp);
  } catch {
    liftKn = null;
  }
  try {
    const d = state.lineCount === 0 ? null : anchorDistanceForPretension(inp, SNAP_PRETENSION);
    snapExact = d;
    snapD = d === null ? null : Math.round(d);
    snapH = snapD === null ? 0 : solveRest(buildModel({ ...inp, anchor: { ...inp.anchor, distance: snapD } })).rode.h;
  } catch {
    snapD = null;
  }
}

function computeSweep(): void {
  if (!result) {
    points = [];
    return;
  }
  const speeds = Array.from({ length: 51 }, (_, i) => 10 + i);
  points = sweep(toScenario(state), speeds, state.sweepGust ? state.gustFactor : 1);
}

/** Peak loads vs wind speed, a few points per timeout so the page stays responsive. */
function startPeakSweep(): void {
  const token = ++peakToken;
  peakPoints = [];
  const inp = toScenario(state);
  if (!result || !hasDynamics(inp)) return;
  const speeds = Array.from({ length: 11 }, (_, i) => 10 + 5 * i);
  const factor = state.sweepGust ? state.gustFactor : 1;
  const acc: typeof peakPoints = [];
  const next = (i: number): void => {
    if (token !== peakToken) return;
    if (i >= speeds.length) {
      peakPoints = acc;
      renderSweepChart();
      return;
    }
    try {
      const p = sweep(inp, [speeds[i]], factor, true)[0];
      acc.push({ windKn: speeds[i], chain: p.chainPeak, anchor: p.anchorPeak, holding: p.holdingPeak, lines: p.linesPeak });
    } catch {
      acc.push({ windKn: speeds[i], chain: NaN, anchor: NaN, holding: NaN, lines: [] });
    }
    window.setTimeout(() => next(i + 1), 0);
  };
  window.setTimeout(() => next(0), 30);
}

const $ = <T extends Element = HTMLElement>(sel: string): T => document.querySelector<T>(sel)!;

function gustIndex(sim: MooringAnimation, t: number): number {
  return sim.events.filter((e) => e.start <= t).length;
}

function shownEq(r: ScenarioResult): { eq: Equilibrium; label: string; frame?: AnimFrame } {
  if (anim?.frame) {
    const f = anim.frame;
    const eq: Equilibrium = { ...f.base, pose: f.pose, rode: f.rode, lines: f.lines, chainForce: f.chainForce };
    const parts = [`Gust ${Math.max(1, gustIndex(anim.sim, f.t))}/${anim.sim.events.length}`, `${f.windKn.toFixed(0)} kn`];
    if (f.yawDeg) parts.push(`yaw ${f.yawDeg >= 0 ? '+' : ''}${f.yawDeg.toFixed(0)}°`);
    if (f.waveAmp) parts.push(`wave ${(2 * f.waveAmp).toFixed(1)} m`);
    return { eq, label: parts.join(' · '), frame: f };
  }
  if (state.viewCase === 'rest') return { eq: r.rest, label: 'At rest (no wind)' };
  if (state.viewCase === 'gust') return { eq: r.gust.eq, label: `Gust — ${r.gust.windKn.toFixed(0)} kn` };
  return { eq: r.sustained.eq, label: `Sustained — ${r.sustained.windKn.toFixed(0)} kn` };
}

function render(): void {
  syncControls(document, state);
  paintSliders();
  renderDial($('#dial'), state.windDir, state.windKn);
  renderWindageItems();
  const u = state.units as Units;

  const warn = $('#warnings');
  if (!result) {
    $('#status').innerHTML = '';
    warn.innerHTML = `<div class="alert alert-red"><strong>Cannot solve:</strong> ${esc(error ?? 'unknown error')}</div>`;
    return;
  }
  const r = result;
  const { eq, label, frame: af } = shownEq(r);

  // Status strip: sustained → gust for each element
  const chip = (name: string, a: { status: 'green' | 'amber' | 'red'; ratio: number }, b: { status: 'green' | 'amber' | 'red'; ratio: number }, cls: string): string =>
    `<div class="chip"><span class="key ${cls}" aria-hidden="true"></span><span class="chip-name">${name}</span>${badge(a.status, pct(a.ratio))}<span class="arrow" aria-label="then in gust">→</span>${badge(b.status, pct(b.ratio))}</div>`;
  // With waves / fishtailing the chips show the peaks.
  const A = r.sustained.peak;
  const B = r.gust.peak;
  const chips = [chip('Chain', A.chain, B.chain, 'k-chain')];
  if (A.snubber && B.snubber) chips.push(chip('Snubber', A.snubber, B.snubber, 'k-snub'));
  A.lines.forEach((l, i) => chips.push(chip(state.lineCount === 1 ? 'Line' : i === 0 ? 'Port line' : 'Stbd line', l, B.lines[i], `k-line${i + 1}`)));
  chips.push(chip('Anchor', A.anchor, B.anchor, 'k-anchor'));
  const dynNote = !resultIsFull
    ? ' · <em>adding waves / fishtail…</em>'
    : B.source !== 'static'
      ? ` · peaks include <strong>${esc(B.source)}</strong>`
      : '';
  $('#status').innerHTML = `<div class="chips">${chips.join('')}</div><div class="wind-sum">Wind <strong>${force(r.sustained.eq.wind.force, u)}</strong> → gust <strong>${force(r.gust.eq.wind.force, u)}</strong> · side shift <strong>${Math.abs(r.sustained.drift.dy).toFixed(1)} m</strong> → <strong>${Math.abs(r.gust.drift.dy).toFixed(1)} m</strong>${dynNote}</div>`;

  // Diagrams
  const forceRef = Math.max(
    r.gust.eq.wind.force,
    r.gust.eq.rode.h,
    ...r.gust.eq.lines.map((l) => Math.hypot(l.force[0], l.force[1])),
    anim && !anim.done ? anim.peakRef : 0,
    1,
  );
  const waveDraw =
    af && anim && r.model.waves && af.waveAmp > 0
      ? { lambda: anim.sim.wavelength, phase: af.wavePhase, amp: af.waveAmp, dir: windDirectionVector(state.windDir) as [number, number] }
      : undefined;
  renderPlan($<SVGSVGElement>('#plan'), { s: state, model: r.model, rest: r.rest, eq, forceRef, label, frozen: planFrozen ?? (anim && !anim.done ? anim.planView : undefined), waves: waveDraw });
  const xMax = Math.max(r.gust.eq.rode.x, r.rest.rode.x, eq.rode.x);
  let sideWave: { amp: number; k: number; cosGamma: number; phase: number; dz: number } | undefined;
  if (waveDraw && af) {
    const bow = toEarth(af.pose, [r.model.bowX, 0]);
    const c = [bow[0] - r.model.anchor[0], bow[1] - r.model.anchor[1]];
    const cl = Math.hypot(c[0], c[1]) || 1;
    sideWave = { amp: af.waveAmp, k: (2 * Math.PI) / waveDraw.lambda, cosGamma: (c[0] * waveDraw.dir[0] + c[1] * waveDraw.dir[1]) / cl, phase: af.wavePhase, dz: af.bowRise };
  }
  renderSide($<SVGSVGElement>('#side'), { s: state, rode: r.model.rode, rest: r.rest.rode, st: eq.rode, xMax: anim && !anim.done ? Math.max(xMax, anim.sideXMax) : xMax, frozen: sideFrozen, wave: sideWave });

  const st = eq.rode;
  $('#facts').innerHTML = [
    ['Bow tension', force(st.tensionTop, u)],
    ['At anchor', force(st.tensionAnchor, u)],
    ['Lifted', `${st.suspended.toFixed(1)} of ${state.chainLength} m`],
    ['Uplift at anchor', `${((st.angleAnchor * 180) / Math.PI).toFixed(1)}°`],
    ['Anchor pull', st.vAnchor > 0 ? '<strong class="warn-text">⚠ upward</strong>' : 'horizontal'],
  ]
    .map(([k, v]) => `<div><span>${k}</span><strong>${v}</strong></div>`)
    .join('');

  // Warnings
  const w = r.warnings.map((t) => `<li>${esc(t)}</li>`).join('');
  const peak = r.gust.eq.wind.force + 2 * (r.gust.eq.wind.force - r.sustained.eq.wind.force);
  warn.innerHTML = `
    ${w ? `<div class="alert alert-amber"><strong>Check the set-up</strong><ul>${w}</ul></div>` : ''}
    <div class="alert alert-info">
      ${r.gust.peak.source !== 'static'
        ? `<strong>⚠ Peaks include ${esc(r.gust.peak.source)}.</strong> They are quasi-static estimates plus a simplified surge simulation; real snatch loads scatter widely.`
        : '<strong>⚠ These are static loads.</strong> A gust or a wave snatch load can be several times the static load. Turn on <strong>waves</strong> and, when swinging, <strong>fishtailing</strong> to see them.'}
      A sudden gust on an elastic mooring can overshoot to about <strong>${force(peak, u)}</strong> of wind load (2 × the gust increment).
      A ${state.snatchSpeed} m/s surge stopped by the mooring adds about <strong>${force(r.gust.snatch.force, u)}</strong>.
      ${state.snubberOn ? 'Your snubber lowers the mooring stiffness and so the snatch load.' : 'A nylon <strong>snubber</strong>, or longer nylon stern lines, adds elasticity and cuts snatch loads sharply. Try one in the Snubber section.'}
    </div>`;

  $('#results').innerHTML = resultsTable(state, r);
}

function renderSweepChart(): void {
  const host = $('#sweep');
  if (!result || !points.length) {
    host.innerHTML = '';
    return;
  }
  const r = result;
  const effLine = state.lineMbl * 1000 * LINE_EFFICIENCY;
  const series = [
    { id: 'chain', name: 'Chain (bow)', cls: 's-chain', values: points.map((p) => p.chain), limit: () => state.chainMbl * 1000 },
    ...points[0].lines.map((_, i) => ({
      id: `line${i}`,
      name: state.lineCount === 1 ? 'Stern line' : i === 0 ? 'Port line' : 'Stbd line',
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
  // Peaks with waves / fishtail (computed every 5 kn, interpolated between), dashed.
  if (peakPoints.length > 1) {
    const at = (kn: number, get: (p: (typeof peakPoints)[number]) => number): number => {
      let j = 0;
      while (j < peakPoints.length - 2 && kn > peakPoints[j + 1].windKn) j++;
      const a = peakPoints[j];
      const b = peakPoints[j + 1];
      const f = Math.min(1, Math.max(0, (kn - a.windKn) / (b.windKn - a.windKn)));
      return get(a) + f * (get(b) - get(a));
    };
    series.push(
      { id: 'chainPeak', name: 'Chain peak', cls: 's-chain c-dash', values: points.map((p) => at(p.windKn, (q) => q.chain)), limit: () => state.chainMbl * 1000 },
      { id: 'anchorPeak', name: 'Anchor peak', cls: 's-anchor c-dash', values: points.map((p) => at(p.windKn, (q) => q.anchor)), limit: (i: number) => at(points[i].windKn, (q) => q.holding) },
    );
  }
  renderSweep(host, { s: state, points, series });
}

function renderWindageItems(): void {
  const t = $<HTMLTableElement>('#witems');
  if (document.activeElement && t.contains(document.activeElement)) return;
  t.innerHTML = `<thead><tr><th>On</th><th>Item</th><th>Side m²</th><th>Front m²</th><th>x m</th></tr></thead><tbody>${state.windageItems
    .map(
      (it, i) => `<tr${it.enabled ? '' : ' class="off"'}>
      <td><input type="checkbox" data-witem="${i}" data-wfield="enabled"${it.enabled ? ' checked' : ''} aria-label="Include ${esc(it.name)}"></td>
      <td>${esc(it.name)}</td>
      <td><input type="number" step="0.1" min="0" data-witem="${i}" data-wfield="side" value="${it.side}" aria-label="${esc(it.name)} side area"></td>
      <td><input type="number" step="0.1" min="0" data-witem="${i}" data-wfield="front" value="${it.front}" aria-label="${esc(it.name)} frontal area"></td>
      <td><input type="number" step="0.1" data-witem="${i}" data-wfield="x" value="${it.x}" aria-label="${esc(it.name)} position from midships"></td>
    </tr>`,
    )
    .join('')}</tbody>`;
}

// ───────────────────────────── Slider colours, snap, range ─────────────────────────────

/** Anchor → quay limits: from the anchor under the bow out to line + boat + chain pulled straight. */
function anchorRange(): [number, number] {
  const max = maxAnchorDistance(toScenario(state));
  return [Math.floor(max - state.chainLength), Math.floor(max)];
}
const snapTolerance = (): number => {
  const [lo, hi] = anchorRange();
  return Math.max(0.3, (hi - lo) * 0.025);
};

/** Position on a range track (CSS length) for a value, allowing for the 18 px thumb. */
const trackPos = (v: number, lo: number, hi: number): string =>
  `calc(9px + (100% - 18px) * ${Math.min(1, Math.max(0, (v - lo) / (hi - lo))).toFixed(4)})`;

function paintSliders(): void {
  const wind = document.querySelector<HTMLInputElement>('#play-wind')?.parentElement?.querySelector<HTMLInputElement>('input[type=range]');
  const chain = document.querySelector<HTMLInputElement>('#play-chain')?.parentElement?.querySelector<HTMLInputElement>('input[type=range]');
  const anchor = document.querySelector<HTMLInputElement>('#play-anchor')?.parentElement?.querySelector<HTMLInputElement>('input[type=range]');

  // Wind: green → amber (chain fully lifted in gusts) → red (fully lifted at the mean wind).
  if (wind) {
    const lo = Number(wind.min);
    const hi = Number(wind.max);
    const liftHint = $('#lift-hint');
    if (liftKn === null) {
      wind.style.setProperty('--track', 'var(--good)');
      wind.style.removeProperty('--thumb');
      liftHint.textContent = 'Chain stays on the seabed up to 100 kn.';
    } else {
      const gustLift = liftKn / state.gustFactor;
      const a = trackPos(gustLift, lo, hi);
      const b = trackPos(liftKn, lo, hi);
      wind.style.setProperty('--track', `linear-gradient(to right, var(--good) 0 ${a}, var(--warning) ${a} ${b}, var(--critical) ${b} 100%)`);
      const zone = state.windKn >= liftKn ? 'var(--critical)' : state.windKn >= gustLift ? 'var(--warning)' : 'var(--good)';
      wind.style.setProperty('--thumb', zone);
      liftHint.innerHTML =
        liftKn === 0
          ? '<strong>Chain is fully lifted even at rest.</strong>'
          : `Chain fully lifted from <strong>${liftKn.toFixed(1)} kn</strong> (in gusts from ${gustLift.toFixed(1)} kn).`;
    }
  }

  // Chain out: turns amber / red while the chain is fully lifted in the gust / at the mean wind.
  if (chain && result) {
    const sus = result.sustained.eq.rode.grounded <= 1e-9 && !result.sustained.eq.rode.slack;
    const gst = result.gust.eq.rode.grounded <= 1e-9 && !result.gust.eq.rode.slack;
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

  // Anchor → quay: range follows the rigging limits; a marker shows the balanced distance it snaps to.
  const [lo, hi] = anchorRange();
  document.querySelectorAll<HTMLInputElement>('[data-key=anchorDistance]').forEach((el) => {
    el.max = String(hi);
    if (el.type === 'range') el.min = String(lo);
  });
  if (anchor) {
    if (snapD !== null) {
      const p = trackPos(snapD, lo, hi);
      anchor.style.setProperty('--track', `linear-gradient(to right, var(--track-bg) 0 calc(${p} - 1.5px), var(--ink) calc(${p} - 1.5px) calc(${p} + 1.5px), var(--track-bg) calc(${p} + 1.5px) 100%)`);
      anchor.style.setProperty('--thumb', Math.abs(state.anchorDistance - snapD) < 0.05 ? 'var(--ink)' : 'var(--accent)');
      $('#snap-hint').innerHTML = `Snaps to <strong>${snapD} m</strong>: ${(snapH / 1000).toFixed(2)} kN pretension at rest (exactly ${SNAP_PRETENSION / 1000} kN at ${snapExact?.toFixed(1)} m). Max ${hi} m (all pulled straight).`;
    } else {
      anchor.style.removeProperty('--track');
      anchor.style.removeProperty('--thumb');
      $('#snap-hint').textContent =
        state.lineCount === 0
          ? `No stern lines: the boat swings on its anchor, so there is no balanced point. Max ${hi} m.`
          : `No balanced point inside the range. Max ${hi} m.`;
    }
  }
}

// ───────────────────────────── Events ─────────────────────────────

document.addEventListener('input', (ev) => {
  const el = ev.target as HTMLInputElement | HTMLSelectElement;
  if (el.dataset.witem !== undefined) {
    const i = Number(el.dataset.witem);
    const f = el.dataset.wfield as 'enabled' | 'side' | 'front' | 'x';
    const items = state.windageItems.map((it) => ({ ...it }));
    if (f === 'enabled') items[i].enabled = (el as HTMLInputElement).checked;
    else {
      const v = parseFloat(el.value);
      if (!Number.isFinite(v)) return;
      items[i][f] = v;
    }
    update({ windageItems: items, windageItemsEdited: f === 'enabled' ? state.windageItemsEdited : true, windageAuto: true });
    return;
  }
  const key = el.dataset.key as Key | undefined;
  if (!key) return;
  let v = readControl(el);
  if (v === undefined) return;
  // The anchor slider snaps to the balanced (1 kN pretension) distance when close to it.
  if (key === 'anchorDistance' && el.type === 'range' && snapD !== null && Math.abs((v as number) - snapD) <= snapTolerance()) v = snapD;
  const patch: Partial<AppState> = { [key]: v } as Partial<AppState>;
  const autoKey = AUTO_OF[key];
  if (autoKey) (patch as Record<string, unknown>)[autoKey] = false;
  update(patch);
});

document.addEventListener('click', (ev) => {
  const t = ev.target as HTMLElement;
  const seg = t.closest<HTMLButtonElement>('[data-seg]');
  if (seg) {
    const key = seg.dataset.seg as Key;
    const raw = seg.dataset.value!;
    const v = seg.dataset.type === 'number' ? Number(raw) : raw === 'true' ? true : raw === 'false' ? false : raw;
    update({ [key]: v } as Partial<AppState>);
    if (key === 'sweepGust' || key === 'sweepMode' || key === 'units') {
      if (key === 'sweepGust') computeSweep();
      renderSweepChart();
    }
    return;
  }
  const auto = t.closest<HTMLButtonElement>('[data-auto]');
  if (auto) {
    const k = auto.dataset.auto as Key;
    update({ [k]: !state[k] } as Partial<AppState>);
    return;
  }
  if (t.closest('#btn-example')) {
    state = workedExampleState(state);
    saveState(state);
    schedule();
    toast('Loaded the worked example (see the bottom of the page)');
  } else if (t.closest('#btn-reset')) {
    if (!confirm('Reset all inputs to the defaults?')) return;
    clearSaved();
    state = resolve({ ...DEFAULT_STATE, units: state.units });
    saveState(state);
    schedule();
  } else if (t.closest('#btn-reestimate')) {
    update({
      windageItemsEdited: false,
      windageAuto: true,
      windageItems: estimateWindageItems({ type: state.boatType, loa: state.loa, beam: state.beam, freeboard: state.freeboard, mastHeight: state.mastHeight }),
    });
  } else if (t.closest('#btn-animate')) {
    if (anim && !anim.done) stopAnimation();
    else startAnimation();
  }
});

let toastTimer: number | undefined;
function toast(msg: string): void {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), 3200);
}

// Wind dial
const dial = $('#dial');
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
  update({ windDir: (state.windDir + d + 360) % 360 });
});

// Drag the anchor (plan) and the water level (side view)
let dragging: 'anchor' | 'depth' | null = null;
let dragStart = { y: 0, depth: 0 };
const plan = $<SVGSVGElement>('#plan');
const currentView = (svg: SVGSVGElement): ViewBox => {
  const b = svg.viewBox.baseVal;
  return { x: b.x, y: b.y, w: b.width, h: b.height };
};
const side = $<SVGSVGElement>('#side');

plan.addEventListener('pointerdown', (ev) => {
  if (!(ev.target as Element).closest('.drag-anchor')) return;
  dragging = 'anchor';
  planFrozen = currentView(plan);
  plan.setPointerCapture(ev.pointerId);
  ev.preventDefault();
});
plan.addEventListener('pointermove', (ev) => {
  if (dragging !== 'anchor') return;
  const [x, y] = toUser(plan, ev);
  const [minD, maxD] = anchorRange();
  update({ anchorDistance: Math.min(maxD, Math.max(minD, Math.round(x))), anchorOffset: round(-y * 2, 0) / 2 });
});
const endDrag = (): void => {
  if (!dragging) return;
  dragging = null;
  planFrozen = undefined;
  sideFrozen = undefined;
  schedule();
};
plan.addEventListener('pointerup', endDrag);
plan.addEventListener('pointercancel', endDrag);
plan.addEventListener('keydown', (ev) => {
  if (!(ev.target as Element).closest('.drag-anchor')) return;
  const step = 0.5;
  const map: Record<string, [number, number]> = { ArrowRight: [step, 0], ArrowLeft: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
  const d = map[ev.key];
  if (!d) return;
  ev.preventDefault();
  update({ anchorDistance: Math.round(state.anchorDistance + d[0] * 2), anchorOffset: state.anchorOffset + d[1] });
});

side.addEventListener('pointerdown', (ev) => {
  if (!(ev.target as Element).closest('.drag-depth')) return;
  dragging = 'depth';
  sideFrozen = currentView(side);
  dragStart = { y: toUser(side, ev)[1], depth: state.depth };
  side.setPointerCapture(ev.pointerId);
  ev.preventDefault();
});
side.addEventListener('pointermove', (ev) => {
  if (dragging !== 'depth') return;
  const y = toUser(side, ev)[1];
  const maxDepth = state.chainLength - state.rollerHeight - 0.5;
  update({ depth: Math.min(maxDepth, Math.max(0.5, round(dragStart.depth - (y - dragStart.y) / state.vExag, 1))) });
});
side.addEventListener('pointerup', endDrag);
side.addEventListener('pointercancel', endDrag);
side.addEventListener('keydown', (ev) => {
  if (!(ev.target as Element).closest('.drag-depth')) return;
  const d = ev.key === 'ArrowUp' ? 0.1 : ev.key === 'ArrowDown' ? -0.1 : 0;
  if (!d) return;
  ev.preventDefault();
  update({ depth: Math.max(0.5, round(state.depth + d, 1)) });
});

// ───────────────────────────── Gust animation ─────────────────────────────
// 10 gusts with waves and fishtailing, simulated step by step (see physics/animation.ts).

function startAnimation(): void {
  stopAnimation();
  if (!result) return;
  const r = result;
  const inp = toScenario(state);
  let sim: MooringAnimation;
  try {
    sim = new MooringAnimation(inp, 10);
  } catch {
    return;
  }
  // Freeze the plan view around the gust case (and the fishtail extreme) so it does not jump every frame.
  const svg = $<SVGSVGElement>('#plan');
  const views = [r.gust.eq, ...(r.gust.fishtail ? [r.gust.fishtail.eq] : [])].map((eq) => {
    renderPlan(svg, { s: state, model: r.model, rest: r.rest, eq, forceRef: Math.max(1, r.gust.peak.chain.tension), label: '' });
    const b = svg.viewBox.baseVal;
    return { x0: b.x, y0: b.y, x1: b.x + b.width, y1: b.y + b.height };
  });
  const box = views.reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }));
  const pad = r.gust.fishtail ? 0.3 : 0.12;
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  anim = {
    sim,
    frame: null,
    series: [],
    raf: 0,
    last: performance.now(),
    done: false,
    planView: { x: box.x0 - w * pad, y: box.y0 - h * pad, w: w * (1 + 2 * pad), h: h * (1 + 2 * pad) },
    sideXMax: Math.max(r.gust.eq.rode.x, r.gust.fishtail?.eq.rode.x ?? 0) + 1.5,
    peakRef: Math.max(r.gust.peak.chain.tension, r.gust.chain.tension),
  };
  $('#anim-card').hidden = false;
  $('#btn-animate').textContent = '■ Stop';
  queueTick();
}

function queueTick(): void {
  if (!anim || anim.done) return;
  let fired = false;
  const go = (): void => {
    if (fired) return;
    fired = true;
    cancelAnimationFrame(anim?.raf ?? 0);
    tick();
  };
  anim.raf = requestAnimationFrame(go);
  window.setTimeout(go, 60); // background tabs pause rAF
}

function tick(): void {
  if (!anim || anim.done) return;
  const now = performance.now();
  const dtReal = Math.min(0.5, Math.max(1 / 240, (now - anim.last) / 1000)); // hidden tabs tick ~1 Hz
  anim.last = now;
  const f = anim.sim.step(dtReal * state.animSpeed);
  anim.frame = f;
  const m = f.stepMax; // peaks since the last frame, so spikes between frames are not missed
  anim.series.push({ t: f.t, wind: f.windKn, chain: m.chain, anchor: m.anchor, lines: m.lines, anchorRatio: m.anchorRatio, yaw: m.yawDeg, wave: m.waveHeight });
  render();
  renderAnimChart();
  if (anim.sim.time >= anim.sim.duration) {
    anim.done = true;
    anim.frame = null;
    $('#btn-animate').textContent = '▶ Animate 10 gusts';
    render();
    renderAnimChart();
    return;
  }
  queueTick();
}

/** Stop a running animation; its chart stays on screen. */
function stopAnimation(): void {
  if (!anim || anim.done) return;
  anim.done = true;
  anim.frame = null;
  cancelAnimationFrame(anim.raf);
  $('#btn-animate').textContent = '▶ Animate 10 gusts';
  render();
  renderAnimChart();
}

function renderAnimChart(): void {
  if (!anim) return;
  const { sim, series } = anim;
  const u = state.units as Units;
  const W = 640;
  const M = { l: 48, r: 14 };
  const X = (t: number): number => M.l + (t / sim.duration) * (W - M.l - M.r);
  const conv = (n: number): number => (u === 'kgf' ? n / KGF : n / 1000);
  const chainMbl = state.chainMbl * 1000;
  const nice = (v: number): number => {
    const e = 10 ** Math.floor(Math.log10(Math.max(v, 1e-9)));
    const b = v / e;
    return (b <= 1 ? 1 : b <= 2 ? 2 : b <= 2.5 ? 2.5 : b <= 5 ? 5 : 10) * e;
  };
  // Wind strip (top) and loads (bottom): two panels, each with its own axis.
  const wTop = 14;
  const wBot = 64;
  const windMax = nice(state.windKn * state.gustFactor * 1.1);
  const Yw = (kn: number): number => wBot - (kn / windMax) * (wBot - wTop);
  const lTop = 90;
  const lBot = 236;
  const maxLoad = Math.max(1, anim.peakRef, ...series.map((p) => Math.max(p.chain, p.anchor, ...p.lines)));
  const loadMax = nice(conv(maxLoad) * 1.08);
  const Yl = (n: number): number => lBot - (conv(n) / loadMax) * (lBot - lTop);
  const g: string[] = [];
  for (let i = 0; i <= 2; i++) {
    const v = (windMax * i) / 2;
    g.push(`<line class="c-grid" x1="${M.l}" x2="${W - M.r}" y1="${Yw(v)}" y2="${Yw(v)}"/><text class="c-tick" x="${M.l - 6}" y="${Yw(v) + 4}" text-anchor="end">${v.toFixed(0)}</text>`);
  }
  g.push(`<text class="c-axis-title" x="${M.l}" y="${wTop - 4}">Wind, kn</text>`);
  for (let i = 0; i <= 4; i++) {
    const v = (loadMax * i) / 4;
    const y = lBot - (v / loadMax) * (lBot - lTop);
    g.push(`<line class="c-grid" x1="${M.l}" x2="${W - M.r}" y1="${y}" y2="${y}"/><text class="c-tick" x="${M.l - 6}" y="${y + 4}" text-anchor="end">${v >= 100 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, '')}</text>`);
  }
  g.push(`<text class="c-axis-title" x="${M.l}" y="${lTop - 6}">Load, ${u}</text>`);
  for (const [frac, cls, lab] of [
    [0.3, 'c-thr-amber', 'chain 30% MBL'],
    [0.5, 'c-thr-red', 'chain 50% MBL'],
  ] as const) {
    if (conv(frac * chainMbl) > loadMax) continue;
    const y = Yl(frac * chainMbl);
    g.push(`<line class="c-thr ${cls}" x1="${M.l}" x2="${W - M.r}" y1="${y}" y2="${y}"/><text class="c-thr-lbl" x="${W - M.r - 4}" y="${y - 4}" text-anchor="end">${lab}</text>`);
  }
  for (const e of sim.events) {
    const x = X(e.start + e.rise + e.hold / 2);
    g.push(`<line class="c-gust" x1="${x}" x2="${x}" y1="${wTop}" y2="${lBot}"/>`);
  }
  const path = (get: (p: (typeof series)[number]) => number, Y: (v: number) => number): string =>
    series.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(get(p)).toFixed(1)}`).join('');
  if (series.length) {
    g.push(`<path class="c-line s-wind" d="${path((p) => p.wind, Yw)}"/>`);
    g.push(`<path class="c-line s-anchor" d="${path((p) => p.anchor, Yl)}"/>`);
    series[0].lines.forEach((_, i) => g.push(`<path class="c-line s-line${i + 1}" d="${path((p) => p.lines[i], Yl)}"/>`));
    g.push(`<path class="c-line s-chain" d="${path((p) => p.chain, Yl)}"/>`);
    const now = series[series.length - 1].t;
    if (!anim.done) g.push(`<line class="c-now" x1="${X(now)}" x2="${X(now)}" y1="${wTop}" y2="${lBot}"/>`);
  }
  g.push(`<line class="c-axis" x1="${M.l}" x2="${W - M.r}" y1="${lBot}" y2="${lBot}"/>`);
  for (let t = 0; t <= sim.duration; t += 30) g.push(`<text class="c-tick" x="${X(t)}" y="${lBot + 16}" text-anchor="middle">${t}</text>`);
  g.push(`<text class="c-axis-title" x="${W - M.r}" y="${lBot + 16}" text-anchor="end">s</text>`);
  $('#anim-chart').innerHTML = g.join('');

  const key = (cls: string, name: string): string =>
    `<span class="legend-item"><svg width="18" height="8" aria-hidden="true"><line class="c-line ${cls}" x1="1" x2="17" y1="4" y2="4"/></svg>${esc(name)}</span>`;
  const lineNames = state.lineCount === 0 ? [] : state.lineCount === 1 ? ['Stern line'] : ['Port line', 'Stbd line'];
  $('#anim-legend').innerHTML = [key('s-chain', 'Chain (bow)'), ...lineNames.map((n, i) => key(`s-line${i + 1}`, n)), key('s-anchor', 'Anchor load'), key('s-wind', 'Wind')].join('');

  const last = series[series.length - 1];
  const gi = last ? Math.min(sim.events.length, gustIndex(sim, last.t)) : 0;
  $('#anim-status').innerHTML = anim.done ? `<span class="badge-plain">Finished · ${sim.events.length} gusts</span>` : `<span class="badge-plain">Gust ${Math.max(1, gi)} / ${sim.events.length} · ${last ? last.t.toFixed(0) : 0} s · ×${state.animSpeed}</span>`;
  if (!series.length) return;
  const maxOf = (get: (p: (typeof series)[number]) => number): (typeof series)[number] => series.reduce((a, b) => (get(b) > get(a) ? b : a));
  const pc = maxOf((p) => p.chain);
  const pa = maxOf((p) => p.anchorRatio);
  const chainRatio = pc.chain / chainMbl;
  const effLine = state.lineMbl * 1000 * LINE_EFFICIENCY;
  const facts: Array<[string, string]> = [
    ['Max chain', `${force(pc.chain, u)} ${badge(loadStatus(chainRatio), pct(chainRatio))}`],
    ['Max anchor / holding', `${force(pa.anchor, u)} ${badge(holdingStatus(pa.anchorRatio), pct(pa.anchorRatio))}`],
  ];
  lineNames.forEach((n, i) => {
    const p = maxOf((q) => q.lines[i]);
    facts.push([`Max ${n.toLowerCase()}`, `${force(p.lines[i], u)} ${badge(loadStatus(p.lines[i] / effLine), pct(p.lines[i] / effLine))}`]);
  });
  facts.push(['Max wind', `${Math.max(...series.map((p) => p.wind)).toFixed(0)} kn`]);
  if (series.some((p) => p.wave > 0)) facts.push(['Largest wave', `${Math.max(...series.map((p) => p.wave)).toFixed(2)} m`]);
  if (series.some((p) => p.yaw !== 0)) facts.push(['Fishtail', `±${Math.max(...series.map((p) => Math.abs(p.yaw))).toFixed(0)}°`]);
  $('#anim-facts').innerHTML = facts.map(([k, v]) => `<div><span>${k}</span><strong>${v}</strong></div>`).join('');
}

window.addEventListener('resize', () => schedule());

compute(true);
render();
computeSweep();
renderSweepChart();
computeDerived();
paintSliders();
startPeakSweep();
