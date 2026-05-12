// Train two flow-matching models for the OT-coupling figure:
//   1. Independent coupling (standard FlowModel.train, source=null)
//   2. Minibatch OT coupling (custom loop, per-batch Sinkhorn)
//
// Same architecture and hyperparameters for both — only the coupling differs.

import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-wasm';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { FlowModel } from '@diffusion-explorer/diffusion';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');

async function initBackend(): Promise<void> {
  await tf.setBackend('wasm');
  await tf.ready();
}

const CONFIG = {
  datasetPath: 'static/optimal_transport_coupling/data/smiley_face.json',
  modelOutputDir: 'static/optimal_transport_coupling/models',
  dim: 2,
  hidden: 64,
  epochs: 2000,
  batchSizeIndep: 1024,
  batchSizeOT: 1024,       // per-batch Sinkhorn (clamped to dataset size, which is small)
  updateInterval: 100,
  // Minibatch-OT Sinkhorn params
  sinkhornEpsilon: 0.1,
  sinkhornMaxIter: 100,
  sinkhornTolerance: 1e-5,
  // Source-noise clipping radius (matches viz-time clipping)
  clippingRadius: 2.0,
};

// ----------------------------------------------------------------
// Dataset + model save helpers (copied from rectified-flow-explainer)
// ----------------------------------------------------------------

function loadDataset(relPath: string): tf.Tensor2D {
  const absPath = path.join(ROOT, relPath);
  const rawData = fs.readFileSync(absPath, 'utf-8');
  const data = JSON.parse(rawData);
  return tf.tensor2d(data.points);
}

async function saveModel(model: tf.Sequential, dir: string, name: string): Promise<string> {
  const outputDir = path.join(ROOT, dir);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const topoJSON = model.toJSON();
  const modelTopology = typeof topoJSON === 'string' ? JSON.parse(topoJSON) : topoJSON;
  const weights = model.getWeights();

  const modelJSON: tf.io.ModelJSON = { modelTopology } as tf.io.ModelJSON;

  const weightSpecs: tf.io.WeightsManifestEntry[] = [];
  const weightDataArrays: ArrayBuffer[] = [];

  for (let i = 0; i < weights.length; i++) {
    const weight = weights[i];
    const wName = model.weights[i].name;
    const data = await weight.data();
    weightSpecs.push({
      name: wName,
      shape: weight.shape,
      dtype: weight.dtype as 'float32' | 'int32' | 'bool' | 'string' | 'complex64',
    });
    const buffer = new ArrayBuffer(data.byteLength);
    new (data.constructor as Float32ArrayConstructor)(buffer).set(data as Float32Array);
    weightDataArrays.push(buffer);
  }

  const totalBytes = weightDataArrays.reduce((s, b) => s + b.byteLength, 0);
  const combinedBuffer = new ArrayBuffer(totalBytes);
  const combinedView = new Uint8Array(combinedBuffer);
  let offset = 0;
  for (const buf of weightDataArrays) {
    combinedView.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }

  const weightsManifest: tf.io.WeightsManifestConfig = [{
    paths: [`${name}.weights.bin`],
    weights: weightSpecs,
  }];
  modelJSON.weightsManifest = weightsManifest;

  const jsonPath = path.join(outputDir, `${name}.json`);
  const weightsPath = path.join(outputDir, `${name}.weights.bin`);
  fs.writeFileSync(jsonPath, JSON.stringify(modelJSON));
  fs.writeFileSync(weightsPath, Buffer.from(combinedBuffer));

  weights.forEach(w => w.dispose());
  return path.join(outputDir, name);
}

// ----------------------------------------------------------------
// Sinkhorn (per-batch, log-domain-stable enough for batch ≤ 256)
// ----------------------------------------------------------------

function pairwiseSqDistances(X: tf.Tensor2D, Y: tf.Tensor2D): tf.Tensor2D {
  return tf.tidy(() => {
    const X2 = tf.sum(tf.square(X), 1).expandDims(1);
    const Y2 = tf.sum(tf.square(Y), 1).expandDims(0);
    const XY = tf.matMul(X, Y.transpose());
    return X2.add(Y2).sub(XY.mul(2)) as tf.Tensor2D;
  });
}

function sinkhornMatching(
  x0: tf.Tensor2D,
  x1: tf.Tensor2D,
  epsilon: number,
  maxIter: number,
  tolerance: number,
): number[] {
  return tf.tidy(() => {
    const C = pairwiseSqDistances(x0, x1);
    const K = tf.exp(C.div(-epsilon)) as tf.Tensor2D;
    const n = x0.shape[0];
    const m = x1.shape[0];
    const a = tf.fill([n], 1 / n) as tf.Tensor1D;
    const b = tf.fill([m], 1 / m) as tf.Tensor1D;

    let u: tf.Tensor1D = tf.ones([n]) as tf.Tensor1D;
    let v: tf.Tensor1D = tf.ones([m]) as tf.Tensor1D;

    for (let iter = 0; iter < maxIter; iter++) {
      const Kv = tf.matMul(K, v.expandDims(1)).squeeze([1]) as tf.Tensor1D;
      const uNew = a.div(Kv.add(1e-10)) as tf.Tensor1D;
      const KTu = tf.matMul(K.transpose(), uNew.expandDims(1)).squeeze([1]) as tf.Tensor1D;
      const vNew = b.div(KTu.add(1e-10)) as tf.Tensor1D;

      const uDiff = tf.sum(tf.abs(uNew.sub(u))).arraySync() as number;
      const vDiff = tf.sum(tf.abs(vNew.sub(v))).arraySync() as number;

      u = uNew;
      v = vNew;
      if (uDiff < tolerance && vDiff < tolerance) break;
    }

    const P = K.mul(u.expandDims(1)).mul(v.expandDims(0)) as tf.Tensor2D;
    const matching = P.argMax(1).arraySync() as number[];
    return matching;
  });
}

// ----------------------------------------------------------------
// Clipped Gaussian sampling (rejection-sampled to radius)
// ----------------------------------------------------------------

function sampleClippedGaussian(numSamples: number, dim: number, radius: number): tf.Tensor2D {
  // Oversample and reject, keep retrying until we have enough
  const samples: number[][] = [];
  while (samples.length < numSamples) {
    const oversample = Math.max(numSamples * 2, 64);
    const raw = tf.randomNormal([oversample, dim]);
    const arr = raw.arraySync() as number[][];
    raw.dispose();
    for (const s of arr) {
      const r = Math.sqrt(s.reduce((acc, v) => acc + v * v, 0));
      if (r <= radius && samples.length < numSamples) samples.push(s);
    }
  }
  return tf.tensor2d(samples);
}

// ----------------------------------------------------------------
// Custom training loop for minibatch OT coupling
// ----------------------------------------------------------------

async function trainOTModel(
  data: tf.Tensor2D,
  config: typeof CONFIG,
): Promise<FlowModel> {
  const model = new FlowModel(config.dim, config.hidden);
  const optimizer = tf.train.adam(0.01);
  const lossFn = (pred: tf.Tensor, target: tf.Tensor) =>
    tf.losses.meanSquaredError(target, pred);

  const numSamples = data.shape[0];
  const numBatches = Math.ceil(numSamples / config.batchSizeOT);

  const startTime = Date.now();
  let lastLogTime = startTime;

  for (let epoch = 0; epoch < config.epochs; epoch++) {
    const indices = tf.util.createShuffledIndices(numSamples);
    let epochLoss = 0;
    let batchCount = 0;

    for (let batchIdx = 0; batchIdx < numBatches; batchIdx++) {
      const batchLoss = tf.tidy(() => {
        // Gather target batch
        const slice = indices.slice(
          batchIdx * config.batchSizeOT,
          Math.min((batchIdx + 1) * config.batchSizeOT, numSamples),
        );
        const batchIndices = tf.tensor1d(Array.from(slice), 'int32');
        const x_1 = tf.gather(data, batchIndices) as tf.Tensor2D;
        const actualBatchSize = x_1.shape[0];

        // Sample fresh x0 ~ N(0, I), clipped
        const x_0_unclipped = tf.randomNormal([actualBatchSize, config.dim]) as tf.Tensor2D;
        const norms = tf.sqrt(tf.sum(tf.square(x_0_unclipped), 1)).expandDims(1);
        const scale = tf.minimum(tf.onesLike(norms), tf.scalar(config.clippingRadius).div(norms.add(1e-10)));
        const x_0_raw = x_0_unclipped.mul(scale) as tf.Tensor2D;

        // Minibatch OT: compute matching, reorder x0 so x0[i] is OT mate of x1[i]
        const matching = sinkhornMatching(
          x_0_raw,
          x_1,
          config.sinkhornEpsilon,
          config.sinkhornMaxIter,
          config.sinkhornTolerance,
        );
        // matching[i] = j means x_0_raw[i] is paired to x_1[j]
        // We need x_0_reordered[j] = x_0_raw[i] for each (i, j) pair.
        // Build inverse: inv[j] = i (source index that matches target j).
        const inv = new Array(actualBatchSize).fill(0);
        for (let i = 0; i < matching.length; i++) inv[matching[i]] = i;
        const invTensor = tf.tensor1d(inv, 'int32');
        const x_0 = tf.gather(x_0_raw, invTensor) as tf.Tensor2D;

        // Standard FM loss
        const t = tf.randomUniform([actualBatchSize, 1]);
        const x_t = x_0.mul(tf.sub(1, t)).add(x_1.mul(t)) as tf.Tensor2D;
        const dx_t = x_1.sub(x_0);

        let lossValue = 0;
        optimizer.minimize(() => {
          const pred = model.forward(x_t, t);
          const loss = lossFn(pred, dx_t);
          lossValue = loss.dataSync()[0];
          return loss as tf.Scalar;
        });
        return lossValue;
      });
      epochLoss += batchLoss;
      batchCount++;
    }

    const avgLoss = epochLoss / batchCount;
    if (epoch % config.updateInterval === 0 || epoch === config.epochs - 1) {
      const now = Date.now();
      const epochTime = ((now - lastLogTime) / 1000).toFixed(1);
      const totalTime = ((now - startTime) / 1000).toFixed(1);
      lastLogTime = now;
      console.log(`  [OT] Epoch ${String(epoch).padStart(4)} | Loss: ${avgLoss.toFixed(6)} | dT: ${epochTime}s | total: ${totalTime}s`);
    }
    await tf.nextFrame();
  }

  optimizer.dispose();
  return model;
}

// ----------------------------------------------------------------
// Main
// ----------------------------------------------------------------

async function main() {
  await initBackend();

  console.log('\n========================================');
  console.log('  OT-Coupling: Train two flow models');
  console.log('========================================\n');
  console.log(`Backend: ${tf.getBackend()} | tfjs: ${tf.version.tfjs}`);

  const dataset = loadDataset(CONFIG.datasetPath);
  console.log(`Dataset shape: [${dataset.shape.join(', ')}]\n`);

  // ----- Train Independent (standard flow matching) -----
  console.log('--- Training INDEPENDENT model (source=null) ---');
  const indepStart = Date.now();
  const indepModel = new FlowModel(CONFIG.dim, CONFIG.hidden);
  let lastLog = Date.now();
  await indepModel.train(
    dataset,
    CONFIG.epochs,
    CONFIG.batchSizeIndep,
    CONFIG.updateInterval,
    () => false,
    (epoch, _samples, loss) => {
      if (epoch % CONFIG.updateInterval === 0 || epoch === CONFIG.epochs - 1) {
        const now = Date.now();
        const dt = ((now - lastLog) / 1000).toFixed(1);
        lastLog = now;
        console.log(`  [INDEP] Epoch ${String(epoch).padStart(4)} | Loss: ${(loss ?? 0).toFixed(6)} | dT: ${dt}s`);
      }
    },
    null,
  );
  console.log(`Independent training done in ${((Date.now() - indepStart) / 1000).toFixed(1)}s\n`);

  // Save independent model
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const indepInternal = (indepModel as any).model as tf.Sequential;
  await saveModel(indepInternal, CONFIG.modelOutputDir, 'flow_model_independent');
  console.log('  Saved flow_model_independent.json + .weights.bin\n');

  // ----- Train OT (custom minibatch-OT loop) -----
  console.log('--- Training OT model (minibatch Sinkhorn coupling) ---');
  const otStart = Date.now();
  const otModel = await trainOTModel(dataset, CONFIG);
  console.log(`OT training done in ${((Date.now() - otStart) / 1000).toFixed(1)}s\n`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const otInternal = (otModel as any).model as tf.Sequential;
  await saveModel(otInternal, CONFIG.modelOutputDir, 'flow_model_ot');
  console.log('  Saved flow_model_ot.json + .weights.bin\n');

  dataset.dispose();

  console.log('========================================');
  console.log('  Training complete!');
  console.log('========================================\n');
}

main().catch((err) => {
  console.error('Training failed:', err);
  process.exit(1);
});
