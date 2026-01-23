// Sample REVERSE trajectories from trained Flow Matching model
// Runs the flow from target distribution (t=1) back to source (t=0)
// TensorFlow.js with WASM backend (works on Apple Silicon)
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-wasm';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { FlowModel } from '@diffusion-explorer/diffusion';

// ESM __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');

// Initialize WASM backend
async function initBackend(): Promise<void> {
  await tf.setBackend('wasm');
  await tf.ready();
}

// Configuration
const CONFIG = {
  numSamples: 50,         // Number of reverse trajectories
  numSteps: 300,          // Timesteps in trajectory
  gaussianStd: 0.5,       // Standard deviation (for normalizing target data)
  modelPath: 'static/flow_invertibility/models/flow_matching_model.json',
  targetDataPath: 'static/flow_invertibility/data/smiley_face.json',
  outputPath: 'static/flow_invertibility/cached_samples/reverse_trajectories.json',
  dim: 2,
  hidden: 64,
};

// Helper: Format duration
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}min`;
}

// Helper: Load model from filesystem (manual deserialization for WASM backend)
async function loadModel(modelJsonPath: string): Promise<tf.LayersModel> {
  // Read model topology
  const modelJSON = JSON.parse(fs.readFileSync(modelJsonPath, 'utf-8'));

  // Read weights binary
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

  // Get weights in the order expected by the model
  const weightValues: tf.Tensor[] = [];
  for (const weight of model.weights) {
    const tensor = weightTensors[weight.name];
    if (tensor) {
      weightValues.push(tensor);
    } else {
      // Try to find by original name (without unique suffix)
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

  // Cleanup decoded tensors
  Object.values(weightTensors).forEach(t => t.dispose());

  return model;
}

// Load and normalize target distribution (same as training)
function loadNormalizedTargetData(relPath: string, targetStd: number): number[][] {
  const absPath = path.join(ROOT, relPath);
  const rawData = fs.readFileSync(absPath, 'utf-8');
  const data = JSON.parse(rawData);
  const points: number[][] = data.points;

  // Compute mean
  let meanX = 0, meanY = 0;
  for (const p of points) {
    meanX += p[0];
    meanY += p[1];
  }
  meanX /= points.length;
  meanY /= points.length;

  // Center the points
  const centered = points.map(p => [p[0] - meanX, p[1] - meanY]);

  // Compute std
  let variance = 0;
  for (const p of centered) {
    variance += p[0] * p[0] + p[1] * p[1];
  }
  variance /= (points.length * 2);  // Average variance across both dimensions
  const std = Math.sqrt(variance);

  // Scale to target std
  const scale = targetStd / std;
  return centered.map(p => [p[0] * scale, p[1] * scale]);
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

// Generate REVERSE trajectories from target distribution points using flow model
// This integrates from t=1 to t=0, using the negative of the velocity field
async function generateReverseTrajectories(
  model: FlowModel,
  startingPoints: number[][],  // Points from target distribution (at t=1)
  numSteps: number
): Promise<number[][][]> {
  const trajectories: number[][][] = [];

  for (let i = 0; i < startingPoints.length; i++) {
    const trajectory: number[][] = [];
    let currentPoint = [...startingPoints[i]];
    trajectory.push([...currentPoint]);

    const dt = 1.0 / numSteps;

    // Integrate from t=1 to t=0 (reverse time)
    for (let step = 0; step < numSteps; step++) {
      // Time goes from 1 to 0
      const t = 1.0 - step / numSteps;

      // Get velocity from flow model
      const velocityTensor = model.forward(
        tf.tensor2d([currentPoint]),
        tf.scalar(t)
      ) as tf.Tensor2D;

      const velocity = velocityTensor.arraySync()[0] as number[];

      // Reverse Euler step (subtract velocity because we're going backward in time)
      currentPoint[0] -= velocity[0] * dt;
      currentPoint[1] -= velocity[1] * dt;
      trajectory.push([...currentPoint]);

      velocityTensor.dispose();
    }

    trajectories.push(trajectory);

    if ((i + 1) % 10 === 0) {
      console.log(`  Generated ${i + 1}/${startingPoints.length} reverse trajectories`);
    }
  }

  return trajectories;
}

// Main
async function main() {
  // Initialize backend
  await initBackend();

  console.log('\n****************************************');
  console.log('  Reverse Sampling - Trajectory Caching');
  console.log('****************************************\n');

  console.log(`TensorFlow.js Backend: ${tf.getBackend()}`);
  console.log(`TensorFlow.js Version: ${tf.version.tfjs}`);

  const startTime = Date.now();

  // Check if model exists
  const modelJsonPath = path.join(ROOT, CONFIG.modelPath);
  if (!fs.existsSync(modelJsonPath)) {
    console.error(`Model not found at ${CONFIG.modelPath}`);
    console.error('Please run the training script first: npx tsx scripts/flow_invertibility/train.ts');
    process.exit(1);
  }

  // Create FlowModel and load weights
  console.log('\nLoading flow matching model...');
  const model = new FlowModel(CONFIG.dim, CONFIG.hidden);
  const tfModel = await loadModel(modelJsonPath);
  (model as any).model = tfModel;
  console.log('Model loaded successfully.');

  // Load target distribution (normalized same as training)
  console.log(`\nLoading target distribution...`);
  const targetDistribution = loadNormalizedTargetData(CONFIG.targetDataPath, CONFIG.gaussianStd);
  console.log(`  Loaded ${targetDistribution.length} target points (centered, scaled to std=${CONFIG.gaussianStd})`);

  // Sample random subset of target distribution points
  console.log(`\nSelecting ${CONFIG.numSamples} random points from target distribution...`);
  const startingPoints = getRandomSubset(targetDistribution, CONFIG.numSamples);

  // Generate reverse trajectories (from t=1 to t=0)
  console.log(`\nGenerating reverse trajectories (${CONFIG.numSteps} steps, t=1 -> t=0)...`);
  const trajectories = await generateReverseTrajectories(model, startingPoints, CONFIG.numSteps);

  // Prepare output data
  // Note: trajectories[i][0] is the starting point (from target),
  //       trajectories[i][numSteps] is the ending point (should be near source/Gaussian)
  const outputData = {
    trajectories: trajectories,  // [sample][timestep][dim] where timestep 0 is at t=1 (target)
    config: {
      numSamples: CONFIG.numSamples,
      numSteps: CONFIG.numSteps,
    }
  };

  // Save to file
  const outputFile = path.join(ROOT, CONFIG.outputPath);
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify(outputData));

  console.log(`\nSaved to: ${CONFIG.outputPath}`);
  console.log(`Total time: ${formatDuration(Date.now() - startTime)}`);

  // Cleanup
  tfModel.dispose();

  console.log('\n****************************************');
  console.log('  Done!');
  console.log('****************************************\n');
}

main().catch((err) => {
  console.error('Reverse sampling failed:', err);
  process.exit(1);
});
