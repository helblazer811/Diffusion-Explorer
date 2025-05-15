/**********************************************************************
* DiffusionModel.ts
*
* Score-based diffusion - noise-prediction objective, DDPM sampler.
********************************************************************
*/

import * as tf from '@tensorflow/tfjs';
import { Model } from './model';    // ← same lightweight base-class you used for FlowModel

/* ------------------------------------------------------------------ *
*  Helpers                                                           *
* ------------------------------------------------------------------ 
* */

/** Sinusoidal positional embedding (same formula as in the PyTorch code). */
function sinusoidalEmbedding(
  t: tf.Tensor2D,             // shape [B, 1]  – times in [0,   T-1]
  embedDim = 10,
  maxLen = 1000
): tf.Tensor2D {
  return tf.tidy(() => {
    // normalise t to integer indices (no grad needed)
    const pos = t;
    const i = tf.range(0, embedDim, 2, 'float32');            // [D/2]
    const denom = tf.exp(i.mul(-Math.log(10_000) / embedDim));// same as torch code
    const scaled = pos.mul(denom);                            // broadcast
    const sin = tf.sin(scaled);
    const cos = tf.cos(scaled);
    return tf.concat([sin, cos], 1);                          // [B, D]
  });
}

/** Linear beta schedule (βₜ) as in the PyTorch version. */
function makeBetaSchedule(
  T = 1_000,
  betaStart = 1e-4,
  betaEnd   = 2e-2
): tf.Tensor1D {
  return tf.linspace(betaStart, betaEnd, T);
}

/* ------------------------------------------------------------------ *
 *  DiffusionModel                                                    *
 * ------------------------------------------------------------------ */

export class DiffusionModel extends Model {
  // ---------------- public fields ----------------
  readonly T: number;            // total diffusion steps
  readonly betas: tf.Tensor1D;
  readonly alphas: tf.Tensor1D;
  readonly alphasCumprod: tf.Tensor1D;
  readonly sqrtAlphasCumprod: tf.Tensor1D;
  readonly sqrtOneMinusAlphasCumprod: tf.Tensor1D;
  readonly sqrtInvAlphasCumprod: tf.Tensor1D;
  readonly sqrtInvAlphasCumprodMinusOne: tf.Tensor1D;
  readonly posteriorCoef1: tf.Tensor1D;
  readonly posteriorCoef2: tf.Tensor1D;

  // ---------------- ctor ----------------
  constructor(
    dim = 2,
    timeDim = 10,
    hidden = 128,
    T = 1_000,
    betaStart = 1e-4,
    betaEnd   = 2e-2
  ) {
    super(dim, hidden);          // builds this.model = tf.Sequential(...)
    this.T = T;

    /* -------- noise schedule & derived constants (done once) ------- */
    this.betas  = makeBetaSchedule(T, betaStart, betaEnd);           // [T]
    this.alphas = tf.sub(1, this.betas);                             // [T]
    this.alphasCumprod = tf.cumprod(this.alphas);                    // [T]

    this.sqrtAlphasCumprod          = tf.sqrt(this.alphasCumprod);
    this.sqrtOneMinusAlphasCumprod  = tf.sqrt(tf.sub(1, this.alphasCumprod));

    this.sqrtInvAlphasCumprod       = tf.sqrt(tf.div(1, this.alphasCumprod));
    this.sqrtInvAlphasCumprodMinusOne =
      tf.sqrt(tf.sub(tf.div(1, this.alphasCumprod), 1));

    // ᾱ_{t-1}
    const alphasCumprodPrev =
      tf.concat([tf.ones([1]), this.alphasCumprod.slice([0], [T - 1])]);

    // posterior mean coefficients (see DDPM paper, eq. 7–8)
    this.posteriorCoef1 = tf.tidy(() =>
      this.betas
        .mul(tf.sqrt(alphasCumprodPrev))
        .div(tf.sub(1, this.alphasCumprod))
    );
    this.posteriorCoef2 = tf.tidy(() =>
      tf.sub(1, alphasCumprodPrev)
        .mul(tf.sqrt(this.alphas))
        .div(tf.sub(1, this.alphasCumprod))
    );

    /* ------------- fully-connected noise-prediction net ------------ */
    this.model = tf.sequential({
      layers: [
        tf.layers.dense({ units: hidden, inputShape: [dim + timeDim], activation: 'relu' }),
        tf.layers.dense({ units: hidden, activation: 'relu' }),
        tf.layers.dense({ units: dim })                             // outputs ε̂
      ]
    });
  }

  /* ----------------------------------------------------------------
   *  Core ops (matching the PyTorch names/semantics)
   * ---------------------------------------------------------------- */

  /** ε̂(x_t, t) */
  private predictNoise(x: tf.Tensor2D, tInt: tf.Tensor1D): tf.Tensor2D {
    return tf.tidy(() => {
      const tEmbed = sinusoidalEmbedding(tInt.expandDims(1),       // [B,1]→[B,timeDim]
                                         this.model.layers[0].inputShape[0] as number -
                                         x.shape[1]);
      const inp = tf.concat([x, tEmbed], 1);                       // [B, dim+timeDim]
      return this.model.predict(inp) as tf.Tensor2D;               // [B, dim]
    });
  }

  /** q(x_t | x₀)  (adds noise)  */
  private addNoise(
    x0: tf.Tensor2D,
    noise: tf.Tensor2D,
    tInt: tf.Tensor1D         // shape [B]
  ): tf.Tensor2D {
    return tf.tidy(() => {
      const s1 = tf.gather(this.sqrtAlphasCumprod, tInt);          // [B]
      const s2 = tf.gather(this.sqrtOneMinusAlphasCumprod, tInt);  // [B]
      const s1e = s1.expandDims(1);
      const s2e = s2.expandDims(1);
      return x0.mul(s1e).add(noise.mul(s2e));
    });
  }

  /** p(x_{t-1} | x_t) sampling step (Algorithm 2 in DDPM paper). */
  private step(
    x_t: tf.Tensor2D,
    tInt: tf.Tensor1D          // scalar or [B]
  ): tf.Tensor2D {
    return tf.tidy(() => {
      const epshat = this.predictNoise(x_t, tInt);
      const s1 = tf.gather(this.sqrtInvAlphasCumprod, tInt).expandDims(1);
      const s2 = tf.gather(this.sqrtInvAlphasCumprodMinusOne, tInt).expandDims(1);
      const x0hat = x_t.mul(s1).sub(epshat.mul(s2));               // ĥx₀

      const c1 = tf.gather(this.posteriorCoef1, tInt).expandDims(1);
      const c2 = tf.gather(this.posteriorCoef2, tInt).expandDims(1);
      let mean = x0hat.mul(c1).add(x_t.mul(c2));                   // μₜ

      // variance term for t>0
      const noise = tf.randomNormal(x_t.shape as [number, number]);
      const varTerm = tf.gather(this.getVariance(), tInt)          // [B]
                         .sqrt()
                         .expandDims(1)
                         .mul(noise);
      // if t==0, variance=0 (mask)
      const isZero = tInt.equal(tf.scalar(0, 'int32')).expandDims(1);
      varTerm.mul(tf.cast(isZero.logicalNot(), 'float32'));

      return mean.add(varTerm);
    });
  }

  /** β̃ (posterior variance) – cached once for speed. */
  private varianceCache?: tf.Tensor1D;
  private getVariance(): tf.Tensor1D {
    if (!this.varianceCache) {
      const alphasCumprodPrev =
        tf.concat([tf.ones([1]), this.alphasCumprod.slice([0], [this.T - 1])]);

      this.varianceCache = tf.tidy(() =>
        this.betas
          .mul(tf.sub(1, alphasCumprodPrev))
          .div(tf.sub(1, this.alphasCumprod))
          .clipByValue(1e-20, 1e10)
      );
    }
    return this.varianceCache;
  }

  /* ----------------------------------------------------------------
   *  Training (noise-prediction MSE) – matches your PyTorch loop
   * ---------------------------------------------------------------- */

  async train(
    data: tf.Tensor2D,           // [N, dim]  (spiral or datasaurus)
    iterations = 100_000,
    batchSize = 256,
    lr = 1e-4
  ): Promise<void> {
    const B = batchSize;
    const N = data.shape[0];
    const optim = tf.train.adam(lr);
    const mse = (a: tf.Tensor, b: tf.Tensor) => tf.losses.meanSquaredError(a, b);

    for (let i = 0; i < iterations; ++i) {
      await optim.minimize(() => tf.tidy(() => {
        /* ---- sample mini-batch ---- */
        const idx = tf.randomUniform([B], 0, N, 'int32');
        const x0  = tf.gather(data, idx);                       // [B, dim]
        const noise = tf.randomNormal(x0.shape as [number, number]);
        const tInt = tf.randomUniform([B], 0, this.T, 'int32'); // discrete ∈[0,T)
        const x_t  = this.addNoise(x0, noise, tInt);

        /* ---- forward & loss ---- */
        const epshat = this.predictNoise(x_t, tInt);
        return mse(noise, epshat);                              // ε vs ε̂
      }), /* returnCost */ false);

      if (i % 1_000 === 0) console.log(`iter ${i}/${iterations}`);
    }
  }

  /* ----------------------------------------------------------------
   *  Reverse sampling (DDPM ancestral sampling)
   * ---------------------------------------------------------------- */
  sample(
    numSamples = 1_000,
    numSteps   = this.T            // can set ≤T for faster sampling
  ): tf.Tensor3D {                 // [numSteps, numSamples, dim]
    return tf.tidy(() => {
      let x = tf.randomNormal([numSamples, this.dim]);        // x_T ∼ N(0,I)
      const traj: tf.Tensor2D[] = [];
      const steps = [...Array(numSteps).keys()].reverse();    // T-1 … 0

      for (const t of steps) {
        traj.push(x);
        const tInt = tf.fill([numSamples], t, 'int32');
        x = this.step(x, tInt);                               // x_{t-1}
      }
      traj.push(x);                                           // include x₀
      return tf.stack(traj);                                  // [numSteps+1, N, dim]
    });
  }

  /* ----------------------------------------------------------------
   *  Utility – generate spiral or datasaurus inside the browser
   * ---------------------------------------------------------------- */

  /** spiral like your make_spiral_data() (returns tf.Tensor2D). */
  static spiral(
    num = 1_000,
    noise = 0,
    rescale = 0.3
  ): tf.Tensor2D {
    return tf.tidy(() => {
      const t = tf.linspace(0, 4 * Math.PI, num);             // [num]
      const x = t.mul(tf.cos(t)).add(tf.randomNormal([num]).mul(noise));
      const y = t.mul(tf.sin(t)).add(tf.randomNormal([num]).mul(noise));
      return tf.stack([x, y], 1).mul(rescale);                // [num,2]
    });
  }
}
