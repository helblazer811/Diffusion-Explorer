/**
 * Hamiltonian Monte Carlo. The integrator is backend-agnostic — it consumes a
 * `GradLogProbFn`, which can be either a closed-form analytic gradient (fast
 * path, used for our GMM visualizations) or an autodiff-backed adapter around
 * a TensorFlow.js `LogProbFn` (slow path, used when the target log-density
 * doesn't have a tractable closed-form gradient).
 *
 * Lemniscate helpers below still use TensorFlow.js to define a tensor-shaped
 * `LogProbFn`, which can be wrapped by `autodiffGradLogProb` (./autodiff) when
 * needed.
 */

import * as tf from "@tensorflow/tfjs";
import { boxMuller, inBounds, type Bounds, type Vec2 } from "./random";

export type { Bounds, Vec2 } from "./random";

/**
 * Tensor-shaped log-probability function. Used as the input to the autodiff
 * gradient adapter; never consumed by the HMC integrator directly.
 */
export type LogProbFn = (pos: tf.Tensor1D) => tf.Scalar;

/**
 * Unified gradient interface consumed by the HMC integrator. Returns both
 * `logProb(pos)` and `∇log p(pos)` from a single call so the leapfrog loop
 * can reuse the log-density it just computed for the MH accept step.
 */
export type GradLogProbFn = (pos: Vec2) => { logProb: number; grad: Vec2 };

// ================================================================
// Lemniscate of Bernoulli
// ================================================================

/**
 * Parametric point on the lemniscate of Bernoulli at parameter t ∈ [0, 2π].
 * Parametrization: x(t) = a·cos(t) / (1 + sin²(t))
 *                  y(t) = a·sin(t)·cos(t) / (1 + sin²(t))
 */
export function lemniscatePoint(t: number, a: number = 1.5): Vec2 {
  const cost = Math.cos(t);
  const sint = Math.sin(t);
  const denom = 1 + sint * sint;
  return [
    (a * cost) / denom,
    (a * sint * cost) / denom,
  ];
}

/**
 * Approximate the minimum distance from a point to the lemniscate curve.
 * Samples the curve uniformly and returns the minimum distance.
 */
export function distToLemniscate(pos: Vec2, numSamples: number = 500): number {
  const [px, py] = pos;
  let minDist = Infinity;

  for (let i = 0; i < numSamples; i++) {
    const t = (2 * Math.PI * i) / numSamples;
    const [cx, cy] = lemniscatePoint(t);
    const dx = px - cx;
    const dy = py - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < minDist) minDist = dist;
  }

  return minDist;
}

/**
 * Create a TensorFlow.js-compatible log-probability function for the
 * lemniscate Gaussian tube. The density is Gaussian around the curve
 * with standard deviation sigma = 0.18.
 */
export function makeLemniscateLogProb(sigma: number = 0.18): LogProbFn {
  // Precompute lemniscate sample points as a [numSamples, 2] constant tensor.
  // Log-density is a smooth-min over squared distances via log-sum-exp,
  // which keeps the computation differentiable w.r.t. pos for tf.grad.
  const numSamples = 500;
  const curveData = new Float32Array(numSamples * 2);
  for (let i = 0; i < numSamples; i++) {
    const t = (2 * Math.PI * i) / numSamples;
    const [cx, cy] = lemniscatePoint(t);
    curveData[2 * i] = cx;
    curveData[2 * i + 1] = cy;
  }
  const curvePoints = tf.tensor2d(curveData, [numSamples, 2]);
  const invTwoSigmaSq = 1 / (2 * sigma * sigma);

  return (pos: tf.Tensor1D): tf.Scalar => {
    return tf.tidy(() => {
      // diff: [numSamples, 2] = curvePoints - pos (broadcast over rows)
      const diff = tf.sub(curvePoints, pos.reshape([1, 2]));
      // sqDist: [numSamples]
      const sqDist = tf.sum(tf.square(diff), 1);
      // log( sum_i exp(-||pos - c_i||^2 / (2 sigma^2)) ) — smooth surrogate
      // for -minDist^2 / (2 sigma^2), differentiable end-to-end.
      const logits = tf.mul(sqDist, tf.scalar(-invTwoSigmaSq));
      return tf.logSumExp(logits) as tf.Scalar;
    });
  };
}

/**
 * Sample points from the lemniscate Gaussian distribution.
 * Uniform sample of the parameter t, then add Gaussian noise.
 */
export function sampleLemniscate(
  rng: () => number,
  n: number,
  sigma: number = 0.18,
  a: number = 1.5,
): Vec2[] {
  const out: Vec2[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = 2 * Math.PI * rng();
    const [cx, cy] = lemniscatePoint(t, a);
    const [z1, z2] = boxMuller(rng);
    out[i] = [cx + sigma * z1, cy + sigma * z2];
  }
  return out;
}

// ================================================================
// Hamiltonian Monte Carlo
// ================================================================

/**
 * Run a single HMC proposal using leapfrog integration.
 * Returns the trajectory of positions over numSteps leapfrog steps,
 * including the initial position at index 0. Also returns the final
 * `logProb` so `runHMCChain` can use it for MH acceptance without an
 * extra evaluation.
 *
 * Pure JS — no tensor machinery. Leapfrog calls `gradLogProbFn` twice per
 * step (half-step momentum, full-step position, half-step momentum) and
 * reuses the `logProb` returned alongside the gradient.
 */
export function runHMCLeapfrog(
  pos: Vec2,
  numSteps: number,
  stepSize: number,
  gradLogProbFn: GradLogProbFn,
  rng: () => number,
): { trajectory: Vec2[]; finalLogProb: number } {
  const [p0, p1] = boxMuller(rng);
  const half = stepSize / 2;

  let x = pos[0];
  let y = pos[1];
  let px = p0;
  let py = p1;

  const trajectory: Vec2[] = new Array(numSteps + 1);
  trajectory[0] = [x, y];

  let lastLogProb = gradLogProbFn([x, y]).logProb;

  for (let step = 0; step < numSteps; step++) {
    // Half-step in momentum: p += (h/2) · ∇log π(x)
    const g1 = gradLogProbFn([x, y]).grad;
    px += half * g1[0];
    py += half * g1[1];

    // Full step in position: x += h · p
    x += stepSize * px;
    y += stepSize * py;

    // Half-step in momentum at the new position. Capture logProb here so
    // the final iteration leaves us with logProb at the end of the trajectory.
    const r = gradLogProbFn([x, y]);
    px += half * r.grad[0];
    py += half * r.grad[1];
    lastLogProb = r.logProb;

    trajectory[step + 1] = [x, y];
  }

  return { trajectory, finalLogProb: lastLogProb };
}

/**
 * Run the full HMC chain with Metropolis-Hastings acceptance.
 * Each proposal uses leapfrog integration to generate a candidate,
 * which is accepted or rejected via MH ratio based on log-density.
 *
 * If `bounds` is supplied, proposals landing outside the box are rejected
 * outright before the MH ratio is evaluated — visualization-only behavior
 * to keep the animated chain inside the figure's domain.
 */
export function runHMCChain(
  initialPos: Vec2,
  numProposals: number,
  leapfrogSteps: number,
  stepSize: number,
  gradLogProbFn: GradLogProbFn,
  rng: () => number,
  bounds?: Bounds,
): Vec2[] {
  const result: Vec2[] = [];
  let currentPos: Vec2 = [initialPos[0], initialPos[1]];
  let currentLogProb = gradLogProbFn(currentPos).logProb;

  for (let proposal = 0; proposal < numProposals; proposal++) {
    const { trajectory, finalLogProb } = runHMCLeapfrog(
      currentPos,
      leapfrogSteps,
      stepSize,
      gradLogProbFn,
      rng,
    );

    const proposedPos = trajectory[trajectory.length - 1];
    const outOfBounds = bounds !== undefined && !inBounds(proposedPos, bounds);

    if (!outOfBounds) {
      const logAlpha = finalLogProb - currentLogProb;
      if (Math.log(rng()) < logAlpha) {
        currentPos = proposedPos;
        currentLogProb = finalLogProb;
      }
    }

    for (const pos of trajectory) {
      result.push([pos[0], pos[1]] as Vec2);
    }
  }

  return result;
}
