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
  numSamples: 300,    // Number of trajectories to visualize
  numMiniSamples: 1000, // Number of samples for mini distribution contours
  numSteps: 200,      // Integration steps
  dim: 2,
  hidden: 64,
  // Gaussian distribution parameters
  gaussianStd: 0.7,
  // Ring distribution parameters
  ringInnerRadius: 1.0,
  ringOuterRadius: 1.5,
  // Uniform distribution parameters
  uniformMin: -1.5,
  uniformMax: 1.5,
  // Source types
  sourceTypes: ['gaussian', 'uniform', 'ring'] as const,
};

type SourceType = typeof CONFIG.sourceTypes[number];

// Helper: Format duration
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}min`;
}

// Helper: Load model from filesystem
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

  const totalBytes = weightDataArrays.reduce((sum, buf) => sum + buf.byteLength, 0);
  const combinedBuffer = new ArrayBuffer(totalBytes);
  const combinedView = new Uint8Array(combinedBuffer);
  let offset = 0;
  for (const buf of weightDataArrays) {
    combinedView.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }

  const modelTopology = modelJSON.modelTopology || modelJSON;
  const model = await tf.models.modelFromJSON({ modelTopology });

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

// Generate source distribution samples
function generateSourceDistribution(type: SourceType, numSamples: number): tf.Tensor2D {
  return tf.tidy(() => {
    switch (type) {
      case 'gaussian':
        return tf.randomNormal([numSamples, 2], 0, CONFIG.gaussianStd);

      case 'uniform':
        return tf.randomUniform([numSamples, 2], CONFIG.uniformMin, CONFIG.uniformMax);

      case 'ring':
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

// Cached data structure
interface CachedData {
  sourceDistribution: number[][];  // [numSamples, 2] - for trajectory start points
  miniDistribution: number[][];    // [numMiniSamples, 2] - for mini button contours
  trajectories: number[][][];      // [numSteps+1, numSamples, 2]
}

// Generate and cache trajectories for a source type
async function generateTrajectories(sourceType: SourceType): Promise<void> {
  console.log('\n----------------------------------------');
  console.log(`  ${sourceType.toUpperCase()} Source Trajectories`);
  console.log('----------------------------------------');

  const startTime = Date.now();

  // Check if model exists
  const modelJsonPath = path.join(ROOT, `static/source_selection/models/flow_${sourceType}.json`);
  if (!fs.existsSync(modelJsonPath)) {
    console.log(`  Skipping - model not found at ${modelJsonPath}`);
    return;
  }

  // Create FlowModel and load weights
  const model = new FlowModel(CONFIG.dim, CONFIG.hidden);
  const tfModel = await loadModel(modelJsonPath);
  (model as any).model = tfModel;

  console.log(`  Samples: ${CONFIG.numSamples}`);
  console.log(`  Mini samples: ${CONFIG.numMiniSamples}`);
  console.log(`  Steps: ${CONFIG.numSteps}`);

  // Generate source distribution for trajectories
  const sourceSamples = generateSourceDistribution(sourceType, CONFIG.numSamples);
  const sourceArray = sourceSamples.arraySync() as number[][];

  // Generate larger sample set for mini distribution contours
  const miniSamples = generateSourceDistribution(sourceType, CONFIG.numMiniSamples);
  const miniArray = miniSamples.arraySync() as number[][];
  miniSamples.dispose();

  // Sample trajectories from initial points
  const trajectories = await model.sample_from_initial_points(
    sourceSamples,
    CONFIG.numSteps
  );

  if (trajectories) {
    const trajArray = trajectories.arraySync() as number[][][];

    // Create cached data structure
    const cachedData: CachedData = {
      sourceDistribution: sourceArray,
      miniDistribution: miniArray,
      trajectories: trajArray
    };

    // Ensure output directory exists
    const outputFile = path.join(ROOT, `static/source_selection/cached_samples/${sourceType}_trajectories.json`);
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });

    // Save
    fs.writeFileSync(outputFile, JSON.stringify(cachedData));

    console.log(`  Trajectory shape: [${trajectories.shape.join(', ')}]`);
    console.log(`  Saved to: static/source_selection/cached_samples/${sourceType}_trajectories.json`);
    console.log(`  Time: ${formatDuration(Date.now() - startTime)}`);

    trajectories.dispose();
  } else {
    console.log(`  Failed to generate trajectories`);
  }

  sourceSamples.dispose();
  tfModel.dispose();
}

// Main
async function main() {
  await initBackend();

  console.log('\n****************************************');
  console.log('  Source Selection - Sample Caching');
  console.log('****************************************\n');

  console.log(`TensorFlow.js Backend: ${tf.getBackend()}`);
  console.log(`TensorFlow.js Version: ${tf.version.tfjs}`);

  const startTime = Date.now();

  // Generate trajectories for each source type
  for (const sourceType of CONFIG.sourceTypes) {
    await generateTrajectories(sourceType);
  }

  console.log('\n****************************************');
  console.log('  All Samples Cached!');
  console.log(`  Total time: ${formatDuration(Date.now() - startTime)}`);
  console.log('****************************************\n');
}

main().catch((err) => {
  console.error('Sample caching failed:', err);
  process.exit(1);
});
