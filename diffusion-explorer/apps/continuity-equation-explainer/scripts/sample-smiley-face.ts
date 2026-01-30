/**
 * Sample Smiley Face Trajectories
 *
 * Generates forward and reverse trajectories from the trained flow model.
 * Used by multiple figures (CrownJewel, FlowInvertibility, ReverseSampling, etc.)
 *
 * Usage: npx tsx scripts/sample-smiley-face.ts
 *
 * Output:
 *   - static/smiley_face/cached_samples/trajectories.json (forward: Gaussian → Smiley)
 *   - static/smiley_face/cached_samples/reverse_trajectories.json (reverse: Smiley → Gaussian)
 */

import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-wasm';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { FlowModel } from '@diffusion-explorer/diffusion';

// ESM __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

// Initialize WASM backend
async function initBackend(): Promise<void> {
  await tf.setBackend('wasm');
  await tf.ready();
}

// Configuration
const CONFIG = {
  // Paths
  modelPath: 'static/models/flow_model.json',
  targetDataPath: 'static/data/smiley_face.json',
  forwardOutputPath: 'static/cached_samples/trajectories.json',
  reverseOutputPath: 'static/cached_samples/reverse_trajectories.json',

  // Model
  dim: 2,
  hidden: 64,

  // Sampling parameters
  gaussianStd: 1.0,       // Source Gaussian std (must match training)

  // Forward sampling
  forwardNumSamples: 150,
  forwardNumSteps: 200,

  // Reverse sampling
  reverseNumSamples: 50,
  reverseNumSteps: 200,
};

// ============================================================================
// Helpers
// ============================================================================

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}min`;
}

// Load model from filesystem (manual deserialization for WASM backend)
async function loadModel(modelJsonPath: string): Promise<tf.LayersModel> {
  const modelJSON = JSON.parse(fs.readFileSync(modelJsonPath, 'utf-8'));

  const weightsManifest = modelJSON.weightsManifest;
  if (!weightsManifest || weightsManifest.length === 0) {
    throw new Error('No weights manifest found in model JSON');
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

  // Concatenate weight buffers
  const totalBytes = weightDataArrays.reduce((sum, buf) => sum + buf.byteLength, 0);
  const combinedBuffer = new ArrayBuffer(totalBytes);
  const combinedView = new Uint8Array(combinedBuffer);
  let offset = 0;
  for (const buf of weightDataArrays) {
    combinedView.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }

  // Create model from topology and load weights
  const modelTopology = modelJSON.modelTopology || modelJSON;
  const model = await tf.models.modelFromJSON({ modelTopology });

  // Decode weights and set them
  const weightTensors = tf.io.decodeWeights(combinedBuffer, weightSpecs);

  const weightValues: tf.Tensor[] = [];
  for (const weight of model.weights) {
    const tensor = weightTensors[weight.name];
    if (tensor) {
      weightValues.push(tensor);
    } else {
      const baseName = weight.originalName || weight.name;
      const found = weightTensors[baseName];
      if (found) {
        weightValues.push(found);
      } else {
        throw new Error(`Weight not found: ${weight.name} (original: ${baseName})`);
      }
    }
  }
  model.setWeights(weightValues);

  Object.values(weightTensors).forEach(t => t.dispose());

  return model;
}

// Load target distribution (raw data, no normalization)
function loadTargetData(relPath: string): number[][] {
  const absPath = path.join(ROOT, relPath);
  const rawData = fs.readFileSync(absPath, 'utf-8');
  const data = JSON.parse(rawData);
  return data.points;
}

// Box-Muller transform for standard normal samples
function standardNormal(): number {
  let u1 = 0, u2 = 0;
  while (u1 === 0) u1 = Math.random();
  while (u2 === 0) u2 = Math.random();
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
}

// Sample from 2D Gaussian (no clipping)
function sampleGaussian(numSamples: number, std: number): number[][] {
  const samples: number[][] = [];
  for (let i = 0; i < numSamples; i++) {
    const x = standardNormal() * std;
    const y = standardNormal() * std;
    samples.push([x, y]);
  }
  return samples;
}

// Shuffle array and return first n elements
function getRandomSubset<T>(array: T[], n: number): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, n);
}

// ============================================================================
// Trajectory Generation
// ============================================================================

// Generate forward trajectories (t=0 → t=1)
async function generateForwardTrajectories(
  model: FlowModel,
  startingPoints: number[][],
  numSteps: number
): Promise<number[][][]> {
  const trajectories: number[][][] = [];

  for (let i = 0; i < startingPoints.length; i++) {
    const trajectory: number[][] = [];
    let currentPoint = [...startingPoints[i]];
    trajectory.push([...currentPoint]);

    const dt = 1.0 / numSteps;

    for (let step = 0; step < numSteps; step++) {
      const t = step / numSteps;

      const velocityTensor = model.forward(
        tf.tensor2d([currentPoint]),
        tf.scalar(t)
      ) as tf.Tensor2D;

      const velocity = velocityTensor.arraySync()[0] as number[];

      currentPoint[0] += velocity[0] * dt;
      currentPoint[1] += velocity[1] * dt;
      trajectory.push([...currentPoint]);

      velocityTensor.dispose();
    }

    trajectories.push(trajectory);

    if ((i + 1) % 50 === 0) {
      console.log(`  Forward: ${i + 1}/${startingPoints.length} trajectories`);
    }
  }

  return trajectories;
}

// Generate reverse trajectories (t=1 → t=0)
async function generateReverseTrajectories(
  model: FlowModel,
  startingPoints: number[][],
  numSteps: number
): Promise<number[][][]> {
  const trajectories: number[][][] = [];

  for (let i = 0; i < startingPoints.length; i++) {
    const trajectory: number[][] = [];
    let currentPoint = [...startingPoints[i]];
    trajectory.push([...currentPoint]);

    const dt = 1.0 / numSteps;

    for (let step = 0; step < numSteps; step++) {
      const t = 1.0 - step / numSteps;

      const velocityTensor = model.forward(
        tf.tensor2d([currentPoint]),
        tf.scalar(t)
      ) as tf.Tensor2D;

      const velocity = velocityTensor.arraySync()[0] as number[];

      // Reverse: subtract velocity
      currentPoint[0] -= velocity[0] * dt;
      currentPoint[1] -= velocity[1] * dt;
      trajectory.push([...currentPoint]);

      velocityTensor.dispose();
    }

    trajectories.push(trajectory);

    if ((i + 1) % 10 === 0) {
      console.log(`  Reverse: ${i + 1}/${startingPoints.length} trajectories`);
    }
  }

  return trajectories;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  await initBackend();

  console.log('\n****************************************');
  console.log('  Smiley Face - Trajectory Sampling');
  console.log('****************************************\n');

  console.log(`TensorFlow.js Backend: ${tf.getBackend()}`);
  console.log(`TensorFlow.js Version: ${tf.version.tfjs}`);

  const startTime = Date.now();

  // Check if model exists
  const modelJsonPath = path.join(ROOT, CONFIG.modelPath);
  if (!fs.existsSync(modelJsonPath)) {
    console.error(`Model not found at ${CONFIG.modelPath}`);
    console.error('Please run the training script first: npx tsx scripts/train-smiley-face.ts');
    process.exit(1);
  }

  // Load model
  console.log('\nLoading flow model...');
  const model = new FlowModel(CONFIG.dim, CONFIG.hidden);
  const tfModel = await loadModel(modelJsonPath);
  (model as any).model = tfModel;
  console.log('Model loaded successfully.');

  // Load target distribution
  console.log(`\nLoading target distribution...`);
  const targetDistribution = loadTargetData(CONFIG.targetDataPath);
  console.log(`  Loaded ${targetDistribution.length} target points (std=${CONFIG.gaussianStd})`);

  // ========================================================================
  // Forward Sampling (Gaussian → Smiley)
  // ========================================================================

  console.log('\n========================================');
  console.log('  Forward Trajectories (Gaussian → Smiley)');
  console.log('========================================\n');

  console.log(`Sampling ${CONFIG.forwardNumSamples} points from Gaussian (std=${CONFIG.gaussianStd})...`);
  const gaussianSamples = sampleGaussian(CONFIG.forwardNumSamples, CONFIG.gaussianStd);

  console.log(`Generating ${CONFIG.forwardNumSteps} step trajectories...`);
  const forwardTrajectories = await generateForwardTrajectories(model, gaussianSamples, CONFIG.forwardNumSteps);

  // Find highlighted points at 10th and 90th percentile
  const startingPoints = forwardTrajectories.map(traj => traj[0]);
  const sortedIndices = startingPoints
    .map((pt, idx) => ({ idx, y: pt[1] }))
    .sort((a, b) => a.y - b.y)
    .map(item => item.idx);

  const idx10 = sortedIndices[Math.floor(sortedIndices.length * 0.1)];
  const idx90 = sortedIndices[Math.floor(sortedIndices.length * 0.9)];
  const highlightedIndices = [idx10, idx90];

  console.log(`Highlighted indices: ${highlightedIndices.join(', ')} (10th/90th percentile by y)`);

  // Transpose trajectories from [sample][timestep][dim] to [timestep][sample][dim]
  // This is the format expected by loadCachedTrajectories
  const numSteps = forwardTrajectories[0].length;
  const numSamples = forwardTrajectories.length;
  const transposedTrajectories: number[][][] = [];
  for (let t = 0; t < numSteps; t++) {
    const timestepSamples: number[][] = [];
    for (let s = 0; s < numSamples; s++) {
      timestepSamples.push(forwardTrajectories[s][t]);
    }
    transposedTrajectories.push(timestepSamples);
  }

  // Save forward trajectories as raw array (format: [timestep][sample][dim])
  const forwardOutputFile = path.join(ROOT, CONFIG.forwardOutputPath);
  fs.mkdirSync(path.dirname(forwardOutputFile), { recursive: true });
  fs.writeFileSync(forwardOutputFile, JSON.stringify(transposedTrajectories));
  console.log(`Saved to: ${CONFIG.forwardOutputPath} (${numSteps} timesteps x ${numSamples} samples)`);

  // ========================================================================
  // Reverse Sampling (Smiley → Gaussian)
  // ========================================================================

  console.log('\n========================================');
  console.log('  Reverse Trajectories (Smiley → Gaussian)');
  console.log('========================================\n');

  console.log(`Selecting ${CONFIG.reverseNumSamples} random points from target distribution...`);
  const reverseStartingPoints = getRandomSubset(targetDistribution, CONFIG.reverseNumSamples);

  console.log(`Generating ${CONFIG.reverseNumSteps} step reverse trajectories...`);
  const reverseTrajectories = await generateReverseTrajectories(model, reverseStartingPoints, CONFIG.reverseNumSteps);

  // Save reverse trajectories
  const reverseOutput = {
    trajectories: reverseTrajectories,
    config: {
      numSamples: CONFIG.reverseNumSamples,
      numSteps: CONFIG.reverseNumSteps,
    }
  };

  const reverseOutputFile = path.join(ROOT, CONFIG.reverseOutputPath);
  fs.mkdirSync(path.dirname(reverseOutputFile), { recursive: true });
  fs.writeFileSync(reverseOutputFile, JSON.stringify(reverseOutput));
  console.log(`Saved to: ${CONFIG.reverseOutputPath}`);

  // Cleanup
  tfModel.dispose();

  console.log(`\nTotal time: ${formatDuration(Date.now() - startTime)}`);

  console.log('\n****************************************');
  console.log('  Done!');
  console.log('****************************************\n');
}

main().catch((err) => {
  console.error('Sampling failed:', err);
  process.exit(1);
});
