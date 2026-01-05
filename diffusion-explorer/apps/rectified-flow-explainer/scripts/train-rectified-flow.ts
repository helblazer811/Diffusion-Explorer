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
const ROOT = path.resolve(__dirname, '..');

// Initialize WASM backend
async function initBackend(): Promise<void> {
  await tf.setBackend('wasm');
  await tf.ready();
}

// Configuration
export const CONFIG = {
  datasetPath: 'static/data/smiley_face.json',
  modelOutputDir: 'static/models',
  modelName: 'rectified_flow_model',
  dim: 2,
  hidden: 64,
  numRectifiedSteps: 3,
  epochsPerStep: 2000,
  batchSize: 1024,
  numSimulationSteps: 200,
};

// Helper: Load dataset from JSON file
function loadDataset(relPath: string): tf.Tensor2D {
  const absPath = path.join(ROOT, relPath);
  const rawData = fs.readFileSync(absPath, 'utf-8');
  const data = JSON.parse(rawData);
  return tf.tensor2d(data.points);
}

// Helper: Save model to filesystem (manual serialization for WASM backend)
async function saveModel(model: tf.LayersModel, dir: string, name: string): Promise<string> {
  const outputDir = path.join(ROOT, dir);

  // Ensure directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Get model topology and weights
  const topoJSON = model.toJSON();
  const modelTopology = typeof topoJSON === 'string' ? JSON.parse(topoJSON) : topoJSON;
  const weights = model.getWeights();

  // Create model JSON with modelTopology wrapper (required by tf.loadLayersModel)
  const modelJSON: tf.io.ModelJSON = {
    modelTopology,
  } as tf.io.ModelJSON;

  // Serialize weights to binary
  const weightSpecs: tf.io.WeightsManifestEntry[] = [];
  const weightDataArrays: ArrayBuffer[] = [];

  for (let i = 0; i < weights.length; i++) {
    const weight = weights[i];
    const name = model.weights[i].name;
    const data = await weight.data();

    weightSpecs.push({
      name,
      shape: weight.shape,
      dtype: weight.dtype as 'float32' | 'int32' | 'bool' | 'string' | 'complex64',
    });

    // Convert to ArrayBuffer
    const buffer = new ArrayBuffer(data.byteLength);
    new (data.constructor as Float32ArrayConstructor)(buffer).set(data as Float32Array);
    weightDataArrays.push(buffer);
  }

  // Concatenate all weight buffers
  const totalBytes = weightDataArrays.reduce((sum, buf) => sum + buf.byteLength, 0);
  const combinedBuffer = new ArrayBuffer(totalBytes);
  const combinedView = new Uint8Array(combinedBuffer);
  let offset = 0;
  for (const buf of weightDataArrays) {
    combinedView.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }

  // Add weights manifest to model JSON
  const weightsManifest: tf.io.WeightsManifestConfig = [{
    paths: [`${name}.weights.bin`],
    weights: weightSpecs,
  }];
  modelJSON.weightsManifest = weightsManifest;

  // Write files
  const jsonPath = path.join(outputDir, `${name}.json`);
  const weightsPath = path.join(outputDir, `${name}.weights.bin`);

  fs.writeFileSync(jsonPath, JSON.stringify(modelJSON));
  fs.writeFileSync(weightsPath, Buffer.from(combinedBuffer));

  // Cleanup
  weights.forEach(w => w.dispose());

  return path.join(outputDir, name);
}

// Helper: Format duration
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}min`;
}

// Main training function (exported for orchestrator)
export async function trainRectifiedFlow(config = CONFIG): Promise<string> {
  // Initialize backend
  await initBackend();

  console.log('\n========================================');
  console.log('  Rectified Flow Model Training');
  console.log('========================================\n');

  const startTime = Date.now();

  // Show backend info
  console.log(`TensorFlow.js Backend: ${tf.getBackend()}`);
  console.log(`TensorFlow.js Version: ${tf.version.tfjs}\n`);

  // Load dataset
  console.log(`Loading dataset from: ${config.datasetPath}`);
  const dataset = loadDataset(config.datasetPath);
  console.log(`  Dataset shape: [${dataset.shape.join(', ')}]\n`);

  // Create model
  console.log(`Creating FlowModel (dim=${config.dim}, hidden=${config.hidden})\n`);
  const model = new FlowModel(config.dim, config.hidden);

  // Track current rectified step for epoch callback
  let currentRectifiedStep = 0;
  let stepStartTime = Date.now();

  // Epoch callback
  const epochCallback = (epoch: number, rectifiedStep: number, _samples: number[][] | null, loss?: number) => {
    // Update current step if changed
    if (rectifiedStep !== currentRectifiedStep) {
      currentRectifiedStep = rectifiedStep;
      stepStartTime = Date.now();
    }

    // Log every 100 epochs or at end
    if (epoch % 100 === 0 || epoch === config.epochsPerStep - 1) {
      const now = Date.now();
      const elapsed = formatDuration(now - startTime);
      const stepElapsed = formatDuration(now - stepStartTime);
      const lossStr = loss !== undefined ? loss.toFixed(6) : 'N/A';
      console.log(`  Step ${rectifiedStep + 1} | Epoch ${epoch.toString().padStart(4)} | Loss: ${lossStr} | Step: ${stepElapsed.padStart(8)} | Total: ${elapsed}`);
    }
  };

  // Rectified step callback
  const rectifiedStepCallback = (rectifiedStep: number, _trajectories: number[][][] | null) => {
    console.log(`\n  Completed rectified step ${rectifiedStep + 1}/${config.numRectifiedSteps}`);
    if (rectifiedStep < config.numRectifiedSteps - 1) {
      console.log(`  Starting rectified step ${rectifiedStep + 2}/${config.numRectifiedSteps}\n`);
    }
  };

  // Train
  console.log(`Starting rectified flow training:`);
  console.log(`  - ${config.numRectifiedSteps} rectified steps`);
  console.log(`  - ${config.epochsPerStep} epochs per step`);
  console.log(`  - ${config.numSimulationSteps} simulation steps for sampling`);
  console.log(`  - batch size ${config.batchSize}`);
  console.log('----------------------------------------');
  console.log(`\n  Starting rectified step 1/${config.numRectifiedSteps}\n`);

  await model.train_rectified(
    dataset,
    null, // source_distribution - use random noise
    config.numRectifiedSteps,
    config.epochsPerStep,
    config.batchSize,
    config.numSimulationSteps,
    () => false, // stopTraining
    epochCallback,
    rectifiedStepCallback
  );

  console.log('\n----------------------------------------');
  console.log(`Training completed in ${formatDuration(Date.now() - startTime)}\n`);

  // Save model
  console.log(`Saving model to: ${config.modelOutputDir}/${config.modelName}`);
  const modelPath = await saveModel((model as any).model, config.modelOutputDir, config.modelName);
  console.log('  Model saved successfully!\n');

  // Cleanup
  dataset.dispose();

  console.log('========================================');
  console.log('  Training Complete!');
  console.log(`  Total time: ${formatDuration(Date.now() - startTime)}`);
  console.log('========================================\n');

  return modelPath;
}

// Run if called directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  trainRectifiedFlow().catch((err) => {
    console.error('Training failed:', err);
    process.exit(1);
  });
}
