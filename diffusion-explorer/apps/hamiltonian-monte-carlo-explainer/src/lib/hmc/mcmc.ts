/**
 * Random-walk Metropolis-Hastings on a closed-form log-density.
 *
 * Companion to `hmc.ts` (which runs HMC with leapfrog + tf.js gradients).
 * MH here is plain — Gaussian proposal, MH ratio from a scalar log-prob —
 * so the figure can render the propose/accept/reject beats explicitly.
 */

import { boxMuller, inBounds, type Bounds, type Vec2 } from "./random";

/**
 * Scalar log-density of an isotropic Gaussian mixture
 *   p(x) = Σₖ wₖ · N(x | μₖ, σ²I)
 * computed via log-sum-exp for numerical stability across well-separated
 * modes.
 */
export function gmmLogProb(
  x: Vec2,
  means: Vec2[],
  weights: number[],
  std: number,
): number {
  const inv2sig2 = 1 / (2 * std * std);
  // Constant log Z for the 2D isotropic Gaussian: −log(2π σ²).
  const logNorm = -Math.log(2 * Math.PI * std * std);

  const logTerms: number[] = new Array(means.length);
  let maxLog = -Infinity;
  for (let k = 0; k < means.length; k++) {
    const dx = x[0] - means[k][0];
    const dy = x[1] - means[k][1];
    const lt = Math.log(weights[k]) + logNorm - (dx * dx + dy * dy) * inv2sig2;
    logTerms[k] = lt;
    if (lt > maxLog) maxLog = lt;
  }

  let acc = 0;
  for (let k = 0; k < means.length; k++) acc += Math.exp(logTerms[k] - maxLog);
  return maxLog + Math.log(acc);
}

export interface MHStep {
  /** Chain position at the start of this iteration. */
  from: Vec2;
  /** Candidate sampled from the proposal distribution. */
  proposal: Vec2;
  /** Whether the candidate was accepted (chain moves to `proposal`). */
  accepted: boolean;
  /** log α = log p(proposal) − log p(from). Useful for debugging / display. */
  logAlpha: number;
}

export interface RunMHOptions {
  start: Vec2;
  numSteps: number;
  proposalStd: number;
  logProb: (x: Vec2) => number;
  rng: () => number;
  /**
   * Optional axis-aligned rectangle. Proposals outside the box are rejected
   * before evaluating the MH ratio — purely a visualization aid to keep the
   * chain on-canvas.
   */
  bounds?: Bounds;
}

/**
 * Run a random-walk Metropolis-Hastings chain. Returns one record per
 * iteration — including rejected proposals — so playback can render the
 * reject visual without having to re-derive what the chain *would* have
 * proposed.
 */
export function runMetropolisHastings({
  start,
  numSteps,
  proposalStd,
  logProb,
  rng,
  bounds,
}: RunMHOptions): MHStep[] {
  const steps: MHStep[] = new Array(numSteps);
  let current: Vec2 = [start[0], start[1]];
  let currentLogProb = logProb(current);

  for (let s = 0; s < numSteps; s++) {
    const [z1, z2] = boxMuller(rng);
    const proposal: Vec2 = [
      current[0] + proposalStd * z1,
      current[1] + proposalStd * z2,
    ];

    const outOfBounds = bounds !== undefined && !inBounds(proposal, bounds);
    const proposalLogProb = outOfBounds ? -Infinity : logProb(proposal);
    const logAlpha = outOfBounds ? -Infinity : proposalLogProb - currentLogProb;
    const accepted = !outOfBounds && Math.log(rng()) < logAlpha;

    steps[s] = {
      from: [current[0], current[1]],
      proposal,
      accepted,
      logAlpha,
    };

    if (accepted) {
      current = proposal;
      currentLogProb = proposalLogProb;
    }
  }

  return steps;
}
