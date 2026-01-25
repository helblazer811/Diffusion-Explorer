/**
 * Compute time-varying velocity grids from a trained flow model.
 *
 * For each timestep t in [0, 1], evaluates the flow model's velocity field
 * on a uniform grid and saves the result as a binary Float32Array.
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
  outputDir: 'static/flow_model_dlic',
  gridSize: 128,           // 128x128 spatial grid
  numTimesteps: 100,       // 100 timesteps from t=0 to t=1
  domain: {
    xMin: -3.0,
    xMax: 3.0,
    yMin: -3.0,
    yMax: 3.0,
  },
};

// Initialize WASM backend
async function initBackend(): Promise<void> {
  await tf.setBackend('wasm');
  await tf.ready();
}

// Generate uniform grid points
function generateGridPoints(gridSize: number, domain: typeof CONFIG.domain): tf.Tensor2D {
  const { xMin, xMax, yMin, yMax } = domain;
  const points: number[][] = [];

  for (let j = 0; j < gridSize; j++) {
    for (let i = 0; i < gridSize; i++) {
      const x = xMin + (i + 0.5) * (xMax - xMin) / gridSize;
      const y = yMin + (j + 0.5) * (yMax - yMin) / gridSize;
      points.push([x, y]);
    }
  }

  return tf.tensor2d(points);
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

  // Check if file exists
  if (!fs.existsSync(absPath)) {
    throw new Error(`Model file not found: ${absPath}. Run train.ts first.`);
  }

  // Load model using custom filesystem handler
  const ioHandler = createFilesystemIOHandler(absPath);
  const model = await tf.loadLayersModel(ioHandler);
  console.log('Model loaded successfully');
  return model;
}

// Compute velocity at grid points for a given timestep
function computeVelocityGrid(
  model: tf.LayersModel,
  gridPoints: tf.Tensor2D,
  t: number
): Float32Array {
  return tf.tidy(() => {
    const numPoints = gridPoints.shape[0];

    // Create time tensor [numPoints, 1]
    const tTensor = tf.fill([numPoints, 1], t);

    // Concatenate [x, y, t] -> [numPoints, 3]
    const input = tf.concat([gridPoints, tTensor], 1);

    // Forward pass through model
    const velocities = model.predict(input) as tf.Tensor2D;

    // Convert to Float32Array
    return velocities.dataSync() as Float32Array;
  });
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
  console.log('  Computing Velocity Grids');
  console.log('****************************************\n');

  // Initialize backend
  await initBackend();
  console.log(`TensorFlow.js Backend: ${tf.getBackend()}`);
  console.log(`TensorFlow.js Version: ${tf.version.tfjs}\n`);

  // Load model
  const model = await loadModel(CONFIG.modelPath);

  // Generate grid points
  console.log(`Generating ${CONFIG.gridSize}x${CONFIG.gridSize} grid points...`);
  const gridPoints = generateGridPoints(CONFIG.gridSize, CONFIG.domain);
  const numGridPoints = gridPoints.shape[0];
  console.log(`  Grid points: ${numGridPoints}`);

  // Compute velocities for each timestep
  const totalSize = CONFIG.numTimesteps * numGridPoints * 2; // 2 components (vx, vy)
  const allVelocities = new Float32Array(totalSize);

  console.log(`\nComputing velocity grids for ${CONFIG.numTimesteps} timesteps...`);
  console.log('----------------------------------------');

  for (let step = 0; step < CONFIG.numTimesteps; step++) {
    const t = step / (CONFIG.numTimesteps - 1);

    // Compute velocity grid for this timestep
    const velocities = computeVelocityGrid(model, gridPoints, t);

    // Copy to output array
    const offset = step * numGridPoints * 2;
    allVelocities.set(velocities, offset);

    // Progress logging
    if (step % 10 === 0 || step === CONFIG.numTimesteps - 1) {
      const progress = ((step + 1) / CONFIG.numTimesteps * 100).toFixed(0);
      const elapsed = formatDuration(Date.now() - startTime);
      console.log(`  Step ${(step + 1).toString().padStart(3)}/${CONFIG.numTimesteps} (t=${t.toFixed(3)}) | ${progress}% | ${elapsed}`);
    }
  }

  console.log('----------------------------------------\n');

  // Ensure output directory exists
  const outputDir = path.join(ROOT, CONFIG.outputDir);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Save velocity grids as binary
  const binPath = path.join(outputDir, 'velocity_grids.bin');
  fs.writeFileSync(binPath, Buffer.from(allVelocities.buffer));
  console.log(`Saved velocity grids to: ${binPath}`);
  console.log(`  File size: ${(allVelocities.byteLength / (1024 * 1024)).toFixed(2)} MB`);

  // Save metadata as JSON
  const metadata = {
    numTimesteps: CONFIG.numTimesteps,
    gridSize: CONFIG.gridSize,
    domain: CONFIG.domain,
    bytesPerTimestep: numGridPoints * 2 * 4, // 2 floats * 4 bytes
    totalBytes: allVelocities.byteLength,
  };

  const metaPath = path.join(outputDir, 'velocity_grids_meta.json');
  fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
  console.log(`Saved metadata to: ${metaPath}`);

  // Cleanup
  gridPoints.dispose();

  console.log(`\n****************************************`);
  console.log(`  Velocity Grid Computation Complete!`);
  console.log(`  Total time: ${formatDuration(Date.now() - startTime)}`);
  console.log('****************************************\n');
}

main().catch((err) => {
  console.error('Computation failed:', err);
  process.exit(1);
});
