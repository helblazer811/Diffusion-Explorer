import * as tf from '@tensorflow/tfjs'
import { Model } from './interfaces';
import { generateUniformGridSamples } from './utils';
import { SchedulerType, SamplingOptions, getScheduler } from './schedulers';

export class FlowModel extends Model {
  
    constructor(dim: number = 2, hidden: number = 64) {
        super(dim, hidden);
    }

    /**
     * Train the flow model using the flow matching objective
     * @param data tf.Tensor2D of shape [num_samples, dim] - target distribution
     * @param epochs number of epochs to train the model
     * @param batchSize number of samples to use in each batch
     * @param updateInterval number of epochs to wait before updating the model
     * @param stopTraining function to check if training should stop
     * @param endEpochCallback function to call at the end of each epoch with (epoch, samples, loss)
     * @param source_distribution tf.Tensor2D | null - source distribution. If null, generates random noise each batch
     * @returns Promise<void>
     */
    async train(
        data: tf.Tensor2D,
        epochs: number = 1000,
        batchSize: number = 32,
        updateInterval: number = 50,
        stopTraining: () => boolean = () => { return false; },
        endEpochCallback: (epoch: number, intermediateSamples: number[][] | null, loss?: number) => void = () => { },
        source_distribution: tf.Tensor2D | null = null,
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

        const numSamples = data.shape[0];
        const numBatches = Math.ceil(numSamples / batchSize);

        // Run the training loop
        for (let epoch = 0; epoch < epochs; epoch++) {
            // Shuffle indices for each epoch
            const indices = tf.util.createShuffledIndices(numSamples);

            // Track epoch loss
            let epochLoss = 0;
            let batchCount = 0;

            // Iterate over batches
            for (let batchIdx = 0; batchIdx < numBatches; batchIdx++) {
                const batchLoss = tf.tidy(() => {
                    // Get batch indices
                    const batchIndicesArray = indices.slice(
                        batchIdx * batchSize,
                        Math.min((batchIdx + 1) * batchSize, numSamples)
                    );
                    const batchIndices = tf.tensor1d(Array.from(batchIndicesArray), 'int32');

                    // Sample a batch of target distribution samples from `data`
                    const x_1 = tf.gather(data, batchIndices);
                    const actualBatchSize = x_1.shape[0];

                    // Sample a batch of timesteps in [0, 1]
                    const t = tf.randomUniform([actualBatchSize, 1]);

                    // Sample or gather source distribution samples
                    let x_0: tf.Tensor2D;
                    if (source_distribution === null) {
                        // Standard flow matching: random noise for each batch
                        x_0 = tf.randomNormal([actualBatchSize, this.dim]);
                    } else {
                        // Rectified flow style: use provided source distribution
                        x_0 = tf.gather(source_distribution, batchIndices);
                    }

                    // Compute the x_t interpolation x_t = (1 - t) * x_0 + t * x_1
                    const x_t = x_0.mul(tf.sub(1, t)).add(x_1.mul(t));
                    const dx_t = x_1.sub(x_0) // dx_t = x_1 - x_0

                    // Run the optimizer with the mse loss and capture loss value
                    let lossValue = 0;
                    optimizer.minimize(() => {
                        const pred = this.forward(x_t, t);
                        const loss = lossFn(pred, dx_t);
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
            let intermediateSamples = null;
            if (epoch % updateInterval === 0) {
                // Sample from the model
                // TODO put these in the settings
                const allTimeSamples = await this.sample(
                    500, // number of samples
                    30 // number of steps
                ); // shape [num_total_steps, num_samples, dim]
                // Pull out the last time step (if not cancelled)
                if (allTimeSamples) {
                    const lastTimeStep = allTimeSamples.gather(allTimeSamples.shape[0] - 1, 0); // shape [num_samples, dim]
                    intermediateSamples = lastTimeStep.arraySync();
                }
            }
            // Run the end epoch callback with loss
            endEpochCallback(epoch, intermediateSamples, avgEpochLoss);
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
     * Train the flow model using rectified flow algorithm
     * @param data Target distribution dataset [num_samples, dim]
     * @param source_distribution Initial source distribution [num_samples, dim]. If null, generates N(0, I)
     * @param num_rectified_steps Number of rectification iterations
     * @param epochs_per_rectified_step Training epochs per rectification step
     * @param batchSize Mini-batch size for training
     * @param num_simulation_steps ODE integration steps for sampling
     * @param stopTraining Function to check if training should halt
     * @param endEpochCallback Called after each epoch
     * @param endRectifiedStepCallback Called after each rectification step with trajectories
     * @param test_source_distribution Optional test points for visualization sampling. If null, uses x0_coupling.
     * @returns Promise<void>
     */
    async train_rectified(
        data: tf.Tensor2D,
        source_distribution: tf.Tensor2D | null,
        num_rectified_steps: number,
        epochs_per_rectified_step: number,
        batchSize: number = 32,
        num_simulation_steps: number = 200,
        stopTraining: () => boolean = () => false,
        endEpochCallback: (epoch: number, rectifiedStep: number, intermediateSamples: number[][] | null, loss?: number) => void = () => {},
        endRectifiedStepCallback: (rectifiedStep: number, trajectories: number[][][] | null) => void = () => {},
        test_source_distribution: tf.Tensor2D | null = null
    ): Promise<void> {
        const numSamples = data.shape[0];
        const dim = data.shape[1];

        // Step 1: Initialize coupling
        // If source_distribution is provided, use it; otherwise generate Gaussian noise
        let x0_coupling: tf.Tensor2D;
        let shouldDisposeX0 = false;

        if (source_distribution === null) {
            x0_coupling = tf.randomNormal([numSamples, dim]);
            shouldDisposeX0 = true; // We created it, so we should dispose it
        } else {
            x0_coupling = source_distribution;
            shouldDisposeX0 = false; // User provided it, don't dispose
        }

        let x1_coupling = data;

        // Main rectification loop
        for (let rectifiedStep = 0; rectifiedStep < num_rectified_steps; rectifiedStep++) {
            // Check if training should stop
            if (stopTraining()) {
                console.log(`Training stopped at rectified step ${rectifiedStep}`);
                break;
            }

            console.log(`=== Rectified Step ${rectifiedStep + 1}/${num_rectified_steps} ===`);

            // Train flow matching with current coupling using the standard train method
            // Wrap the endEpochCallback to include the rectifiedStep parameter
            const wrappedCallback = (epoch: number, intermediateSamples: number[][] | null, loss?: number) => {
                endEpochCallback(epoch, rectifiedStep, intermediateSamples, loss);
            };

            // Call the train method with the coupling
            // Set updateInterval very high to avoid intermediate sampling during rectified training
            await this.train(
                x1_coupling,  // target distribution
                epochs_per_rectified_step,
                batchSize,
                epochs_per_rectified_step + 1,  // updateInterval - effectively disables intermediate sampling
                stopTraining,
                wrappedCallback,
                x0_coupling  // source distribution
            );

            // Sample to get new coupling (except on last step)
            if (rectifiedStep < num_rectified_steps - 1) {
                // Generate trajectories from x0_coupling
                const trajectories = await this.sample_from_initial_points(
                    x0_coupling,
                    num_simulation_steps
                );

                // Handle cancellation
                if (!trajectories) {
                    console.log(`Sampling cancelled at rectified step ${rectifiedStep}`);
                    break;
                }

                // Extract final timestep (t=1) as new x1
                const finalStep = trajectories.shape[0] - 1;
                const newX1 = trajectories.slice([finalStep, 0, 0], [1, numSamples, dim])
                                          .squeeze([0]);

                // Update coupling: keep same x0, pair with generated x1
                // Dispose old x1_coupling if it's not the original data
                if (rectifiedStep > 0) {
                    x1_coupling.dispose();
                }
                x1_coupling = newX1;

                // Dispose trajectories tensor
                trajectories.dispose();
            }

            // Sample trajectories for visualization using test distribution if provided
            const sampleSource = test_source_distribution ?? x0_coupling;
            const vizTrajectories = await this.sample_from_initial_points(
                sampleSource,
                num_simulation_steps
            );

            if (vizTrajectories) {
                const trajArray = vizTrajectories.arraySync() as number[][][];
                vizTrajectories.dispose();
                endRectifiedStepCallback(rectifiedStep, trajArray);
            } else {
                endRectifiedStepCallback(rectifiedStep, null);
            }
        }

        // Cleanup - only dispose x0 if we created it
        if (shouldDisposeX0) {
            x0_coupling.dispose();
        }
        // Dispose x1_coupling if it's not the original data
        if (num_rectified_steps > 0) {
            x1_coupling.dispose();
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
     * Integrate one step from t_start to t_end using the specified scheduler
     * @param x_t tf.Tensor2D of shape [batch, dim]
     * @param t_start tf.Tensor1D or tf.Tensor2D of shape [batch] or [batch, 1]
     * @param t_end tf.Tensor1D or tf.Tensor2D of shape [batch] or [batch, 1]
     * @param scheduler The integration method to use (default: 'euler_midpoint')
     */
    step(
      x_t: tf.Tensor2D,
      t_start: tf.Tensor1D | tf.Tensor2D,
      t_end: tf.Tensor1D | tf.Tensor2D,
      scheduler: SchedulerType = 'euler_midpoint'
    ): tf.Tensor2D {
      const stepFn = getScheduler(scheduler);
      return stepFn(x_t, t_start, t_end, (x, t) => this.forward(x, t));
    }

    /**
     * Draw `num_samples` samples from the model at time step `t`
     * @param num_samples number of samples to draw
     * @param t timestep to draw samples at in [0, num_total_steps]
     * @param num_total_steps number of total steps to simulate the ODE
     * @param options Sampling options (scheduler, etc.)
     * @param perStepCallback Optional callback invoked after each integration step with (step, x_t)
     * @param shouldStop Optional callback to check if sampling should be cancelled
     * @returns Promise<tf.Tensor3D | null> - null if cancelled
     */
    async sample(
        num_samples: number,
        num_total_steps: number = 100,
        options: SamplingOptions = {},
        perStepCallback?: (step: number, x_t: number[][]) => void,
        shouldStop: () => boolean = () => false
    ): Promise<tf.Tensor3D | null> {
        // Draw initial samples from a Gaussian distribution
        const initial_points = tf.randomNormal([num_samples, this.dim]);

        // Delegate to sample_from_initial_points
        return this.sample_from_initial_points(initial_points, num_total_steps, options, perStepCallback, shouldStop);
    }

    /**
    * Draw samples from the model using the given initial points
    * @param initial_points tf.Tensor2D of shape [num_samples, dim]
    * @param num_total_steps Number of integration steps
    * @param options Sampling options (scheduler, reverse, etc.)
    * @param perStepCallback Optional callback invoked after each integration step with (step, x_t)
    * @param shouldStop Optional callback to check if sampling should be cancelled
    * @returns Promise<tf.Tensor3D | null> - null if cancelled
    */
    async sample_from_initial_points(
        initial_points: tf.Tensor2D,
        num_total_steps: number = 100,
        options: SamplingOptions = {},
        perStepCallback?: (step: number, x_t: number[][]) => void,
        shouldStop: () => boolean = () => false
    ): Promise<tf.Tensor3D | null> {
        const scheduler = options.scheduler ?? 'euler_midpoint';
        const reverse = options.reverse ?? false;
        const num_samples = initial_points.shape[0];
        // Forward: t goes from 0 to 1, Reverse: t goes from 1 to 0
        const t_steps = reverse
            ? tf.linspace(1, 0, num_total_steps + 1)
            : tf.linspace(0, 1, num_total_steps + 1);

        let x_t: tf.Tensor2D = initial_points;
        const all_step_data: tf.Tensor2D[] = [];

        for (let i = 0; i < num_total_steps; i++) {
            // Check for cancellation
            if (shouldStop()) {
                t_steps.dispose();
                all_step_data.forEach(t => t.dispose());
                return null;
            }

            // Perform ODE step
            const x_next = tf.tidy(() => {
                const t_i = tf.tile(t_steps.slice([i], [1]), [num_samples]);
                const t_next = tf.tile(t_steps.slice([i + 1], [1]), [num_samples]);
                return this.step(x_t, t_i, t_next, scheduler);
            });

            x_t = x_next;
            all_step_data.push(x_t);

            // Call per-step callback if provided
            if (perStepCallback) {
                perStepCallback(i, x_t.arraySync() as number[][]);
            }

            // Yield to event loop - allows cancel messages to be processed
            await tf.nextFrame();
        }

        t_steps.dispose();
        return tf.stack(all_step_data);
    }    
    
    /**
    * Sample from a uniform grid of initial points
    * @param gridResolution Number of points along each axis
    * @param domainRange The domain range for x and y coordinates
    * @param num_total_steps Number of flow steps
    * @param options Sampling options (scheduler, reverse, etc.)
    * @param perStepCallback Optional callback invoked after each integration step with (step, x_t)
    * @param shouldStop Optional callback to check if sampling should be cancelled
    * @returns Promise<tf.Tensor3D | null> - null if cancelled
    */
    async sample_grid(
        gridResolution: number,
        domainRange: { xMin: number, xMax: number, yMin: number, yMax: number },
        num_total_steps: number = 100,
        options: SamplingOptions = {},
        perStepCallback?: (step: number, x_t: number[][]) => void,
        shouldStop: () => boolean = () => false
    ): Promise<tf.Tensor3D | null> {
        // Generate uniform grid as tensor
        const initialPoints = generateUniformGridSamples(gridResolution, domainRange, true);

        // Sample from the initial points (reverse option is read from options)
        return this.sample_from_initial_points(initialPoints, num_total_steps, options, perStepCallback, shouldStop);
    }
}