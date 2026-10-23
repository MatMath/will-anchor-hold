import { DEG } from './constants';

/**
 * Plane geometry shared by every layer.
 *
 * Earth frame: shore (quay face) along the y axis at x = 0, sea at x > 0, y to port, z up.
 * Boat frame: origin at midships on the centreline, u forward, v to port.
 * A pose (x, y, ψ) places midships in the earth frame; ψ > 0 turns the bow to port.
 */

export type Vec2 = [number, number];

export interface Pose {
  x: number;
  y: number;
  psi: number;
}

export const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
export const scale = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k];
export const dot = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1];
export const cross = (a: Vec2, b: Vec2): number => a[0] * b[1] - a[1] * b[0];
export const len = (a: Vec2): number => Math.hypot(a[0], a[1]);

/** Rotate a vector by ψ (rad, counter-clockwise). */
export const rot = (psi: number, p: Vec2): Vec2 => {
  const c = Math.cos(psi);
  const s = Math.sin(psi);
  return [c * p[0] - s * p[1], s * p[0] + c * p[1]];
};

/** A point given in the boat frame, in earth coordinates. */
export const toEarth = (pose: Pose, local: Vec2): Vec2 => add([pose.x, pose.y], rot(pose.psi, local));

/** Move a pose by an earth-frame displacement d·dir, keeping its heading. */
export const shiftPose = (pose: Pose, dir: Vec2, d: number): Pose => ({ x: pose.x + dir[0] * d, y: pose.y + dir[1] * d, psi: pose.psi });

/** Apparent wind angle on the (possibly rotated) boat, degrees clockwise from the bow, in [0, 360). */
export const apparentAngle = (fromDeg: number, psi: number): number => {
  const a = (fromDeg + (psi * 180) / Math.PI) % 360;
  return a < 0 ? a + 360 : a;
};

/** Heading (rad, in [−π, π)) that points the bow into a wind coming from `windFromDeg` (relative to the at-rest bow). */
export const headToWindPsi = (windFromDeg: number): number => (((((-windFromDeg + 180) % 360) + 360) % 360) - 180) * DEG;
