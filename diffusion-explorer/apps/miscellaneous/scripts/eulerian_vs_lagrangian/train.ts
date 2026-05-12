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
  modelOutputDir: 'static/eulerian_vs_lagrangian/models',
  dim: 2,
  hidden: 64,
  numRectifiedSteps: 3,
  epochsPerStep: 2000,
  batchSize: 1024,
  numSimulationSteps: 200,
  updateInterval: 100,
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

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const topoJSON = model.toJSON();
  const modelTopology = typeof topoJSON === 'string' ? JSON.parse(topoJSON) : topoJSON;
  const weights = model.getWeights();

  const modelJSON: tf.io.ModelJSON = {
    modelTopology,
  } as tf.io.ModelJSON;

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

    const buffer = new ArrayBuffer(data.byteLength);
    new (data.constructor as Float32ArrayConstructor)(buffer).set(data as Float32Array);
    weightDataArrays.push(buffer);
  }

  const totalBytes = weightDataArrays.reduce((sum, buf) => sum + buf.byteLength, 0);
  const combinedBuffer = new ArrayBuffer(totalBytes);
  const combinedView = new Uint8Array(combinedBuffer);
  let offset = 0;
  for (const buf of weightDataArrays) {
    combinedView.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }

  const weightsManifest: tf.io.WeightsManifestConfig = [{
    paths: [`${name}.weights.bin`],
    weights: weightSpecs,
  }];
  modelJSON.weightsManifest = weightsManifest;

  const jsonPath = path.join(outputDir, `${name}.json`);
  const weightsPath = path.join(outputDir, `${name}.weights.bin`);

  fs.writeFileSync(jsonPath, JSON.stringify(modelJSON));
  fs.writeFileSync(weightsPath, Buffer.from(combinedBuffer));

  weights.forEach(w => w.dispose());

  return path.join(outputDir, name);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}min`;
}

async function trainRectifiedFlowModel(targetData: tf.Tensor2D): Promise<string> {
  console.log('\n========================================');
  console.log('  Training Rectified Flow Model');
  console.log('========================================\n');

  const startTime = Date.now();

  console.log(`Creating FlowModel (dim=${CONFIG.dim}, hidden=${CONFIG.hidden})\n`);
  const model = new FlowModel(CONFIG.dim, CONFIG.hidden);

  let currentStep = 0;
  let stepStartTime = Date.now();

  const epochCallback = (epoch: number, rectifiedStep: number, _samples: number[][] | null, loss?: number) => {
    if (rectifiedStep !== currentStep) {
      currentStep = rectifiedStep;
      stepStartTime = Date.now();
    }
    if (epoch % CONFIG.updateInterval === 0 || epoch === CONFIG.epochsPerStep - 1) {
      const now = Date.now();
      const elapsed = formatDuration(now - startTime);
      const stepElapsed = formatDuration(now - stepStartTime);
      const lossStr = loss !== undefined ? loss.toFixed(6) : 'N/A';
      console.log(`  Step ${rectifiedStep + 1} | Epoch ${epoch.toString().padStart(4)} | Loss: ${lossStr} | Step: ${stepElapsed.padStart(8)} | Total: ${elapsed}`);
    }
  };

  const rectifiedStepCallback = (rectifiedStep: number) => {
    console.log(`\n  Completed rectified step ${rectifiedStep + 1}/${CONFIG.numRectifiedSteps}`);
    if (rectifiedStep < CONFIG.numRectifiedSteps - 1) {
      console.log(`  Starting rectified step ${rectifiedStep + 2}/${CONFIG.numRectifiedSteps}\n`);
    }
  };

  console.log(`Starting rectified flow training:`);
  console.log(`  - ${CONFIG.numRectifiedSteps} rectified steps`);
  console.log(`  - ${CONFIG.epochsPerStep} epochs per step`);
  console.log(`  - ${CONFIG.numSimulationSteps} simulation steps for re-coupling`);
  console.log(`  - batch size ${CONFIG.batchSize}`);
  console.log('----------------------------------------');
  console.log(`\n  Starting rectified step 1/${CONFIG.numRectifiedSteps}\n`);

  await model.train_rectified(
    targetData,
    null, // null source_distribution → train_rectified will sample standard Gaussian
    CONFIG.numRectifiedSteps,
    CONFIG.epochsPerStep,
    CONFIG.batchSize,
    CONFIG.numSimulationSteps,
    () => false,
    epochCallback,
    rectifiedStepCallback
  );

  console.log('----------------------------------------');
  console.log(`Training completed in ${formatDuration(Date.now() - startTime)}\n`);

  const modelName = 'model';
  console.log(`Saving model to: ${CONFIG.modelOutputDir}/${modelName}`);
  const modelPath = await saveModel((model as any).model, CONFIG.modelOutputDir, modelName);
  console.log('  Model saved successfully!\n');

  return modelPath;
}

async function main() {
  const startTime = Date.now();

  console.log('\n****************************************');
  console.log('  Eulerian vs Lagrangian - Rectified Flow Training');
  console.log('****************************************\n');

  await initBackend();
  console.log(`TensorFlow.js Backend: ${tf.getBackend()}`);
  console.log(`TensorFlow.js Version: ${tf.version.tfjs}\n`);

  console.log(`Loading target dataset from: ${CONFIG.datasetPath}`);
  const targetData = loadDataset(CONFIG.datasetPath);
  console.log(`  Dataset shape: [${targetData.shape.join(', ')}]\n`);

  await trainRectifiedFlowModel(targetData);

  targetData.dispose();

  console.log('\n****************************************');
  console.log('  Model Trained!');
  console.log(`  Total time: ${formatDuration(Date.now() - startTime)}`);
  console.log('****************************************\n');
}

main().catch((err) => {
  console.error('Training failed:', err);
  process.exit(1);
});
