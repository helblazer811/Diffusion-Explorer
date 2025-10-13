import * as tf from '@tensorflow/tfjs';
import { ConditionalModel } from './interfaces';

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

    /** Add noise to x0 at timestep t */
    private addNoise(x0: tf.Tensor2D, noise: tf.Tensor2D, t: tf.Tensor1D): tf.Tensor2D {
        return tf.tidy(() => {
            const s1 = tf.gather(this.sqrtAlphasCumprod, t).expandDims(1);
            const s2 = tf.gather(this.sqrtOneMinusAlphasCumprod, t).expandDims(1);
            return x0.mul(s1).add(noise.mul(s2));
        });
    }

    /** Forward pass: predict noise at (x_t, t) conditioned on c */
    forward(x_t: tf.Tensor2D, t: tf.Tensor1D | tf.Tensor2D, c: tf.Tensor2D): tf.Tensor2D {
        return tf.tidy(() => {
            const t_expanded = t.reshape([x_t.shape[0], 1]).div(this.T);
            const input = tf.concat([x_t, t_expanded, c], 1);
            return this.model.predict(input) as tf.Tensor2D;
        });
    }

    /** Single reverse diffusion step */
    step(x_t: tf.Tensor2D, t_start: tf.Tensor1D, t_end: tf.Tensor1D, c: tf.Tensor2D, guidanceScale: number = 0): tf.Tensor2D {
        return tf.tidy(() => {
            let eps_hat: tf.Tensor2D;
            if (guidanceScale > 0) {
                // classifier-free guidance
                const epsUncond = this.forward(x_t, t_start, tf.zerosLike(c));
                const epsCond = this.forward(x_t, t_start, c);
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
            return mean.add(varTerm.mul(tf.cast(isZero.logicalNot(), 'float32')));
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
                        return mse(noise, eps_hat);
                    });
                });
            }

            if (epoch % updateInterval === 0) {
                const samples = this.sample(16, cond.slice([0, 0], [16, this.condDim]));
                endEpochCallback(epoch, samples.arraySync().map((s: any) => s.flat()));
            }

            await tf.nextFrame();
            if (stopTraining()) break;
        }
    }

    /** Full reverse diffusion sampling */
    sample(num_samples: number, cond: tf.Tensor2D, num_total_steps: number = 100, guidanceScale = 0): tf.Tensor3D {
        return tf.tidy(() => {
            let x = tf.randomNormal([num_samples, this.dim]);
            const traj: tf.Tensor2D[] = [];
            const steps = [...Array(num_total_steps).keys()].reverse();

            for (const t of steps) {
                const tInt = tf.fill([num_samples], t, 'int32');
                x = this.step(x, tInt, tInt, cond, guidanceScale);
                traj.push(x);
            }

            return tf.stack(traj);
        });
    }

    /** Sampling from initial points */
    sample_from_initial_points(initial_points: tf.Tensor2D, cond: tf.Tensor2D, num_total_steps: number = 100, guidanceScale = 0): tf.Tensor3D {
        return tf.tidy(() => {
            let x = initial_points;
            const traj: tf.Tensor2D[] = [];
            const steps = [...Array(num_total_steps).keys()].reverse();

            for (const t of steps) {
                const tInt = tf.fill([x.shape[0]], t, 'int32');
                x = this.step(x, tInt, tInt, cond, guidanceScale);
                traj.push(x);
            }

            return tf.stack(traj);
        });
    }
}
