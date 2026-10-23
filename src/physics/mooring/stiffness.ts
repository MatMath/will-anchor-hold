import { jacobianFD, solveLinear } from '../core/numeric';
import { apparentAngle } from '../core/vec';
import { windDirectionVector } from '../environment/wind';
import { evaluateForces } from './forces';
import type { Equilibrium, MooringModel } from './model';

/** How stiff the mooring is around an equilibrium, and the simple dynamic estimates built on it. */

/**
 * Stiffness of the mooring against a push along the wind direction, N/m, at a given equilibrium.
 * Solves K·δ = f̂ for the 3-DOF restoring stiffness (rotation free) and returns 1 / (f̂·δ).
 */
export function stiffnessAlong(m: MooringModel, eq: Equilibrium): number {
  const L = Math.max(1, m.loa / 2);
  const mooring = (q: number[]): number[] => {
    const f = evaluateForces(m, { x: q[0], y: q[1], psi: q[2] / L }, { windSpeed: 0, windFromDeg: eq.windFromDeg }).f;
    return [f[0], f[1], f[2] / L];
  };
  const base = [eq.pose.x, eq.pose.y, eq.pose.psi * L];
  const K = jacobianFD(mooring, base, mooring(base), () => 1e-5).map((row) => row.map((v) => -v));
  const dir = windDirectionVector(eq.windFromDeg);
  // Swinging on the anchor alone, nothing resists rotation about the bow: use the translational block.
  const delta = solveLinear(K, [dir[0], dir[1], 0]) ?? solveLinear([K[0].slice(0, 2), K[1].slice(0, 2)], [dir[0], dir[1]]);
  if (!delta) return 0;
  const compliance = dir[0] * delta[0] + dir[1] * delta[1];
  return compliance > 0 ? 1 / compliance : 0;
}

/** Mass plus hydrodynamic added mass for motion along a direction at angle (deg) to the bow: ~10% fore-aft, ~100% sideways. */
export function effectiveMass(displacement: number, angleDeg: number): number {
  const a = (angleDeg * Math.PI) / 180;
  return displacement * (1 + 0.1 + 0.9 * Math.sin(a) ** 2);
}

/**
 * Indicative snatch load: the extra force when the boat, moving at `speed` (m/s) along the wind
 * direction, is stopped by the mooring acting as a spring: ΔF = v·√(m_eff·k).
 */
export function snatchLoad(m: MooringModel, eq: Equilibrium, speed: number): { k: number; mEff: number; force: number } {
  const k = stiffnessAlong(m, eq);
  const mEff = effectiveMass(m.displacement, apparentAngle(eq.windFromDeg, eq.pose.psi));
  return { k, mEff, force: speed * Math.sqrt(mEff * k) };
}
