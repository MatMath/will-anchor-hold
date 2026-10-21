import { solveIncreasing } from './numeric';
import { ropeStrain, type RopeType } from './rope';

/**
 * Elastic catenary of an anchor rode lying partly on a flat, frictionless seabed (Irvine, 1981),
 * optionally with a weightless elastic snubber between the chain and the bow.
 *
 * Coordinates: anchor at the origin on the seabed, fairlead (bow roller) at horizontal distance X
 * and height Z = water depth + roller height. Arc length s is measured on the UNSTRETCHED chain.
 *
 * With H the horizontal tension (constant along the rode) and V the vertical tension at the top of the
 * chain, two regimes exist:
 *
 *  Touchdown (V ≤ w·L) — part of the chain lies on the seabed, suspended length s = V/w:
 *     X = (L − s) + H·L/EA + (H/w)·asinh(V/H)
 *     Z = (√(H² + V²) − H)/w + V²/(2·w·EA)
 *
 *  Fully suspended (V > w·L) — the anchor sees an upward pull Va = V − w·L:
 *     X = H·L/EA + (H/w)·[asinh(V/H) − asinh(Va/H)]
 *     Z = (√(H² + V²) − √(H² + Va²))/w + (V·L − w·L²/2)/EA
 *
 * The two forms agree at V = w·L. With EA → ∞ they reduce to the classical inelastic catenary.
 */

export interface Snubber {
  /** Unstretched length, m. */
  length: number;
  rope: RopeType;
  /** Effective MBL, N. */
  mbl: number;
}

export interface Rode {
  /** Chain length deployed, m (anchor shackle to the top of the chain). */
  length: number;
  /** Submerged weight, N/m. */
  w: number;
  /** Axial stiffness, N. */
  ea: number;
  /** Height of the fairlead above the seabed (depth + roller height), m. */
  z: number;
  snubber?: Snubber;
}

export interface RodeState {
  /** Horizontal tension, N. */
  h: number;
  /** Vertical tension at the top of the chain, N. */
  v: number;
  /** Vertical (upward) pull at the anchor, N. Zero when chain lies on the seabed. */
  vAnchor: number;
  /** Tension at the top of the chain (= bow tension, also in the snubber if fitted), N. */
  tensionTop: number;
  /** Tension at the anchor shackle, N. */
  tensionAnchor: number;
  /** Rode angle at the top, rad above horizontal. */
  angleTop: number;
  /** Chain angle at the anchor, rad above horizontal (0 = horizontal pull). */
  angleAnchor: number;
  /** Unstretched chain length lifted off the seabed, m. */
  suspended: number;
  /** Chain length still lying on the seabed, m. */
  grounded: number;
  /** Horizontal distance from anchor to touchdown point, m. */
  touchdownX: number;
  /** Horizontal distance anchor → fairlead, m. */
  x: number;
  /** Horizontal and vertical extent of the chain part only (excludes the snubber), m. */
  chainX: number;
  chainZ: number;
  /** Snubber tension strain and stretched length (0 when no snubber). */
  snubberStrain: number;
  snubberLength: number;
  /** True when the rode carries no horizontal load (chain hangs vertically then piles on the seabed). */
  slack: boolean;
}

/** Span of the chain alone for given H, V. */
export function chainSpan(rode: Rode, h: number, v: number): { x: number; z: number } {
  const { length: L, w, ea } = rode;
  const wl = w * L;
  if (v <= wl) {
    const s = v / w;
    const x = L - s + (h * L) / ea + (h > 0 ? (h / w) * Math.asinh(v / h) : 0);
    const z = (Math.hypot(h, v) - h) / w + (v * v) / (2 * w * ea);
    return { x, z };
  }
  const va = v - wl;
  const x = (h * L) / ea + (h > 0 ? (h / w) * (Math.asinh(v / h) - Math.asinh(va / h)) : 0);
  const z = (Math.hypot(h, v) - Math.hypot(h, va)) / w + (v * L - 0.5 * w * L * L) / ea;
  return { x, z };
}

/** Span of the whole rode (chain + snubber hanging along the force direction at the top). */
export function rodeSpan(rode: Rode, h: number, v: number): { x: number; z: number; snubberLength: number; strain: number } {
  const c = chainSpan(rode, h, v);
  if (!rode.snubber) return { ...c, snubberLength: 0, strain: 0 };
  const t = Math.hypot(h, v);
  const strain = ropeStrain(rode.snubber.rope, t, rode.snubber.mbl);
  const ls = rode.snubber.length * (1 + strain);
  // A weightless line in tension is straight and aligned with the force at its lower end.
  const cos = t > 0 ? h / t : 0;
  const sin = t > 0 ? v / t : 1;
  return { x: c.x + ls * cos, z: c.z + ls * sin, snubberLength: ls, strain };
}

/** Vertical tension at the top such that the rode reaches height rode.z for horizontal tension h. */
export function solveV(rode: Rode, h: number): number {
  return solveIncreasing((v) => rodeSpan(rode, h, v).z - rode.z, 0, rode.w * rode.z + h + 1, 1e-9);
}

/** Horizontal span of the rode when it carries no horizontal load (chain hanging straight down, rest on the seabed). */
export function slackSpan(rode: Rode): number {
  return rodeSpan(rode, 0, solveV(rode, 0)).x;
}

function stateFor(rode: Rode, h: number, v: number, slack: boolean): RodeState {
  const { length: L, w, ea } = rode;
  const span = rodeSpan(rode, h, v);
  const chain = chainSpan(rode, h, v);
  const suspended = Math.min(L, v / w);
  const grounded = L - suspended;
  const vAnchor = Math.max(0, v - w * L);
  return {
    h,
    v,
    vAnchor,
    tensionTop: Math.hypot(h, v),
    tensionAnchor: Math.hypot(h, vAnchor),
    angleTop: Math.atan2(v, h),
    angleAnchor: Math.atan2(vAnchor, h),
    suspended,
    grounded,
    touchdownX: grounded * (1 + h / ea),
    x: span.x,
    chainX: chain.x,
    chainZ: chain.z,
    snubberStrain: span.strain,
    snubberLength: span.snubberLength,
    slack,
  };
}

/**
 * Solve the rode for a given horizontal distance from the anchor to the fairlead.
 * Returns the slack state (H = 0) when the distance is shorter than the hanging-chain span.
 */
export function solveRode(rode: Rode, x: number): RodeState {
  if (rode.length <= 0 || rode.w <= 0) throw new Error('rode: length and weight must be positive');
  const x0 = slackSpan(rode);
  if (x <= x0) {
    const st = stateFor(rode, 0, solveV(rode, 0), true);
    return { ...st, x, chainX: x, touchdownX: x };
  }
  const f = (h: number): number => rodeSpan(rode, h, solveV(rode, h)).x - x;
  const h = solveIncreasing(f, 0, rode.w * rode.length, 1e-9);
  return stateFor(rode, h, solveV(rode, h), false);
}

/** Inelastic, chain-only touchdown catenary (closed form) — used to check the general solver. */
export function inelasticTouchdown(w: number, z: number, h: number): { suspended: number; xSuspended: number; v: number } {
  const a = h / w;
  const s = Math.sqrt(z * z + 2 * a * z);
  return { suspended: s, xSuspended: a * Math.asinh(s / a), v: w * s };
}

/**
 * Points along the rode from the anchor (0, 0) to the fairlead, for drawing.
 * Returns chain points and (if fitted) the snubber end points.
 */
export function rodeProfile(rode: Rode, st: RodeState, n = 80): { chain: Array<[number, number]>; snubber: Array<[number, number]> } {
  const { length: L, w, ea } = rode;
  const { h, vAnchor } = st;
  const chain: Array<[number, number]> = [];
  if (st.slack) {
    // Chain hangs vertically from the hook and the rest lies (or piles) on the seabed.
    chain.push([0, 0], [st.x, 0], [st.x, st.chainZ]);
  } else if (st.grounded > 0) {
    const lb = st.grounded;
    const xb = lb * (1 + h / ea);
    chain.push([0, 0], [xb, 0]);
    for (let i = 1; i <= n; i++) {
      const s = (st.suspended * i) / n;
      chain.push([
        xb + (h / w) * Math.asinh((w * s) / h) + (h * s) / ea,
        (Math.hypot(h, w * s) - h) / w + (w * s * s) / (2 * ea),
      ]);
    }
  } else {
    for (let i = 0; i <= n; i++) {
      const s = (L * i) / n;
      const vs = vAnchor + w * s;
      chain.push([
        (h * s) / ea + (h / w) * (Math.asinh(vs / h) - Math.asinh(vAnchor / h)),
        (Math.hypot(h, vs) - Math.hypot(h, vAnchor)) / w + (vAnchor * s + 0.5 * w * s * s) / ea,
      ]);
    }
  }
  const top = chain[chain.length - 1];
  const snubber: Array<[number, number]> = rode.snubber
    ? [top, [top[0] + st.snubberLength * Math.cos(st.angleTop), top[1] + st.snubberLength * Math.sin(st.angleTop)]]
    : [];
  return { chain, snubber };
}

/** Horizontal stiffness dH/dX of the rode at distance x (N/m), by central difference. */
export function rodeStiffness(rode: Rode, x: number): number {
  const d = 1e-4;
  return (solveRode(rode, x + d).h - solveRode(rode, x - d).h) / (2 * d);
}

/** Smallest horizontal distance at which the rode tension reaches `h` (N). Inverse of solveRode. */
export function spanForTension(rode: Rode, h: number): number {
  if (h <= 0) return slackSpan(rode);
  return rodeSpan(rode, h, solveV(rode, h)).x;
}
