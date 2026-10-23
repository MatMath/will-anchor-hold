import { DEG, RHO_AIR } from '../core/constants';

export interface Windage {
  /** Side-profile (lateral) area, m². Seen with the wind exactly on the beam. */
  sideArea: number;
  /** Frontal area, m². Seen with the wind exactly on the bow. */
  frontArea: number;
  /** Drag coefficient for beam wind. Typical yacht 0.9–1.2. */
  cdSide: number;
  /** Drag coefficient for head wind. Typical yacht 0.7–0.9. */
  cdFront: number;
}

export interface WindLoad {
  /** Apparent wind angle on the boat, degrees from the bow, clockwise (90 = starboard beam). */
  angleDeg: number;
  /** Projected area for this angle, m². */
  area: number;
  /** Effective drag coefficient for this angle. */
  cd: number;
  /** Wind force magnitude, N. */
  force: number;
}

/**
 * Projected area of a box-like body at an angle θ off the bow:
 *   A(θ) = A_side·|sin θ| + A_front·|cos θ|
 * This is exact for a rectangular prism and a good approximation for a yacht's above-water shape.
 */
export function projectedArea(w: Windage, angleDeg: number): number {
  const t = angleDeg * DEG;
  return w.sideArea * Math.abs(Math.sin(t)) + w.frontArea * Math.abs(Math.cos(t));
}

/**
 * Drag-area product Cd·A at angle θ: each face carries its own coefficient,
 *   CdA(θ) = Cd_side·A_side·|sin θ| + Cd_front·A_front·|cos θ|
 */
export function dragArea(w: Windage, angleDeg: number): number {
  const t = angleDeg * DEG;
  return w.cdSide * w.sideArea * Math.abs(Math.sin(t)) + w.cdFront * w.frontArea * Math.abs(Math.cos(t));
}

/** Dynamic pressure q = ½·ρ·V², Pa. */
export const dynamicPressure = (speedMs: number, rho = RHO_AIR): number => 0.5 * rho * speedMs * speedMs;

/** F = ½·ρair·Cd·A·V² with Cd and A interpolated for the apparent wind angle. */
export function windLoad(w: Windage, speedMs: number, angleDeg: number, rho = RHO_AIR): WindLoad {
  const area = projectedArea(w, angleDeg);
  const cdA = dragArea(w, angleDeg);
  return {
    angleDeg,
    area,
    cd: area > 0 ? cdA / area : 0,
    force: dynamicPressure(speedMs, rho) * cdA,
  };
}

/**
 * Unit vector, in the earth frame, of the direction the wind blows TOWARDS.
 * Earth frame: x seaward (bow direction at rest), y to port. `fromDeg` is where the wind comes FROM,
 * measured clockwise from the at-rest bow direction (sailor's convention).
 */
export function windDirectionVector(fromDeg: number): [number, number] {
  const t = fromDeg * DEG;
  return [-Math.cos(t), Math.sin(t)];
}
