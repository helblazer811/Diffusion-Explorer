/**
 * Adapter that turns a tensor-shaped `LogProbFn` (TensorFlow.js) into the
 * unified `GradLogProbFn` consumed by the HMC integrator. Used when the
 * target log-density doesn't have a closed-form analytic gradient and we
 * need autodiff to differentiate it.
 *
 * Each call allocates a position tensor, runs `tf.grad` and the original
 * log-prob inside one `tf.tidy`, and reads back `[logProb, gradX, gradY]`
 * with a single `dataSync()`. Slow per call (~1ms TF.js overhead) but the
 * abstraction lets HMC stay backend-agnostic.
 */

import * as tf from "@tensorflow/tfjs";
import type { GradLogProbFn, LogProbFn, Vec2 } from "./hmc";

export function autodiffGradLogProb(logProbFn: LogProbFn): GradLogProbFn {
  const gradFn = tf.grad(logProbFn as (p: tf.Tensor) => tf.Tensor);

  return (pos: Vec2) => {
    const flat = tf.tidy(() => {
      const posT = tf.tensor1d([pos[0], pos[1]]);
      const lp = logProbFn(posT);
      const g = gradFn(posT) as tf.Tensor1D;
      // Concatenate to [logProb, gx, gy] so we can read the whole result
      // back with one dataSync.
      return tf.concat([lp.reshape([1]), g]) as tf.Tensor1D;
    });
    const arr = flat.dataSync();
    flat.dispose();
    return { logProb: arr[0], grad: [arr[1], arr[2]] as Vec2 };
  };
}
