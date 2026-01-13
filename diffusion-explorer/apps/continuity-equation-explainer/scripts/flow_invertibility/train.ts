// Train Flow Matching model for FlowInvertibility visualization
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
  datasetPath: 'static/flow_invertibility/data/smiley_face.json',
  modelOutputDir: 'static/flow_invertibility/models',
  targetStd: 0.5,  // Scale target to match source Gaussian std
  flowMatching: {
    name: 'flow_matching_model',
    dim: 2,
    hidden: 64,
    epochs: 2000,
    batchSize: 1024,
    updateInterval: 100,
  },
};

// Helper: Load dataset from JSON file
function loadDataset(relPath: string): tf.Tensor2D {
  const absPath = path.join(ROOT, relPath);
  const rawData = fs.readFileSync(absPath, 'utf-8');
  const data = JSON.parse(rawData);
  return tf.tensor2d(data.points);
}

// Helper: Center and scale dataset to target std
function normalizeDataset(dataset: tf.Tensor2D, targetStd: number): tf.Tensor2D {
  return tf.tidy(() => {
    // Compute mean and std
    const mean = dataset.mean(0);
    const centered = dataset.sub(mean);
    const variance = centered.square().mean(0);
    const std = variance.sqrt();
    const avgStd = std.mean();

    // Scale to target std
    const scale = tf.scalar(targetStd).div(avgStd);
    const normalized = centered.mul(scale);

    return normalized as tf.Tensor2D;
  });
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

// Train Flow Matching model
async function trainFlowMatching(): Promise<string> {
  const config = CONFIG.flowMatching;

  console.log('\n========================================');
  console.log('  Flow Matching Model Training');
  console.log('========================================\n');

  const startTime = Date.now();

  // Load dataset
  console.log(`Loading dataset from: ${CONFIG.datasetPath}`);
  const rawDataset = loadDataset(CONFIG.datasetPath);
  console.log(`  Raw dataset shape: [${rawDataset.shape.join(', ')}]`);

  // Center and scale to match source Gaussian std
  console.log(`  Normalizing: centering and scaling to std=${CONFIG.targetStd}`);
  const dataset = normalizeDataset(rawDataset, CONFIG.targetStd);
  rawDataset.dispose();
  console.log(`  Normalized dataset ready\n`);

  // Create model
  console.log(`Creating FlowModel (dim=${config.dim}, hidden=${config.hidden})\n`);
  const model = new FlowModel(config.dim, config.hidden);

  // Training callback
  let lastLogTime = Date.now();
  const epochCallback = (epoch: number, _samples: number[][] | null, loss?: number) => {
    if (epoch % config.updateInterval === 0 || epoch === config.epochs - 1) {
      const now = Date.now();
      const elapsed = formatDuration(now - startTime);
      const epochTime = formatDuration(now - lastLogTime);
      lastLogTime = now;

      const lossStr = loss !== undefined ? loss.toFixed(6) : 'N/A';
      console.log(`  Epoch ${epoch.toString().padStart(4)} | Loss: ${lossStr} | Time: ${epochTime.padStart(8)} | Total: ${elapsed}`);
    }
  };

  // Train
  console.log(`Starting training (${config.epochs} epochs, batch size ${config.batchSize})`);
  console.log('----------------------------------------');

  await model.train(
    dataset,
    config.epochs,
    config.batchSize,
    config.updateInterval,
    () => false,
    epochCallback
  );

  console.log('----------------------------------------');
  console.log(`Training completed in ${formatDuration(Date.now() - startTime)}\n`);

  // Save model
  console.log(`Saving model to: ${CONFIG.modelOutputDir}/${config.name}`);
  const modelPath = await saveModel((model as any).model, CONFIG.modelOutputDir, config.name);
  console.log('  Model saved successfully!\n');

  // Cleanup
  dataset.dispose();

  return modelPath;
}

// Main
async function main() {
  const startTime = Date.now();

  console.log('\n****************************************');
  console.log('  Flow Invertibility - Model Training');
  console.log('****************************************\n');

  // Initialize backend
  await initBackend();
  console.log(`TensorFlow.js Backend: ${tf.getBackend()}`);
  console.log(`TensorFlow.js Version: ${tf.version.tfjs}\n`);

  // Train flow matching model
  await trainFlowMatching();

  console.log('\n****************************************');
  console.log('  Training Complete!');
  console.log(`  Total time: ${formatDuration(Date.now() - startTime)}`);
  console.log('****************************************\n');
}

main().catch((err) => {
  console.error('Training failed:', err);
  process.exit(1);
});
