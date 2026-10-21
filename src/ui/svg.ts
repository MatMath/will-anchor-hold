/** SVG helpers shared by the plan view, side view and chart. Coordinates are plain numbers in user units. */

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Fit a bounding box (with margin) into the aspect ratio of the element. */
export function fitView(minX: number, minY: number, maxX: number, maxY: number, aspect: number, margin = 0.08): ViewBox {
  let w = maxX - minX;
  let h = maxY - minY;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  w *= 1 + 2 * margin;
  h *= 1 + 2 * margin;
  if (w / h > aspect) h = w / aspect;
  else w = h * aspect;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

export const vbAttr = (v: ViewBox): string => `${v.x} ${v.y} ${v.w} ${v.h}`;

const f = (n: number): string => (Math.abs(n) < 1e-9 ? '0' : n.toFixed(3));

export const pathOf = (pts: ReadonlyArray<readonly [number, number]>, close = false): string =>
  pts.map((p, i) => `${i ? 'L' : 'M'}${f(p[0])},${f(p[1])}`).join('') + (close ? 'Z' : '');

/** An arrow from (x1,y1) to (x2,y2) with a head of size `head` (user units). */
export function arrow(x1: number, y1: number, x2: number, y2: number, head: number, cls: string, extra = ''): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const L = Math.hypot(dx, dy);
  if (L < 1e-9) return '';
  const ux = dx / L;
  const uy = dy / L;
  const hl = Math.min(head, L * 0.6);
  const bx = x2 - ux * hl;
  const by = y2 - uy * hl;
  const hw = hl * 0.45;
  return `<g class="${cls}"${extra}><line x1="${f(x1)}" y1="${f(y1)}" x2="${f(bx)}" y2="${f(by)}" vector-effect="non-scaling-stroke"/><path class="head" d="M${f(x2)},${f(y2)}L${f(bx - uy * hw)},${f(by + ux * hw)}L${f(bx + uy * hw)},${f(by - ux * hw)}Z"/></g>`;
}

export function text(x: number, y: number, size: number, content: string, cls = 'lbl', anchor: 'start' | 'middle' | 'end' = 'start', extra = ''): string {
  return `<text class="${cls}" x="${f(x)}" y="${f(y)}" font-size="${f(size)}" text-anchor="${anchor}"${extra}>${content}</text>`;
}

/** Convert a pointer event to SVG user coordinates. */
export function toUser(svg: SVGSVGElement, ev: { clientX: number; clientY: number }): [number, number] {
  const ctm = svg.getScreenCTM();
  if (!ctm) return [0, 0];
  const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(ctm.inverse());
  return [p.x, p.y];
}

/** User units per CSS pixel for an svg showing viewBox v. */
export function unitsPerPx(svg: SVGSVGElement, v: ViewBox): number {
  const r = svg.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return v.w / 600;
  return Math.max(v.w / r.width, v.h / r.height);
}

export function aspectOf(el: Element, fallback: number): number {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? r.width / r.height : fallback;
}
