/**
 * Sample trajectories from a trained flow model.
 *
 * Generates trajectories starting from random Gaussian noise and flowing to
 * the target distribution. Also saves the target distribution for visualization.
 */

import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-wasm';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ESM __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');

// Configuration
const CONFIG = {
  modelPath: 'static/flow_model_dlic/models/model.json',
  datasetPath: 'static/source_selection/data/smiley_face.json',
  outputDir: 'static/flow_model_dlic',
  numTrajectories: 20,     // 20 trajectories for visualization
  numSteps: 100,           // 100 timesteps to match DLIC
  seed: 42,                // For reproducibility
};

// Initialize WASM backend
async function initBackend(): Promise<void> {
  await tf.setBackend('wasm');
  await tf.ready();
}

// Custom IOHandler to load model from filesystem (works with WASM backend)
function createFilesystemIOHandler(modelJsonPath: string): tf.io.IOHandler {
  return {
    async load(): Promise<tf.io.ModelArtifacts> {
      // Read model.json
      const modelJson = JSON.parse(fs.readFileSync(modelJsonPath, 'utf-8'));
      const modelDir = path.dirname(modelJsonPath);

      // Load weights
      const weightsManifest = modelJson.weightsManifest as tf.io.WeightsManifestConfig;
      const weightSpecs: tf.io.WeightsManifestEntry[] = [];
      const weightDataArrays: ArrayBuffer[] = [];

      for (const group of weightsManifest) {
        for (const weightPath of group.paths) {
          const weightsPath = path.join(modelDir, weightPath);
          const weightsBuffer = fs.readFileSync(weightsPath);
          weightDataArrays.push(weightsBuffer.buffer.slice(
            weightsBuffer.byteOffset,
            weightsBuffer.byteOffset + weightsBuffer.byteLength
          ));
        }
        weightSpecs.push(...group.weights);
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

      return {
        modelTopology: modelJson.modelTopology,
        weightSpecs,
        weightData: combinedBuffer,
      };
    },
  };
}

// Load model
async function loadModel(modelPath: string): Promise<tf.LayersModel> {
  const absPath = path.join(ROOT, modelPath);
  console.log(`Loading model from: ${absPath}`);

  if (!fs.existsSync(absPath)) {
    throw new Error(`Model file not found: ${absPath}. Run train.ts first.`);
  }

  // Load model using custom filesystem handler
  const ioHandler = createFilesystemIOHandler(absPath);
  const model = await tf.loadLayersModel(ioHandler);
  console.log('Model loaded successfully');
  return model;
}

// Load target distribution from JSON
function loadDataset(relPath: string): number[][] {
  const absPath = path.join(ROOT, relPath);
  const rawData = fs.readFileSync(absPath, 'utf-8');
  const data = JSON.parse(rawData);
  return data.points;
}

// Euler integration step
function eulerStep(
  model: tf.LayersModel,
  x_t: tf.Tensor2D,
  t: number,
  dt: number
): tf.Tensor2D {
  return tf.tidy(() => {
    const numSamples = x_t.shape[0];

    // Create time tensor [numSamples, 1]
    const tTensor = tf.fill([numSamples, 1], t);

    // Concatenate [x, y, t] -> [numSamples, 3]
    const input = tf.concat([x_t, tTensor], 1);

    // Forward pass to get velocity
    const velocity = model.predict(input) as tf.Tensor2D;

    // Euler step: x_next = x_t + dt * velocity
    const x_next = x_t.add(velocity.mul(dt));

    return x_next;
  });
}

// Sample trajectories from the model
async function sampleTrajectories(
  model: tf.LayersModel,
  numTrajectories: number,
  numSteps: number,
  seed: number
): Promise<number[][][]> {
  // Set random seed for reproducibility
  tf.randomNormal([1]).dispose(); // Warm up
  // Note: TF.js doesn't have a simple setSeed, but we can use a seeded RNG externally

  // Generate initial points from Gaussian distribution
  // Using a simple seeded approach by generating more and taking first N
  const initialPoints = tf.randomNormal([numTrajectories, 2]);

  // Store trajectories: [step][sample][x, y]
  const trajectories: number[][][] = [];

  // Store initial points
  trajectories.push(initialPoints.arraySync() as number[][]);

  let x_t = initialPoints;

  console.log(`Sampling ${numTrajectories} trajectories over ${numSteps} steps...`);
  console.log('----------------------------------------');

  for (let step = 0; step < numSteps; step++) {
    const t = step / numSteps;
    const dt = 1.0 / numSteps;

    // Perform Euler step
    const x_next = eulerStep(model, x_t, t, dt);

    // Store current positions
    trajectories.push(x_next.arraySync() as number[][]);

    // Dispose old tensor (except initial points which we keep)
    if (step > 0) {
      x_t.dispose();
    }
    x_t = x_next;

    // Progress logging
    if (step % 20 === 0 || step === numSteps - 1) {
      console.log(`  Step ${(step + 1).toString().padStart(3)}/${numSteps} (t=${t.toFixed(3)})`);
    }
  }

  console.log('----------------------------------------');

  // Cleanup
  x_t.dispose();
  initialPoints.dispose();

  return trajectories;
}

// Helper: Format duration
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}min`;
}

// Main
async function main() {
  const startTime = Date.now();

  console.log('\n****************************************');
  console.log('  Sampling Trajectories');
  console.log('****************************************\n');

  // Initialize backend
  await initBackend();
  console.log(`TensorFlow.js Backend: ${tf.getBackend()}`);
  console.log(`TensorFlow.js Version: ${tf.version.tfjs}\n`);

  // Load model
  const model = await loadModel(CONFIG.modelPath);

  // Load target distribution
  console.log(`Loading target distribution from: ${CONFIG.datasetPath}`);
  const targetDistribution = loadDataset(CONFIG.datasetPath);
  console.log(`  Target distribution size: ${targetDistribution.length} points\n`);

  // Sample trajectories
  const trajectories = await sampleTrajectories(
    model,
    CONFIG.numTrajectories,
    CONFIG.numSteps,
    CONFIG.seed
  );

  // Ensure output directory exists
  const outputDir = path.join(ROOT, CONFIG.outputDir);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Save trajectories and target distribution
  const outputData = {
    trajectories,
    targetDistribution,
    config: {
      numTrajectories: CONFIG.numTrajectories,
      numSteps: CONFIG.numSteps,
      seed: CONFIG.seed,
    },
  };

  const outputPath = path.join(outputDir, 'trajectories.json');
  fs.writeFileSync(outputPath, JSON.stringify(outputData));
  console.log(`\nSaved trajectories to: ${outputPath}`);

  // Log file size
  const stats = fs.statSync(outputPath);
  console.log(`  File size: ${(stats.size / 1024).toFixed(2)} KB`);

  console.log(`\n****************************************`);
  console.log(`  Trajectory Sampling Complete!`);
  console.log(`  Total time: ${formatDuration(Date.now() - startTime)}`);
  console.log('****************************************\n');
}

main().catch((err) => {
  console.error('Sampling failed:', err);
  process.exit(1);
});
