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
  /** Optional caller-supplied pairwise rest lengths d_ij. Flat n×n
   *  Float64Array (row-major) or n×n nested array; only the upper triangle
   *  is read. When provided, the solver uses these as the target distances
   *  instead of computing the 2D Euclidean distance between input points
   *  — useful when the "true" distance is along an intrinsic 1D curve
   *  (e.g. arclength along a spiral) rather than the ambient embedding. */
  targetDistances?: ReadonlyArray<ReadonlyArray<number>> | Float64Array;
  /** Per-spring weight scheme.
   *  - 'sammon' (default): w_ij = 1/d_ij² — short distances dominate the
   *    energy, which is mathematically standard but causes a violent first
   *    few iterations followed by a long tail of barely-visible motion.
   *  - 'uniform': w_ij = 1 — every spring contributes equally. The
   *    relaxation paces evenly across iterations, which reads better as
   *    a "spring system slowly settling" animation.
   */
  weights?: 'sammon' | 'uniform';
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
    targetDistances,
    weights = 'sammon',
  } = options;
  const n = points.length;

  // Pairwise target distances + Sammon weights. Stored as flat n×n arrays
  // for tight inner loops. If `targetDistances` is supplied we use it as-is
  // (the caller knows the intrinsic geometry); otherwise we fall back to
  // the 2D Euclidean distance between input points.
  const D = new Float64Array(n * n);
  const W = new Float64Array(n * n);
  let wSumTotal = 0;
  const readTarget = targetDistances
    ? (targetDistances instanceof Float64Array
        ? (i: number, j: number) => (targetDistances as Float64Array)[i * n + j]
        : (i: number, j: number) =>
            (targetDistances as ReadonlyArray<ReadonlyArray<number>>)[i][j])
    : null;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let d: number;
      if (readTarget) {
        d = readTarget(i, j);
      } else {
        const dx = points[i][0] - points[j][0];
        const dy = points[i][1] - points[j][1];
        d = Math.hypot(dx, dy);
      }
      const dEps = Math.max(d, 1e-6);
      const w = weights === 'uniform' ? 1 : 1 / (dEps * dEps);
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

// ============================================================================
// 2D heavy-ball variant.
//
// The 1D solver above is a pure first-order method: each step strictly
// decreases the energy. That's the wrong physics if you want the points to
// behave like an actual spring system that overshoots its rest length and
// oscillates as it relaxes. Heavy-ball momentum gets the dynamics right
// with one extra term:
//   v_{k+1} = γ · v_k − η · ∇E(x_k)
//   x_{k+1} = x_k + v_{k+1}
// γ ∈ [0, 1) is the velocity retention (1 − damping). γ near 1 = lightly
// damped (rings out for many iterations); γ ≈ 0 collapses to plain
// gradient descent.
//
// We also drive points toward a target line y = collapseY via a per-point
// linear pull k_y · (collapseY − y). This is a separate spring on each
// point's y-coordinate, NOT part of the pairwise energy, so it doesn't
// disturb the in-line geometry — it just slowly compresses the cloud onto
// the line over the course of the run.
// ============================================================================

export interface SpringSolver2DResult {
  /** Point cloud at each iteration. trajectory[k][i] = [x, y] of point i
   *  at iteration k. */
  trajectory: [number, number][][];
  /** Energy at each iteration (same definition as σ above, computed in
   *  2D from |X_i − X_j|). */
  stressTrace: number[];
}

export interface SpringSolver2DOptions {
  /** Iteration cap. Default 800. */
  maxIter?: number;
  /** Energy-change tolerance for early termination. Default 0 (run to cap),
   *  because for an oscillating system the energy is non-monotonic and
   *  ratio-based stopping criteria don't apply. */
  tol?: number;
  /** RNG used for tie-breaking jitter. */
  rng?: () => number;
  /** Initial 2D positions. Defaults to the input `points`. */
  init?: ReadonlyArray<readonly [number, number]>;
  /** Learning rate η on the spring force. Default 1e-5. */
  stepSize?: number;
  /** Momentum coefficient γ ∈ [0, 1). Default 0.92 — visibly oscillates
   *  but eventually settles within ~hundreds of iterations. */
  momentum?: number;
  /** Per-step pull strength toward `collapseY` along y, applied as
   *  v_y += k_y · (collapseY − y). Default 5e-4. The animation is more
   *  legible when this is small enough that y oscillation persists for
   *  many iterations. */
  collapseStrength?: number;
  /** Target y-coordinate every point eventually settles onto. */
  collapseY?: number;
  /** Pairwise rest lengths. Same shape as the 1D solver's option. */
  targetDistances?: ReadonlyArray<ReadonlyArray<number>> | Float64Array;
  /** Per-spring weight scheme. Same as the 1D solver's option. */
  weights?: 'sammon' | 'uniform';
}

export function solveSpringSystem2D(
  points: ReadonlyArray<readonly [number, number]>,
  options: SpringSolver2DOptions = {},
): SpringSolver2DResult {
  const {
    maxIter = 800,
    tol = 0,
    rng = Math.random,
    init,
    stepSize = 1e-5,
    momentum = 0.92,
    collapseStrength = 5e-4,
    collapseY = 0,
    targetDistances,
    weights = 'uniform',
  } = options;
  const n = points.length;

  const D = new Float64Array(n * n);
  const W = new Float64Array(n * n);
  let wSumTotal = 0;
  const readTarget = targetDistances
    ? (targetDistances instanceof Float64Array
        ? (i: number, j: number) => (targetDistances as Float64Array)[i * n + j]
        : (i: number, j: number) =>
            (targetDistances as ReadonlyArray<ReadonlyArray<number>>)[i][j])
    : null;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let d: number;
      if (readTarget) {
        d = readTarget(i, j);
      } else {
        const dx = points[i][0] - points[j][0];
        const dy = points[i][1] - points[j][1];
        d = Math.hypot(dx, dy);
      }
      const dEps = Math.max(d, 1e-6);
      const w = weights === 'uniform' ? 1 : 1 / (dEps * dEps);
      D[i * n + j] = d;
      D[j * n + i] = d;
      W[i * n + j] = w;
      W[j * n + i] = w;
      wSumTotal += 2 * w;
    }
  }

  const X = new Float64Array(n);
  const Y = new Float64Array(n);
  const VX = new Float64Array(n);
  const VY = new Float64Array(n);
  const seed = init ?? points;
  for (let i = 0; i < n; i++) {
    X[i] = seed[i][0] + 1e-3 * (rng() - 0.5);
    Y[i] = seed[i][1] + 1e-3 * (rng() - 0.5);
  }

  function stressOf(): number {
    let s = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = X[i] - X[j];
        const dy = Y[i] - Y[j];
        const r = Math.hypot(dx, dy) - D[i * n + j];
        s += W[i * n + j] * r * r;
      }
    }
    return s / wSumTotal;
  }

  const trajectory: [number, number][][] = [];
  const stressTrace: number[] = [];
  function snapshot() {
    const frame: [number, number][] = new Array(n);
    for (let i = 0; i < n; i++) frame[i] = [X[i], Y[i]];
    trajectory.push(frame);
    stressTrace.push(stressOf());
  }
  snapshot();

  let prev = stressTrace[0];
  for (let it = 0; it < maxIter; it++) {
    // Compute spring forces (negative gradient of the pairwise energy).
    // Force on i from j is along the unit vector from j to i, magnitude
    // 2·w·(|x_i − x_j| − d_ij). We accumulate Δv per point first so we
    // don't bias later points within the iteration.
    const dvx = new Float64Array(n);
    const dvy = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let fx = 0;
      let fy = 0;
      const xi = X[i];
      const yi = Y[i];
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const dx = xi - X[j];
        const dy = yi - Y[j];
        const len = Math.hypot(dx, dy);
        if (len < 1e-12) continue;
        const w = W[i * n + j];
        const ext = len - D[i * n + j];
        const k = 2 * w * ext / len; // shared scalar for the unit vector
        fx += k * dx;
        fy += k * dy;
      }
      // Negative gradient → minus sign on the accumulated force above.
      dvx[i] = -stepSize * fx;
      dvy[i] = -stepSize * fy;
    }
    // Heavy-ball update + soft attractor on y.
    for (let i = 0; i < n; i++) {
      VX[i] = momentum * VX[i] + dvx[i];
      VY[i] =
        momentum * VY[i] + dvy[i] + collapseStrength * (collapseY - Y[i]);
      X[i] += VX[i];
      Y[i] += VY[i];
    }
    snapshot();

    if (tol > 0) {
      const cur = stressTrace[stressTrace.length - 1];
      if (Math.abs(prev - cur) / Math.max(prev, 1e-12) < tol) break;
      prev = cur;
    }
  }

  return { trajectory, stressTrace };
}
