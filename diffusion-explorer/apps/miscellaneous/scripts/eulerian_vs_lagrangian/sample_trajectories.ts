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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');

const CONFIG = {
  modelPath: 'static/eulerian_vs_lagrangian/models/model.json',
  datasetPath: 'static/source_selection/data/smiley_face.json',
  outputDir: 'static/eulerian_vs_lagrangian',
  numSteps: 400,
  // Uniform initial-point grid matching the front-end quiver layout
  // (displayDomain ±2 with an 8% inset → spans [-1.84, 1.84])
  gridSize: 5,
  domain: { xMin: -2, xMax: 2, yMin: -2, yMax: 2 },
  insetFraction: 0.08,
};

async function initBackend(): Promise<void> {
  await tf.setBackend('wasm');
  await tf.ready();
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

function loadDataset(relPath: string): number[][] {
  const absPath = path.join(ROOT, relPath);
  const rawData = fs.readFileSync(absPath, 'utf-8');
  const data = JSON.parse(rawData);
  return data.points;
}

function eulerStep(
  model: tf.LayersModel,
  x_t: tf.Tensor2D,
  t: number,
  dt: number
): tf.Tensor2D {
  return tf.tidy(() => {
    const numSamples = x_t.shape[0];

    const tTensor = tf.fill([numSamples, 1], t);
    const input = tf.concat([x_t, tTensor], 1);
    const velocity = model.predict(input) as tf.Tensor2D;
    const x_next = x_t.add(velocity.mul(dt));

    return x_next;
  });
}

function buildUniformGridPoints(
  gridSize: number,
  domain: { xMin: number; xMax: number; yMin: number; yMax: number },
  insetFraction: number
): number[][] {
  const xRange = domain.xMax - domain.xMin;
  const yRange = domain.yMax - domain.yMin;
  const insetX = xRange * insetFraction;
  const insetY = yRange * insetFraction;
  const xMin = domain.xMin + insetX;
  const xMax = domain.xMax - insetX;
  const yMin = domain.yMin + insetY;
  const yMax = domain.yMax - insetY;

  const points: number[][] = [];
  for (let j = 0; j < gridSize; j++) {
    for (let i = 0; i < gridSize; i++) {
      const u = gridSize === 1 ? 0.5 : i / (gridSize - 1);
      const v = gridSize === 1 ? 0.5 : j / (gridSize - 1);
      points.push([xMin + u * (xMax - xMin), yMin + v * (yMax - yMin)]);
    }
  }
  return points;
}

async function sampleTrajectories(
  model: tf.LayersModel,
  initialPointsArr: number[][],
  numSteps: number
): Promise<number[][][]> {
  const initialPoints = tf.tensor2d(initialPointsArr);

  const trajectories: number[][][] = [];

  trajectories.push(initialPoints.arraySync() as number[][]);

  let x_t = initialPoints;

  console.log(`Sampling ${initialPointsArr.length} trajectories over ${numSteps} steps...`);
  console.log('----------------------------------------');

  for (let step = 0; step < numSteps; step++) {
    const t = step / numSteps;
    const dt = 1.0 / numSteps;

    const x_next = eulerStep(model, x_t, t, dt);

    trajectories.push(x_next.arraySync() as number[][]);

    if (step > 0) {
      x_t.dispose();
    }
    x_t = x_next;

    if (step % 20 === 0 || step === numSteps - 1) {
      console.log(`  Step ${(step + 1).toString().padStart(3)}/${numSteps} (t=${t.toFixed(3)})`);
    }
  }

  console.log('----------------------------------------');

  x_t.dispose();
  initialPoints.dispose();

  return trajectories;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}min`;
}

async function main() {
  const startTime = Date.now();

  console.log('\n****************************************');
  console.log('  Sampling Trajectories');
  console.log('****************************************\n');

  await initBackend();
  console.log(`TensorFlow.js Backend: ${tf.getBackend()}`);
  console.log(`TensorFlow.js Version: ${tf.version.tfjs}\n`);

  const model = await loadModel(CONFIG.modelPath);

  console.log(`Loading target distribution from: ${CONFIG.datasetPath}`);
  const targetDistribution = loadDataset(CONFIG.datasetPath);
  console.log(`  Target distribution size: ${targetDistribution.length} points\n`);

  const initialPointsArr = buildUniformGridPoints(
    CONFIG.gridSize,
    CONFIG.domain,
    CONFIG.insetFraction
  );
  console.log(
    `Initial points: ${CONFIG.gridSize}x${CONFIG.gridSize} uniform grid (${initialPointsArr.length} samples) over ` +
    `[${CONFIG.domain.xMin}, ${CONFIG.domain.xMax}] x [${CONFIG.domain.yMin}, ${CONFIG.domain.yMax}] with ` +
    `${(CONFIG.insetFraction * 100).toFixed(0)}% inset\n`
  );

  const trajectories = await sampleTrajectories(model, initialPointsArr, CONFIG.numSteps);

  const outputDir = path.join(ROOT, CONFIG.outputDir);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputData = {
    trajectories,
    targetDistribution,
    config: {
      gridSize: CONFIG.gridSize,
      numTrajectories: initialPointsArr.length,
      numSteps: CONFIG.numSteps,
      domain: CONFIG.domain,
      insetFraction: CONFIG.insetFraction,
    },
  };

  const outputPath = path.join(outputDir, 'trajectories.json');
  fs.writeFileSync(outputPath, JSON.stringify(outputData));
  console.log(`\nSaved trajectories to: ${outputPath}`);

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
