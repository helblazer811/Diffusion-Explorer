import * as tf from '@tensorflow/tfjs';
import { ConditionalModel } from '../interfaces';
import { generateUniformGridSamples } from '../utils';
import { SchedulerType, SamplingOptions as SchedulerSamplingOptions, getScheduler } from './schedulers';

export interface ConditionalSamplingOptions extends SchedulerSamplingOptions {
    cond?: tf.Tensor1D | tf.Tensor2D | number[];
    guidanceScale?: number;
    t_start?: number;
    t_end?: number;
}

/**
 * Class-conditioned flow matching model.
 *
 * Network input: [x_t, t_normalized, one_hot(c)].
 * Loss: MSE(v_θ(x_t, t, c), x_1 - x_0) where x_0 ~ N(0, I), x_1 ~ data, t ~ U[0,1].
 * Supports classifier-free guidance via conditioning dropout during training.
 */
export class ConditionalFlowModel extends ConditionalModel {

    constructor(dim: number = 2, condDim: number = 0, hidden: number = 64) {
        super(dim, condDim, hidden);
    }

    private convertToOneHot(labels: tf.Tensor1D, numClasses: number): tf.Tensor2D {
        return tf.tidy(() => tf.oneHot(labels.toInt(), numClasses).toFloat());
    }

    private prepareCondTensor(cond: tf.Tensor1D | tf.Tensor2D, batchSize: number): tf.Tensor2D {
        if (cond.rank === 1) {
            return this.convertToOneHot(cond as tf.Tensor1D, this.condDim);
        }
        if (cond.shape[0] !== batchSize) {
            throw new Error(
                `Conditioning batch size mismatch: cond.shape[0]=${cond.shape[0]}, expected ${batchSize}`,
            );
        }
        return cond as tf.Tensor2D;
    }

    /**
     * Train using the flow matching objective with optional CFG dropout.
     *
     * @param data target distribution samples [N, dim]
     * @param cond per-sample conditioning. Tensor1D of int class labels OR Tensor2D one-hot
     * @param epochs number of training epochs
     * @param batchSize minibatch size
     * @param updateInterval epochs between intermediate sample callbacks
     * @param stopTraining cooperative cancellation hook
     * @param endEpochCallback callback (epoch, samples, loss). samples drawn at random classes.
     * @param source_distribution optional fixed source coupling [N, dim]; if null, fresh N(0,I) each batch
     * @param condDropProb probability of replacing conditioning with zeros (CFG dropout)
     */
    async train(
        data: tf.Tensor2D,
        cond: tf.Tensor1D | tf.Tensor2D,
        epochs: number = 1000,
        batchSize: number = 32,
        updateInterval: number = 50,
        stopTraining: () => boolean = () => false,
        endEpochCallback: (epoch: number, intermediateSamples: number[][] | null, loss?: number) => void = () => { },
        source_distribution: tf.Tensor2D | null = null,
        condDropProb: number = 0.1,
    ): Promise<void> {
        console.log("ConditionalFlowModel training started.");
        console.log("Training data shape:", data.shape, "condDim:", this.condDim);

        const lossFn = (pred: tf.Tensor, target: tf.Tensor) =>
            tf.losses.meanSquaredError(target, pred);
        const optimizer = tf.train.adam(0.01);

        // Pre-convert cond to one-hot once if it came in as int labels.
        const condTensor: tf.Tensor2D = cond.rank === 1
            ? this.convertToOneHot(cond as tf.Tensor1D, this.condDim)
            : (cond as tf.Tensor2D);

        const numSamples = data.shape[0];
        const numBatches = Math.ceil(numSamples / batchSize);

        for (let epoch = 0; epoch < epochs; epoch++) {
            const indices = tf.util.createShuffledIndices(numSamples);
            let epochLoss = 0;
            let batchCount = 0;

            for (let batchIdx = 0; batchIdx < numBatches; batchIdx++) {
                const batchLoss = tf.tidy(() => {
                    const batchIndicesArray = indices.slice(
                        batchIdx * batchSize,
                        Math.min((batchIdx + 1) * batchSize, numSamples),
                    );
                    const batchIndices = tf.tensor1d(Array.from(batchIndicesArray), 'int32');

                    const x_1 = tf.gather(data, batchIndices);
                    const c = tf.gather(condTensor, batchIndices) as tf.Tensor2D;
                    const actualBatchSize = x_1.shape[0];

                    const t = tf.randomUniform([actualBatchSize, 1]);
                    const x_0: tf.Tensor2D = source_distribution === null
                        ? tf.randomNormal([actualBatchSize, this.dim])
                        : tf.gather(source_distribution, batchIndices);

                    const x_t = x_0.mul(tf.sub(1, t)).add(x_1.mul(t));
                    const dx_t = x_1.sub(x_0);

                    // CFG: zero out conditioning for a fraction of the batch.
                    const useCond = Math.random() > condDropProb;
                    const cInput: tf.Tensor2D = useCond ? c : (tf.zerosLike(c) as tf.Tensor2D);

                    let lossValue = 0;
                    optimizer.minimize(() => {
                        const pred = this.forward(x_t as tf.Tensor2D, t, cInput);
                        const loss = lossFn(pred, dx_t);
                        lossValue = loss.dataSync()[0];
                        return loss;
                    });
                    return lossValue;
                });
                epochLoss += batchLoss;
                batchCount++;
            }

            const avgEpochLoss = epochLoss / batchCount;

            let intermediateSamples: number[][] | null = null;
            if (epoch % updateInterval === 0) {
                // Sample with random classes for monitoring.
                const monitorBatch = 500;
                const randomClasses = tf.randomUniform([monitorBatch], 0, this.condDim, 'int32') as tf.Tensor1D;
                const allTimeSamples = await this.sample(
                    monitorBatch,
                    30,
                    { cond: randomClasses },
                );
                if (allTimeSamples) {
                    const lastTimeStep = allTimeSamples.gather(allTimeSamples.shape[0] - 1, 0);
                    intermediateSamples = lastTimeStep.arraySync() as number[][];
                    lastTimeStep.dispose();
                    allTimeSamples.dispose();
                }
                randomClasses.dispose();
            }

            endEpochCallback(epoch, intermediateSamples, avgEpochLoss);
            await tf.nextFrame();
            if (stopTraining()) {
                console.log("Training stopped by user.");
                break;
            }
        }

        // Dispose pre-converted cond tensor if we created it.
        if (cond.rank === 1) condTensor.dispose();
    }

    /**
     * Predict the velocity field at (x_t, t) conditioned on c.
     */
    forward(
        x_t: tf.Tensor2D,
        t: tf.Tensor1D | tf.Tensor2D,
        c: tf.Tensor1D | tf.Tensor2D,
    ): tf.Tensor {
        return tf.tidy(() => {
            const cond2D = this.prepareCondTensor(c, x_t.shape[0]);
            const t_expanded = t.reshape([x_t.shape[0], 1]);
            const input = tf.concat([x_t, t_expanded, cond2D], 1);
            return this.model.predict(input) as tf.Tensor2D;
        });
    }

    /**
     * Integrate one step from t_start to t_end. With guidanceScale > 0,
     * applies classifier-free guidance: v_hat = v_uncond + g * (v_cond - v_uncond).
     */
    step(
        x_t: tf.Tensor2D,
        t_start: tf.Tensor1D | tf.Tensor2D,
        t_end: tf.Tensor1D | tf.Tensor2D,
        c: tf.Tensor2D,
        scheduler: SchedulerType = 'euler_midpoint',
        guidanceScale: number = 0,
    ): tf.Tensor2D {
        const stepFn = getScheduler(scheduler);
        const vectorField = (x: tf.Tensor2D, tt: tf.Tensor1D | tf.Tensor2D) => {
            if (guidanceScale > 0) {
                return tf.tidy(() => {
                    const vCond = this.forward(x, tt, c);
                    const vUncond = this.forward(x, tt, tf.zerosLike(c) as tf.Tensor2D);
                    return vUncond.add(vCond.sub(vUncond).mul(guidanceScale));
                });
            }
            return this.forward(x, tt, c);
        };
        return stepFn(x_t, t_start, t_end, vectorField);
    }

    /**
     * Draw `num_samples` conditioned samples from N(0, I).
     * If `cond` is not given, classes are uniformly random in [0, condDim).
     */
    async sample(
        num_samples: number,
        num_total_steps: number = 100,
        options: ConditionalSamplingOptions = {},
        perStepCallback?: (step: number, x_t: number[][]) => void,
        shouldStop: () => boolean = () => false,
    ): Promise<tf.Tensor3D | null> {
        const initial_points = tf.randomNormal([num_samples, this.dim]);
        return this.sample_from_initial_points(initial_points, num_total_steps, options, perStepCallback, shouldStop);
    }

    /**
     * Draw conditioned samples from caller-provided initial points.
     */
    async sample_from_initial_points(
        initial_points: tf.Tensor2D,
        num_total_steps: number = 100,
        options: ConditionalSamplingOptions = {},
        perStepCallback?: (step: number, x_t: number[][]) => void,
        shouldStop: () => boolean = () => false,
    ): Promise<tf.Tensor3D | null> {
        const scheduler = options.scheduler ?? 'euler_midpoint';
        const reverse = options.reverse ?? false;
        const guidanceScale = options.guidanceScale ?? 0;
        const num_samples = initial_points.shape[0];

        const defaultStart = reverse ? 1 : 0;
        const defaultEnd = reverse ? 0 : 1;
        const t_start = options.t_start ?? defaultStart;
        const t_end = options.t_end ?? defaultEnd;
        const t_steps = tf.linspace(t_start, t_end, num_total_steps + 1);

        // Resolve conditioning to a [num_samples, condDim] one-hot tensor.
        let condInput: tf.Tensor1D | tf.Tensor2D;
        if (options.cond === undefined) {
            condInput = tf.randomUniform([num_samples], 0, this.condDim, 'int32') as tf.Tensor1D;
        } else if (Array.isArray(options.cond)) {
            condInput = tf.tensor(options.cond, undefined, 'int32') as tf.Tensor1D;
        } else {
            condInput = options.cond as tf.Tensor1D | tf.Tensor2D;
        }
        const condTensor: tf.Tensor2D = condInput.rank === 1
            ? this.convertToOneHot(condInput as tf.Tensor1D, this.condDim)
            : (condInput as tf.Tensor2D);

        if (condTensor.shape[0] !== num_samples) {
            condTensor.dispose();
            if (options.cond === undefined || Array.isArray(options.cond)) {
                condInput.dispose();
            }
            t_steps.dispose();
            throw new Error(
                `Conditioning size ${condTensor.shape[0]} does not match initial_points size ${num_samples}`,
            );
        }

        let x_t: tf.Tensor2D = initial_points;
        const all_step_data: tf.Tensor2D[] = [];

        for (let i = 0; i < num_total_steps; i++) {
            if (shouldStop()) {
                t_steps.dispose();
                condTensor.dispose();
                if (options.cond === undefined || Array.isArray(options.cond)) {
                    condInput.dispose();
                }
                all_step_data.forEach(t => t.dispose());
                return null;
            }

            const x_next = tf.tidy(() => {
                const t_i = tf.tile(t_steps.slice([i], [1]), [num_samples]);
                const t_next = tf.tile(t_steps.slice([i + 1], [1]), [num_samples]);
                return this.step(x_t, t_i, t_next, condTensor, scheduler, guidanceScale);
            });

            x_t = x_next;
            all_step_data.push(x_t);

            if (perStepCallback) {
                perStepCallback(i, x_t.arraySync() as number[][]);
            }

            await tf.nextFrame();
        }

        t_steps.dispose();
        // Dispose owned cond tensors; leave caller-provided Tensor2D alone.
        if (options.cond === undefined || Array.isArray(options.cond) || condInput !== options.cond) {
            condTensor.dispose();
        }
        if (options.cond === undefined || Array.isArray(options.cond)) {
            condInput.dispose();
        }

        return tf.stack(all_step_data) as tf.Tensor3D;
    }

    /**
     * Sample from a uniform grid of initial points with conditioning.
     */
    async sample_grid(
        gridResolution: number,
        domainRange: { xMin: number, xMax: number, yMin: number, yMax: number },
        num_total_steps: number = 100,
        options: ConditionalSamplingOptions = {},
        perStepCallback?: (step: number, x_t: number[][]) => void,
        shouldStop: () => boolean = () => false,
    ): Promise<tf.Tensor3D | null> {
        const initialPoints = generateUniformGridSamples(gridResolution, domainRange, true);
        return this.sample_from_initial_points(initialPoints, num_total_steps, options, perStepCallback, shouldStop);
    }
}
