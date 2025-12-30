import * as tf from '@tensorflow/tfjs';
import {
  callSamplingWorkerThreadFromInitialPoints,
  callSamplingWorkerThreadVectorFieldGrid,
  sampleMultivariateNormal
} from '@diffusion-explorer/diffusion';
import {
  type VectorFieldData,
  type RectifiedFlowData,
  type TrainingSettings
} from '../settings';
import { clipSamplesToRadius } from './utils';

// Re-export types for convenience
export type { VectorFieldData, RectifiedFlowData, TrainingSettings };

// ========== HELPER FUNCTIONS ==========

export function generateUniformGridSamples(
  gridResolution: number,
  domainRange: { xMin: number; xMax: number; yMin: number; yMax: number }
): number[][] {
  const samples: number[][] = [];
  const { xMin, xMax, yMin, yMax } = domainRange;

  for (let i = 0; i < gridResolution; i++) {
    for (let j = 0; j < gridResolution; j++) {
      const x = xMin + (xMax - xMin) * (i / (gridResolution - 1));
      const y = yMin + (yMax - yMin) * (j / (gridResolution - 1));
      samples.push([x, y]);
    }
  }
  return samples;
}

export function generateClippedGaussianSamples(numSamples: number): number[][] {
  return tf.tidy(() => {
    const mean = [0, 0];
    const cov = [[1, 0], [0, 1]];
    const maxStdDev = 2.0;
    const threshold = maxStdDev * Math.sqrt(2);

    let allClippedSamples: number[][] = [];
    let attempts = 0;
    const maxAttempts = 10;
    const batchSize = Math.ceil(numSamples * 1.5);

    while (allClippedSamples.length < numSamples && attempts < maxAttempts) {
      attempts++;
      const rawSamplesTensor = sampleMultivariateNormal(mean, cov, batchSize) as tf.Tensor2D;
      const rawSamplesArray = rawSamplesTensor.arraySync() as number[][];

      const clippedBatch = clipSamplesToRadius(rawSamplesArray, threshold);
      allClippedSamples = allClippedSamples.concat(clippedBatch);
    }
    return allClippedSamples.slice(0, numSamples);
  });
}

// ========== DATA LOADING FUNCTIONS ==========

export async function loadTargetDistribution(
  dataPath: string,
  numSamples: number
): Promise<number[][] | null> {
  try {
    const response = await fetch(dataPath);
    const data = await response.json();
    const allPoints = data.points as number[][];
    // Fisher-Yates shuffle for unbiased random sampling
    const shuffled = [...allPoints];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.slice(0, numSamples);
  } catch (error) {
    console.error('Failed to load target distribution:', error);
    return null;
  }
}

export async function loadCachedTrajectories(
  path: string
): Promise<{ trajectories: number[][][]; sourceDistribution: number[][] } | null> {
  try {
    const response = await fetch(path);
    if (!response.ok) {
      console.log('Cached trajectories file not found:', path);
      return null;
    }

    const cachedData = await response.json();
    if (!cachedData || !Array.isArray(cachedData)) {
      console.error('Invalid cached trajectories format from file: ', path);
      return null;
    }

    if (cachedData.length > 0 && cachedData[0]) {
      return {
        trajectories: cachedData,
        sourceDistribution: cachedData[0]
      };
    }

    console.error('Cached trajectories array is empty');
    return null;
  } catch (error) {
    console.log('Could not load cached trajectories:', error);
    return null;
  }
}

export async function loadCachedVectorField(
  path: string
): Promise<VectorFieldData | null> {
  try {
    const response = await fetch(path);
    if (!response.ok) {
      console.log('Cached vector field file not found:', path);
      return null;
    }

    const cachedData = await response.json();

    // Validate format
    if (!cachedData ||
        typeof cachedData.gridResolution !== 'number' ||
        !Array.isArray(cachedData.timeSteps) ||
        !Array.isArray(cachedData.velocities)) {
      console.error('Invalid cached vector field format');
      return null;
    }

    return cachedData;
  } catch (error) {
    console.log('Could not load cached vector field:', error);
    return null;
  }
}

export async function loadCachedRectifiedFlowTrajectories(
  path: string
): Promise<RectifiedFlowData | null> {
  try {
    const response = await fetch(path);
    if (!response.ok) {
      console.log('Cached rectified flow file not found:', path);
      return null;
    }

    const cachedData = await response.json();

    // Validate format
    if (!cachedData ||
        !Array.isArray(cachedData.allRectifiedTrajectories) ||
        typeof cachedData.modelPath !== 'string') {
      console.error('Invalid cached rectified flow format');
      return null;
    }

    return cachedData;
  } catch (error) {
    console.log('Could not load cached rectified flow:', error);
    return null;
  }
}

// ========== SAMPLING FUNCTIONS ==========

/**
 * Validates that a model path exists by checking for model.json
 * @throws Error if the model path does not exist
 */
async function validateModelPath(modelPath: string): Promise<void> {
  // Determine the model.json URL - if path already ends with .json, use it directly
  // Otherwise append /model.json
  const modelJsonPath = modelPath.endsWith('.json')
    ? modelPath
    : modelPath.endsWith('/')
      ? `${modelPath}model.json`
      : `${modelPath}/model.json`;

  try {
    const response = await fetch(modelJsonPath);
    if (!response.ok) {
      throw new Error(`Model not found at path: ${modelPath} (HTTP ${response.status} for ${modelJsonPath})`);
    }
    // Verify it's valid JSON
    const data = await response.json();
    if (!data.modelTopology && !data.weightsManifest) {
      throw new Error(`Invalid model.json format at: ${modelJsonPath}`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Model not found')) {
      throw error;
    }
    throw new Error(`Failed to validate model at path: ${modelPath} - ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function generateSamples(
  modelPath: string,
  numSamples: number,
  numberOfSteps: number,
  settings: TrainingSettings,
  samplingWorkerUrl: string
): Promise<{ allTimeSamples: number[][][]; sourceDistribution: number[][] }> {
  // Validate model path exists
  await validateModelPath(modelPath);

  const modelConfig = settings.modelConfig;
  const initialPoints = generateClippedGaussianSamples(numSamples);

  return new Promise((resolve) => {
    callSamplingWorkerThreadFromInitialPoints(
      samplingWorkerUrl,
      modelPath,
      'Flow Matching',
      modelConfig,
      initialPoints,
      numberOfSteps,
      (allSamples: number[][][]) => {
        console.log('Generated samples:', allSamples.length);
        resolve({
          allTimeSamples: allSamples,
          sourceDistribution: allSamples[0]
        });
      },
      settings.domainRange
    );
  });
}

export async function generateSamplesUniformGrid(
  modelPath: string,
  gridResolution: number,
  gridDomainRange: { xMin: number; xMax: number; yMin: number; yMax: number },
  numberOfSteps: number,
  settings: TrainingSettings,
  samplingWorkerUrl: string
): Promise<{ allTimeSamples: number[][][]; sourceDistribution: number[][] }> {
  // Validate model path exists
  await validateModelPath(modelPath);

  const modelConfig = settings.modelConfig;
  const initialPoints = generateUniformGridSamples(gridResolution, gridDomainRange);

  return new Promise((resolve) => {
    callSamplingWorkerThreadFromInitialPoints(
      samplingWorkerUrl,
      modelPath,
      'Flow Matching',
      modelConfig,
      initialPoints,
      numberOfSteps,
      (allSamples: number[][][]) => {
        console.log('Generated uniform grid samples:', allSamples.length, 'timesteps');
        resolve({
          allTimeSamples: allSamples,
          sourceDistribution: allSamples[0]
        });
      },
      gridDomainRange
    );
  });
}

export async function generateVectorField(
  modelPath: string,
  gridResolution: number,
  numTimeSteps: number,
  domainRange: { xMin: number; xMax: number; yMin: number; yMax: number },
  settings: TrainingSettings,
  samplingWorkerUrl: string
): Promise<VectorFieldData> {
  // Validate model path exists
  await validateModelPath(modelPath);

  console.log('Generating vector field...');
  const modelConfig = settings.modelConfig;

  // Generate time steps
  const timeSteps: number[] = [];
  for (let i = 0; i < numTimeSteps; i++) {
    timeSteps.push(i / (numTimeSteps - 1));
  }

  // Collect velocities and grid points for all time steps
  const allVelocities: number[][][] = [];
  let gridPoints: number[][] = [];

  for (let i = 0; i < timeSteps.length; i++) {
    const t = timeSteps[i];
    console.log(`Sampling vector field at t=${t.toFixed(2)}...`);

    // Use promise to wait for worker callback
    const result = await new Promise<{ velocities: number[][]; gridPoints?: number[][] }>((resolve) => {
      const worker = callSamplingWorkerThreadVectorFieldGrid(
        samplingWorkerUrl,
        modelPath,
        'Flow Matching',
        modelConfig,
        gridResolution,
        domainRange,
        (velocities: number[][]) => {
          // Worker callback - need to access the raw message
          resolve({ velocities: velocities as number[][] });
        },
        t
      );

      // Override the worker message handler to capture gridPoints
      worker.onmessage = (e: MessageEvent) => {
        if (e.data.type === 'result') {
          resolve({
            velocities: e.data.velocities,
            gridPoints: e.data.gridPoints
          });
        }
      };
    });

    allVelocities.push(result.velocities);

    // Capture grid points from first call (same for all time steps)
    if (i === 0 && result.gridPoints) {
      gridPoints = result.gridPoints;
    }
  }

  // Create complete vector field data
  const fieldData: VectorFieldData = {
    gridResolution,
    timeSteps,
    domainRange,
    velocities: allVelocities,
    gridPoints
  };

  console.log('Vector field generation complete:', allVelocities.length, 'timesteps');
  return fieldData;
}
