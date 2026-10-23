import { describe, expect, it } from 'vitest';
import { driftStep, jacobianFD, rk4Step, solveNonlinear } from './core/numeric';
import { headToWindPsi, shiftPose, toEarth } from './core/vec';
import { KNOT, WORKED_EXAMPLE, buildModel, evaluateForces, generalisedForce, solveEquilibrium, sternLinesOnCleats, windOnHull } from './index';

describe('core numerics', () => {
  it('rk4Step integrates a harmonic oscillator to 4th-order accuracy', () => {
    const f = (_t: number, [x, v]: number[]): number[] => [v, -x];
    let y = [1, 0];
    const dt = 0.01;
    for (let i = 0; i < 628; i++) y = rk4Step(f, i * dt, y, dt);
    expect(y[0]).toBeCloseTo(Math.cos(6.28), 8);
    expect(y[1]).toBeCloseTo(-Math.sin(6.28), 8);
  });

  it('jacobianFD matches an analytic Jacobian', () => {
    const f = ([a, b]: number[]): number[] => [a * a + b, Math.sin(b)];
    const J = jacobianFD(f, [2, 0.5], f([2, 0.5]), () => 1e-7);
    expect(J[0][0]).toBeCloseTo(4, 5);
    expect(J[0][1]).toBeCloseTo(1, 5);
    expect(J[1][1]).toBeCloseTo(Math.cos(0.5), 5);
  });

  it('solveNonlinear solves a small system, and drifts across a flat (slack) region', () => {
    const smooth = solveNonlinear(([x, y]) => [x * x + y * y - 4, x - y], [1, 0.5], { tol: 1e-10, maxIter: 50, maxStep: 2, driftMax: 100 });
    expect(smooth.x[0]).toBeCloseTo(Math.SQRT2, 8);
    // Constant push of 1 until x = 10, where a stiff spring takes up: the root is just past 10.
    const slack = solveNonlinear(([x]) => [x < 10 ? 1 : 1 - 1000 * (x - 10)], [0], { tol: 1e-9, maxIter: 50, maxStep: 2, driftMax: 100 });
    expect(slack.x[0]).toBeCloseTo(10.001, 6);
  });

  it('driftStep returns 0 when nothing ever takes up', () => {
    expect(driftStep(() => 1, 50)).toBe(0);
  });

  it('geometry helpers', () => {
    const p = { x: 1, y: 2, psi: Math.PI / 2 };
    const e = toEarth(p, [1, 0]);
    expect(e[0]).toBeCloseTo(1, 12);
    expect(e[1]).toBeCloseTo(3, 12);
    expect(shiftPose(p, [0, 1], 2)).toEqual({ x: 1, y: 4, psi: Math.PI / 2 });
    expect(headToWindPsi(90)).toBeCloseTo(-Math.PI / 2, 12);
    expect(headToWindPsi(0)).toBeCloseTo(0, 12);
  });
});

describe('force contributors', () => {
  const m = buildModel(WORKED_EXAMPLE);
  const env = { windSpeed: 30 * KNOT, windFromDeg: 90 };

  it('generalisedForce sums forces and their moments about the origin', () => {
    const [fx, fy, mz] = generalisedForce([0, 0], [
      { point: [1, 0], force: [0, 2] },
      { point: [0, 1], force: [3, 0] },
    ]);
    expect([fx, fy, mz]).toEqual([3, 2, 2 - 3]);
  });

  it('evaluateForces is the sum of the individual contributors', () => {
    const eq = solveEquilibrium(m, env.windSpeed, env.windFromDeg);
    const pose = { ...eq.pose, x: eq.pose.x + 0.3 }; // off equilibrium, so the sum is not zero
    const { f, state } = evaluateForces(m, pose, env);
    const wind = windOnHull(m, pose, env);
    const lines = sternLinesOnCleats(m, pose);
    const sum = generalisedForce([pose.x, pose.y], [...wind.applied, { point: state.bow, force: state.chainForce }, ...lines.applied]);
    sum.forEach((v, i) => expect(f[i]).toBeCloseTo(v, 9));
    expect(Math.hypot(f[0], f[1])).toBeGreaterThan(1);
  });
});
