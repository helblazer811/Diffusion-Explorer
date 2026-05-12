// Generate the figure's data bundle:
//   - N viz source points (clipped Gaussian) shared across both panels
//   - N viz target points (smiley) shared across both panels
//   - OT matching between viz source/target (Sinkhorn)
//   - Random matching for the naive panel
//   - Trajectories from the independent-trained model (curved)
//   - Trajectories from the OT-trained model (straighter)

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
  indepModelPath: 'static/optimal_transport_coupling/models/flow_model_independent.json',
  // Use the rectified-flow model (from rectified-flow-explainer) for OT-panel trajectories
  otModelPath: '../rectified-flow-explainer/static/models/rectified_flow_model.json',
  outputPath: 'static/optimal_transport_coupling/cached_samples/coupling_data.json',
  numVizSamples: 80,
  numTrajSteps: 300,
  clippingRadius: 2.0,
  sinkhornEpsilon: 0.1,
  sinkhornMaxIter: 500,
  sinkhornTolerance: 1e-6,
  dim: 2,
  hidden: 64,
};

// ----------------------------------------------------------------
// Model load (copied from cache-samples.ts)
// ----------------------------------------------------------------

async function loadModel(modelJsonPath: string): Promise<tf.LayersModel> {
  const modelJSON = JSON.parse(fs.readFileSync(modelJsonPath, 'utf-8'));
  const weightsManifest = modelJSON.weightsManifest;
  if (!weightsManifest || weightsManifest.length === 0) {
    throw new Error('No weights manifest in model JSON');
  }

  const modelDir = path.dirname(modelJsonPath);
  const weightSpecs: tf.io.WeightsManifestEntry[] = [];
  const weightDataArrays: ArrayBuffer[] = [];

  for (const group of weightsManifest) {
    weightSpecs.push(...group.weights);
    for (const weightPath of group.paths) {
      const fullPath = path.join(modelDir, weightPath);
      const buffer = fs.readFileSync(fullPath);
      weightDataArrays.push(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
    }
  }

  const totalBytes = weightDataArrays.reduce((s, b) => s + b.byteLength, 0);
  const combinedBuffer = new ArrayBuffer(totalBytes);
  const combinedView = new Uint8Array(combinedBuffer);
  let offset = 0;
  for (const buf of weightDataArrays) {
    combinedView.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }

  const modelTopology = modelJSON.modelTopology || modelJSON;
  const model = await tf.models.modelFromJSON({ modelTopology });
  const weightTensors = tf.io.decodeWeights(combinedBuffer, weightSpecs);
  const weightValues: tf.Tensor[] = [];
  for (const weight of model.weights) {
    const tensor = weightTensors[weight.name];
    if (tensor) {
      weightValues.push(tensor);
    } else {
      const baseName = weight.originalName || weight.name;
      const found = weightTensors[baseName];
      if (found) weightValues.push(found);
      else throw new Error(`Weight not found: ${weight.name}`);
    }
  }
  model.setWeights(weightValues);
  Object.values(weightTensors).forEach(t => t.dispose());
  return model;
}

// ----------------------------------------------------------------
// Sinkhorn (same as train.ts but for the *viz* coupling — full precision)
// ----------------------------------------------------------------

function pairwiseSqDistances(X: tf.Tensor2D, Y: tf.Tensor2D): tf.Tensor2D {
  return tf.tidy(() => {
    const X2 = tf.sum(tf.square(X), 1).expandDims(1);
    const Y2 = tf.sum(tf.square(Y), 1).expandDims(0);
    const XY = tf.matMul(X, Y.transpose());
    return X2.add(Y2).sub(XY.mul(2)) as tf.Tensor2D;
  });
}

function sinkhornCoupling(
  x0: tf.Tensor2D,
  x1: tf.Tensor2D,
  epsilon: number,
  maxIter: number,
  tolerance: number,
): number[][] {
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
      if (uDiff < tolerance && vDiff < tolerance) {
        console.log(`  Sinkhorn converged at iter ${iter + 1}`);
        break;
      }
    }
    const P = K.mul(u.expandDims(1)).mul(v.expandDims(0)) as tf.Tensor2D;
    return P.arraySync() as number[][];
  });
}

// Extract a 1-to-1 permutation from the coupling matrix.
// Greedy: repeatedly pick the highest-probability (source, target) pair,
// then remove that row and column. Yields a near-optimal assignment.
function greedyPermutationFromCoupling(P: number[][]): number[] {
  const n = P.length;
  const matching = new Array<number>(n).fill(-1);
  const usedTarget = new Array<boolean>(P[0].length).fill(false);

  // Collect (i, j, P[i][j]) and sort desc by probability
  const entries: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < P[i].length; j++) entries.push([i, j, P[i][j]]);
  }
  entries.sort((a, b) => b[2] - a[2]);

  let assigned = 0;
  for (const [i, j] of entries) {
    if (matching[i] !== -1 || usedTarget[j]) continue;
    matching[i] = j;
    usedTarget[j] = true;
    assigned++;
    if (assigned === n) break;
  }
  return matching;
}

// ----------------------------------------------------------------
// Source-noise generation
// ----------------------------------------------------------------

function generateClippedGaussian(numSamples: number, radius: number, dim: number): number[][] {
  const samples: number[][] = [];
  while (samples.length < numSamples) {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    const x = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    const y = Math.sqrt(-2 * Math.log(u)) * Math.sin(2 * Math.PI * v);
    const pt = dim === 2 ? [x, y] : [x, y, /* extend if needed */];
    const r = Math.sqrt(pt.reduce((acc, c) => acc + c * c, 0));
    if (r <= radius) samples.push(pt);
  }
  return samples;
}

function shuffleArray<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ----------------------------------------------------------------
// Main
// ----------------------------------------------------------------

async function main() {
  await initBackend();

  console.log('\n========================================');
  console.log('  OT-Coupling: Generate figure data');
  console.log('========================================\n');

  // 1. Load smiley target, sample N viz target points
  const rawData = fs.readFileSync(path.join(ROOT, CONFIG.datasetPath), 'utf-8');
  const allTarget: number[][] = JSON.parse(rawData).points;
  const shuffledTarget = shuffleArray([...allTarget]);
  const targetPoints = shuffledTarget.slice(0, CONFIG.numVizSamples);
  console.log(`Loaded target distribution: ${allTarget.length} points, using ${targetPoints.length}`);

  // 2. Generate N clipped Gaussian source points
  const sourcePoints = generateClippedGaussian(CONFIG.numVizSamples, CONFIG.clippingRadius, CONFIG.dim);
  console.log(`Generated ${sourcePoints.length} clipped Gaussian source points (radius ${CONFIG.clippingRadius})`);

  // 3. OT matching on viz coupling (Sinkhorn → greedy 1-to-1)
  console.log('Running Sinkhorn on viz coupling...');
  const sourceTensor = tf.tensor2d(sourcePoints);
  const targetTensor = tf.tensor2d(targetPoints);
  const P = sinkhornCoupling(
    sourceTensor,
    targetTensor,
    CONFIG.sinkhornEpsilon,
    CONFIG.sinkhornMaxIter,
    CONFIG.sinkhornTolerance,
  );
  const otMatching = greedyPermutationFromCoupling(P);
  const uniqueMatched = new Set(otMatching).size;
  console.log(`  OT matching: ${uniqueMatched}/${otMatching.length} unique target indices`);

  // 4. Random matching for naive panel
  const naiveMatching = shuffleArray([...Array(CONFIG.numVizSamples).keys()]);
  console.log('Generated random naive matching');

  // 5. Load both models and sample trajectories from viz source points
  console.log('\nLoading INDEPENDENT model...');
  const indepFlow = new FlowModel(CONFIG.dim, CONFIG.hidden);
  const indepInternal = await loadModel(path.join(ROOT, CONFIG.indepModelPath));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (indepFlow as any).model = indepInternal;

  console.log('Loading rectified-flow model (for OT-panel trajectories)...');
  const otFlow = new FlowModel(CONFIG.dim, CONFIG.hidden);
  const otInternal = await loadModel(path.join(ROOT, CONFIG.otModelPath));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (otFlow as any).model = otInternal;

  // Sample trajectories for both, starting from same viz source points
  console.log(`\nSampling ${CONFIG.numVizSamples} trajectories x ${CONFIG.numTrajSteps} steps (INDEP)...`);
  const indepInitial = tf.tensor2d(sourcePoints) as tf.Tensor2D;
  const indepTrajRaw = await indepFlow.sample_from_initial_points(indepInitial, CONFIG.numTrajSteps);
  if (!indepTrajRaw) throw new Error('INDEP sampling cancelled');
  // shape: [numSteps, numSamples, dim] — we want [numSamples][numSteps][dim] with source as t=0
  const indepStepData = indepTrajRaw.arraySync() as number[][][];
  indepTrajRaw.dispose();
  indepInitial.dispose();

  console.log(`Sampling ${CONFIG.numVizSamples} trajectories x ${CONFIG.numTrajSteps} steps (OT)...`);
  const otInitial = tf.tensor2d(sourcePoints) as tf.Tensor2D;
  const otTrajRaw = await otFlow.sample_from_initial_points(otInitial, CONFIG.numTrajSteps);
  if (!otTrajRaw) throw new Error('OT sampling cancelled');
  const otStepData = otTrajRaw.arraySync() as number[][][];
  otTrajRaw.dispose();
  otInitial.dispose();

  // Reshape: indepStepData is [steps][samples][dim]. We want [samples][steps+1][dim] with source as first step.
  function buildPerSampleTrajectories(stepData: number[][][], source: number[][]): number[][][] {
    const numSamples = source.length;
    const numStepsOut = stepData.length;
    const trajectories: number[][][] = [];
    for (let i = 0; i < numSamples; i++) {
      const traj: number[][] = [source[i]];
      for (let t = 0; t < numStepsOut; t++) traj.push(stepData[t][i]);
      trajectories.push(traj);
    }
    return trajectories;
  }
  const naiveTrajectories = buildPerSampleTrajectories(indepStepData, sourcePoints);
  const otTrajectories = buildPerSampleTrajectories(otStepData, sourcePoints);

  console.log(`  INDEP trajectories: [${naiveTrajectories.length}][${naiveTrajectories[0].length}][${naiveTrajectories[0][0].length}]`);
  console.log(`  OT trajectories:    [${otTrajectories.length}][${otTrajectories[0].length}][${otTrajectories[0][0].length}]`);

  // 6. Save bundle
  const output = {
    sourcePoints,
    targetPoints,
    otMatching,
    naiveMatching,
    otTrajectories,
    naiveTrajectories,
  };
  const outputFile = path.join(ROOT, CONFIG.outputPath);
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify(output));
  console.log(`\nSaved: ${CONFIG.outputPath}`);
  console.log(`  File size: ${(fs.statSync(outputFile).size / 1024).toFixed(1)} KB`);

  // Cleanup
  sourceTensor.dispose();
  targetTensor.dispose();
  indepInternal.dispose();
  otInternal.dispose();

  console.log('\n========================================');
  console.log('  Done!');
  console.log('========================================\n');
}

main().catch((err) => {
  console.error('Sampling failed:', err);
  process.exit(1);
});
