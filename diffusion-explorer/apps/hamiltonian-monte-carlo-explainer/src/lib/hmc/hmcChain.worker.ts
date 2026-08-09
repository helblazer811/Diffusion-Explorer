/*
 * Web worker that runs the HMC chain off the main thread so the explainer
 * page stays interactive while the chain computes. One-shot request/response
 * — no pool, no streaming.
 *
 * The request specifies a `target` descriptor that the worker maps to a
 * concrete `GradLogProbFn`: analytic for fast closed-form targets (the GMM),
 * or autodiff via TensorFlow.js when the target's gradient isn't tractable.
 * Adding a new target means adding one entry to `targetToGrad` here.
 */
import { runHMCChain, type GradLogProbFn, type Vec2 } from "./hmc";
import { makeGMMGradLogProb, makeGMMLogProb } from "./gmm";
import { autodiffGradLogProb } from "./autodiff";
import { mulberry32 } from "./random";

export type HmcTarget =
  | { kind: "gmm-analytic"; means?: Vec2[]; weights?: number[]; std?: number }
  | { kind: "gmm-autodiff"; means?: Vec2[]; weights?: number[]; std?: number };

export interface HmcChainRequest {
  type: "run";
  target: HmcTarget;
  initialPos: Vec2;
  numProposals: number;
  leapfrogSteps: number;
  stepSize: number;
  seed: number;
}

export type HmcChainResponse =
  | { type: "result"; trajectory: Float32Array }
  | { type: "error"; error: string };

let backendReady: Promise<void> | null = null;
async function ensureTfBackend(): Promise<void> {
  if (!backendReady) {
    const tf = await import("@tensorflow/tfjs");
    backendReady = tf.ready();
  }
  return backendReady;
}

async function targetToGrad(target: HmcTarget): Promise<GradLogProbFn> {
  switch (target.kind) {
    case "gmm-analytic":
      return makeGMMGradLogProb(target.means, target.weights, target.std);
    case "gmm-autodiff": {
      await ensureTfBackend();
      return autodiffGradLogProb(
        makeGMMLogProb(target.means, target.weights, target.std),
      );
    }
  }
}

self.onmessage = async (e: MessageEvent<HmcChainRequest>) => {
  try {
    const req = e.data;
    if (req.type !== "run") {
      throw new Error(`Unknown message type: ${(req as { type: string }).type}`);
    }

    const gradLogProbFn = await targetToGrad(req.target);
    const rng = mulberry32(req.seed);
    const trajectory = runHMCChain(
      req.initialPos,
      req.numProposals,
      req.leapfrogSteps,
      req.stepSize,
      gradLogProbFn,
      rng,
    );

    const flat = new Float32Array(trajectory.length * 2);
    for (let i = 0; i < trajectory.length; i++) {
      flat[2 * i] = trajectory[i][0];
      flat[2 * i + 1] = trajectory[i][1];
    }

    const response: HmcChainResponse = { type: "result", trajectory: flat };
    (self as unknown as Worker).postMessage(response, [flat.buffer]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const response: HmcChainResponse = { type: "error", error: msg };
    (self as unknown as Worker).postMessage(response);
  }
};
