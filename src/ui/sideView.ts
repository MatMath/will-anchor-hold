import { rodeProfile, type Rode, type RodeState } from '../physics';
import { force, type Units } from './format';
import { arrow, aspectOf, fitView, pathOf, text, unitsPerPx, vbAttr, type ViewBox } from './svg';
import type { AppState } from './state';

/**
 * Side view of the rode in its vertical plane: anchor at the left on the seabed, bow roller on the right.
 * SVG x = horizontal distance from the anchor (m); SVG y = −height above the seabed × vertical exaggeration.
 */

export interface SideInput {
  s: AppState;
  rode: Rode;
  rest: RodeState;
  st: RodeState;
  /** Largest anchor–roller distance across the cases, so the scale doesn't jump. */
  xMax: number;
  frozen?: ViewBox;
  /** Animated wave along this view: amplitude, wave number, cos(angle between rode and waves), phase ωt, bow rise (m). */
  wave?: { amp: number; k: number; cosGamma: number; phase: number; dz: number };
}

type Pt = [number, number];

/** What the layers need: input, scales and the rode profiles. */
interface SideScene {
  p: SideInput;
  /** Vertical exaggeration, water depth, seabed → roller height. */
  V: number;
  depth: number;
  Z: number;
  /** (x, height) → SVG coordinates. */
  tr: (pts: Pt[]) => Pt[];
  vb: ViewBox;
  k: number;
  fs: number;
  units: Units;
  /** Rode profile now; the bow rise from the wave (m). */
  prof: { chain: Pt[]; snubber: Pt[] };
  dz: number;
}

type Layer = (sc: SideScene) => string[];

/** Drawing order, back to front. */
const LAYERS: Layer[] = [waterAndSeabedLayer, depthDimensionLayer, boatLayer, rodeLayer, anchorLayer, annotationLayer, depthHandleLayer, scaleNoteLayer];

export function renderSide(svg: SVGSVGElement, p: SideInput): ViewBox {
  const sc = sideScene(svg, p);
  svg.setAttribute('viewBox', vbAttr(sc.vb));
  svg.innerHTML = LAYERS.flatMap((layer) => layer(sc)).join('');
  return sc.vb;
}

function sideScene(svg: SVGSVGElement, p: SideInput): SideScene {
  const { s, rode } = p;
  const V = s.vExag;
  const Z = rode.z;
  const xRight = p.xMax + Math.min(s.loa * 0.55, 8);
  const aspect = aspectOf(svg, 2.6);
  let vb = p.frozen ?? fitView(-3, -(Z + 3.2) * V, xRight, 1.6 * V, aspect, 0.03);
  // Leave room under the seabed for its labels (about 30 px), whatever the scale.
  if (!p.frozen) vb = fitView(-3, -(Z + 3.2) * V, xRight, Math.max(1.6 * V, 30 * unitsPerPx(svg, vb)), aspect, 0.03);
  const k = unitsPerPx(svg, vb);
  return {
    p,
    V,
    depth: s.depth,
    Z,
    tr: (pts) => pts.map(([x, z]) => [x, -z * V]),
    vb,
    k,
    fs: 12 * k,
    units: s.units as Units,
    prof: rodeProfile(rode, p.st),
    dz: p.wave?.dz ?? 0,
  };
}

/** Sky, water (wavy while animating: η(x) = a·cos(k·cosγ·(x − x_bow) − ωt), so the bow sees a·cos(ωt)) and seabed. */
function waterAndSeabedLayer({ p, vb, V, depth }: SideScene): string[] {
  const out = [`<rect class="s-sky" x="${vb.x}" y="${vb.y}" width="${vb.w}" height="${-depth * V - vb.y}"/>`];
  if (p.wave) {
    const { amp, k: kw, cosGamma, phase } = p.wave;
    const pts: Pt[] = [];
    for (let i = 0; i <= 160; i++) {
      const x = vb.x + (vb.w * i) / 160;
      pts.push([x, -(depth + amp * Math.cos(kw * cosGamma * (x - p.st.x) - phase)) * V]);
    }
    out.push(`<path class="s-water" d="${pathOf([...pts, [vb.x + vb.w, 0], [vb.x, 0]], true)}"/>`);
  } else out.push(`<rect class="s-water" x="${vb.x}" y="${-depth * V}" width="${vb.w}" height="${depth * V}"/>`);
  out.push(`<rect class="s-bed" x="${vb.x}" y="0" width="${vb.w}" height="${vb.y + vb.h}"/>`);
  if (!p.wave) out.push(`<line class="s-surface" x1="${vb.x}" y1="${-depth * V}" x2="${vb.x + vb.w}" y2="${-depth * V}" vector-effect="non-scaling-stroke"/>`);
  out.push(`<line class="s-bedline" x1="${vb.x}" y1="0" x2="${vb.x + vb.w}" y2="0" vector-effect="non-scaling-stroke"/>`);
  return out;
}

function depthDimensionLayer({ V, depth, k, fs }: SideScene): string[] {
  const dx = -1.6;
  return [
    arrow(dx, -depth * V * 0.5, dx, -depth * V, 7 * k, 's-dim'),
    arrow(dx, -depth * V * 0.5, dx, 0, 7 * k, 's-dim'),
    text(dx + 5 * k, -depth * V * 0.5 + fs * 0.35, fs, `${depth.toFixed(1)} m`, 'lbl lbl-strong', 'start'),
  ];
}

/** Simple boat profile, bow at the roller, extending away from the anchor; it rides the wave at the bow. */
function boatLayer({ p, tr, vb, V, depth, dz }: SideScene): string[] {
  const { s } = p;
  const bx = p.st.x;
  const L = s.loa;
  const fb = s.freeboard;
  const wl = depth + dz;
  const draft = s.boatType === 'catamaran' ? 1.2 : Math.max(1.4, 0.15 * L);
  const hull: Pt[] =
    s.boatType === 'catamaran'
      ? [[bx + s.rollerOverhang, wl + fb], [bx + L + s.rollerOverhang, wl + fb * 0.95], [bx + L + s.rollerOverhang, wl - 0.3], [bx + 0.15 * L, wl - 0.6], [bx + s.rollerOverhang + 0.4, wl - 0.2]]
      : [[bx + s.rollerOverhang, wl + fb], [bx + L + s.rollerOverhang, wl + fb * 0.8], [bx + L * 0.97, wl - 0.3], [bx + 0.25 * L, wl - 0.5], [bx + s.rollerOverhang + 0.9, wl - 0.1]];
  const out = [`<path class="s-hull" d="${pathOf(tr(hull), true)}" vector-effect="non-scaling-stroke"/>`];
  if (s.boatType === 'monohull')
    out.push(`<path class="s-hull" d="${pathOf(tr([[bx + 0.4 * L, wl - 0.45], [bx + 0.5 * L, wl - draft], [bx + 0.58 * L, wl - draft], [bx + 0.55 * L, wl - 0.45]]), true)}" vector-effect="non-scaling-stroke"/>`);
  out.push(`<path class="s-cabin" d="${pathOf(tr([[bx + 0.3 * L, wl + fb], [bx + 0.36 * L, wl + fb + 0.6], [bx + 0.72 * L, wl + fb + 0.6], [bx + 0.72 * L, wl + fb]]), true)}" vector-effect="non-scaling-stroke"/>`);
  out.push(`<line class="s-mast" x1="${bx + 0.4 * L}" y1="${-(wl + fb) * V}" x2="${bx + 0.4 * L}" y2="${vb.y}" vector-effect="non-scaling-stroke"/>`);
  return out;
}

/** Rode at rest (dashed), the rode now (seabed part darker), snubber and roller. */
function rodeLayer({ p, tr, prof, V, Z, k, dz }: SideScene): string[] {
  const { st } = p;
  const out = [`<path class="s-chain-ghost" d="${pathOf(tr(rodeProfile(p.rode, p.rest).chain))}" vector-effect="non-scaling-stroke"/>`];
  const ground = prof.chain.filter(([, z]) => z <= 1e-9);
  out.push(`<path class="s-chain" d="${pathOf(tr(prof.chain))}" vector-effect="non-scaling-stroke"/>`);
  if (ground.length > 1 && !st.slack) out.push(`<path class="s-chain-ground" d="${pathOf(tr([ground[0], ground[ground.length - 1]]))}" vector-effect="non-scaling-stroke"/>`);
  if (prof.snubber.length) {
    out.push(`<path class="s-snubber" d="${pathOf(tr(prof.snubber))}" vector-effect="non-scaling-stroke"/>`);
    const [hx, hz] = prof.snubber[0];
    out.push(`<circle class="s-hook" cx="${hx}" cy="${-hz * V}" r="${3.5 * k}" vector-effect="non-scaling-stroke"/>`);
  }
  out.push(`<circle class="s-roller" cx="${st.x}" cy="${-(Z + dz) * V}" r="${4 * k}" vector-effect="non-scaling-stroke"/>`);
  return out;
}

function anchorLayer({ k }: SideScene): string[] {
  const r = 7 * k;
  return [`<path class="s-anchor" d="M0,${-r * 1.3}V0M${-r},${-r * 0.4}Q${-r * 0.8},${r * 0.3} 0,${r * 0.2}Q${r * 0.8},${r * 0.3} ${r},${-r * 0.4}" vector-effect="non-scaling-stroke"/>`];
}

/** Touchdown or uplift at the anchor, lifted length, bow tension and angle. */
function annotationLayer({ p, prof, vb, V, Z, k, fs, units }: SideScene): string[] {
  const { st } = p;
  if (st.slack) return [text(st.x / 2, -14 * k, fs, 'Chain slack — no horizontal pull', 'lbl lbl-strong', 'middle')];
  const out: string[] = [];
  if (st.grounded > 0.01) {
    const tx = st.touchdownX;
    out.push(`<line class="s-td" x1="${tx}" y1="${4 * k}" x2="${tx}" y2="${-18 * k}" vector-effect="non-scaling-stroke"/>`);
    out.push(text(Math.max(tx, vb.x + 90 * k), 18 * k, fs, `touchdown ${tx.toFixed(1)} m from anchor`, 'lbl lbl-bed', 'middle'));
    out.push(text(tx / 2, -6 * k, fs * 0.9, `${st.grounded.toFixed(1)} m on seabed`, 'lbl lbl-muted', 'middle'));
  } else {
    const deg = (st.angleAnchor * 180) / Math.PI;
    const ar = 26 * k;
    const a = st.angleAnchor;
    out.push(`<path class="s-uplift" d="M${ar},0A${ar},${ar} 0 0 0 ${ar * Math.cos(a)},${-ar * Math.sin(a) * V}" vector-effect="non-scaling-stroke"/>`);
    out.push(text(4 * k, 18 * k, fs, `⚠ ${deg.toFixed(1)}° uplift at anchor — all chain lifted`, 'lbl lbl-warn lbl-bed', 'start'));
  }
  // Lifted length label near the middle of the suspended part
  const mid = prof.chain[Math.floor(prof.chain.length * 0.55)];
  out.push(text(mid[0] + 6 * k, -mid[1] * V + 16 * k, fs, `${st.suspended.toFixed(1)} m lifted`, 'lbl lbl-strong', 'start'));
  const tdeg = (st.angleTop * 180) / Math.PI;
  out.push(text(st.x - 8 * k, -Z * V - 10 * k, fs, `${force(st.tensionTop, units)} · ${tdeg.toFixed(0)}° down`, 'lbl', 'end'));
  return out;
}

/** Draggable handle on the water surface: drag up for deeper water. */
function depthHandleLayer({ vb, V, depth, k, fs }: SideScene): string[] {
  const hx = vb.x + vb.w * 0.3;
  const hy = -depth * V;
  return [
    `<g class="drag-depth" tabindex="0" role="slider" aria-label="Water depth, metres" aria-valuenow="${depth}"><rect class="hit" x="${hx - 34 * k}" y="${hy - 16 * k}" width="${68 * k}" height="${32 * k}"/><rect class="handle" x="${hx - 28 * k}" y="${hy - 10 * k}" width="${56 * k}" height="${20 * k}" rx="${10 * k}" vector-effect="non-scaling-stroke"/>${text(hx, hy + 4 * k, fs * 0.85, '⇕ depth', 'lbl lbl-handle', 'middle')}</g>`,
  ];
}

function scaleNoteLayer({ vb, V, k, fs }: SideScene): string[] {
  return [text(vb.x + 8 * k, vb.y + 16 * k, fs * 0.9, `Vertical scale ×${V}`, 'lbl lbl-muted', 'start')];
}
