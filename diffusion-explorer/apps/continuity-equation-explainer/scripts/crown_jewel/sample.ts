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
  modelPath: 'static/crown_jewel/models/flow_model.json',
  outputPath: 'static/crown_jewel/cached_samples/trajectories.json',
  dim: 1,
  hidden: 64,
  numSamples: 2000,
  numSteps: 300,
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

// Generate trajectories
async function generateTrajectories(): Promise<void> {
  console.log('\n----------------------------------------');
  console.log('  Crown Jewel Trajectories');
  console.log('----------------------------------------');

  const startTime = Date.now();

  // Check if model exists
  const modelJsonPath = path.join(ROOT, CONFIG.modelPath);
  if (!fs.existsSync(modelJsonPath)) {
    console.log(`  Error: model not found at ${CONFIG.modelPath}`);
    console.log('  Please run the training script first.');
    return;
  }

  // Create FlowModel and load weights
  console.log(`  Loading model from ${CONFIG.modelPath}...`);
  const model = new FlowModel(CONFIG.dim, CONFIG.hidden);
  const tfModel = await loadModel(modelJsonPath);
  (model as any).model = tfModel;

  console.log(`  Samples: ${CONFIG.numSamples}`);
  console.log(`  Steps: ${CONFIG.numSteps}`);

  // Generate trajectories using the sample method
  console.log('  Generating trajectories...');
  const trajectories = await model.sample(
    CONFIG.numSamples,
    CONFIG.numSteps
  );

  if (trajectories) {
    // Shape: [num_steps, num_samples, dim] = [300, 2000, 1]
    const rawData = trajectories.arraySync();

    // Ensure output directory exists
    const outputFile = path.join(ROOT, CONFIG.outputPath);
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });

    // Save as raw array
    fs.writeFileSync(outputFile, JSON.stringify(rawData));

    const shape = trajectories.shape;
    console.log(`  Shape: [${shape.join(', ')}]`);
    console.log(`  Saved to: ${CONFIG.outputPath}`);
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
  console.log('  Crown Jewel - Sample Caching');
  console.log('****************************************\n');

  console.log(`TensorFlow.js Backend: ${tf.getBackend()}`);
  console.log(`TensorFlow.js Version: ${tf.version.tfjs}`);

  const startTime = Date.now();

  await generateTrajectories();

  console.log('\n****************************************');
  console.log('  Samples Cached!');
  console.log(`  Total time: ${formatDuration(Date.now() - startTime)}`);
  console.log('****************************************\n');
}

main().catch((err) => {
  console.error('Sample caching failed:', err);
  process.exit(1);
});
