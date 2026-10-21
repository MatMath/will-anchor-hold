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
