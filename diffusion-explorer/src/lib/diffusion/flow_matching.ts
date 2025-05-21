import * as tf from '@tensorflow/tfjs'
import { Model } from './interfaces';

export class FlowModel extends Model {
  
    constructor(dim: number = 2, hidden: number = 64) {
        super(dim, hidden);
    }

    /**
     * Train the flow model using the flow matching objective 
     * @param data tf.Tensor2D of shape [num_samples, dim]
     * @param epochs number of epochs to train the model
     * @param batchSize number of samples to use in each batch
     * @param updateInterval number of epochs to wait before updating the model
     * @param stopTraining function to check if training should stop
     * @param endEpochCallback function to call at the end of each epoch
     * @returns Promise<void>
     */
    async train(
        data: tf.Tensor2D,
        epochs: number = 1000,
        batchSize: number = 32,
        updateInterval: number = 50,
        stopTraining: () => boolean = () => { return false; },
        endEpochCallback: (epoch: number, intermediateSamples: number[][] | null) => void = () => { },
    ): Promise<void> {
        // Run training
        console.log("Training started in worker thread...");
        console.log("Training data shape: ", data.shape);
        // Set up the loss
        const lossFn = (pred: tf.Tensor, target: tf.Tensor) => {
            return tf.losses.meanSquaredError(target, pred);
        };
        // Set up optimizer
        const optimizer = tf.train.adam(0.01);
        // Run the training loop
        for (let epoch = 0; epoch < epochs; epoch++) {
            // console.log(`Epoch ${epoch + 1} / ${epochs}`);
            // Iterate over the dataset
            for (let i = 0; i < data.shape[0]; i += batchSize) {
                tf.tidy(() => {// Clear memory 
                    // Sample a batch of target distribution samples from `data`
                    const x_1 = tf.gather(data, tf.range(i, Math.min(i + batchSize, data.shape[0])).toInt());
                    // Sample a batch of `batch_size` timesteps in [0, 1]
                    const t = tf.randomUniform([x_1.shape[0], 1]);
                    // Sample a batch of `batch_size` random noise
                    const x_0 = tf.randomNormal([x_1.shape[0], this.dim]);
                    // Compute the x_t interpolation x_t = (1 - t) * x_0 + t * x_1
                    const x_t = x_0.mul(tf.sub(1, t)).add(x_1.mul(t));
                    const dx_t = x_1.sub(x_0) // dx_t = x_1 - x_0
                    // Run the optimizer with the mse loss
                    optimizer.minimize(() => {
                        const pred = this.forward(x_t, t);
                        const loss = lossFn(pred, dx_t);
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
                    30 // number of steps
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
  
    /**
     * Compute the vector field at (x_t, t)
     * @param x_t tf.Tensor2D of shape [batch, dim]
     * @param t tf.Tensor1D or tf.Tensor2D of shape [batch] or [batch, 1]
     */
    forward(x_t: tf.Tensor2D, t: tf.Tensor1D | tf.Tensor2D): tf.Tensor {
      return tf.tidy(() => {
        const t_expanded = t.reshape([x_t.shape[0], 1]);
        const input = tf.concat([x_t, t_expanded], 1); // shape [batch, dim+1]
        return this.model.predict(input) as tf.Tensor2D;
      });
    }
  
    /**
     * Integrate one step from t_start to t_end using midpoint method
     * @param x_t tf.Tensor2D of shape [batch, dim]
     * @param t_start tf.Tensor1D or tf.Tensor2D of shape [batch] or [batch, 1]
     * @param t_end tf.Tensor1D or tf.Tensor2D of shape [batch] or [batch, 1]
     */
    step(x_t: tf.Tensor2D, t_start: tf.Tensor1D | tf.Tensor2D, t_end: tf.Tensor1D | tf.Tensor2D): tf.Tensor2D {
      return tf.tidy(() => {
        const t0 = t_start.reshape([x_t.shape[0], 1]);
        const t1 = t_end.reshape([x_t.shape[0], 1]);
        const dt = t1.sub(t0); // shape [batch, 1]
  
        const half_step = this.forward(x_t, t0).mul(dt).div(2);
        const mid_point = x_t.add(half_step);
        const t_mid = t0.add(dt.div(2));
        const update = this.forward(mid_point, t_mid).mul(dt);
        return x_t.add(update);
      });
    }

    /**
     * Draw `num_samples` samples from the model at time step `t`
     * @param num_samples number of samples to draw
     * @param t timestep to draw samples at in [0, num_total_steps]
     * @param num_total_steps number of total steps to simulate the ODE
     * @returns tf.Tensor2D of shape [num_total_steps, num_samples, dim]
     */
    sample(num_samples: number, num_total_steps: number = 100): tf.Tensor3D {
        return tf.tidy(() => {
            // console.log("Number of samples: ", num_samples);
            // Draw some initial samples from the source distribution 
            const x_0 = tf.randomNormal([num_samples, this.dim]);
            // Draw some linear spaced timesteps in [0, 1]
            const t_steps = tf.linspace(0, 1, num_total_steps + 1);
            // Simulate the ODE until timestep t for all samples
            let all_step_data: tf.Tensor2D[] = [];
            // Store the initial sample
            let x_t: tf.Tensor2D = x_0;
            for (let i = 0; i < num_total_steps; i++) {
                const t_i = t_steps.slice([i], [1]); // current time
                const t_i_repeated = tf.tile(t_i, [num_samples]);
                const t_next = t_steps.slice([i + 1], [1]); // next time
                const t_next_repeated = tf.tile(t_next, [num_samples]);
                // Do the step using the midpoint method
                x_t = this.step(x_t, t_i_repeated, t_next_repeated);
                // Store the result in the all_step_data tensor
                all_step_data.push(x_t)
            }
            // Return all samples
            return tf.stack(all_step_data);
        });
    }

    /**
    * Draw samples from the model using the given initial points
    * @param initial_points tf.Tensor2D of shape [num_samples, dim]
    * @param num_total_steps 
    */
    sample_from_initial_points(initial_points: tf.Tensor2D, num_total_steps: number = 100): tf.Tensor3D {
        return tf.tidy(() => {
            // Draw some initial samples from the source distribution 
            const num_samples = initial_points.shape[0]; 
            const x_0 = initial_points;
            // Draw some linear spaced timesteps in [0, 1]
            const t_steps = tf.linspace(0, 1, num_total_steps + 1);
            // Simulate the ODE until timestep t for all samples
            let all_step_data: tf.Tensor2D[] = [];
            // Store the initial sample
            let x_t: tf.Tensor2D = x_0;
            for (let i = 0; i < num_total_steps; i++) {
                const t_i = t_steps.slice([i], [1]); // current time
                const t_i_repeated = tf.tile(t_i, [num_samples]);
                const t_next = t_steps.slice([i + 1], [1]); // next time
                const t_next_repeated = tf.tile(t_next, [num_samples]);
                // Do the step using the midpoint method
                x_t = this.step(x_t, t_i_repeated, t_next_repeated);
                // Store the result in the all_step_data tensor
                all_step_data.push(x_t)
            }
            // Return all samples
            return tf.stack(all_step_data);
        });
    }
}