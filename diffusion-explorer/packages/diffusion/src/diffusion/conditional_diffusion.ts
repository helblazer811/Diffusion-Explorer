import * as tf from '@tensorflow/tfjs';
import { ConditionalModel } from '../interfaces';
import { generateUniformGridSamples } from '../utils';

export class ConditionalDiffusionModel extends ConditionalModel {
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

    constructor(dim = 2, condDim = 0, hidden = 64, T = 1000, betaStart = 1e-4, betaEnd = 2e-2) {
        super(dim, condDim, hidden);
        this.T = T;

        this.betas = tf.linspace(betaStart, betaEnd, T);
        this.alphas = tf.sub(1, this.betas);
        this.alphasCumprod = tf.cumprod(this.alphas);
        this.alphasCumprodPrev = tf.concat([tf.ones([1]), this.alphasCumprod.slice([0], [T - 1])]);
        this.sqrtAlphasCumprod = tf.sqrt(this.alphasCumprod);
        this.sqrtOneMinusAlphasCumprod = tf.sqrt(tf.sub(1, this.alphasCumprod));
        this.sqrtInvAlphasCumprod = tf.sqrt(tf.div(1, this.alphasCumprod));
        this.sqrtInvAlphasCumprodMinusOne = tf.sqrt(tf.sub(tf.div(1, this.alphasCumprod), 1));
        this.variance = this.betas.mul(tf.sub(1, this.alphasCumprodPrev)).div(tf.sub(1, this.alphasCumprod)).clipByValue(1e-20, 1e20);

        this.posteriorCoef1 = tf.tidy(() => this.betas.mul(tf.sqrt(this.alphasCumprodPrev)).div(tf.sub(1, this.alphasCumprod)));
        this.posteriorCoef2 = tf.tidy(() => tf.sub(1, this.alphasCumprodPrev).mul(tf.sqrt(this.alphas)).div(tf.sub(1, this.alphasCumprod)));
    }

    private convertToOneHot(labels: tf.Tensor1D, numClasses: number): tf.Tensor2D {
        return tf.tidy(() => {
            return tf.oneHot(labels.toInt(), numClasses).toFloat();
        });
    }

    /** Add noise to x0 at timestep t */
    private addNoise(x0: tf.Tensor2D, noise: tf.Tensor2D, t: tf.Tensor1D): tf.Tensor2D {
        return tf.tidy(() => {
            const s1 = tf.gather(this.sqrtAlphasCumprod, t).expandDims(1);
            const s2 = tf.gather(this.sqrtOneMinusAlphasCumprod, t).expandDims(1);
            return x0.mul(s1).add(noise.mul(s2));
        });
    }

    /** Forward pass: predict noise at (x_t, t) conditioned on c */
    forward(x_t: tf.Tensor2D, t: tf.Tensor1D | tf.Tensor2D, c: tf.Tensor1D | tf.Tensor2D): tf.Tensor2D {
        return tf.tidy(() => {
            // Check if c is undefined
            let cond = c;
            if (cond === undefined) {
                // Create cond with all zeros for unconditional prediction
                cond = tf.zeros([x_t.shape[0], this.condDim]);
            }
            // If cond is 1D then convert to one-hot
            if (cond.rank === 1) {
                const c_expanded = cond as tf.Tensor1D;
                const numClasses = this.condDim;
                cond = this.convertToOneHot(c_expanded, numClasses);
            }
            // Reshape t to be [batch, 1]
            // Normalize time to [0, 1]
            const t_expanded = t.reshape([x_t.shape[0], 1]).div(this.T);
            const input = tf.concat([x_t, t_expanded, cond], 1);
            return this.model.predict(input) as tf.Tensor2D;
        });
    }

    /** Single reverse diffusion step */
    step(x_t: tf.Tensor2D, t_start: tf.Tensor1D, t_end: tf.Tensor1D, c: tf.Tensor2D, guidanceScale: number = 0): any {
        return tf.tidy(() => {
            let eps_hat: tf.Tensor2D;
            let epsUncond: tf.Tensor2D | null = null;
            let epsCond: tf.Tensor2D | null = null;
            if (guidanceScale > 0) {
                // classifier-free guidance
                epsUncond = this.forward(x_t, t_start, tf.zerosLike(c));
                epsCond = this.forward(x_t, t_start, c);
                eps_hat = epsUncond.add(epsCond.sub(epsUncond).mul(guidanceScale));
            } else {
                eps_hat = this.forward(x_t, t_start, c);
            }

            const s1 = tf.gather(this.sqrtInvAlphasCumprod, t_start).expandDims(1);
            const s2 = tf.gather(this.sqrtInvAlphasCumprodMinusOne, t_start).expandDims(1);
            const x0_pred = x_t.mul(s1).sub(eps_hat.mul(s2));

            const c1 = tf.gather(this.posteriorCoef1, t_start).expandDims(1);
            const c2 = tf.gather(this.posteriorCoef2, t_start).expandDims(1);
            const mean = x0_pred.mul(c1).add(x_t.mul(c2));

            const noise = tf.randomNormal(x_t.shape as [number, number]);
            const varTerm = tf.gather(this.variance, t_start).sqrt().expandDims(1).mul(noise);
            const isZero = t_start.equal(tf.scalar(0, 'int32')).expandDims(1);
            const finalMean = mean.add(varTerm.mul(tf.cast(isZero.logicalNot(), 'float32')));

            // Return the epsUncond and epsCond as well as the updated x_t
            return {
                mean: finalMean,
                epsUncond: epsUncond,
                epsCond: epsCond,
                eps_hat: eps_hat
            };
        });
    }

    /** Train using denoising score matching with classifier-free guidance */
    async train(
        data: tf.Tensor2D,
        cond: tf.Tensor2D,
        epochs = 1000,
        batchSize = 32,
        updateInterval = 50,
        endEpochCallback: (epoch: number, intermediateSamples: number[][] | null) => void = () => { },
        stopTraining: () => boolean = () => false,
        condDropProb = 0.1
    ) {
        const N = data.shape[0];
        const optimizer = tf.train.adam(1e-4);
        const mse = (a: tf.Tensor, b: tf.Tensor) => tf.losses.meanSquaredError(a, b);

        for (let epoch = 0; epoch < epochs; epoch++) {
            const losses: number[] = [];
            for (let i = 0; i < N; i += batchSize) {
                tf.tidy(() => {
                    const x0 = tf.gather(data, tf.range(i, Math.min(i + batchSize, N)).toInt());
                    const batchCond = tf.gather(cond, tf.range(i, Math.min(i + batchSize, N)).toInt());

                    const noise = tf.randomNormal(x0.shape as [number, number]);
                    const tInt = tf.randomUniform([x0.shape[0]], 0, this.T, 'int32');
                    const x_t = this.addNoise(x0, noise, tInt);

                    // Drop conditioning for classifier-free guidance
                    const useCond = Math.random() > condDropProb;
                    const cInput = useCond ? batchCond : tf.zerosLike(batchCond);

                    optimizer.minimize(() => {
                        const eps_hat = this.forward(x_t, tInt, cInput);
                        const mse_loss = mse(noise, eps_hat);
                        losses.push(mse_loss.arraySync() as number);
                        return mse(noise, eps_hat);
                    });
                });
            }
            const meanLoss = losses.reduce((a, b) => a + b, 0) / losses.length;
            console.log(`Epoch ${epoch + 1} / ${epochs}, Loss: ${meanLoss.toFixed(4)}`);

            if (epoch % updateInterval === 0) {
                // Randomly sample integers from 0 too condDim - 1
                console.log("Epoch ", epoch);
                const condIndices: tf.Tensor1D = tf.randomUniform([200], 0, this.condDim, 'int32');
                const samples = this.sample(200, 100, { cond: condIndices, guidanceScale: 5.0 });
                endEpochCallback(epoch, samples.arraySync().map((s: any) => s.flat()));
            }

            await tf.nextFrame();
            if (stopTraining()) break;
        }
    }

    /** Full reverse diffusion sampling */
    sample(
        num_samples: number,
        num_total_steps: number = this.T,
        options: { cond?: tf.Tensor1D | tf.Tensor2D | number[], guidanceScale?: number, return_guidance?: boolean } = {}
    ): any {
        let { cond, guidanceScale = 0, return_guidance = false } = options;

        // Convert array-based cond to tensor if needed
        if (Array.isArray(cond)) {
            cond = tf.tensor(cond, undefined, 'int32') as tf.Tensor1D;
        }

        // If no condition is provided, generate random classes
        if (!cond) {
            cond = tf.randomUniform([num_samples], 0, this.condDim, 'int32') as tf.Tensor1D;
        }

        // Draw initial samples from a Gaussian distribution
        const initial_points = tf.randomNormal([num_samples, this.dim]);

        // Delegate to sample_from_initial_points
        return this.sample_from_initial_points(initial_points, num_total_steps, { cond, guidanceScale, return_guidance });
    }

    /** Sampling from initial points */
    sample_from_initial_points(
        initial_points: tf.Tensor2D,
        num_total_steps: number = 100,
        options: {
            cond?: tf.Tensor1D | tf.Tensor2D | number[],
            guidanceScale?: number,
            return_guidance?: boolean
        } = {}
    ): any {
        let { cond, guidanceScale = 0, return_guidance = false } = options;

        // If initial_points is an array convert it to tf.Tensor2D
        if (!(initial_points instanceof tf.Tensor)) {
            initial_points = tf.tensor2d(initial_points);
        }

        // Convert array-based cond to tensor if needed
        if (Array.isArray(cond)) {
            cond = tf.tensor(cond, undefined, 'int32') as tf.Tensor1D;
        }

        // If cond is not provided, generate random classes
        if (!cond) {
            const numSamples = initial_points.shape[0];
            cond = tf.randomUniform([numSamples], 0, this.condDim, 'int32') as tf.Tensor1D;
        }

        return tf.tidy(() => {
            // If cond is 1D then convert to one-hot
            let condTensor = cond!;
            if (cond!.rank === 1) {
                const cond_expanded = cond as tf.Tensor1D;
                const numClasses = this.condDim;
                condTensor = this.convertToOneHot(cond_expanded, numClasses);
            }
            // Make sure that initial points and cond have same number of samples
            if (initial_points.shape[0] !== condTensor.shape[0]) {
                throw new Error('Initial points and conditioning must have the same number of samples');
            }
            let x = initial_points;
            const traj: tf.Tensor2D[] = [];
            const steps = [...Array(num_total_steps).keys()].reverse();
            const epsConds: tf.Tensor2D[] = [];
            const epsUnconds: tf.Tensor2D[] = [];
            const epsHats: tf.Tensor2D[] = [];

            for (const t of steps) {
                const tInt = tf.fill([x.shape[0]], t, 'int32');
                const stepOutput = this.step(x, tInt, tInt, condTensor, guidanceScale);
                traj.push(stepOutput.mean);
                if (return_guidance) {
                    epsConds.push(stepOutput.epsCond);
                    epsUnconds.push(stepOutput.epsUncond);
                    epsHats.push(stepOutput.eps_hat);
                }
                x = stepOutput.mean;
            }

            if (return_guidance) {
                return {
                    traj: tf.stack(traj),
                    epsCond: guidanceScale > 0 ? tf.stack(epsConds) : null,
                    epsUncond: guidanceScale > 0 ? tf.stack(epsUnconds) : null,
                    epsHat: guidanceScale > 0 ? tf.stack(epsHats) : null
                };
            } else {
                return tf.stack(traj);
            }
        });
    }

    /**
     * Sample from a uniform grid of initial points with conditioning
     * @param gridResolution Number of points along each axis
     * @param domainRange The domain range for x and y coordinates
     * @param num_total_steps Number of diffusion steps
     * @param options Optional parameters including cond, guidanceScale, and return_guidance
     * @returns Tensor of shape [num_total_steps, gridResolution * gridResolution, 2] or object with guidance info
     */
    sample_grid(
        gridResolution: number,
        domainRange: { xMin: number, xMax: number, yMin: number, yMax: number },
        num_total_steps: number = 100,
        options: { cond?: tf.Tensor1D | tf.Tensor2D | number[], guidanceScale?: number, return_guidance?: boolean } = {}
    ): any {
        // Generate uniform grid
        const initialPoints = generateUniformGridSamples(gridResolution, domainRange, 'tensor') as tf.Tensor2D;

        // Sample from the initial points
        return this.sample_from_initial_points(initialPoints, num_total_steps, options);
    }
}
