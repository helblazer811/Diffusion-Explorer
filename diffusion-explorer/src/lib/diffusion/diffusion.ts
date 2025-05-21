import * as tf from '@tensorflow/tfjs';
import { Model } from './interfaces';

export class DiffusionModel extends Model {
    readonly T: number;
    readonly betas: tf.Tensor1D;
    readonly alphas: tf.Tensor1D;
    readonly alphasCumprod: tf.Tensor1D;
    readonly alphasCumprodPrev: tf.Tensor1D;
    readonly sqrtAlphasCumprod: tf.Tensor1D;
    readonly sqrtOneMinusAlphasCumprod: tf.Tensor1D;
    readonly sqrtInvAlphasCumprod: tf.Tensor1D;
    readonly sqrtInvAlphasCumprodMinusOne: tf.Tensor1D;
    readonly variance: tf.Tensor1D;
    readonly posteriorCoef1: tf.Tensor1D;
    readonly posteriorCoef2: tf.Tensor1D;

    constructor(dim = 2, hidden = 128, T = 1000, betaStart = 1e-4, betaEnd = 2e-2) {
        super(dim, hidden);
        this.T = T;
        this.betas = tf.linspace(betaStart, betaEnd, T);
        this.alphas = tf.sub(1, this.betas);
        this.alphasCumprod = tf.cumprod(this.alphas);
        this.sqrtAlphasCumprod = tf.sqrt(this.alphasCumprod);
        this.sqrtOneMinusAlphasCumprod = tf.sqrt(tf.sub(1, this.alphasCumprod));
        this.sqrtInvAlphasCumprod = tf.sqrt(tf.div(1, this.alphasCumprod));
        this.sqrtInvAlphasCumprodMinusOne = tf.sqrt(tf.sub(tf.div(1, this.alphasCumprod), 1));
        this.alphasCumprodPrev = tf.concat([tf.ones([1]), this.alphasCumprod.slice([0], [T - 1])]);
        this.variance = this.betas.mul(tf.sub(1, this.alphasCumprodPrev)).div(tf.sub(1, this.alphasCumprod)).clipByValue(1e-20, 1e20);
        
        this.posteriorCoef1 = tf.tidy(() =>
            this.betas.mul(tf.sqrt(this.alphasCumprodPrev)).div(tf.sub(1, this.alphasCumprod))
        );
        this.posteriorCoef2 = tf.tidy(() =>
            tf.sub(1, this.alphasCumprodPrev).mul(tf.sqrt(this.alphas)).div(tf.sub(1, this.alphasCumprod))
        );
    }

    /**
     * Train the diffusion model with denoising score matching
     * @param data tf.Tensor2D of shape [num_samples, dim]
     * @param epochs number of epochs to train the model
     * @param batchSize number of samples to use in each batch
     * @param updateInterval number of epochs to wait before updating the model
     * @returns Promise<void>
     */
    async train(
        data: tf.Tensor2D, 
        epochs = 1000, 
        batchSize = 32,
        updateInterval: number = 50,
        stopTraining: () => boolean = () => { return false; },
        endEpochCallback: (epoch: number, intermediateSamples: number[][] | null) => void = () => { },
    ): Promise<void> {
        const N = data.shape[0];
        const optimizer = tf.train.adam(1e-4);
        const mse = (a: tf.Tensor, b: tf.Tensor) => tf.losses.meanSquaredError(a, b);
        const losses: number[] = [];

        for (let epoch = 0; epoch < epochs; ++epoch) {
            for (let i = 0; i < data.shape[0]; i += batchSize) {
                tf.tidy(() => {// Clear memory 
                    const x0 = tf.gather(data, tf.range(i, Math.min(i + batchSize, N)).toInt());
                    // Sample random gaussian noise
                    const noise = tf.randomNormal(x0.shape as [number, number]);
                    // Sample a random timestep t
                    const tInt = tf.randomUniform([x0.shape[0]], 0, this.T, 'int32');
                    // Add noise to x0
                    const x_t = this.addNoise(x0, noise, tInt);
                    // Run the optimizer
                    optimizer.minimize(() => {
                        // Get the model prediction
                        const eps = this.forward(x_t, tInt);
                        // Compute the loss
                        const loss = mse(noise, eps);
                        // Store the losses
                        losses.push(loss.dataSync()[0]);

                        return loss;
                    });
                });
            }
            // Run intermediate sampling
            let intermediateSamples = null;
            if (epoch % updateInterval === 0) {
                // Sample from the model
                // TODO put these in the settings
                const allTimeSamples = this.sample(
                    500, // number of samples
                    100 // number of steps
                ); // shape [num_total_steps, num_samples, dim]
                // Pull out the last time step
                const lastTimeStep = allTimeSamples.gather(allTimeSamples.shape[0] - 1, 0); // shape [num_samples, dim]
                intermediateSamples = lastTimeStep.arraySync();
            }
            // Run the end epoch callback
            // TODO: add the loss
            endEpochCallback(epoch, intermediateSamples);
            // Yield control to the worker event loop to handle stop events
            await tf.nextFrame();
            // Check if the training should continue
            if (stopTraining()) {
                console.log("Training stopped by user.");
                break;
            }
        }
    }

    private addNoise(x0: tf.Tensor2D, noise: tf.Tensor2D, tInt: tf.Tensor1D): tf.Tensor2D {
        return tf.tidy(() => {
            const s1 = tf.gather(this.sqrtAlphasCumprod, tInt).expandDims(1);
            const s2 = tf.gather(this.sqrtOneMinusAlphasCumprod, tInt).expandDims(1);
            return x0.mul(s1).add(noise.mul(s2));
        });
    }

    forward(x_t: tf.Tensor2D, t: tf.Tensor1D | tf.Tensor2D): tf.Tensor2D {
        return tf.tidy(() => {
            const t_expanded = t.reshape([x_t.shape[0], 1]); // Use very simple time conditioning, no sinusoidal embedding
            const t_scaled = t_expanded.div(this.T);
            const input = tf.concat([x_t, t_scaled], 1); // shape [batch, dim+1]

            return this.model.predict(input) as tf.Tensor2D;
        });
    }

    step(x_t: tf.Tensor2D, t_start: tf.Tensor1D | tf.Tensor2D): tf.Tensor2D {
        return tf.tidy(() => {
            // Reconstruct the original sample
            const tInt = (t_start.rank === 2 ? t_start.squeeze() : t_start) as tf.Tensor1D;
            const eps_hat = this.forward(x_t, tInt);
            // Reconstruct the original sample
            const s1 = tf.gather(this.sqrtInvAlphasCumprod, tInt).expandDims(1);
            const s2 = tf.gather(this.sqrtInvAlphasCumprodMinusOne, tInt).expandDims(1);
            const pred_original_sample = x_t.mul(s1).sub(eps_hat.mul(s2));
            // Predict the previous sample
            const c1 = tf.gather(this.posteriorCoef1, tInt).expandDims(1);
            const c2 = tf.gather(this.posteriorCoef2, tInt).expandDims(1);
            const pred_prev_sample = x_t.mul(c2).add(pred_original_sample.mul(c1));
            // Add noise back to the sample
            const noise = tf.randomNormal(x_t.shape as [number, number]);
            const varTerm = tf.gather(this.variance, tInt).sqrt().expandDims(1).mul(noise);
            const isZero = tInt.equal(tf.scalar(0, 'int32')).expandDims(1);
            return pred_prev_sample.add(varTerm.mul(tf.cast(isZero.logicalNot(), 'float32')));
        });
    }

    sample(num_samples: number, num_total_steps: number = this.T): tf.Tensor3D {
        return tf.tidy(() => {
            // Draw some initial samples from the source distribution
            let x = tf.randomNormal([num_samples, this.dim]);
            const traj: tf.Tensor2D[] = [];
            const steps = [...Array(num_total_steps).keys()].reverse();
            // Iterate through the timesteps backwards
            for (const t of steps) {
                const tInt = tf.fill([num_samples], t, 'int32');
                x = this.step(x, tInt);
                traj.push(x);
            }
            // traj.push(x);
            return tf.stack(traj);
        });
    }

    sample_from_initial_points(initial_points: tf.Tensor2D, num_total_steps: number = this.T): tf.Tensor3D {
        return tf.tidy(() => {
            let x = initial_points;
            const traj: tf.Tensor2D[] = [];
            const steps = [...Array(num_total_steps).keys()].reverse();
            for (const t of steps) {
                traj.push(x);
                const tInt = tf.fill([x.shape[0]], t, 'int32');
                x = this.step(x, tInt);
            }
            traj.push(x);
            return tf.stack(traj);
        });
    }
}