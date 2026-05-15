// Train a class-conditioned flow matching model on a 2-Gaussian mixture.
// Two classes are vertically stacked at (0, +1.2) and (0, -1.2), each with σ=0.3.
// Saves weights to static/class_conditioning/models/ and runs a per-class
// sanity check on the trained model.

import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-wasm';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
// NOTE: Resolve via relative path rather than the workspace symlink
// `@diffusion-explorer/diffusion`. In a worktree the symlink can route
// imports back to the primary checkout, missing local edits to the package.
import { ConditionalFlowModel } from '../../../../packages/diffusion/src/flow_matching/conditional_flow_matching';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');

async function initBackend(): Promise<void> {
  await tf.setBackend('wasm');
  await tf.ready();
}

// ---------- Configuration ----------

const CONFIG = {
  modelOutputDir: 'static/class_conditioning/models',
  modelName: 'conditional_flow_model',
  model: {
    dim: 2,
    condDim: 2,        // two classes
    hidden: 64,
    epochs: 3000,
    batchSize: 256,
    updateInterval: 200,
    condDropProb: 0.1, // CFG dropout (unused at sample time unless guidanceScale > 0)
  },
  dataset: {
    samplesPerClass: 1000,
    classMeans: [
      [0, 1.2] as [number, number],   // class 0
      [0, -1.2] as [number, number],  // class 1
    ],
    sigma: 0.3,
  },
  sanityCheck: {
    samplesPerClass: 200,
    numSteps: 60,
  },
};

// ---------- Dataset ----------

function sampleGaussian2D(mean: [number, number], sigma: number, n: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < n; i++) {
    const u1 = Math.max(Math.random(), 1e-9);
    const u2 = Math.random();
    const r = Math.sqrt(-2 * Math.log(u1));
    const z1 = r * Math.cos(2 * Math.PI * u2);
    const z2 = r * Math.sin(2 * Math.PI * u2);
    out.push([mean[0] + sigma * z1, mean[1] + sigma * z2]);
  }
  return out;
}

function generateDataset(): { x: tf.Tensor2D; classes: tf.Tensor1D } {
  const { samplesPerClass, classMeans, sigma } = CONFIG.dataset;
  const points: number[][] = [];
  const labels: number[] = [];
  for (let c = 0; c < classMeans.length; c++) {
    const cluster = sampleGaussian2D(classMeans[c], sigma, samplesPerClass);
    for (const p of cluster) {
      points.push(p);
      labels.push(c);
    }
  }
  // Joint shuffle
  for (let i = points.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [points[i], points[j]] = [points[j], points[i]];
    [labels[i], labels[j]] = [labels[j], labels[i]];
  }
  return {
    x: tf.tensor2d(points) as tf.Tensor2D,
    classes: tf.tensor1d(labels, 'int32') as tf.Tensor1D,
  };
}

// ---------- Model serialization ----------
// Adapted from scripts/one_dimensional_flow/train.ts.

async function saveModel(model: tf.LayersModel, dir: string, name: string): Promise<string> {
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
    const wname = model.weights[i].name;
    const data = await weight.data();
    weightSpecs.push({
      name: wname,
      shape: weight.shape,
      dtype: weight.dtype as 'float32' | 'int32' | 'bool' | 'string' | 'complex64',
    });
    const buffer = new ArrayBuffer(data.byteLength);
    new (data.constructor as Float32ArrayConstructor)(buffer).set(data as Float32Array);
    weightDataArrays.push(buffer);
  }

  const totalBytes = weightDataArrays.reduce((s, b) => s + b.byteLength, 0);
  const combined = new ArrayBuffer(totalBytes);
  const view = new Uint8Array(combined);
  let offset = 0;
  for (const b of weightDataArrays) {
    view.set(new Uint8Array(b), offset);
    offset += b.byteLength;
  }

  modelJSON.weightsManifest = [{
    paths: [`${name}.weights.bin`],
    weights: weightSpecs,
  }];

  const jsonPath = path.join(outputDir, `${name}.json`);
  const weightsPath = path.join(outputDir, `${name}.weights.bin`);
  fs.writeFileSync(jsonPath, JSON.stringify(modelJSON));
  fs.writeFileSync(weightsPath, Buffer.from(combined));

  weights.forEach((w) => w.dispose());
  return path.join(outputDir, name);
}

// ---------- Utilities ----------

function fmt(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}min`;
}

function meanOf2D(samples: number[][]): [number, number] {
  let sx = 0, sy = 0;
  for (const [x, y] of samples) { sx += x; sy += y; }
  return [sx / samples.length, sy / samples.length];
}

// ---------- Main ----------

async function main() {
  console.log('\n****************************************');
  console.log('  Class-Conditioned Flow Model Training');
  console.log('****************************************\n');

  const t0 = Date.now();

  await initBackend();
  console.log(`TF.js backend: ${tf.getBackend()} (v${tf.version.tfjs})\n`);

  // ----- Dataset -----
  console.log('Generating 2-Gaussian-mixture dataset:');
  CONFIG.dataset.classMeans.forEach((m, i) => {
    console.log(`  class ${i}: mean=(${m[0]}, ${m[1]}), σ=${CONFIG.dataset.sigma}, n=${CONFIG.dataset.samplesPerClass}`);
  });
  const { x: dataset, classes } = generateDataset();
  console.log(`  total: ${dataset.shape[0]} samples, dim=${dataset.shape[1]}\n`);

  // ----- Model -----
  const m = CONFIG.model;
  console.log(`Creating ConditionalFlowModel (dim=${m.dim}, condDim=${m.condDim}, hidden=${m.hidden})\n`);
  const model = new ConditionalFlowModel(m.dim, m.condDim, m.hidden);

  // ----- Train -----
  let lastLog = Date.now();
  const epochCallback = (epoch: number, _samples: number[][] | null, loss?: number) => {
    if (epoch % m.updateInterval === 0 || epoch === m.epochs - 1) {
      const now = Date.now();
      const stepTime = fmt(now - lastLog);
      const total = fmt(now - t0);
      lastLog = now;
      const lossStr = loss !== undefined ? loss.toFixed(6) : 'N/A';
      console.log(`  Epoch ${epoch.toString().padStart(4)} | Loss: ${lossStr} | step: ${stepTime.padStart(8)} | total: ${total}`);
    }
  };

  console.log(`Training ${m.epochs} epochs, batch=${m.batchSize}, condDropProb=${m.condDropProb}`);
  console.log('----------------------------------------');
  await model.train(
    dataset,
    classes,
    m.epochs,
    m.batchSize,
    m.updateInterval,
    () => false,
    epochCallback,
    null,            // no fixed source coupling
    m.condDropProb,
  );
  console.log('----------------------------------------');
  console.log(`Training done in ${fmt(Date.now() - t0)}\n`);

  // ----- Sanity check (before save: saveModel disposes the model weights) -----
  console.log('Sanity check: sample per-class and verify means cluster correctly.');
  const { samplesPerClass: spc, numSteps } = CONFIG.sanityCheck;
  for (let c = 0; c < m.condDim; c++) {
    const condArr = new Array(spc).fill(c);
    const trajT = await model.sample(spc, numSteps, { cond: condArr });
    if (!trajT) throw new Error('Sampling returned null');
    // Last timestep along axis 0
    const lastStep = trajT.gather(trajT.shape[0] - 1, 0);
    const samples = lastStep.arraySync() as number[][];
    lastStep.dispose();
    trajT.dispose();

    const expected = CONFIG.dataset.classMeans[c];
    const observed = meanOf2D(samples);
    const dx = observed[0] - expected[0];
    const dy = observed[1] - expected[1];
    const dist = Math.sqrt(dx * dx + dy * dy);
    const ok = dist < 0.4 ? 'PASS' : 'WARN';
    console.log(
      `  class ${c}: observed=(${observed[0].toFixed(3)}, ${observed[1].toFixed(3)}) ` +
      `expected=(${expected[0]}, ${expected[1]}) dist=${dist.toFixed(3)} [${ok}]`,
    );
  }

  // ----- Save -----
  console.log(`\nSaving to: ${CONFIG.modelOutputDir}/${CONFIG.modelName}`);
  await saveModel((model as any).model, CONFIG.modelOutputDir, CONFIG.modelName);
  console.log('  Saved.');

  dataset.dispose();
  classes.dispose();

  console.log('\n****************************************');
  console.log(`  Done. Total time: ${fmt(Date.now() - t0)}`);
  console.log('****************************************\n');
}

main().catch((err) => {
  console.error('Training failed:', err);
  process.exit(1);
});
