/** Small numeric helpers: root finding and dense linear solve. Pure functions, no dependencies. */

/**
 * Brent's method. Finds x in [a, b] with f(x) = 0, given f(a) and f(b) of opposite sign.
 * Returns the bracketing endpoint if it already is a root.
 */
export function brent(
  f: (x: number) => number,
  a: number,
  b: number,
  xtol = 1e-12,
  maxIter = 200,
): number {
  let fa = f(a);
  let fb = f(b);
  if (fa === 0) return a;
  if (fb === 0) return b;
  if (fa * fb > 0) throw new Error(`brent: root not bracketed [${a}, ${b}] f=(${fa}, ${fb})`);
  let c = a;
  let fc = fa;
  let d = b - a;
  let e = d;
  for (let i = 0; i < maxIter; i++) {
    if (fb * fc > 0) {
      c = a;
      fc = fa;
      d = b - a;
      e = d;
    }
    if (Math.abs(fc) < Math.abs(fb)) {
      a = b;
      b = c;
      c = a;
      fa = fb;
      fb = fc;
      fc = fa;
    }
    const tol = 2 * Number.EPSILON * Math.abs(b) + 0.5 * xtol;
    const m = 0.5 * (c - b);
    if (Math.abs(m) <= tol || fb === 0) return b;
    if (Math.abs(e) >= tol && Math.abs(fa) > Math.abs(fb)) {
      // Attempt inverse quadratic interpolation / secant.
      const s = fb / fa;
      let p: number;
      let q: number;
      if (a === c) {
        p = 2 * m * s;
        q = 1 - s;
      } else {
        const qq = fa / fc;
        const r = fb / fc;
        p = s * (2 * m * qq * (qq - r) - (b - a) * (r - 1));
        q = (qq - 1) * (r - 1) * (s - 1);
      }
      if (p > 0) q = -q;
      else p = -p;
      if (2 * p < Math.min(3 * m * q - Math.abs(tol * q), Math.abs(e * q))) {
        e = d;
        d = p / q;
      } else {
        d = m;
        e = m;
      }
    } else {
      d = m;
      e = m;
    }
    a = b;
    fa = fb;
    b += Math.abs(d) > tol ? d : m > 0 ? tol : -tol;
    fb = f(b);
  }
  return b;
}

/**
 * Root of an increasing function on [lo, ∞): expands the upper bound by doubling until f(hi) ≥ 0,
 * then refines with Brent. Assumes f(lo) ≤ 0.
 */
export function solveIncreasing(f: (x: number) => number, lo: number, hiGuess: number, xtol = 1e-12): number {
  let hi = Math.max(hiGuess, lo + 1e-9);
  let fhi = f(hi);
  let n = 0;
  while (fhi < 0) {
    lo = hi;
    hi *= 2;
    fhi = f(hi);
    if (++n > 200) throw new Error('solveIncreasing: could not bracket root');
  }
  if (fhi === 0) return hi;
  return brent(f, lo, hi, xtol);
}

/** Solve A·x = b for a small dense system by Gaussian elimination with partial pivoting. Returns null if singular. */
export function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-14) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / M[col][col];
      for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x.every(Number.isFinite) ? x : null;
}

/** Piecewise-linear interpolation through sorted (x, y) points, extrapolating linearly past both ends. */
export function interp(points: ReadonlyArray<readonly [number, number]>, x: number): number {
  const n = points.length;
  let i = 0;
  while (i < n - 2 && x > points[i + 1][0]) i++;
  const [x0, y0] = points[i];
  const [x1, y1] = points[i + 1];
  return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
}

export const norm = (v: readonly number[]): number => Math.sqrt(v.reduce((s, x) => s + x * x, 0));

/**
 * Forward-difference Jacobian J[i][j] = ∂f_i/∂x_j at x, given f(x) = fx and a step size per coordinate.
 */
export function jacobianFD(f: (x: number[]) => number[], x: number[], fx: number[], step: (xj: number) => number): number[][] {
  const J: number[][] = fx.map(() => []);
  for (let j = 0; j < x.length; j++) {
    const h = step(x[j]);
    const xj = [...x];
    xj[j] += h;
    const fj = f(xj);
    for (let i = 0; i < fx.length; i++) J[i][j] = (fj[i] - fx[i]) / h;
  }
  return J;
}

/**
 * Step along a direction d to the root of f(s), where f(0) > 0 is the residual projected on d.
 * Doubles s until f changes sign, then refines with Brent, so it cannot jump over a narrow band where the
 * system suddenly stiffens (a slack mooring line coming taut). Returns 0 if f stays positive up to sMax.
 */
export function driftStep(f: (s: number) => number, sMax: number): number {
  let s0 = 0;
  let s1 = 1e-4;
  let f1 = f(s1);
  while (f1 > 0 && s1 < sMax) {
    s0 = s1;
    s1 *= 2;
    f1 = f(s1);
  }
  if (f1 > 0) return 0;
  return brent(f, s0, s1, 1e-10);
}

export interface NonlinearOptions {
  /** Stop when |residual| ≤ tol. */
  tol: number;
  maxIter: number;
  /** Largest Newton step length (in the scaled unknowns). */
  maxStep: number;
  /** Furthest the drift fallback may move. */
  driftMax: number;
}

export interface NonlinearResult {
  x: number[];
  residual: number[];
  norm: number;
  iterations: number;
}

/**
 * Solve resid(x) = 0 for a small system.
 *
 * Each iteration: (1) Newton step with a forward-difference Jacobian, clipped to maxStep and halved until
 * the residual drops (Armijo); (2) if that fails — singular or flat Jacobian, e.g. a slack mooring — a
 * drift step along the residual direction to where its projection changes sign (driftStep).
 */
export function solveNonlinear(resid: (x: number[]) => number[], x0: number[], opts: NonlinearOptions): NonlinearResult {
  let x = x0;
  let r = resid(x);
  let rn = norm(r);
  let it = 0;
  for (; it < opts.maxIter && rn > opts.tol; it++) {
    const newton = newtonStep(resid, x, r, rn, opts.maxStep);
    if (newton) {
      ({ x, r, rn } = newton);
      continue;
    }
    const d = r.map((v) => v / rn);
    const along = (s: number): number => resid(x.map((v, i) => v + s * d[i])).reduce((acc, v, i) => acc + v * d[i], 0);
    const s = driftStep(along, opts.driftMax);
    if (s < 1e-9) break;
    x = x.map((v, i) => v + s * d[i]);
    r = resid(x);
    rn = norm(r);
  }
  return { x, residual: r, norm: rn, iterations: it };
}

/** One damped Newton step; null when no step length reduces the residual. */
function newtonStep(
  resid: (x: number[]) => number[],
  x: number[],
  r: number[],
  rn: number,
  maxStep: number,
): { x: number[]; r: number[]; rn: number } | null {
  const J = jacobianFD(resid, x, r, (xj) => 1e-6 * Math.max(1, Math.abs(xj)));
  let dx = solveLinear(J, r.map((v) => -v));
  if (!dx) return null;
  const sn = norm(dx);
  if (sn > maxStep) dx = dx.map((v) => (v * maxStep) / sn);
  for (let t = 1, k = 0; k < 30; k++, t /= 2) {
    const xn = x.map((v, i) => v + t * dx![i]);
    const rr = resid(xn);
    const rrn = norm(rr);
    if (rrn < (1 - 1e-4 * t) * rn) return { x: xn, r: rr, rn: rrn };
  }
  return null;
}

/** dy/dt = f(t, y) for a state vector y. */
export type Derivative = (t: number, y: number[]) => number[];

/** One classical fourth-order Runge–Kutta step. */
export function rk4Step(f: Derivative, t: number, y: number[], dt: number): number[] {
  const k1 = f(t, y);
  const k2 = f(t + dt / 2, y.map((v, i) => v + (dt / 2) * k1[i]));
  const k3 = f(t + dt / 2, y.map((v, i) => v + (dt / 2) * k2[i]));
  const k4 = f(t + dt, y.map((v, i) => v + dt * k3[i]));
  return y.map((v, i) => v + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
}
