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
  datasetPath: 'static/source_selection/data/smiley_face.json',
  modelOutputDir: 'static/source_selection/models',
  dim: 2,
  hidden: 64,
  epochs: 2000,
  batchSize: 1024,
  updateInterval: 100,
  // Ring distribution parameters (scaled to match Gaussian spread)
  ringInnerRadius: 1.2,
  ringOuterRadius: 1.8,
  // Uniform distribution parameters (scaled to match Gaussian spread)
  uniformMin: -1.8,
  uniformMax: 1.8,
};

type SourceType = 'gaussian' | 'uniform' | 'ring';

// Helper: Load dataset from JSON file
function loadDataset(relPath: string): tf.Tensor2D {
  const absPath = path.join(ROOT, relPath);
  const rawData = fs.readFileSync(absPath, 'utf-8');
  const data = JSON.parse(rawData);
  return tf.tensor2d(data.points);
}

// Generate source distribution samples
function generateSourceDistribution(type: SourceType, numSamples: number): tf.Tensor2D {
  return tf.tidy(() => {
    switch (type) {
      case 'gaussian':
        // Standard Gaussian N(0, I)
        return tf.randomNormal([numSamples, 2]);

      case 'uniform':
        // Uniform square [-1.5, 1.5]²
        return tf.randomUniform([numSamples, 2], CONFIG.uniformMin, CONFIG.uniformMax);

      case 'ring':
        // Ring with uniform area sampling (sqrt trick for proper distribution)
        const angles = tf.randomUniform([numSamples], 0, 2 * Math.PI);
        const innerR2 = CONFIG.ringInnerRadius ** 2;
        const outerR2 = CONFIG.ringOuterRadius ** 2;
        const r2 = tf.randomUniform([numSamples], innerR2, outerR2);
        const radii = tf.sqrt(r2);
        const x = radii.mul(tf.cos(angles));
        const y = radii.mul(tf.sin(angles));
        return tf.stack([x, y], 1) as tf.Tensor2D;

      default:
        throw new Error(`Unknown source type: ${type}`);
    }
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

// Train Flow Model for a specific source distribution type
async function trainFlowModel(sourceType: SourceType, targetData: tf.Tensor2D): Promise<string> {
  console.log('\n========================================');
  console.log(`  Training Flow Model: ${sourceType.toUpperCase()} source`);
  console.log('========================================\n');

  const startTime = Date.now();
  const numSamples = targetData.shape[0];

  // Generate source distribution (same size as target for coupling)
  console.log(`Generating ${sourceType} source distribution (${numSamples} samples)`);
  const sourceDistribution = generateSourceDistribution(sourceType, numSamples);

  // Create model
  console.log(`Creating FlowModel (dim=${CONFIG.dim}, hidden=${CONFIG.hidden})\n`);
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
      console.log(`  Epoch ${epoch.toString().padStart(4)} | Loss: ${lossStr} | Time: ${epochTime.padStart(8)} | Total: ${elapsed}`);
    }
  };

  // Train with specified source distribution
  console.log(`Starting training (${CONFIG.epochs} epochs, batch size ${CONFIG.batchSize})`);
  console.log('----------------------------------------');

  await model.train(
    targetData,
    CONFIG.epochs,
    CONFIG.batchSize,
    CONFIG.updateInterval,
    () => false,
    epochCallback,
    sourceDistribution  // Pass source distribution for rectified flow style training
  );

  console.log('----------------------------------------');
  console.log(`Training completed in ${formatDuration(Date.now() - startTime)}\n`);

  // Save model
  const modelName = `flow_${sourceType}`;
  console.log(`Saving model to: ${CONFIG.modelOutputDir}/${modelName}`);
  const modelPath = await saveModel((model as any).model, CONFIG.modelOutputDir, modelName);
  console.log('  Model saved successfully!\n');

  // Cleanup
  sourceDistribution.dispose();

  return modelPath;
}

// Main
async function main() {
  const startTime = Date.now();

  console.log('\n****************************************');
  console.log('  Source Selection - Model Training');
  console.log('****************************************\n');

  // Initialize backend
  await initBackend();
  console.log(`TensorFlow.js Backend: ${tf.getBackend()}`);
  console.log(`TensorFlow.js Version: ${tf.version.tfjs}\n`);

  // Load target dataset (same for all models)
  console.log(`Loading target dataset from: ${CONFIG.datasetPath}`);
  const targetData = loadDataset(CONFIG.datasetPath);
  console.log(`  Dataset shape: [${targetData.shape.join(', ')}]\n`);

  // Train all three models
  const sourceTypes: SourceType[] = ['gaussian', 'uniform', 'ring'];

  for (const sourceType of sourceTypes) {
    await trainFlowModel(sourceType, targetData);
  }

  // Cleanup
  targetData.dispose();

  console.log('\n****************************************');
  console.log('  All Models Trained!');
  console.log(`  Total time: ${formatDuration(Date.now() - startTime)}`);
  console.log('****************************************\n');
}

main().catch((err) => {
  console.error('Training failed:', err);
  process.exit(1);
});
