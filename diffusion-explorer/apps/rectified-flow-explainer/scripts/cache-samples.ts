// TensorFlow.js with WASM backend (works on Apple Silicon)
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-wasm';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { FlowModel, DomainRange } from '@diffusion-explorer/diffusion';

// ESM __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

// Initialize WASM backend
async function initBackend(): Promise<void> {
  await tf.setBackend('wasm');
  await tf.ready();
}

interface CacheConfig {
  modelPath: string; // Relative path to model.json
  outputPath: string; // Relative path for output JSON
  numSamples: number;
  numSteps: number;
  type: 'random' | 'grid';
  isRectifiedFlow?: boolean; // If true, saves in RectifiedFlowData format
  gridResolution?: number;
  domainRange?: DomainRange;
  dim?: number;
  hidden?: number;
}

// Cache configurations
const CACHES: CacheConfig[] = [
  {
    modelPath: 'static/models/flow_matching_model.json',
    outputPath: 'static/cached_samples/flow_matching_trajectories.json',
    numSamples: 300,
    numSteps: 200,
    type: 'random',
    dim: 2,
    hidden: 64,
  },
  {
    modelPath: 'static/models/rectified_flow_model.json',
    outputPath: 'static/cached_samples/rectified_flow_trajectories.json',
    numSamples: 300,
    numSteps: 200,
    type: 'random',
    isRectifiedFlow: true,
    dim: 2,
    hidden: 64,
  },
  {
    modelPath: 'static/models/flow_matching_model.json',
    outputPath: 'static/cached_samples/flow_matching_grid_trajectories.json',
    numSamples: 0,
    numSteps: 200,
    type: 'grid',
    gridResolution: 6,
    domainRange: { xMin: -1.5, xMax: 1.5, yMin: -1.5, yMax: 1.5 },
    dim: 2,
    hidden: 64,
  },
  {
    modelPath: 'static/models/rectified_flow_model.json',
    outputPath: 'static/cached_samples/rectified_flow_grid_trajectories.json',
    numSamples: 0,
    numSteps: 200,
    type: 'grid',
    isRectifiedFlow: true,
    gridResolution: 6,
    domainRange: { xMin: -1.5, xMax: 1.5, yMin: -1.5, yMax: 1.5 },
    dim: 2,
    hidden: 64,
  },
];

// Check if cache file exists
function cacheExists(outputPath: string): boolean {
  return fs.existsSync(path.join(ROOT, outputPath));
}

// Check if model exists
function modelExists(modelPath: string): boolean {
  return fs.existsSync(path.join(ROOT, modelPath));
}

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

// Generate cache for a single config
async function generateCache(config: CacheConfig): Promise<void> {
  const startTime = Date.now();
  console.log(`\nGenerating: ${config.outputPath}`);
  console.log(`  Model: ${config.modelPath}`);
  console.log(`  Type: ${config.type}`);

  // Check if model exists
  if (!modelExists(config.modelPath)) {
    console.log(`  Skipping - model not found at ${config.modelPath}`);
    return;
  }

  // Create FlowModel and load weights
  const dim = config.dim ?? 2;
  const hidden = config.hidden ?? 64;
  const model = new FlowModel(dim, hidden);

  // Load the saved model weights (manual loading for WASM backend)
  const modelJsonPath = path.join(ROOT, config.modelPath);
  const tfModel = await loadModel(modelJsonPath);

  // Set the loaded model's internal layers model
  (model as any).model = tfModel;

  // Generate samples
  let trajectories: tf.Tensor3D | null = null;

  if (config.type === 'grid') {
    console.log(`  Grid: ${config.gridResolution}x${config.gridResolution}`);
    trajectories = await model.sample_grid(
      config.gridResolution!,
      config.domainRange!,
      config.numSteps
    );
  } else {
    console.log(`  Samples: ${config.numSamples}, Steps: ${config.numSteps}`);
    trajectories = await model.sample(config.numSamples, config.numSteps);
  }

  if (trajectories) {
    const rawData = trajectories.arraySync();
    const outputFile = path.join(ROOT, config.outputPath);

    // Ensure output directory exists
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });

    // For rectified flow, wrap data in expected format: { allRectifiedTrajectories: [...], modelPath: "..." }
    // The allRectifiedTrajectories is a 4D array where each element represents a rectification step
    // Since we're caching the final model's output, we just have one "step" worth of data
    let outputData: unknown;
    if (config.isRectifiedFlow) {
      outputData = {
        allRectifiedTrajectories: [rawData], // Wrap in array for 4D format
        modelPath: config.modelPath,
      };
    } else {
      outputData = rawData;
    }

    // Write JSON
    fs.writeFileSync(outputFile, JSON.stringify(outputData));

    const shape = trajectories.shape;
    console.log(`  Shape: [${shape.join(', ')}]`);
    console.log(`  Format: ${config.isRectifiedFlow ? 'RectifiedFlowData' : 'raw array'}`);
    console.log(`  Saved to: ${config.outputPath}`);
    console.log(`  Time: ${formatDuration(Date.now() - startTime)}`);

    trajectories.dispose();
  } else {
    console.log(`  Failed to generate trajectories`);
  }

  // Cleanup model
  tfModel.dispose();
}

async function main(options: { force?: boolean } = {}) {
  // Initialize backend
  await initBackend();

  console.log('\n========================================');
  console.log('  Sample Cache Generation');
  console.log('========================================\n');

  console.log(`TensorFlow.js Backend: ${tf.getBackend()}`);
  console.log(`TensorFlow.js Version: ${tf.version.tfjs}`);

  const { force = false } = options;

  if (force) {
    console.log('\nForce mode enabled - will regenerate all caches');
  }

  const startTime = Date.now();
  let generated = 0;
  let skipped = 0;

  for (const config of CACHES) {
    if (force || !cacheExists(config.outputPath)) {
      await generateCache(config);
      generated++;
    } else {
      console.log(`\nSkipping ${config.outputPath} (already exists)`);
      skipped++;
    }
  }

  console.log('\n========================================');
  console.log('  Cache Generation Complete!');
  console.log(`  Generated: ${generated}, Skipped: ${skipped}`);
  console.log(`  Total time: ${formatDuration(Date.now() - startTime)}`);
  console.log('========================================\n');
}

// Parse args: --force to regenerate all
const force = process.argv.includes('--force');
main({ force }).catch((err) => {
  console.error('Cache generation failed:', err);
  process.exit(1);
});
