/**
 * A repeatable timeline of wind gusts for the animation: smooth rise, hold and fall of varied strength.
 */

export interface GustEvent {
  /** Start, rise, hold and fall times, s. */
  start: number;
  rise: number;
  hold: number;
  fall: number;
  /** Fraction of (gust − mean) reached, 0–1. */
  strength: number;
}

/** Deterministic pseudo-random numbers (mulberry32), so the animation is repeatable. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `count` gusts of varied strength and length; the strongest reaches the full gust speed. */
export function gustSchedule(count = 10, seed = 7): { events: GustEvent[]; duration: number } {
  const r = rng(seed);
  const events: GustEvent[] = [];
  let t = 8;
  for (let i = 0; i < count; i++) {
    const rise = 2 + 2 * r();
    const hold = 2 + 4 * r();
    const fall = 3 + 3 * r();
    const strength = i === Math.floor(count / 2) ? 1 : 0.55 + 0.45 * r();
    events.push({ start: t, rise, hold, fall, strength });
    t += rise + hold + fall + 6 + 8 * r();
  }
  return { events, duration: t + 4 };
}

export const smooth = (u: number): number => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

/** How far into its gust the wind is at time t: 0 between gusts, up to `strength` at the top. */
export function gustLevel(events: readonly GustEvent[], t: number): number {
  let g = 0;
  for (const e of events) {
    const u = t - e.start;
    if (u < 0 || u > e.rise + e.hold + e.fall) continue;
    const s = u < e.rise ? smooth(u / e.rise) : u < e.rise + e.hold ? 1 : 1 - smooth((u - e.rise - e.hold) / e.fall);
    g = Math.max(g, s * e.strength);
  }
  return g;
}
