/**
 * Train a flow model for the smiley face distribution.
 *
 * Usage:
 *   cd apps/miscellaneous
 *   npx tsx scripts/flow_model_dlic/train.ts
 *
 * This script trains a flow matching model on the smiley face dataset
 * and saves it to static/flow_model_dlic/models/
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
const ROOT = path.resolve(__dirname, '../..');

// Configuration
const CONFIG = {
  dim: 2,
  hidden: 64,
  epochs: 2000,
  batchSize: 1024,
  updateInterval: 100,
};

/**
 * Initialize TensorFlow.js with WASM backend
 */
async function initBackend(): Promise<void> {
  await tf.setBackend('wasm');
  await tf.ready();
  console.log(`TensorFlow.js Backend: ${tf.getBackend()}`);
  console.log(`TensorFlow.js Version: ${tf.version.tfjs}\n`);
}

/**
 * Load dataset from JSON file
 */
function loadDataset(datasetPath: string): tf.Tensor2D {
  const rawData = fs.readFileSync(datasetPath, 'utf-8');
  const data = JSON.parse(rawData);
  return tf.tensor2d(data.points);
}

/**
 * Ensure directory exists
 */
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Save model to filesystem
 */
async function saveModel(model: tf.LayersModel, outputDir: string, name: string): Promise<string> {
  ensureDir(outputDir);

  // Get model topology and weights
  const topoJSON = model.toJSON();
  const modelTopology = typeof topoJSON === 'string' ? JSON.parse(topoJSON) : topoJSON;
  const weights = model.getWeights();

  // Create model JSON
  const modelJSON: tf.io.ModelJSON = {
    modelTopology,
  } as tf.io.ModelJSON;

  // Serialize weights to binary
  const weightSpecs: tf.io.WeightsManifestEntry[] = [];
  const weightDataArrays: ArrayBuffer[] = [];

  for (let i = 0; i < weights.length; i++) {
    const weight = weights[i];
    const weightName = model.weights[i].name;
    const data = await weight.data();

    weightSpecs.push({
      name: weightName,
      shape: weight.shape,
      dtype: weight.dtype as 'float32' | 'int32' | 'bool' | 'string' | 'complex64',
    });

    const buffer = new ArrayBuffer(data.byteLength);
    new (data.constructor as Float32ArrayConstructor)(buffer).set(data as Float32Array);
    weightDataArrays.push(buffer);
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

  // Add weights manifest
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

  return jsonPath;
}

/**
 * Format duration for display
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}min`;
}

async function main(): Promise<void> {
  console.log('\n========================================');
  console.log('  Training Flow Model for Smiley Face');
  console.log('========================================\n');

  // Initialize backend
  await initBackend();

  // Paths
  const datasetPath = path.join(ROOT, 'static', 'flow_model_dlic', 'datasets', 'smiley_face.json');
  const modelDir = path.join(ROOT, 'static', 'flow_model_dlic', 'models');

  const startTime = Date.now();

  // Load dataset
  console.log(`Loading dataset: ${datasetPath}`);
  const data = loadDataset(datasetPath);
  console.log(`  Dataset shape: [${data.shape.join(', ')}]\n`);

  // Create model
  console.log(`Creating FlowModel (dim=${CONFIG.dim}, hidden=${CONFIG.hidden})`);
  const model = new FlowModel(CONFIG.dim, CONFIG.hidden);

  // Training callback
  let lastLogTime = Date.now();
  const epochCallback = (epoch: number, _samples: number[][] | null, loss?: number) => {
    if (epoch % CONFIG.updateInterval === 0 || epoch === CONFIG.epochs - 1) {
      const now = Date.now();
      const elapsed = formatDuration(now - startTime);
      const epochTime = formatDuration(now - lastLogTime);
      lastLogTime = now;

      const lossStr = loss !== undefined ? loss.toFixed(6) : 'N/A';
      console.log(`  Epoch ${epoch.toString().padStart(4)} | Loss: ${lossStr} | Batch: ${epochTime.padStart(8)} | Total: ${elapsed}`);
    }
  };

  // Train
  console.log(`\nStarting training (${CONFIG.epochs} epochs, batch size ${CONFIG.batchSize})`);
  console.log('----------------------------------------');

  await model.train(
    data,
    CONFIG.epochs,
    CONFIG.batchSize,
    CONFIG.updateInterval,
    () => false,
    epochCallback
  );

  console.log('----------------------------------------');
  console.log(`Training completed in ${formatDuration(Date.now() - startTime)}\n`);

  // Save model
  console.log(`Saving model to: ${modelDir}`);
  const modelPath = await saveModel((model as any).model, modelDir, 'model');
  console.log(`  Model saved: ${modelPath}\n`);

  // Cleanup
  data.dispose();

  console.log('========================================');
  console.log('  Training Complete!');
  console.log(`  Model: ${modelPath}`);
  console.log('========================================\n');
}

main().catch((err) => {
  console.error('Training failed:', err);
  process.exit(1);
});
