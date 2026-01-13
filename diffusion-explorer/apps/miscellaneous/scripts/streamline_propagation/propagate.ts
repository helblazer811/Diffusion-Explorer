/**
 * Pre-compute streamline propagation data for visualization.
 *
 * This script:
 * 1. Loads the flow_matching_smiley_face model
 * 2. Generates initial streamlines at t=0
 * 3. Propagates them through time using the ODE
 * 4. Generates discrete streamline snapshots at fixed intervals
 * 5. Saves all data to JSON files
 */

import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-wasm';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { FlowModel } from '@diffusion-explorer/diffusion';
import {
  generateStreamlines,
  propagateStreamlines,
  generateDiscreteStreamlines,
  type VectorFieldFn,
  type TimeVaryingVectorFieldFn
} from '@diffusion-explorer/ui/node';

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
  // Model from diffusion-explorer app
  modelPath: '../../../../apps/diffusion-explorer/static/models/flow_matching_smiley_face/model.json',
  outputDir: 'static/streamline_propagation/cached_samples',

  domain: { xMin: -3, xMax: 3, yMin: -3, yMax: 3 },
  modelConfig: { dim: 2, hidden: 64 },

  propagation: {
    numTimeSteps: 100,        // 100 time steps for smooth animation
    pointsPerStreamline: 60,  // Dense sampling for smooth curves
    density: 1.0,             // Initial streamline density
    minPathLength: 0.5,       // Minimum streamline length
  },

  discrete: {
    timeSnapshots: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
    density: 1.0,
  },
};

// Helper: Format duration
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}min`;
}

// Helper: Load model from filesystem (manual deserialization for WASM backend)
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

// Create time-varying vector field from flow model
function createVectorField(model: FlowModel): TimeVaryingVectorFieldFn {
  return (x: number, y: number, t: number): [number, number] => {
    const result = tf.tidy(() => {
      const point = tf.tensor2d([[x, y]]);
      const time = tf.tensor1d([t]);
      const velocity = model.forward(point, time);
      return velocity.arraySync() as number[][];
    });
    return [result[0][0], result[0][1]];
  };
}

// Generate and save propagated streamlines
async function generatePropagatedStreamlines(model: FlowModel): Promise<void> {
  console.log('\n----------------------------------------');
  console.log('  Propagated Streamlines');
  console.log('----------------------------------------');

  const startTime = Date.now();
  const { domain, propagation } = CONFIG;

  // Create time-varying vector field
  const vectorField = createVectorField(model);

  // Create frozen vector field at t=0 for initial streamlines
  const initialField: VectorFieldFn = (x, y) => vectorField(x, y, 0);

  console.log(`  Generating initial streamlines at t=0...`);

  // Generate initial streamlines
  const initialStreamlines = generateStreamlines(initialField, {
    domainMin: [domain.xMin, domain.yMin],
    domainMax: [domain.xMax, domain.yMax],
    density: propagation.density,
    minlength: propagation.minPathLength,
    integrationDirection: 'both',
  });

  console.log(`  Generated ${initialStreamlines.length} streamlines`);
  console.log(`  Propagating through ${propagation.numTimeSteps} time steps...`);

  // Propagate streamlines
  const propagated = propagateStreamlines(
    initialStreamlines,
    vectorField,
    {
      numTimeSteps: propagation.numTimeSteps,
      pointsPerStreamline: propagation.pointsPerStreamline,
      integrationMethod: 'euler',
    }
  );

  console.log(`  Propagation complete`);
  console.log(`  Num streamlines: ${propagated.numStreamlines}`);
  console.log(`  Points per streamline: ${propagated.numPointsPerStreamline}`);
  console.log(`  Num time steps: ${propagated.numTimeSteps}`);

  // Save to JSON
  const outputFile = path.join(ROOT, CONFIG.outputDir, 'propagated_streamlines.json');
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify({
    curves: propagated.curves,
    timeSteps: propagated.timeSteps,
    numStreamlines: propagated.numStreamlines,
    numPointsPerStreamline: propagated.numPointsPerStreamline,
    numTimeSteps: propagated.numTimeSteps,
    metadata: {
      model: 'flow_matching_smiley_face',
      domain: domain,
    }
  }));

  console.log(`  Saved to: ${CONFIG.outputDir}/propagated_streamlines.json`);
  console.log(`  Time: ${formatDuration(Date.now() - startTime)}`);
}

// Generate and save discrete streamline snapshots
async function generateDiscreteSnapshots(model: FlowModel): Promise<void> {
  console.log('\n----------------------------------------');
  console.log('  Discrete Streamlines');
  console.log('----------------------------------------');

  const startTime = Date.now();
  const { domain, discrete } = CONFIG;

  console.log(`  Time snapshots: [${discrete.timeSnapshots.join(', ')}]`);
  console.log(`  Generating ${discrete.timeSnapshots.length} snapshots...`);

  // Create time-varying vector field
  const vectorField = createVectorField(model);

  // Generate discrete snapshots
  const discreteData = generateDiscreteStreamlines(
    vectorField,
    domain,
    discrete.timeSnapshots,
    {
      density: discrete.density,
      minlength: 0.5,
      integrationDirection: 'both',
    }
  );

  console.log(`  Generated snapshots with ${discreteData.snapshots.map(s => s.length).join(', ')} streamlines`);

  // Save to JSON
  const outputFile = path.join(ROOT, CONFIG.outputDir, 'discrete_streamlines.json');
  fs.writeFileSync(outputFile, JSON.stringify({
    snapshots: discreteData.snapshots,
    timeSnapshots: discreteData.timeSnapshots,
    metadata: {
      model: 'flow_matching_smiley_face',
      domain: domain,
    }
  }));

  console.log(`  Saved to: ${CONFIG.outputDir}/discrete_streamlines.json`);
  console.log(`  Time: ${formatDuration(Date.now() - startTime)}`);
}

// Main
async function main() {
  await initBackend();

  console.log('\n****************************************');
  console.log('  Streamline Propagation - Pre-compute');
  console.log('****************************************\n');

  console.log(`TensorFlow.js Backend: ${tf.getBackend()}`);
  console.log(`TensorFlow.js Version: ${tf.version.tfjs}`);

  const startTime = Date.now();

  // Check if model exists
  const modelJsonPath = path.join(__dirname, CONFIG.modelPath);
  if (!fs.existsSync(modelJsonPath)) {
    console.error(`Model not found at: ${modelJsonPath}`);
    console.error('Please ensure the flow_matching_smiley_face model is trained.');
    process.exit(1);
  }

  console.log(`\nLoading model from: ${CONFIG.modelPath}`);

  // Create FlowModel and load weights
  const model = new FlowModel(CONFIG.modelConfig.dim, CONFIG.modelConfig.hidden);
  const tfModel = await loadModel(modelJsonPath);
  (model as any).model = tfModel;

  console.log('Model loaded successfully');

  // Generate data
  await generatePropagatedStreamlines(model);
  await generateDiscreteSnapshots(model);

  // Cleanup
  tfModel.dispose();

  console.log('\n****************************************');
  console.log('  Pre-computation Complete!');
  console.log(`  Total time: ${formatDuration(Date.now() - startTime)}`);
  console.log('****************************************\n');
}

main().catch((err) => {
  console.error('Pre-computation failed:', err);
  process.exit(1);
});
