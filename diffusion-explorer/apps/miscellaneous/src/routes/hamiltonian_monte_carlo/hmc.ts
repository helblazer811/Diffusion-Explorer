/**
 * Hamiltonian Monte Carlo on a lemniscate Gaussian target.
 * Uses TensorFlow.js for automatic differentiation of the log-density.
 */

import * as tf from "@tensorflow/tfjs";
import { boxMuller, mulberry32 } from "../svgd/svgd";

export type Vec2 = [number, number];

/**
 * Standard interface for a log-probability function used by HMC.
 * Takes a position as a TensorFlow 1D tensor and returns a scalar tensor.
 */
export type LogProbFn = (pos: tf.Tensor1D) => tf.Scalar;

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
 *
 * Returns a function that takes a tf.Tensor1D position and returns
 * the log-density as a tf.Scalar. The function is defined inside
 * tf.tidy() so it can be passed to tf.grad.
 */
export function makeLemniscateLogProb(sigma: number = 0.18): LogProbFn {
  return (pos: tf.Tensor1D): tf.Scalar => {
    return tf.tidy(() => {
      // Convert tensor to array to compute distance to lemniscate.
      const posArray = pos.dataSync();
      const px = posArray[0];
      const py = posArray[1];

      // Compute minimum distance to the lemniscate curve.
      // Sample the curve parametrically.
      let minDist = Infinity;
      const numSamples = 500;
      for (let i = 0; i < numSamples; i++) {
        const t = (2 * Math.PI * i) / numSamples;
        const [cx, cy] = lemniscatePoint(t);
        const dx = px - cx;
        const dy = py - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < minDist) minDist = dist;
      }

      // Log-density: Gaussian with std sigma around the curve.
      const logProb = -(minDist * minDist) / (2 * sigma * sigma);
      return tf.scalar(logProb);
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
 * including the initial position at index 0.
 *
 * @param pos Initial position
 * @param numSteps Number of leapfrog steps
 * @param stepSize Step size (ε in the leapfrog update)
 * @param logProbFn Differentiable log-probability function (via tf.grad)
 * @param rng Random number generator
 * @returns Array of positions [pos_0, pos_1, ..., pos_numSteps]
 */
export function runHMCLeapfrog(
  pos: Vec2,
  numSteps: number,
  stepSize: number,
  logProbFn: LogProbFn,
  rng: () => number,
): Vec2[] {
  const trajectory: Vec2[] = new Array(numSteps + 1);
  trajectory[0] = [...pos];

  // Sample random momentum p ~ N(0, I)
  const [p0, p1] = [
    (function () {
      const [u1, u2] = [Math.max(rng(), 1e-12), rng()];
      const r = Math.sqrt(-2 * Math.log(u1));
      return r * Math.cos(2 * Math.PI * u2);
    })(),
    (function () {
      const [u1, u2] = [Math.max(rng(), 1e-12), rng()];
      const r = Math.sqrt(-2 * Math.log(u1));
      return r * Math.cos(2 * Math.PI * u2);
    })(),
  ];

  // Create gradient function from logProbFn (cast to handle tf.grad typing).
  const gradLogProb = tf.grad(logProbFn as (p: tf.Tensor) => tf.Tensor);

  let [x, y] = pos;
  let [px, py] = [p0, p1];

  // Leapfrog integration.
  for (let step = 0; step < numSteps; step++) {
    // Half-step in momentum
    const posTensor = tf.tensor1d([x, y]);
    const grad = gradLogProb(posTensor);
    const gradArray = grad.dataSync();
    px += (stepSize / 2) * gradArray[0];
    py += (stepSize / 2) * gradArray[1];
    grad.dispose();
    posTensor.dispose();

    // Full step in position
    x += stepSize * px;
    y += stepSize * py;

    // Half-step in momentum
    const posTensor2 = tf.tensor1d([x, y]);
    const grad2 = gradLogProb(posTensor2);
    const gradArray2 = grad2.dataSync();
    px += (stepSize / 2) * gradArray2[0];
    py += (stepSize / 2) * gradArray2[1];
    grad2.dispose();
    posTensor2.dispose();

    trajectory[step + 1] = [x, y];
  }

  return trajectory;
}

/**
 * Run the full HMC chain with Metropolis-Hastings acceptance.
 * Each proposal uses leapfrog integration to generate a candidate,
 * which is accepted or rejected via MH ratio based on log-density.
 *
 * @param initialPos Starting position
 * @param numProposals Number of MH proposals to generate
 * @param leapfrogSteps Steps per leapfrog trajectory
 * @param stepSize Leapfrog step size
 * @param logProbFn Differentiable log-probability function
 * @param rng Random number generator
 * @returns Flat array of all positions from all accepted trajectories
 */
export function runHMCChain(
  initialPos: Vec2,
  numProposals: number,
  leapfrogSteps: number,
  stepSize: number,
  logProbFn: LogProbFn,
  rng: () => number,
): Vec2[] {
  const result: Vec2[] = [];
  let currentPos: Vec2 = [...initialPos];

  // Compute initial log-density (for acceptance ratio).
  const posInitTensor = tf.tensor1d(currentPos);
  let currentLogProb = logProbFn(posInitTensor).dataSync()[0];
  posInitTensor.dispose();

  for (let proposal = 0; proposal < numProposals; proposal++) {
    // Generate leapfrog trajectory from current position.
    const trajectory = runHMCLeapfrog(
      currentPos,
      leapfrogSteps,
      stepSize,
      logProbFn,
      rng,
    );

    // Proposed position is the last step of the trajectory.
    const proposedPos = trajectory[trajectory.length - 1];

    // Compute log-density at proposed position.
    const proposedTensor = tf.tensor1d(proposedPos);
    const proposedLogProb = logProbFn(proposedTensor).dataSync()[0];
    proposedTensor.dispose();

    // Metropolis-Hastings acceptance ratio (log scale).
    const logAlpha = proposedLogProb - currentLogProb;
    const accept = Math.log(rng()) < logAlpha;

    if (accept) {
      currentPos = proposedPos;
      currentLogProb = proposedLogProb;
    }

    // Concatenate entire trajectory to result.
    for (const pos of trajectory) {
      result.push([pos[0], pos[1]] as Vec2);
    }
  }

  return result;
}
