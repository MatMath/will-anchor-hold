import { describe, expect, it } from 'vitest';
import { chainEA, slackSpan, solveRode, submergedWeight, type Rode } from './index';

/**
 * Independent check of the closed-form elastic catenary: integrate the chain's equilibrium equations
 * numerically (RK4) from the anchor end and compare where the chain arrives with the fairlead position.
 *
 * Along the unstretched arc s, with constant horizontal tension H and vertical tension V(s):
 *   dV/ds = w,   T = √(H² + V²),   dx/ds = (H/T)(1 + T/EA),   dz/ds = (V/T)(1 + T/EA)
 * The lying part (V = 0) just stretches by H/EA.
 * The closed form was also compared with NREL MoorPy (Jonkman catenary, CB = 0) — see docs/validation.md.
 */
function integrate(rode: Rode, h: number, vAnchor: number, grounded: number, n = 4000): [number, number] {
  const { w, ea } = rode;
  let x = grounded * (1 + h / ea);
  let z = 0;
  const L = rode.length - grounded;
  const ds = L / n;
  const f = (v: number): [number, number] => {
    const t = Math.hypot(h, v);
    const k = 1 + t / ea;
    return [(h / t) * k, (v / t) * k];
  };
  for (let i = 0; i < n; i++) {
    const v0 = vAnchor + w * i * ds;
    const k1 = f(v0);
    const k2 = f(v0 + (w * ds) / 2);
    const k4 = f(v0 + w * ds);
    // dV/ds is constant, so the two midpoint stages coincide.
    x += (ds / 6) * (k1[0] + 4 * k2[0] + k4[0]);
    z += (ds / 6) * (k1[1] + 4 * k2[1] + k4[1]);
  }
  return [x, z];
}

describe('catenary — independent numerical integration', () => {
  const cases: Array<[string, number, number, number, number]> = [
    // name, kg/m in air, d mm, chain length m, height seabed → roller m
    ['10 mm, 40 m, 7.3 m', 2.25, 10, 40, 7.3],
    ['8 mm, 30 m, 5 m', 1.35, 8, 30, 5],
    ['12 mm, 60 m, 15 m', 3.1, 12, 60, 15],
  ];
  for (const [name, kg, d, L, z] of cases) {
    it(`${name}: closed form and ODE agree from slack to nearly straight`, () => {
      const rode: Rode = { length: L, w: submergedWeight(kg), ea: chainEA(d), z };
      const x0 = slackSpan(rode);
      const straight = Math.sqrt(L * L - z * z);
      for (const x of [x0 + 0.5, (x0 + straight) / 2, straight - 1, straight - 0.2, straight + 0.05]) {
        const st = solveRode(rode, x);
        const [xi, zi] = integrate(rode, st.h, st.vAnchor, st.grounded);
        expect(Math.abs(xi - x)).toBeLessThan(1e-6);
        expect(Math.abs(zi - z)).toBeLessThan(1e-6);
      }
    });
  }
});
