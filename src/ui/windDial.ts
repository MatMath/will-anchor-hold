/**
 * Compass-style wind direction control. The boat points up; the arrow shows where the wind comes FROM.
 * Drag anywhere on the dial (or use arrow keys) to change the direction.
 */
export function renderDial(host: HTMLElement, dirDeg: number, kn: number): void {
  const R = 46;
  const t = (dirDeg * Math.PI) / 180;
  const fx = Math.sin(t) * (R + 4);
  const fy = -Math.cos(t) * (R + 4);
  const tx = Math.sin(t) * 16;
  const ty = -Math.cos(t) * 16;
  const ticks = Array.from({ length: 12 }, (_, i) => {
    const a = (i * 30 * Math.PI) / 180;
    const r1 = i % 3 === 0 ? R - 8 : R - 4;
    return `<line class="d-tick" x1="${Math.sin(a) * r1}" y1="${-Math.cos(a) * r1}" x2="${Math.sin(a) * R}" y2="${-Math.cos(a) * R}"/>`;
  }).join('');
  const ux = tx - fx;
  const uy = ty - fy;
  const ul = Math.hypot(ux, uy);
  const nx = ux / ul;
  const ny = uy / ul;
  const head = `M${tx},${ty}L${tx - nx * 9 - ny * 5},${ty - ny * 9 + nx * 5}L${tx - nx * 9 + ny * 5},${ty - ny * 9 - nx * 5}Z`;
  host.innerHTML = `<svg viewBox="-62 -62 124 124" class="dial-svg" aria-hidden="true">
    <circle class="d-ring" r="${R}"/>${ticks}
    <text class="d-lbl" x="0" y="${-R + 16}" text-anchor="middle">bow</text>
    <text class="d-lbl" x="${R - 12}" y="4" text-anchor="end">stbd</text>
    <text class="d-lbl" x="${-R + 12}" y="4" text-anchor="start">port</text>
    <path class="d-boat" d="M0,-13 C5,-6 5,4 4,12 L-4,12 C-5,4 -5,-6 0,-13Z"/>
    <line class="d-arrow" x1="${fx}" y1="${fy}" x2="${tx - nx * 8}" y2="${ty - ny * 8}"/>
    <path class="d-arrow-head" d="${head}"/>
    <circle class="d-knob" cx="${fx}" cy="${fy}" r="7"/>
  </svg>
  <div class="dial-readout"><strong>${Math.round(dirDeg)}°</strong><span>${describe(dirDeg)}</span><span>${kn} kn</span></div>`;
  host.setAttribute('aria-valuenow', String(Math.round(dirDeg)));
  host.setAttribute('aria-valuetext', `${Math.round(dirDeg)} degrees, ${describe(dirDeg)}`);
}

export function describe(d: number): string {
  const a = ((d % 360) + 360) % 360;
  if (a < 15 || a > 345) return 'on the bow';
  if (a > 165 && a < 195) return 'from astern';
  if (Math.abs(a - 90) <= 15) return 'stbd beam';
  if (Math.abs(a - 270) <= 15) return 'port beam';
  if (a < 90) return 'stbd bow';
  if (a < 180) return 'stbd quarter';
  if (a < 270) return 'port quarter';
  return 'port bow';
}

/** Angle (deg, clockwise from up) of a pointer relative to the dial centre. */
export function dialAngle(host: HTMLElement, ev: { clientX: number; clientY: number }): number {
  const svg = host.querySelector('svg')!;
  const r = svg.getBoundingClientRect();
  const dx = ev.clientX - (r.left + r.width / 2);
  const dy = ev.clientY - (r.top + r.height / 2);
  let a = (Math.atan2(dx, -dy) * 180) / Math.PI;
  if (a < 0) a += 360;
  return Math.round(a / 5) * 5 % 360;
}
