import * as tf from '@tensorflow/tfjs';

/**
 * Available scheduler types for diffusion sampling
 */
export type DiffusionSchedulerType = 'ddpm' | 'ddim';

/**
 * Noise prediction function signature - evaluates epsilon(x_t, t)
 */
export type NoisePredictor = (
    x_t: tf.Tensor2D,
    t: tf.Tensor1D
) => tf.Tensor2D;

/**
 * Diffusion step function signature
 * Takes current noisy state, timestep, noise schedule params, and noise predictor
 * Returns previous (less noisy) state
 */
export type DiffusionStepFunction = (
    x_t: tf.Tensor2D,
    t: tf.Tensor1D,
    noisePredictor: NoisePredictor,
    scheduleParams: DiffusionScheduleParams
) => tf.Tensor2D;

/**
 * Pre-computed noise schedule parameters for efficient sampling
 */
export interface DiffusionScheduleParams {
    T: number;
    betas: tf.Tensor1D;
    alphas: tf.Tensor1D;
    alphasCumprod: tf.Tensor1D;
    alphasCumprodPrev: tf.Tensor1D;
    sqrtAlphasCumprod: tf.Tensor1D;
    sqrtOneMinusAlphasCumprod: tf.Tensor1D;
    sqrtInvAlphasCumprod: tf.Tensor1D;
    sqrtInvAlphasCumprodMinusOne: tf.Tensor1D;
    variance: tf.Tensor1D;
    posteriorCoef1: tf.Tensor1D;
    posteriorCoef2: tf.Tensor1D;
}

/**
 * Options for diffusion sampling methods
 */
export interface DiffusionSamplingOptions {
    /** Scheduler to use (default: 'ddpm') */
    scheduler?: DiffusionSchedulerType;
}

/**
 * DDPM (Denoising Diffusion Probabilistic Models) reverse step
 *
 * Implements the standard DDPM sampling step:
 * 1. Predict noise from current state
 * 2. Compute predicted original sample x_0
 * 3. Compute mean for previous timestep
 * 4. Add stochastic noise (except at t=0)
 */
export function ddpmStep(
    x_t: tf.Tensor2D,
    t: tf.Tensor1D,
    noisePredictor: NoisePredictor,
    scheduleParams: DiffusionScheduleParams
): tf.Tensor2D {
    return tf.tidy(() => {
        const tInt = t.cast('int32');

        // Predict noise
        const eps_hat = noisePredictor(x_t, tInt);

        // Reconstruct x_0 estimate: x_0 = (x_t - sqrt(1-alpha_bar) * eps) / sqrt(alpha_bar)
        const s1 = tf.gather(scheduleParams.sqrtInvAlphasCumprod, tInt).expandDims(1);
        const s2 = tf.gather(scheduleParams.sqrtInvAlphasCumprodMinusOne, tInt).expandDims(1);
        const pred_original_sample = x_t.mul(s1).sub(eps_hat.mul(s2));

        // Compute posterior mean: mu_t = c1 * x_0 + c2 * x_t
        const c1 = tf.gather(scheduleParams.posteriorCoef1, tInt).expandDims(1);
        const c2 = tf.gather(scheduleParams.posteriorCoef2, tInt).expandDims(1);
        const pred_prev_sample = x_t.mul(c2).add(pred_original_sample.mul(c1));

        // Add noise (except at t=0)
        const noise = tf.randomNormal(x_t.shape as [number, number]);
        const varTerm = tf.gather(scheduleParams.variance, tInt).sqrt().expandDims(1).mul(noise);
        const isZero = tInt.equal(tf.scalar(0, 'int32')).expandDims(1);

        return pred_prev_sample.add(varTerm.mul(tf.cast(isZero.logicalNot(), 'float32')));
    });
}

/**
 * DDIM (Denoising Diffusion Implicit Models) reverse step
 *
 * Implements the deterministic DDIM sampling step:
 * Uses a different parameterization that allows for deterministic sampling
 * and the ability to skip steps for faster generation.
 */
export function ddimStep(
    x_t: tf.Tensor2D,
    t: tf.Tensor1D,
    noisePredictor: NoisePredictor,
    scheduleParams: DiffusionScheduleParams,
    eta: number = 0.0  // eta=0 is deterministic, eta=1 is equivalent to DDPM
): tf.Tensor2D {
    return tf.tidy(() => {
        const tInt = t.cast('int32');

        // Predict noise
        const eps_hat = noisePredictor(x_t, tInt);

        // Get alpha values
        const alpha_bar_t = tf.gather(scheduleParams.alphasCumprod, tInt).expandDims(1);
        const alpha_bar_prev = tf.gather(scheduleParams.alphasCumprodPrev, tInt).expandDims(1);

        // Predict x_0
        const pred_x0 = x_t.sub(eps_hat.mul(tf.sqrt(tf.sub(1, alpha_bar_t)))).div(tf.sqrt(alpha_bar_t));

        // Compute direction pointing to x_t
        const sigma_t = tf.sqrt(tf.sub(1, alpha_bar_prev).div(tf.sub(1, alpha_bar_t)))
            .mul(tf.sqrt(tf.sub(1, alpha_bar_t.div(alpha_bar_prev))))
            .mul(eta);

        // Compute "direction pointing to x_t"
        const dir_xt = tf.sqrt(tf.sub(1, alpha_bar_prev).sub(sigma_t.square())).mul(eps_hat);

        // Compute x_{t-1}
        const x_prev = tf.sqrt(alpha_bar_prev).mul(pred_x0).add(dir_xt);

        // Add noise if eta > 0
        if (eta > 0) {
            const noise = tf.randomNormal(x_t.shape as [number, number]);
            return x_prev.add(sigma_t.mul(noise)) as tf.Tensor2D;
        }

        return x_prev as tf.Tensor2D;
    });
}

/**
 * Registry mapping scheduler names to their step functions
 */
export const DIFFUSION_SCHEDULERS: Record<DiffusionSchedulerType, DiffusionStepFunction> = {
    'ddpm': ddpmStep,
    'ddim': (x_t, t, noisePredictor, scheduleParams) => ddimStep(x_t, t, noisePredictor, scheduleParams, 0.0),
};

/**
 * Get a diffusion step function by scheduler name
 * @param scheduler The scheduler type
 * @returns The corresponding step function
 * @throws Error if scheduler type is not recognized
 */
export function getDiffusionScheduler(scheduler: DiffusionSchedulerType): DiffusionStepFunction {
    const stepFn = DIFFUSION_SCHEDULERS[scheduler];
    if (!stepFn) {
        const validSchedulers = Object.keys(DIFFUSION_SCHEDULERS).join(', ');
        throw new Error(`Unknown diffusion scheduler: '${scheduler}'. Valid options are: ${validSchedulers}`);
    }
    return stepFn;
}

/**
 * Create diffusion schedule parameters from beta schedule
 * @param T Total number of timesteps
 * @param betaStart Starting beta value
 * @param betaEnd Ending beta value
 * @returns Pre-computed schedule parameters
 */
export function createDiffusionSchedule(
    T: number = 1000,
    betaStart: number = 1e-4,
    betaEnd: number = 2e-2
): DiffusionScheduleParams {
    const betas = tf.linspace(betaStart, betaEnd, T);
    const alphas = tf.sub(1, betas);
    const alphasCumprod = tf.cumprod(alphas);
    const sqrtAlphasCumprod = tf.sqrt(alphasCumprod);
    const sqrtOneMinusAlphasCumprod = tf.sqrt(tf.sub(1, alphasCumprod));
    const sqrtInvAlphasCumprod = tf.sqrt(tf.div(1, alphasCumprod));
    const sqrtInvAlphasCumprodMinusOne = tf.sqrt(tf.sub(tf.div(1, alphasCumprod), 1));
    const alphasCumprodPrev = tf.concat([tf.ones([1]), alphasCumprod.slice([0], [T - 1])]);
    const variance = betas.mul(tf.sub(1, alphasCumprodPrev)).div(tf.sub(1, alphasCumprod)).clipByValue(1e-20, 1e20);

    const posteriorCoef1 = tf.tidy(() =>
        betas.mul(tf.sqrt(alphasCumprodPrev)).div(tf.sub(1, alphasCumprod))
    );
    const posteriorCoef2 = tf.tidy(() =>
        tf.sub(1, alphasCumprodPrev).mul(tf.sqrt(alphas)).div(tf.sub(1, alphasCumprod))
    );

    return {
        T,
        betas,
        alphas,
        alphasCumprod,
        alphasCumprodPrev,
        sqrtAlphasCumprod,
        sqrtOneMinusAlphasCumprod,
        sqrtInvAlphasCumprod,
        sqrtInvAlphasCumprodMinusOne,
        variance,
        posteriorCoef1,
        posteriorCoef2,
    };
}
