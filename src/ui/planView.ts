import { toEarth, type Equilibrium, type MooringModel, type Pose, type Vec2 } from '../physics';
import { force, type Units } from './format';
import { arrow, aspectOf, fitView, pathOf, text, unitsPerPx, vbAttr, type ViewBox } from './svg';
import type { AppState } from './state';

/**
 * Top-down view. Earth x (seaward) → right, earth y (port) → up, so SVG y = −earth y.
 * Drawn: quay, shore points, rest-position ghost, the boat at equilibrium, chain (seabed part darker,
 * touchdown marked), stern lines, and force arrows drawn to a common scale.
 */

export interface PlanInput {
  s: AppState;
  model: MooringModel;
  rest: Equilibrium;
  eq: Equilibrium;
  /** Largest force to show (sets the arrow scale so it stays steady when toggling cases). */
  forceRef: number;
  label: string;
  frozen?: ViewBox;
}

const S = (p: Vec2): [number, number] => [p[0], -p[1]];

function hullOutline(s: AppState): Array<[number, number]> {
  const L = s.loa;
  const B = s.beam;
  const pts: Array<[number, number]> = [];
  const n = 24;
  const hw = (t: number): number => (t <= 0.4 ? (B / 2) * (0.84 + 0.16 * (t / 0.4)) : (B / 2) * Math.sqrt(Math.max(0, 1 - ((t - 0.4) / 0.6) ** 2)));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([-L / 2 + t * L, hw(t)]);
  }
  for (let i = n; i >= 0; i--) {
    const t = i / n;
    pts.push([-L / 2 + t * L, -hw(t)]);
  }
  return pts;
}

/** Boat shapes in the boat frame: [outline polygons, cabin polygon]. */
function boatShapes(s: AppState): { hulls: Array<Array<[number, number]>>; deck: Array<[number, number]> } {
  const L = s.loa;
  const B = s.beam;
  if (s.boatType === 'catamaran') {
    const w = 0.2 * B;
    const off = B / 2 - w / 2;
    const one = (c: number): Array<[number, number]> => {
      const pts: Array<[number, number]> = [];
      for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        const hw = t < 0.6 ? w / 2 : (w / 2) * Math.sqrt(Math.max(0, 1 - ((t - 0.6) / 0.4) ** 2));
        pts.push([-L / 2 + t * L, c + hw]);
      }
      for (let i = 16; i >= 0; i--) {
        const t = i / 16;
        const hw = t < 0.6 ? w / 2 : (w / 2) * Math.sqrt(Math.max(0, 1 - ((t - 0.6) / 0.4) ** 2));
        pts.push([-L / 2 + t * L, c - hw]);
      }
      return pts;
    };
    const deck: Array<[number, number]> = [
      [-0.42 * L, off],
      [0.22 * L, off],
      [0.22 * L, -off],
      [-0.42 * L, -off],
    ];
    return { hulls: [one(off), one(-off)], deck };
  }
  const deck: Array<[number, number]> = [
    [-0.3 * L, 0.3 * B],
    [0.12 * L, 0.27 * B],
    [0.18 * L, 0],
    [0.12 * L, -0.27 * B],
    [-0.3 * L, -0.3 * B],
  ];
  return { hulls: [hullOutline(s)], deck };
}

const place = (pose: Pose, pts: Array<[number, number]>): Array<[number, number]> => pts.map((p) => S(toEarth(pose, p)));

function anchorGlyph(x: number, y: number, k: number): string {
  const r = 7 * k;
  return `<g class="anchor-glyph" transform="translate(${x},${y})">
    <circle r="${r * 1.9}" class="hit"/>
    <circle cy="${-r}" r="${r * 0.28}" class="ring" vector-effect="non-scaling-stroke"/>
    <path d="M0,${-r * 0.7}V${r}M${-r * 0.55},${-r * 0.35}H${r * 0.55}M${-r},${r * 0.2}Q${-r * 0.8},${r} 0,${r}Q${r * 0.8},${r} ${r},${r * 0.2}" vector-effect="non-scaling-stroke"/>
  </g>`;
}

export function renderPlan(svg: SVGSVGElement, p: PlanInput): ViewBox {
  const { s, model, rest, eq } = p;
  const N = s.exaggeration;
  const shown: Pose = {
    x: rest.pose.x + N * (eq.pose.x - rest.pose.x),
    y: rest.pose.y + N * (eq.pose.y - rest.pose.y),
    psi: rest.pose.psi + N * (eq.pose.psi - rest.pose.psi),
  };
  const L = s.loa;
  const bow = toEarth(shown, [model.bowX, 0]);
  const cleats = model.lines.map((l) => toEarth(shown, l.attach));
  const ce = toEarth(shown, [model.ceX, 0]);
  const anchor = model.anchor;

  // Arrow scale: the reference force is drawn 0.5 LOA long.
  const scale = (0.5 * L) / Math.max(1, p.forceRef);

  // View box
  let vb: ViewBox;
  if (p.frozen) vb = p.frozen;
  else {
    const xs: number[] = [-2, bow[0] + 2, rest.pose.x - L / 2 - 1];
    const ys: number[] = [s.shoreSpread / 2 + 1, -s.shoreSpread / 2 - 1, rest.pose.y + L * 0.35, rest.pose.y - L * 0.35, shown.y + s.beam, shown.y - s.beam];
    const tip = (from: Vec2, f: Vec2): void => {
      xs.push(from[0] + f[0] * scale);
      ys.push(from[1] + f[1] * scale);
    };
    tip(ce, eq.wind.vector);
    tip(bow, eq.chainForce);
    eq.lines.forEach((l, i) => tip(cleats[i], l.force));
    if (s.planZoom === 'all') {
      xs.push(anchor[0] + 3);
      ys.push(anchor[1] + 3, anchor[1] - 3);
    } else {
      xs.push(bow[0] + 0.45 * L);
    }
    vb = fitView(Math.min(...xs), -Math.max(...ys), Math.max(...xs), -Math.min(...ys), aspectOf(svg, 1.6), 0.06);
  }
  const k = unitsPerPx(svg, vb);
  const fs = 12 * k;
  const head = 9 * k;
  const units = s.units as Units;
  const out: string[] = [];
  /** Text kept inside the view: shifts the anchor point so an estimated label width fits. */
  const label = (x: number, y: number, size: number, str: string, cls: string, anchor: 'start' | 'middle' | 'end'): string => {
    const w = str.length * size * 0.56;
    const left = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
    const lo = Math.max(vb.x, 0) + 4 * k;
    const hi = vb.x + vb.w - 4 * k;
    const shift = left < lo ? lo - left : left + w > hi ? hi - (left + w) : 0;
    const yc = Math.min(Math.max(y, vb.y + size * 1.1), vb.y + vb.h - 6 * k);
    return text(x + shift, yc, size, str, cls, anchor);
  };

  // Water + quay
  out.push(`<rect class="p-water" x="${vb.x}" y="${vb.y}" width="${vb.w}" height="${vb.h}"/>`);
  out.push(`<rect class="p-quay" x="${vb.x - 10}" y="${vb.y - 10}" width="${-vb.x + 10}" height="${vb.h + 20}"/>`);
  out.push(`<line class="p-quay-edge" x1="0" y1="${vb.y}" x2="0" y2="${vb.y + vb.h}" vector-effect="non-scaling-stroke"/>`);
  out.push(text(-6 * k, vb.y + vb.h - 8 * k, fs, 'Quay / rock', 'lbl lbl-muted lbl-vertical', 'start', ` transform="rotate(-90 ${-6 * k} ${vb.y + vb.h - 8 * k})"`));

  // Faint wind streaks
  const wdir = eq.wind.vector[0] === 0 && eq.wind.vector[1] === 0 ? null : eq.wind.vector;
  if (wdir && eq.windSpeed > 0) {
    const n = Math.hypot(wdir[0], wdir[1]);
    const u: Vec2 = [wdir[0] / n, wdir[1] / n];
    const step = Math.max(vb.w, vb.h) / 5;
    const len = 34 * k;
    for (let i = 0; i < 6; i++)
      for (let j = 0; j < 6; j++) {
        const x = vb.x + (i + 0.5 + (j % 2) * 0.5) * step;
        const y = vb.y + (j + 0.5) * step * 0.8;
        if (x < 0) continue;
        out.push(arrow(x, y, x + u[0] * len, y - u[1] * len, 6 * k, 'p-streak'));
      }
  }

  // Rest ghost
  const rb = boatShapes(s);
  for (const h of rb.hulls) out.push(`<path class="p-ghost" d="${pathOf(place(rest.pose, h), true)}" vector-effect="non-scaling-stroke"/>`);
  rest.lines.forEach((l) => out.push(`<path class="p-ghost-line" d="${pathOf([S(l.cleat), S(l.shore)])}" vector-effect="non-scaling-stroke"/>`));

  // Chain in plan: anchor → touchdown (on seabed, darker) → bow.
  const chainDir: Vec2 = [bow[0] - anchor[0], bow[1] - anchor[1]];
  const cl = Math.hypot(chainDir[0], chainDir[1]) || 1;
  const td = Math.min(eq.rode.touchdownX, cl);
  const tdPt: Vec2 = [anchor[0] + (chainDir[0] / cl) * td, anchor[1] + (chainDir[1] / cl) * td];
  out.push(`<path class="p-chain" d="${pathOf([S(tdPt), S(bow)])}" vector-effect="non-scaling-stroke"/>`);
  if (td > 0.01) out.push(`<path class="p-chain-ground" d="${pathOf([S(anchor), S(tdPt)])}" vector-effect="non-scaling-stroke"/>`);
  if (td > 0.01 && !eq.rode.slack) {
    const [tx, ty] = S(tdPt);
    out.push(`<circle class="p-td" cx="${tx}" cy="${ty}" r="${4 * k}" vector-effect="non-scaling-stroke"/>`);
    if (s.planZoom === 'all') out.push(text(tx, ty - 9 * k, fs * 0.9, 'touchdown', 'lbl lbl-muted', 'middle'));
  }

  // Stern lines
  eq.lines.forEach((l, i) => {
    const c = S(cleats[i]);
    const sh = S(l.shore);
    out.push(`<path class="p-line p-line${i + 1}${l.slack ? ' is-slack' : ''}" d="${pathOf([c, sh])}" vector-effect="non-scaling-stroke"/>`);
  });
  model.lines.forEach((l) => {
    const [x, y] = S(l.shore);
    out.push(`<circle class="p-ring" cx="${x}" cy="${y}" r="${4 * k}" vector-effect="non-scaling-stroke"/>`);
  });

  // Boat
  const shapes = boatShapes(s);
  if (s.boatType === 'catamaran') out.push(`<path class="p-deck" d="${pathOf(place(shown, shapes.deck), true)}" vector-effect="non-scaling-stroke"/>`);
  for (const h of shapes.hulls) out.push(`<path class="p-hull" d="${pathOf(place(shown, h), true)}" vector-effect="non-scaling-stroke"/>`);
  if (s.boatType === 'monohull') out.push(`<path class="p-deck" d="${pathOf(place(shown, shapes.deck), true)}" vector-effect="non-scaling-stroke"/>`);
  out.push(`<path class="p-centre" d="${pathOf(place(shown, [[-L / 2, 0], [L / 2 + 0.3, 0]]))}" vector-effect="non-scaling-stroke"/>`);
  const [bx, by] = S(bow);
  out.push(`<circle class="p-roller" cx="${bx}" cy="${by}" r="${3.5 * k}" vector-effect="non-scaling-stroke"/>`);
  cleats.forEach((c) => {
    const [x, y] = S(c);
    out.push(`<circle class="p-cleat" cx="${x}" cy="${y}" r="${3 * k}" vector-effect="non-scaling-stroke"/>`);
  });
  const [cex, cey] = S(ce);
  out.push(`<circle class="p-ce" cx="${cex}" cy="${cey}" r="${4 * k}" vector-effect="non-scaling-stroke"/>`);

  // Drift dimension
  const drift = Math.hypot(eq.pose.x - rest.pose.x, eq.pose.y - rest.pose.y);
  if (drift > 0.05) {
    const a = S([rest.pose.x, rest.pose.y]);
    const b = S([shown.x, shown.y]);
    out.push(`<path class="p-drift" d="${pathOf([a, b])}" vector-effect="non-scaling-stroke"/>`);
    const side = eq.pose.y - rest.pose.y;
    // Label on the far side of the rest outline from the drift, clear of the boat.
    const ddx = b[0] - a[0];
    const ddy = b[1] - a[1];
    const dl = Math.hypot(ddx, ddy) || 1;
    const off = s.beam * 0.75 + 12 * k;
    out.push(
      label(a[0] - (ddx / dl) * off, a[1] - (ddy / dl) * off + fs * 0.35, fs, `drift ${Math.abs(side).toFixed(2)} m ${side >= 0 ? 'to port' : 'to starboard'}${N > 1 ? ` (drawn ×${N})` : ''}`, 'lbl lbl-strong', 'middle'),
    );
  }

  // Force arrows
  const forceArrow = (from: Vec2, f: Vec2, cls: string, name: string): void => {
    const a = S(from);
    const b = S([from[0] + f[0] * scale, from[1] + f[1] * scale]);
    if (Math.hypot(f[0], f[1]) < 1) return;
    out.push(arrow(a[0], a[1], b[0], b[1], head, `p-force ${cls}`));
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const n = Math.hypot(dx, dy) || 1;
    out.push(label(b[0] + (dx / n) * 6 * k, b[1] + (dy / n) * 6 * k + fs * 0.35, fs, name, 'lbl lbl-force', dx >= 0 ? 'start' : 'end'));
  };
  if (eq.windSpeed > 0) forceArrow(ce, eq.wind.vector, 'f-wind', `Wind ${force(eq.wind.force, units)}`);
  forceArrow(bow, eq.chainForce, 'f-chain', `Chain ${force(eq.rode.tensionTop, units)}`);
  eq.lines.forEach((l, i) => forceArrow(cleats[i], l.force, `f-line${i + 1}`, `${force(l.tension, units)}`));

  // Anchor
  const [ax, ay] = S(anchor);
  out.push(`<g class="drag-anchor" tabindex="0" role="button" aria-label="Anchor position: drag to move">${anchorGlyph(ax, ay, k)}</g>`);
  if (s.planZoom === 'all') out.push(label(ax, ay + 22 * k, fs * 0.9, `${s.anchorDistance.toFixed(1)} m from quay`, 'lbl lbl-muted', 'middle'));
  else if (anchor[0] > vb.x + vb.w) {
    const y = Math.min(Math.max(-anchor[1], vb.y + 20 * k), vb.y + vb.h - 20 * k);
    out.push(arrow(vb.x + vb.w - 60 * k, y, vb.x + vb.w - 6 * k, y, head, 'p-offscreen'));
    out.push(text(vb.x + vb.w - 64 * k, y + fs * 0.35, fs * 0.9, `anchor ${(anchor[0] - bow[0]).toFixed(0)} m`, 'lbl lbl-muted', 'end'));
  }

  // Scale bar + arrow scale + case label
  const bar = niceLen(vb.w * 0.18);
  const sx = Math.max(vb.x, 0) + 14 * k;
  const sy = vb.y + vb.h - 14 * k;
  out.push(`<path class="p-scale" d="M${sx},${sy - 4 * k}V${sy}H${sx + bar}V${sy - 4 * k}" vector-effect="non-scaling-stroke"/>`);
  out.push(text(sx + bar / 2, sy - 7 * k, fs * 0.9, `${bar} m`, 'lbl lbl-muted', 'middle'));
  const fBar = niceLen(p.forceRef / 2);
  out.push(text(vb.x + vb.w - 10 * k, vb.y + vb.h - 10 * k, fs * 0.9, `arrows: ${force(fBar, units)} = ${(fBar * scale).toFixed(1)} m`, 'lbl lbl-muted', 'end'));
  out.push(text(Math.max(vb.x, 0) + 10 * k, vb.y + 18 * k, fs * 1.1, p.label, 'lbl lbl-strong', 'start'));

  svg.setAttribute('viewBox', vbAttr(vb));
  svg.innerHTML = out.join('');
  return vb;
}

/** 1, 2, 5 × 10ⁿ at or below v. */
export function niceLen(v: number): number {
  if (!(v > 0)) return 1;
  const e = Math.floor(Math.log10(v));
  const b = v / 10 ** e;
  const m = b >= 5 ? 5 : b >= 2 ? 2 : 1;
  return m * 10 ** e;
}
