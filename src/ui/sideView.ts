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

export function renderSide(svg: SVGSVGElement, p: SideInput): ViewBox {
  const { s, rode, st, rest } = p;
  const V = s.vExag;
  const depth = s.depth;
  const Z = rode.z;
  const tr = (pts: Array<[number, number]>): Array<[number, number]> => pts.map(([x, z]) => [x, -z * V]);

  const xRight = p.xMax + Math.min(s.loa * 0.55, 8);
  const aspect = aspectOf(svg, 2.6);
  let vb = p.frozen ?? fitView(-3, -(Z + 3.2) * V, xRight, 1.6 * V, aspect, 0.03);
  // Leave room under the seabed for its labels (about 30 px), whatever the scale.
  if (!p.frozen) vb = fitView(-3, -(Z + 3.2) * V, xRight, Math.max(1.6 * V, 30 * unitsPerPx(svg, vb)), aspect, 0.03);
  const k = unitsPerPx(svg, vb);
  const fs = 12 * k;
  const units = s.units as Units;
  const out: string[] = [];

  // Sky, water, seabed
  out.push(`<rect class="s-sky" x="${vb.x}" y="${vb.y}" width="${vb.w}" height="${-depth * V - vb.y}"/>`);
  if (p.wave) {
    // Water surface η(x) = a·cos(k·cosγ·(x − x_bow) − ωt), so the bow sees a·cos(ωt).
    const { amp, k: kw, cosGamma, phase } = p.wave;
    const pts: Array<[number, number]> = [];
    for (let i = 0; i <= 160; i++) {
      const x = vb.x + (vb.w * i) / 160;
      pts.push([x, -(depth + amp * Math.cos(kw * cosGamma * (x - st.x) - phase)) * V]);
    }
    out.push(`<path class="s-water" d="${pathOf([...pts, [vb.x + vb.w, 0], [vb.x, 0]], true)}"/>`);
  } else out.push(`<rect class="s-water" x="${vb.x}" y="${-depth * V}" width="${vb.w}" height="${depth * V}"/>`);
  out.push(`<rect class="s-bed" x="${vb.x}" y="0" width="${vb.w}" height="${vb.y + vb.h}"/>`);
  if (!p.wave) out.push(`<line class="s-surface" x1="${vb.x}" y1="${-depth * V}" x2="${vb.x + vb.w}" y2="${-depth * V}" vector-effect="non-scaling-stroke"/>`);
  out.push(`<line class="s-bedline" x1="${vb.x}" y1="0" x2="${vb.x + vb.w}" y2="0" vector-effect="non-scaling-stroke"/>`);

  // Depth dimension
  const dx = -1.6;
  out.push(arrow(dx, -depth * V * 0.5, dx, -depth * V, 7 * k, 's-dim'));
  out.push(arrow(dx, -depth * V * 0.5, dx, 0, 7 * k, 's-dim'));
  out.push(text(dx + 5 * k, -depth * V * 0.5 + fs * 0.35, fs, `${depth.toFixed(1)} m`, 'lbl lbl-strong', 'start'));

  // Boat (simple profile), bow at the roller, extending away from the anchor
  const bx = st.x;
  const L = s.loa;
  const fb = s.freeboard;
  const wl = depth + (p.wave?.dz ?? 0); // the hull rides the wave at the bow
  const draft = s.boatType === 'catamaran' ? 1.2 : Math.max(1.4, 0.15 * L);
  const hull: Array<[number, number]> =
    s.boatType === 'catamaran'
      ? [[bx + s.rollerOverhang, wl + fb], [bx + L + s.rollerOverhang, wl + fb * 0.95], [bx + L + s.rollerOverhang, wl - 0.3], [bx + 0.15 * L, wl - 0.6], [bx + s.rollerOverhang + 0.4, wl - 0.2]]
      : [[bx + s.rollerOverhang, wl + fb], [bx + L + s.rollerOverhang, wl + fb * 0.8], [bx + L * 0.97, wl - 0.3], [bx + 0.25 * L, wl - 0.5], [bx + s.rollerOverhang + 0.9, wl - 0.1]];
  out.push(`<path class="s-hull" d="${pathOf(tr(hull), true)}" vector-effect="non-scaling-stroke"/>`);
  if (s.boatType === 'monohull')
    out.push(`<path class="s-hull" d="${pathOf(tr([[bx + 0.4 * L, wl - 0.45], [bx + 0.5 * L, wl - draft], [bx + 0.58 * L, wl - draft], [bx + 0.55 * L, wl - 0.45]]), true)}" vector-effect="non-scaling-stroke"/>`);
  out.push(`<path class="s-cabin" d="${pathOf(tr([[bx + 0.3 * L, wl + fb], [bx + 0.36 * L, wl + fb + 0.6], [bx + 0.72 * L, wl + fb + 0.6], [bx + 0.72 * L, wl + fb]]), true)}" vector-effect="non-scaling-stroke"/>`);
  out.push(`<line class="s-mast" x1="${bx + 0.4 * L}" y1="${-(wl + fb) * V}" x2="${bx + 0.4 * L}" y2="${vb.y}" vector-effect="non-scaling-stroke"/>`);

  // Rest rode (ghost)
  const restProf = rodeProfile(rode, rest);
  out.push(`<path class="s-chain-ghost" d="${pathOf(tr(restProf.chain))}" vector-effect="non-scaling-stroke"/>`);

  // Current rode
  const prof = rodeProfile(rode, st);
  const ground = prof.chain.filter(([, z]) => z <= 1e-9);
  out.push(`<path class="s-chain" d="${pathOf(tr(prof.chain))}" vector-effect="non-scaling-stroke"/>`);
  if (ground.length > 1 && !st.slack) out.push(`<path class="s-chain-ground" d="${pathOf(tr([ground[0], ground[ground.length - 1]]))}" vector-effect="non-scaling-stroke"/>`);
  if (prof.snubber.length) out.push(`<path class="s-snubber" d="${pathOf(tr(prof.snubber))}" vector-effect="non-scaling-stroke"/>`);
  if (prof.snubber.length) {
    const [hx, hz] = prof.snubber[0];
    out.push(`<circle class="s-hook" cx="${hx}" cy="${-hz * V}" r="${3.5 * k}" vector-effect="non-scaling-stroke"/>`);
  }
  out.push(`<circle class="s-roller" cx="${st.x}" cy="${-(Z + (p.wave?.dz ?? 0)) * V}" r="${4 * k}" vector-effect="non-scaling-stroke"/>`);

  // Anchor glyph
  const r = 7 * k;
  out.push(`<path class="s-anchor" d="M0,${-r * 1.3}V0M${-r},${-r * 0.4}Q${-r * 0.8},${r * 0.3} 0,${r * 0.2}Q${r * 0.8},${r * 0.3} ${r},${-r * 0.4}" vector-effect="non-scaling-stroke"/>`);

  // Annotations
  if (st.slack) {
    out.push(text(st.x / 2, -14 * k, fs, 'Chain slack — no horizontal pull', 'lbl lbl-strong', 'middle'));
  } else {
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
  }

  // Depth drag handle, on the water surface: drag up for deeper water
  const hx = vb.x + vb.w * 0.3;
  const hy = -depth * V;
  out.push(`<g class="drag-depth" tabindex="0" role="slider" aria-label="Water depth, metres" aria-valuenow="${depth}"><rect class="hit" x="${hx - 34 * k}" y="${hy - 16 * k}" width="${68 * k}" height="${32 * k}"/><rect class="handle" x="${hx - 28 * k}" y="${hy - 10 * k}" width="${56 * k}" height="${20 * k}" rx="${10 * k}" vector-effect="non-scaling-stroke"/>${text(hx, hy + 4 * k, fs * 0.85, '⇕ depth', 'lbl lbl-handle', 'middle')}</g>`);

  out.push(text(vb.x + 8 * k, vb.y + 16 * k, fs * 0.9, `Vertical scale ×${V}`, 'lbl lbl-muted', 'start'));

  svg.setAttribute('viewBox', vbAttr(vb));
  svg.innerHTML = out.join('');
  return vb;
}
