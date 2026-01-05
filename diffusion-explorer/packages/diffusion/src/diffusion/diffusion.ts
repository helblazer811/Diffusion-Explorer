import * as tf from '@tensorflow/tfjs';
import { Model } from '../interfaces';
import { generateUniformGridSamples } from '../utils';
import {
    DiffusionSchedulerType,
    DiffusionSamplingOptions,
    DiffusionScheduleParams,
    createDiffusionSchedule,
    getDiffusionScheduler
} from './schedulers';

export class DiffusionModel extends Model {
    readonly T: number;
    readonly scheduleParams: DiffusionScheduleParams;

    constructor(
        dim: number = 2,
        hidden: number = 128,
        T: number = 1000,
        betaStart: number = 1e-4,
        betaEnd: number = 2e-2
    ) {
        super(dim, hidden);
        this.T = T;
        this.scheduleParams = createDiffusionSchedule(T, betaStart, betaEnd);
    }

    /**
     * Train the diffusion model with denoising score matching
     * @param data tf.Tensor2D of shape [num_samples, dim]
     * @param epochs number of epochs to train the model
     * @param batchSize number of samples to use in each batch
     * @param updateInterval number of epochs to wait before running intermediate sampling
     * @param stopTraining function to check if training should stop
     * @param endEpochCallback function to call at the end of each epoch with (epoch, samples, loss)
     * @returns Promise<void>
     */
    async train(
        data: tf.Tensor2D,
        epochs: number = 1000,
        batchSize: number = 32,
        updateInterval: number = 50,
        stopTraining: () => boolean = () => false,
        endEpochCallback: (epoch: number, intermediateSamples: number[][] | null, loss?: number) => void = () => {},
    ): Promise<void> {
        console.log("Diffusion training started...");
        console.log("Training data shape: ", data.shape);

        const N = data.shape[0];
        const optimizer = tf.train.adam(1e-4);
        const mse = (a: tf.Tensor, b: tf.Tensor) => tf.losses.meanSquaredError(a, b);

        const numBatches = Math.ceil(N / batchSize);

        for (let epoch = 0; epoch < epochs; epoch++) {
            // Shuffle indices for each epoch
            const indices = tf.util.createShuffledIndices(N);

            // Track epoch loss
            let epochLoss = 0;
            let batchCount = 0;

            for (let batchIdx = 0; batchIdx < numBatches; batchIdx++) {
                const batchLoss = tf.tidy(() => {
                    // Get batch indices
                    const batchIndicesArray = indices.slice(
                        batchIdx * batchSize,
                        Math.min((batchIdx + 1) * batchSize, N)
                    );
                    const batchIndices = tf.tensor1d(Array.from(batchIndicesArray), 'int32');

                    const x0 = tf.gather(data, batchIndices) as tf.Tensor2D;
                    const actualBatchSize = x0.shape[0];

                    // Sample random Gaussian noise
                    const noise = tf.randomNormal([actualBatchSize, this.dim]);

                    // Sample random timesteps t in [0, T)
                    const tInt = tf.randomUniform([actualBatchSize], 0, this.T, 'int32');

                    // Add noise to x0: x_t = sqrt(alpha_bar_t) * x0 + sqrt(1 - alpha_bar_t) * noise
                    const x_t = this.addNoise(x0, noise, tInt);

                    // Optimize: predict noise from x_t
                    let lossValue = 0;
                    optimizer.minimize(() => {
                        const eps = this.forward(x_t, tInt);
                        const loss = mse(noise, eps);
                        lossValue = loss.dataSync()[0];
                        return loss;
                    });

                    return lossValue;
                });

                epochLoss += batchLoss;
                batchCount++;
            }

            // Compute average epoch loss
            const avgEpochLoss = epochLoss / batchCount;

            // Run intermediate sampling
            let intermediateSamples: number[][] | null = null;
            if (epoch % updateInterval === 0) {
                const allTimeSamples = await this.sample(
                    500,  // number of samples
                    100   // number of steps
                );
                if (allTimeSamples) {
                    const lastTimeStep = allTimeSamples.gather(allTimeSamples.shape[0] - 1, 0);
                    intermediateSamples = lastTimeStep.arraySync() as number[][];
                    lastTimeStep.dispose();
                    allTimeSamples.dispose();
                }
            }

            // Run the end epoch callback
            endEpochCallback(epoch, intermediateSamples, avgEpochLoss);

            // Yield control to the event loop to handle stop events
            await tf.nextFrame();

            // Check if training should stop
            if (stopTraining()) {
                console.log("Training stopped by user.");
                break;
            }
        }
    }

    /**
     * Add noise to clean samples according to the forward diffusion process
     * x_t = sqrt(alpha_bar_t) * x_0 + sqrt(1 - alpha_bar_t) * noise
     * @param x0 Clean samples [batch, dim]
     * @param noise Gaussian noise [batch, dim]
     * @param tInt Integer timesteps [batch]
     * @returns Noisy samples x_t [batch, dim]
     */
    addNoise(x0: tf.Tensor2D, noise: tf.Tensor2D, tInt: tf.Tensor1D): tf.Tensor2D {
        return tf.tidy(() => {
            const s1 = tf.gather(this.scheduleParams.sqrtAlphasCumprod, tInt).expandDims(1);
            const s2 = tf.gather(this.scheduleParams.sqrtOneMinusAlphasCumprod, tInt).expandDims(1);
            return x0.mul(s1).add(noise.mul(s2)) as tf.Tensor2D;
        });
    }

    /**
     * Predict noise from noisy input at timestep t
     * @param x_t Noisy samples [batch, dim]
     * @param t Timesteps [batch] (integers)
     * @returns Predicted noise [batch, dim]
     */
    forward(x_t: tf.Tensor2D, t: tf.Tensor1D | tf.Tensor2D): tf.Tensor2D {
        return tf.tidy(() => {
            const t_expanded = t.reshape([x_t.shape[0], 1]);
            // Scale timestep to [0, 1] for input conditioning
            const t_scaled = t_expanded.div(this.T);
            const input = tf.concat([x_t, t_scaled], 1);
            return this.model.predict(input) as tf.Tensor2D;
        });
    }

    /**
     * Perform one reverse diffusion step from timestep t to t-1
     * @param x_t Current noisy state [batch, dim]
     * @param t_start Current timestep [batch] (integers)
     * @param scheduler The scheduler to use (default: 'ddpm')
     * @returns Previous (less noisy) state [batch, dim]
     */
    step(
        x_t: tf.Tensor2D,
        t_start: tf.Tensor1D | tf.Tensor2D,
        scheduler: DiffusionSchedulerType = 'ddpm'
    ): tf.Tensor2D {
        const stepFn = getDiffusionScheduler(scheduler);
        const tInt = (t_start.rank === 2 ? t_start.squeeze() : t_start) as tf.Tensor1D;
        return stepFn(
            x_t,
            tInt,
            (x, t) => this.forward(x, t),
            this.scheduleParams
        );
    }

    /**
     * Generate samples by running the reverse diffusion process
     * @param num_samples Number of samples to generate
     * @param num_total_steps Number of reverse steps (can be less than T for faster sampling)
     * @param options Sampling options (scheduler, etc.)
     * @param perStepCallback Optional callback invoked after each step with (step, x_t)
     * @param shouldStop Optional callback to check if sampling should be cancelled
     * @returns Promise<tf.Tensor3D | null> - Trajectory [num_steps, num_samples, dim], null if cancelled
     */
    async sample(
        num_samples: number,
        num_total_steps: number = this.T,
        options: DiffusionSamplingOptions = {},
        perStepCallback?: (step: number, x_t: number[][]) => void,
        shouldStop: () => boolean = () => false
    ): Promise<tf.Tensor3D | null> {
        // Draw initial samples from Gaussian distribution
        const initial_points = tf.randomNormal([num_samples, this.dim]);

        // Delegate to sample_from_initial_points
        return this.sample_from_initial_points(
            initial_points,
            num_total_steps,
            options,
            perStepCallback,
            shouldStop
        );
    }

    /**
     * Generate samples starting from given initial noisy points
     * @param initial_points Initial noisy samples [num_samples, dim]
     * @param num_total_steps Number of reverse steps
     * @param options Sampling options
     * @param perStepCallback Optional callback invoked after each step
     * @param shouldStop Optional callback to check if sampling should be cancelled
     * @returns Promise<tf.Tensor3D | null> - Trajectory, null if cancelled
     */
    async sample_from_initial_points(
        initial_points: tf.Tensor2D,
        num_total_steps: number = this.T,
        options: DiffusionSamplingOptions = {},
        perStepCallback?: (step: number, x_t: number[][]) => void,
        shouldStop: () => boolean = () => false
    ): Promise<tf.Tensor3D | null> {
        const scheduler = options.scheduler ?? 'ddpm';
        const num_samples = initial_points.shape[0];

        // Compute step schedule (which timesteps to use)
        // If num_total_steps < T, we skip some steps
        const stepSize = Math.floor(this.T / num_total_steps);
        const timesteps: number[] = [];
        for (let t = this.T - 1; t >= 0; t -= stepSize) {
            timesteps.push(t);
        }
        // Ensure we end at 0
        if (timesteps[timesteps.length - 1] !== 0) {
            timesteps.push(0);
        }

        let x_t: tf.Tensor2D = initial_points;
        const trajectory: tf.Tensor2D[] = [];
        trajectory.push(x_t);

        for (let i = 0; i < timesteps.length - 1; i++) {
            // Check for cancellation
            if (shouldStop()) {
                trajectory.forEach(t => t.dispose());
                return null;
            }

            const t = timesteps[i];

            // Perform reverse step
            const x_next = tf.tidy(() => {
                const tInt = tf.fill([num_samples], t, 'int32') as tf.Tensor1D;
                return this.step(x_t, tInt, scheduler);
            });

            // Dispose previous if not the initial points
            if (i > 0) {
                x_t.dispose();
            }
            x_t = x_next;
            trajectory.push(x_t);

            // Call per-step callback if provided
            if (perStepCallback) {
                perStepCallback(i, x_t.arraySync() as number[][]);
            }

            // Yield to event loop
            await tf.nextFrame();
        }

        // Stack trajectory into a single tensor
        const result = tf.stack(trajectory);

        // Dispose intermediate tensors (except initial_points which we don't own)
        for (let i = 1; i < trajectory.length; i++) {
            trajectory[i].dispose();
        }

        return result as tf.Tensor3D;
    }

    /**
     * Sample from a uniform grid of initial noisy points
     * @param gridResolution Number of points along each axis
     * @param domainRange The domain range for x and y coordinates
     * @param num_total_steps Number of reverse diffusion steps
     * @param options Sampling options
     * @param perStepCallback Optional callback invoked after each step
     * @param shouldStop Optional callback to check if sampling should be cancelled
     * @returns Promise<tf.Tensor3D | null> - Trajectory, null if cancelled
     */
    async sample_grid(
        gridResolution: number,
        domainRange: { xMin: number; xMax: number; yMin: number; yMax: number },
        num_total_steps: number = this.T,
        options: DiffusionSamplingOptions = {},
        perStepCallback?: (step: number, x_t: number[][]) => void,
        shouldStop: () => boolean = () => false
    ): Promise<tf.Tensor3D | null> {
        // Generate uniform grid as tensor
        const initialPoints = generateUniformGridSamples(gridResolution, domainRange, true);

        // Sample from the initial points
        return this.sample_from_initial_points(
            initialPoints,
            num_total_steps,
            options,
            perStepCallback,
            shouldStop
        );
    }

    /**
     * Compute score (gradient of log probability) at given points and timestep
     * For diffusion models: score ≈ -noise / sqrt(1 - alpha_bar)
     * @param x_t Points to evaluate [batch, dim]
     * @param t Timestep (integer)
     * @returns Score vectors [batch, dim]
     */
    score(x_t: tf.Tensor2D, t: number): tf.Tensor2D {
        return tf.tidy(() => {
            const tInt = tf.fill([x_t.shape[0]], t, 'int32') as tf.Tensor1D;
            const eps = this.forward(x_t, tInt);
            const sqrtOneMinusAlphaBar = tf.gather(
                this.scheduleParams.sqrtOneMinusAlphasCumprod,
                tInt
            ).expandDims(1);
            return eps.div(sqrtOneMinusAlphaBar).neg() as tf.Tensor2D;
        });
    }
}
