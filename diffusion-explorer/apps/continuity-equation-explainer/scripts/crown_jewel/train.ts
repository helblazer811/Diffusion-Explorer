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
  modelOutputDir: 'static/crown_jewel/models',
  flowMatching: {
    name: 'flow_model',
    dim: 1,
    hidden: 64,
    epochs: 2000,
    batchSize: 512,
    updateInterval: 100,
  },
  // Gaussian mixture: 3 modes at -4, 0, 4 with std=0.25
  gaussianMixture: {
    means: [-4, 0, 4],
    std: 0.25,
    numSamples: 1000,
  },
};

// Generate Gaussian mixture dataset
function generateGaussianMixture(): tf.Tensor2D {
  const { means, std, numSamples } = CONFIG.gaussianMixture;
  const samplesPerMode = Math.floor(numSamples / means.length);

  const allSamples: number[] = [];

  for (const mean of means) {
    for (let i = 0; i < samplesPerMode; i++) {
      // Box-Muller transform for Gaussian samples
      const u1 = Math.random();
      const u2 = Math.random();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      allSamples.push(mean + std * z);
    }
  }

  // Shuffle the samples
  for (let i = allSamples.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allSamples[i], allSamples[j]] = [allSamples[j], allSamples[i]];
  }

  // Convert to 2D tensor with shape [numSamples, 1]
  return tf.tensor2d(allSamples.map(x => [x]));
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
  console.log('  1D Flow Matching Model Training');
  console.log('========================================\n');

  const startTime = Date.now();

  // Generate dataset
  console.log('Generating Gaussian mixture dataset...');
  console.log(`  Modes: ${CONFIG.gaussianMixture.means.join(', ')}`);
  console.log(`  Std: ${CONFIG.gaussianMixture.std}`);
  console.log(`  Samples: ${CONFIG.gaussianMixture.numSamples}`);
  const dataset = generateGaussianMixture();
  console.log(`  Dataset shape: [${dataset.shape.join(', ')}]\n`);

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
  console.log('  Crown Jewel - Model Training');
  console.log('****************************************\n');

  // Initialize backend
  await initBackend();
  console.log(`TensorFlow.js Backend: ${tf.getBackend()}`);
  console.log(`TensorFlow.js Version: ${tf.version.tfjs}\n`);

  // Train model
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
