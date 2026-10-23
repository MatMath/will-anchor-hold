import workedExampleMd from '../../docs/worked-example.md?raw';
import { ANCHOR_TYPES, BOTTOMS, CHAIN_GRADES, ROPES } from '../physics';
import { check, num, segmented, select } from '../ui/controls';
import { markdown } from '../ui/markdown';

/**
 * Page structure. Each block is a small function returning its markup; controls are bound to state
 * keys through data-key attributes (see ui/controls.ts), so adding an input is one line in a section.
 */

const ropeOpts = Object.entries(ROPES).map(([k, v]) => [k, v.name] as const);
const diaOpts = (ds: number[]): Array<readonly [number, string]> => ds.map((d) => [d, `${d} mm`] as const);

/** Title bar with units and actions, and the sticky status strip. */
const headerHtml = (): string => `
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

<div class="status-strip" id="status" aria-live="polite"></div>`;

/** Quick controls: wind dial and speed, main sliders, waves / fishtail switches, animation. */
const playPanelHtml = (): string => `
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
`;

/** Top-down view of the mooring. */
const planCardHtml = (): string => `
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
`;

/** Side view of the chain catenary, with key facts. */
const sideCardHtml = (): string => `
    <div class="card">
      <div class="card-head">
        <h2>Chain — side view</h2>
        <div class="tools">${segmented('vExag', 'Vertical exaggeration', [[1, 'True scale'], [2, 'Height ×2'], [4, '×4']])}</div>
      </div>
      <svg id="side" class="side" role="img" aria-label="Side view of the chain catenary"></svg>
      <div class="facts" id="facts"></div>
    </div>
`;

/** Live loads during the gust animation (hidden until played). */
const animCardHtml = (): string => `
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
`;

/** Results table. */
const resultsCardHtml = (): string => `
    <div class="card">
      <div class="card-head"><h2>Results</h2></div>
      <div class="table-scroll" id="results"></div>
    </div>
`;

/** Loads vs wind speed chart. */
const sweepCardHtml = (): string => `
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
    </div>`;

/** Inputs — Boat. */
const boatSection = (): string => `
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
    </details>`;

/** Inputs — Windage. */
const windageSection = (): string => `
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
    </details>`;

/** Inputs — Anchor & chain. */
const anchorChainSection = (): string => `
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
    </details>`;

/** Inputs — Snubber. */
const snubberSection = (): string => `
    <details class="card acc">
      <summary><h2>Snubber</h2></summary>
      ${check('snubberOn', 'Use a snubber (bridle) between bow and chain')}
      <div class="grid2" data-show-if="snubberOn">
        ${select('snubberType', 'Rope', ropeOpts)}
        ${select('snubberD', 'Diameter', diaOpts([10, 12, 14, 16, 18, 20, 22, 24]))}
        ${num('snubberLength', 'Length', 'm', { min: 0.5, max: 30, step: 0.5 })}
        ${num('snubberMbl', 'MBL', 'kN', { min: 1, max: 500, step: 0.1, auto: 'snubberMblAuto' })}
      </div>
    </details>`;

/** Inputs — Stern lines. */
const sternLinesSection = (): string => `
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
    </details>`;

/** Inputs — Waves & fishtailing. */
const wavesFishtailSection = (): string => `
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
    </details>`;

/** Inputs — Dynamic estimate. */
const dynamicEstimateSection = (): string => `
    <details class="card acc">
      <summary><h2>Dynamic estimate</h2></summary>
      ${num('snatchSpeed', 'Boat speed stopped by the mooring', 'm/s', { min: 0, max: 3, step: 0.1, hint: 'Used only for the indicative snatch-load figure: ΔF = v·√(m·k).' })}
    </details>`;

/** Inputs — Wind. */
const windSection = (): string => `
    <details class="card acc" open>
      <summary><h2>Wind</h2></summary>
      <div class="grid2">
        ${num('windKn', 'Mean wind speed', 'kn', { min: 0, max: 80, step: 1 })}
        ${num('windDir', 'Direction from, relative to bow', '°', { min: 0, max: 359, step: 1, hint: '90 = starboard beam, 270 = port beam, 0 = on the bow.' })}
        ${num('gustFactor', 'Gust factor (on speed)', '×', { min: 1, max: 2.5, step: 0.05, hint: 'Gust speed ÷ mean speed. Force grows with its square.' })}
      </div>
      <p class="hint">No current is applied, so the water gives no steady sideways resistance.</p>
    </details>`;

/** Assumptions, limits and the hand-checkable worked example. */
const notesHtml = (): string => `
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
</section>`;

/** Inputs column, one collapsible card per topic. */
const inputsHtml = (): string => [boatSection(), windageSection(), anchorChainSection(), snubberSection(), sternLinesSection(), wavesFishtailSection(), dynamicEstimateSection(), windSection()].join('\n');

/** Mount the whole page into the root element. */
export function renderLayout(root: HTMLElement): void {
  root.innerHTML = `
${headerHtml()}

<main class="layout">
  <section class="col-vis">
${playPanelHtml()}

${planCardHtml()}

${sideCardHtml()}

${animCardHtml()}

    <div id="warnings"></div>

${resultsCardHtml()}

${sweepCardHtml()}
  </section>

  <aside class="col-inputs" aria-label="Inputs">
${inputsHtml()}
  </aside>
</main>

${notesHtml()}
<div class="toast" id="toast" role="status" hidden></div>
`;
}
