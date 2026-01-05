// TensorFlow.js with WASM backend (works on Apple Silicon)
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-wasm';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { FlowModel, DiffusionModel, DomainRange } from '@diffusion-explorer/diffusion';

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
  gridResolution: 6,  // 6x6 = 36 trajectories
  numSteps: 200,      // Same for both models
  domainRange: { xMin: -1.5, xMax: 1.5, yMin: -1.5, yMax: 1.5 } as DomainRange,
  flowMatching: {
    modelPath: 'static/pull_toward_mean/models/flow_matching_model.json',
    outputPath: 'static/pull_toward_mean/cached_samples/flow_matching_trajectories.json',
    dim: 2,
    hidden: 64,
  },
  diffusion: {
    modelPath: 'static/pull_toward_mean/models/diffusion_model.json',
    outputPath: 'static/pull_toward_mean/cached_samples/diffusion_trajectories.json',
    dim: 2,
    hidden: 128,
    T: 1000,
  },
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

// Generate Flow Matching trajectories
async function generateFlowMatchingTrajectories(): Promise<void> {
  const config = CONFIG.flowMatching;

  console.log('\n----------------------------------------');
  console.log('  Flow Matching Trajectories');
  console.log('----------------------------------------');

  const startTime = Date.now();

  // Check if model exists
  const modelJsonPath = path.join(ROOT, config.modelPath);
  if (!fs.existsSync(modelJsonPath)) {
    console.log(`  Skipping - model not found at ${config.modelPath}`);
    return;
  }

  // Create FlowModel and load weights
  const model = new FlowModel(config.dim, config.hidden);
  const tfModel = await loadModel(modelJsonPath);
  (model as any).model = tfModel;

  console.log(`  Grid: ${CONFIG.gridResolution}x${CONFIG.gridResolution}`);
  console.log(`  Steps: ${CONFIG.numSteps}`);

  // Generate grid trajectories
  const trajectories = await model.sample_grid(
    CONFIG.gridResolution,
    CONFIG.domainRange,
    CONFIG.numSteps
  );

  if (trajectories) {
    const rawData = trajectories.arraySync();

    // Ensure output directory exists
    const outputFile = path.join(ROOT, config.outputPath);
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });

    // Save as raw array
    fs.writeFileSync(outputFile, JSON.stringify(rawData));

    const shape = trajectories.shape;
    console.log(`  Shape: [${shape.join(', ')}]`);
    console.log(`  Saved to: ${config.outputPath}`);
    console.log(`  Time: ${formatDuration(Date.now() - startTime)}`);

    trajectories.dispose();
  } else {
    console.log(`  Failed to generate trajectories`);
  }

  tfModel.dispose();
}

// Generate Diffusion trajectories
async function generateDiffusionTrajectories(): Promise<void> {
  const config = CONFIG.diffusion;

  console.log('\n----------------------------------------');
  console.log('  Diffusion Trajectories');
  console.log('----------------------------------------');

  const startTime = Date.now();

  // Check if model exists
  const modelJsonPath = path.join(ROOT, config.modelPath);
  if (!fs.existsSync(modelJsonPath)) {
    console.log(`  Skipping - model not found at ${config.modelPath}`);
    return;
  }

  // Create DiffusionModel and load weights
  const model = new DiffusionModel(config.dim, config.hidden, config.T);
  const tfModel = await loadModel(modelJsonPath);
  (model as any).model = tfModel;

  console.log(`  Grid: ${CONFIG.gridResolution}x${CONFIG.gridResolution}`);
  console.log(`  Steps: ${CONFIG.numSteps}`);
  console.log(`  Scheduler: DDIM`);

  // Generate grid trajectories using DDIM scheduler
  const trajectories = await model.sample_grid(
    CONFIG.gridResolution,
    CONFIG.domainRange,
    CONFIG.numSteps,
    { scheduler: 'ddim' }
  );

  if (trajectories) {
    const rawData = trajectories.arraySync();

    // Ensure output directory exists
    const outputFile = path.join(ROOT, config.outputPath);
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });

    // Save as raw array
    fs.writeFileSync(outputFile, JSON.stringify(rawData));

    const shape = trajectories.shape;
    console.log(`  Shape: [${shape.join(', ')}]`);
    console.log(`  Saved to: ${config.outputPath}`);
    console.log(`  Time: ${formatDuration(Date.now() - startTime)}`);

    trajectories.dispose();
  } else {
    console.log(`  Failed to generate trajectories`);
  }

  tfModel.dispose();
}

// Main
async function main() {
  // Initialize backend
  await initBackend();

  console.log('\n****************************************');
  console.log('  Pull Toward Mean - Sample Caching');
  console.log('****************************************\n');

  console.log(`TensorFlow.js Backend: ${tf.getBackend()}`);
  console.log(`TensorFlow.js Version: ${tf.version.tfjs}`);

  const startTime = Date.now();

  await generateFlowMatchingTrajectories();
  await generateDiffusionTrajectories();

  console.log('\n****************************************');
  console.log('  All Samples Cached!');
  console.log(`  Total time: ${formatDuration(Date.now() - startTime)}`);
  console.log('****************************************\n');
}

main().catch((err) => {
  console.error('Sample caching failed:', err);
  process.exit(1);
});
