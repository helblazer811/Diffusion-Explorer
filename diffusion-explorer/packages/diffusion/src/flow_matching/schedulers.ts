import * as tf from '@tensorflow/tfjs';

/**
 * Available scheduler/integrator types for ODE sampling
 */
export type SchedulerType = 'euler' | 'euler_midpoint';

/**
 * Vector field function signature - evaluates v(x, t)
 */
export type VectorField = (
  x: tf.Tensor2D,
  t: tf.Tensor1D | tf.Tensor2D
) => tf.Tensor;

/**
 * Step function signature for ODE integrators
 * Takes current state, time bounds, and vector field evaluator
 * Returns next state
 */
export type StepFunction = (
  x_t: tf.Tensor2D,
  t_start: tf.Tensor1D | tf.Tensor2D,
  t_end: tf.Tensor1D | tf.Tensor2D,
  vectorField: VectorField
) => tf.Tensor2D;

/**
 * Options for sampling methods
 */
export interface SamplingOptions {
  /** Scheduler/integrator to use (default: 'euler_midpoint') */
  scheduler?: SchedulerType;
  /** If true, sample in reverse time (1 to 0) for inverting the flow (default: false) */
  reverse?: boolean;
}

/**
 * Conventional Euler integration step
 * x_next = x_t + dt * v(x_t, t_start)
 *
 * First-order method, simple but less accurate than higher-order methods.
 */
export function eulerStep(
  x_t: tf.Tensor2D,
  t_start: tf.Tensor1D | tf.Tensor2D,
  t_end: tf.Tensor1D | tf.Tensor2D,
  vectorField: VectorField
): tf.Tensor2D {
  return tf.tidy(() => {
    const t0 = t_start.reshape([x_t.shape[0], 1]);
    const t1 = t_end.reshape([x_t.shape[0], 1]);
    const dt = t1.sub(t0);

    const velocity = vectorField(x_t, t0);
    const update = velocity.mul(dt);
    return x_t.add(update) as tf.Tensor2D;
  });
}

/**
 * Euler Midpoint integration step (also known as modified Euler or RK2)
 *
 * 1. Half step: x_mid = x_t + 0.5 * dt * v(x_t, t_start)
 * 2. Full step: x_next = x_t + dt * v(x_mid, t_mid)
 *
 * Second-order method, more accurate than basic Euler.
 */
export function eulerMidpointStep(
  x_t: tf.Tensor2D,
  t_start: tf.Tensor1D | tf.Tensor2D,
  t_end: tf.Tensor1D | tf.Tensor2D,
  vectorField: VectorField
): tf.Tensor2D {
  return tf.tidy(() => {
    const t0 = t_start.reshape([x_t.shape[0], 1]);
    const t1 = t_end.reshape([x_t.shape[0], 1]);
    const dt = t1.sub(t0);

    // Half step to midpoint
    const half_step = vectorField(x_t, t0).mul(dt).div(2);
    const mid_point = x_t.add(half_step);
    const t_mid = t0.add(dt.div(2));

    // Full step using velocity at midpoint
    const update = vectorField(mid_point, t_mid).mul(dt);
    return x_t.add(update) as tf.Tensor2D;
  });
}

/**
 * Registry mapping scheduler names to their step functions
 */
export const SCHEDULERS: Record<SchedulerType, StepFunction> = {
  'euler': eulerStep,
  'euler_midpoint': eulerMidpointStep,
};

/**
 * Get a step function by scheduler name
 * @param scheduler The scheduler type
 * @returns The corresponding step function
 * @throws Error if scheduler type is not recognized
 */
export function getScheduler(scheduler: SchedulerType): StepFunction {
  const stepFn = SCHEDULERS[scheduler];
  if (!stepFn) {
    const validSchedulers = Object.keys(SCHEDULERS).join(', ');
    throw new Error(`Unknown scheduler: '${scheduler}'. Valid options are: ${validSchedulers}`);
  }
  return stepFn;
}
