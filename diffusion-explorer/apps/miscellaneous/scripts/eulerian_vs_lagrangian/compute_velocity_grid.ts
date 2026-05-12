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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');

const CONFIG = {
  modelPath: 'static/eulerian_vs_lagrangian/models/model.json',
  outputDir: 'static/eulerian_vs_lagrangian',
  gridSize: 128,
  numTimesteps: 200,
  domain: {
    xMin: -3.0,
    xMax: 3.0,
    yMin: -3.0,
    yMax: 3.0,
  },
};

async function initBackend(): Promise<void> {
  await tf.setBackend('wasm');
  await tf.ready();
}

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

function createFilesystemIOHandler(modelJsonPath: string): tf.io.IOHandler {
  return {
    async load(): Promise<tf.io.ModelArtifacts> {
      const modelJson = JSON.parse(fs.readFileSync(modelJsonPath, 'utf-8'));
      const modelDir = path.dirname(modelJsonPath);

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

async function loadModel(modelPath: string): Promise<tf.LayersModel> {
  const absPath = path.join(ROOT, modelPath);
  console.log(`Loading model from: ${absPath}`);

  if (!fs.existsSync(absPath)) {
    throw new Error(`Model file not found: ${absPath}. Run train.ts first.`);
  }

  const ioHandler = createFilesystemIOHandler(absPath);
  const model = await tf.loadLayersModel(ioHandler);
  console.log('Model loaded successfully');
  return model;
}

function computeVelocityGrid(
  model: tf.LayersModel,
  gridPoints: tf.Tensor2D,
  t: number
): Float32Array {
  return tf.tidy(() => {
    const numPoints = gridPoints.shape[0];

    const tTensor = tf.fill([numPoints, 1], t);
    const input = tf.concat([gridPoints, tTensor], 1);
    const velocities = model.predict(input) as tf.Tensor2D;

    return velocities.dataSync() as Float32Array;
  });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}min`;
}

async function main() {
  const startTime = Date.now();

  console.log('\n****************************************');
  console.log('  Computing Velocity Grids');
  console.log('****************************************\n');

  await initBackend();
  console.log(`TensorFlow.js Backend: ${tf.getBackend()}`);
  console.log(`TensorFlow.js Version: ${tf.version.tfjs}\n`);

  const model = await loadModel(CONFIG.modelPath);

  console.log(`Generating ${CONFIG.gridSize}x${CONFIG.gridSize} grid points...`);
  const gridPoints = generateGridPoints(CONFIG.gridSize, CONFIG.domain);
  const numGridPoints = gridPoints.shape[0];
  console.log(`  Grid points: ${numGridPoints}`);

  const totalSize = CONFIG.numTimesteps * numGridPoints * 2;
  const allVelocities = new Float32Array(totalSize);

  console.log(`\nComputing velocity grids for ${CONFIG.numTimesteps} timesteps...`);
  console.log('----------------------------------------');

  for (let step = 0; step < CONFIG.numTimesteps; step++) {
    const t = step / (CONFIG.numTimesteps - 1);

    const velocities = computeVelocityGrid(model, gridPoints, t);

    const offset = step * numGridPoints * 2;
    allVelocities.set(velocities, offset);

    if (step % 10 === 0 || step === CONFIG.numTimesteps - 1) {
      const progress = ((step + 1) / CONFIG.numTimesteps * 100).toFixed(0);
      const elapsed = formatDuration(Date.now() - startTime);
      console.log(`  Step ${(step + 1).toString().padStart(3)}/${CONFIG.numTimesteps} (t=${t.toFixed(3)}) | ${progress}% | ${elapsed}`);
    }
  }

  console.log('----------------------------------------\n');

  const outputDir = path.join(ROOT, CONFIG.outputDir);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const binPath = path.join(outputDir, 'velocity_grids.bin');
  fs.writeFileSync(binPath, Buffer.from(allVelocities.buffer));
  console.log(`Saved velocity grids to: ${binPath}`);
  console.log(`  File size: ${(allVelocities.byteLength / (1024 * 1024)).toFixed(2)} MB`);

  const metadata = {
    numTimesteps: CONFIG.numTimesteps,
    gridSize: CONFIG.gridSize,
    domain: CONFIG.domain,
    bytesPerTimestep: numGridPoints * 2 * 4,
    totalBytes: allVelocities.byteLength,
  };

  const metaPath = path.join(outputDir, 'velocity_grids_meta.json');
  fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
  console.log(`Saved metadata to: ${metaPath}`);

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
