// 1D spring-system solver for animating dimensionality reduction.
//
// Treats every pair of input points (i, j) as a Hooke's-law spring with
// rest length d_ij = ||x_i - x_j|| (the original Euclidean distance) and
// stiffness w_ij = 1/d_ij² (Sammon-style — short distances dominate). The
// total system energy / stress is
//   σ(X) = Σ_{i<j} w_ij (|X_i - X_j| - d_ij)²
// and the goal is to find 1D coordinates X minimizing σ.
//
// Two minimization schemes are available (see `method`):
//   - 'gradient' (default): plain gradient descent on σ — physically
//     faithful to the spring system, gentle convergence.
//   - 'smacof'  : Guttman majorization (Borg & Groenen, 1997) — globally
//     convergent and fast (often <10 visible iterations even with damping).
//
// Returns the FULL trajectory (point cloud at every iteration, including
// the initial state) plus the stress at each iteration. The caller can
// replay the trajectory frame-by-frame to animate the optimization.

export interface SpringSolverResult {
  /** Point cloud at each iteration. trajectory[k][i] is the 1D position of
   *  point i at iteration k. trajectory[0] is the initial state, and the
   *  array has length (numIterationsRun + 1). */
  trajectory: number[][];
  /** Stress at each iteration. stressTrace[k] = σ(trajectory[k]).
   *  Same length as `trajectory`. */
  stressTrace: number[];
}

export interface SpringSolverOptions {
  /** Optimization scheme.
   *
   *  - 'smacof' (default historical): Guttman majorization. Each iteration
   *    jumps to the minimizer of a quadratic upper bound — globally
   *    convergent and very fast (often <10 visible iterations even with
   *    damping). Use when you want a tight optimizer.
   *
   *  - 'gradient': plain gradient descent on the spring energy
   *    E(X) = Σ_{i<j} w_ij (|X_i - X_j| - d_ij)².  Each step is a Hooke's-
   *    law nudge — physically faithful to a spring system. Converges much
   *    more gradually than SMACOF, so the animation reads as the springs
   *    visibly relaxing frame-by-frame.
   */
  method?: 'smacof' | 'gradient';
  /** Maximum number of iterations (default 80). */
  maxIter?: number;
  /** Stop when relative stress change < tol (default 1e-5). */
  tol?: number;
  /** RNG used to break initial-position ties; deterministic for testing.
   *  If omitted, uses Math.random. */
  rng?: () => number;
  /** Initial 1D coordinates. Defaults to projecting onto the x-axis (i.e.
   *  taking the first coordinate of each input point) plus tiny jitter. */
  init?: number[];
  /** SMACOF: damping factor on the Guttman update,
   *           X_next = X + stepSize * (Guttman(X) - X). Default 1.0.
   *  Gradient: learning rate η,
   *           X_next = X - stepSize * ∂E/∂X. Default 1e-4 — pick something
   *           small enough to avoid oscillation but large enough to make
   *           progress over `maxIter` iterations.
   */
  stepSize?: number;
}

export function solveSpringSystem1D(
  points: ReadonlyArray<readonly [number, number]>,
  options: SpringSolverOptions = {},
): SpringSolverResult {
  const {
    method = 'gradient',
    maxIter = 80,
    tol = 1e-5,
    rng = Math.random,
    init,
    stepSize = method === 'gradient' ? 1e-4 : 1.0,
  } = options;
  const n = points.length;

  // Pairwise target distances + Sammon weights. Stored as flat n×n arrays
  // for tight inner loops.
  const D = new Float64Array(n * n);
  const W = new Float64Array(n * n);
  let wSumTotal = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = points[i][0] - points[j][0];
      const dy = points[i][1] - points[j][1];
      const d = Math.hypot(dx, dy);
      const dEps = Math.max(d, 1e-6);
      const w = 1 / (dEps * dEps);
      D[i * n + j] = d;
      D[j * n + i] = d;
      W[i * n + j] = w;
      W[j * n + i] = w;
      wSumTotal += 2 * w;
    }
  }
  const rowW = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) if (j !== i) s += W[i * n + j];
    rowW[i] = s;
  }

  // Initial 1D state: project onto x-axis + tiny jitter to break ties.
  let cur = new Float64Array(n);
  if (init) {
    for (let i = 0; i < n; i++) cur[i] = init[i];
  } else {
    for (let i = 0; i < n; i++) cur[i] = points[i][0] + 1e-3 * (rng() - 0.5);
  }

  function stressOf(X: Float64Array): number {
    let s = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const r = Math.abs(X[i] - X[j]) - D[i * n + j];
        s += W[i * n + j] * r * r;
      }
    }
    // Normalize by total weight so absolute scale is O(1) for plotting.
    return s / wSumTotal;
  }

  const trajectory: number[][] = [Array.from(cur)];
  const stressTrace: number[] = [stressOf(cur)];

  let next = new Float64Array(n);
  let prev = stressTrace[0];

  for (let it = 0; it < maxIter; it++) {
    if (method === 'smacof') {
      // Damped Guttman majorization step:
      //   X_next = X + stepSize * (Guttman(X) - X)
      // Vanilla SMACOF uses stepSize = 1.0; smaller values produce many
      // smaller visible intermediate frames.
      for (let i = 0; i < n; i++) {
        let acc = 0;
        for (let j = 0; j < n; j++) {
          if (j === i) continue;
          const w = W[i * n + j];
          const diff = cur[i] - cur[j];
          const adiff = Math.abs(diff);
          const sign = adiff > 1e-12 ? diff / adiff : 0;
          acc += w * (cur[j] + D[i * n + j] * sign);
        }
        const guttman = rowW[i] > 0 ? acc / rowW[i] : cur[i];
        next[i] = cur[i] + stepSize * (guttman - cur[i]);
      }
    } else {
      // Plain gradient descent on the spring energy
      //   E(X) = Σ_{i<j} w_ij (|X_i - X_j| - d_ij)²
      // ∂E/∂X_i = 2 Σ_{j≠i} w_ij (|X_i - X_j| - d_ij) sign(X_i - X_j)
      // Each term is the Hooke's-law force from spring (i, j).
      for (let i = 0; i < n; i++) {
        let grad = 0;
        for (let j = 0; j < n; j++) {
          if (j === i) continue;
          const w = W[i * n + j];
          const diff = cur[i] - cur[j];
          const adiff = Math.abs(diff);
          const sign = adiff > 1e-12 ? diff / adiff : 0;
          // (current_length - rest_length) * direction
          const ext = adiff - D[i * n + j];
          grad += 2 * w * ext * sign;
        }
        next[i] = cur[i] - stepSize * grad;
      }
    }
    // Swap cur ↔ next so we can write into the old buffer next iteration.
    const tmp = cur;
    cur = next;
    next = tmp;

    const stress = stressOf(cur);
    trajectory.push(Array.from(cur));
    stressTrace.push(stress);

    if (Math.abs(prev - stress) / Math.max(prev, 1e-12) < tol) break;
    prev = stress;
  }

  return { trajectory, stressTrace };
}
