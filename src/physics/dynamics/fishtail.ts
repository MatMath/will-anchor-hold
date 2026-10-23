import { DEG } from '../core/constants';
import { solveEquilibrium } from '../mooring/equilibrium';
import type { Equilibrium, MooringModel } from '../mooring/model';

export interface FishtailExtreme {
  amplitudeDeg: number;
  /** +1: bow swung to port of head-to-wind, −1: to starboard. The worse of the two is kept. */
  side: 1 | -1;
  eq: Equilibrium;
}

/**
 * Fishtailing (sheering): a boat swinging on its anchor does not stay head to wind. The topsides act as a
 * poor sail and it swings ±A either side, showing its side to the wind at each end of the swing.
 * Quasi-static: the boat is held at heading ψ0 ± A and its position re-solved; the worse side is returned.
 * Stern lines stop it, so it only applies when there are none.
 */
export function fishtailExtreme(m: MooringModel, base: Equilibrium, amplitudeDeg: number): FishtailExtreme | null {
  if (m.lines.length > 0 || amplitudeDeg <= 0 || base.windSpeed <= 0) return null;
  let worst: FishtailExtreme | null = null;
  for (const side of [1, -1] as const) {
    const eq = solveEquilibrium(m, base.windSpeed, base.windFromDeg, {
      fixedPsi: base.pose.psi + side * amplitudeDeg * DEG,
      initial: base.pose,
    });
    if (!worst || eq.rode.tensionTop > worst.eq.rode.tensionTop) worst = { amplitudeDeg, side, eq };
  }
  return worst;
}
