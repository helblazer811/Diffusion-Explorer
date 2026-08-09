/**
 * Shared 3-Gaussian-mixture target distribution used across the HMC explainer.
 *
 * Modes are arranged as a small triangle so the three components are clearly
 * distinct in the heatmap but close enough that a Gaussian random walk can
 * plausibly hop between them — and so greedy acceptance visibly collapses to
 * whichever mode the chain happens to find first.
 */

import * as tf from "@tensorflow/tfjs";
import { boxMuller, type Vec2 } from "./random";
import { gmmLogProb as gmmLogProbScalar } from "./mcmc";
import type { GradLogProbFn, LogProbFn } from "./hmc";

export const GMM_MEANS: Vec2[] = [
  [-0.7, -0.4],
  [0.7, -0.4],
  [0.0, 0.7],
];
export const GMM_WEIGHTS: number[] = [1 / 3, 1 / 3, 1 / 3];
export const GMM_STD = 0.28;

/** Draw a single sample from the shared GMM. */
export function sampleGMM(
  rng: () => number,
  means: Vec2[] = GMM_MEANS,
  weights: number[] = GMM_WEIGHTS,
  std: number = GMM_STD,
): Vec2 {
  const u = rng();
  let acc = 0;
  let k = means.length - 1;
  for (let i = 0; i < means.length; i++) {
    acc += weights[i];
    if (u < acc) {
      k = i;
      break;
    }
  }
  const [z1, z2] = boxMuller(rng);
  return [means[k][0] + std * z1, means[k][1] + std * z2];
}

/** Convenience: draw `n` samples from the shared GMM. */
export function sampleGMMBatch(
  rng: () => number,
  n: number,
  means: Vec2[] = GMM_MEANS,
  weights: number[] = GMM_WEIGHTS,
  std: number = GMM_STD,
): Vec2[] {
  const out: Vec2[] = new Array(n);
  for (let i = 0; i < n; i++) out[i] = sampleGMM(rng, means, weights, std);
  return out;
}

/** Scalar log-density of the shared GMM at a single point. */
export function gmmLogProbAt(
  x: Vec2,
  means: Vec2[] = GMM_MEANS,
  weights: number[] = GMM_WEIGHTS,
  std: number = GMM_STD,
): number {
  return gmmLogProbScalar(x, means, weights, std);
}

/**
 * Closed-form gradient + log-probability for the shared GMM, in pure JS.
 * For p(x) = Σₖ wₖ · N(x | μₖ, σ²I):
 *   lₖ = log wₖ + logNorm − ‖x − μₖ‖² / (2σ²)
 *   log p(x) = LSE_k(lₖ)
 *   rₖ = exp(lₖ − log p(x))         (component responsibilities, sum to 1)
 *   ∇log p(x) = Σₖ rₖ · (μₖ − x) / σ²
 *
 * Returns both `logProb` and `grad` from one pass — the HMC leapfrog reuses
 * the log-density it just computed for the MH accept step.
 */
export function makeGMMGradLogProb(
  means: Vec2[] = GMM_MEANS,
  weights: number[] = GMM_WEIGHTS,
  std: number = GMM_STD,
): GradLogProbFn {
  const K = means.length;
  const inv2sig2 = 1 / (2 * std * std);
  const invSig2 = 1 / (std * std);
  const logNorm = -Math.log(2 * Math.PI * std * std);
  const logWeights = weights.map((w) => Math.log(w));

  // Per-call scratch is small (K terms); allocate once and reuse.
  const logTerms = new Float64Array(K);

  return (pos: Vec2) => {
    let maxLog = -Infinity;
    for (let k = 0; k < K; k++) {
      const dx = pos[0] - means[k][0];
      const dy = pos[1] - means[k][1];
      const lt = logWeights[k] + logNorm - (dx * dx + dy * dy) * inv2sig2;
      logTerms[k] = lt;
      if (lt > maxLog) maxLog = lt;
    }

    let sumExp = 0;
    for (let k = 0; k < K; k++) sumExp += Math.exp(logTerms[k] - maxLog);
    const logProb = maxLog + Math.log(sumExp);

    let gx = 0;
    let gy = 0;
    for (let k = 0; k < K; k++) {
      // responsibility rₖ = exp(lₖ − logProb)
      const r = Math.exp(logTerms[k] - logProb);
      gx += r * (means[k][0] - pos[0]);
      gy += r * (means[k][1] - pos[1]);
    }
    gx *= invSig2;
    gy *= invSig2;

    return { logProb, grad: [gx, gy] as Vec2 };
  };
}

/**
 * TensorFlow.js log-probability function for the shared GMM. Used as input
 * to the autodiff gradient adapter (./autodiff) when the autodiff backend
 * is selected. The fast path (`makeGMMGradLogProb` above) does not use this.
 */
export function makeGMMLogProb(
  means: Vec2[] = GMM_MEANS,
  weights: number[] = GMM_WEIGHTS,
  std: number = GMM_STD,
): LogProbFn {
  const meansData = new Float32Array(means.length * 2);
  for (let i = 0; i < means.length; i++) {
    meansData[2 * i] = means[i][0];
    meansData[2 * i + 1] = means[i][1];
  }
  const meanTensor = tf.tensor2d(meansData, [means.length, 2]);
  const logWeights = tf.tensor1d(weights.map((w) => Math.log(w)));
  const invTwoSigmaSq = 1 / (2 * std * std);
  // 2D isotropic Gaussian normalizer: −log(2π σ²).
  const logNorm = -Math.log(2 * Math.PI * std * std);

  return (pos: tf.Tensor1D): tf.Scalar => {
    return tf.tidy(() => {
      const diff = tf.sub(meanTensor, pos.reshape([1, 2]));
      const sqDist = tf.sum(tf.square(diff), 1);
      const logits = tf.add(
        tf.add(logWeights, tf.scalar(logNorm)),
        tf.mul(sqDist, tf.scalar(-invTwoSigmaSq)),
      );
      return tf.logSumExp(logits) as tf.Scalar;
    });
  };
}
