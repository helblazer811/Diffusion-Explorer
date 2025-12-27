import * as tf from '@tensorflow/tfjs';
import {
  callTrainingWorkerThread,
  callRectifiedFlowTrainingWorker,
  callSamplingWorkerThreadFromInitialPoints,
  callSamplingWorkerThreadVectorFieldGrid,
  sampleMultivariateNormal
} from '@diffusion-explorer/diffusion';
import {
  settings as globalSettings,
  type VectorFieldData,
  type RectifiedFlowData,
  type TrainingSettings
} from './settings';
import { clipSamplesToRadius } from './utils';

// Re-export types for convenience
export type { VectorFieldData, RectifiedFlowData, TrainingSettings };

// ========== HELPER FUNCTIONS ==========

/**
 * Download a trained model from IndexedDB to the user's device.
 * Triggers a browser download of two files: {downloadName}.json and {downloadName}.weights.bin
 * @param modelPath The IndexedDB path (e.g., "indexeddb://Flow_Matching_123456")
 * @param downloadName The base filename for download (e.g., "flow_matching_model")
 */
export async function downloadModelFromIndexedDB(
  modelPath: string,
  downloadName: string
): Promise<void> {
  try {
    const model = await tf.loadLayersModel(modelPath);
    await model.save(`downloads://${downloadName}`);
    console.log(`Model downloaded as ${downloadName}.json and ${downloadName}.weights.bin`);
  } catch (error) {
    console.error(`Failed to download model from ${modelPath}:`, error);
  }
}

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

// ========== TRAINING AND SAMPLING FUNCTIONS ==========

export async function trainModel(
  settings: TrainingSettings,
  trainWorkerUrl: string,
  onTrainingStart?: () => void,
  onTrainingEnd?: () => void
): Promise<{ modelPath: string; worker: Worker }> {
  console.log('Starting model training...');
  const modelConfig = settings.modelConfig;
  const trainingConfig = settings.flowMatchingTrainingConfig;
  const datasetPath = globalSettings.targetDistributionPointsPath;

  onTrainingStart?.();

  return new Promise((resolve) => {
    console.log("Starting training worker thread...");
    const worker = callTrainingWorkerThread(
      trainWorkerUrl,
      'Flow Matching',
      modelConfig,
      datasetPath,
      trainingConfig,
      async (tfModelPath: string) => {
        console.log('Training finished!', tfModelPath);
        onTrainingEnd?.();
        // Auto-download the trained model
        await downloadModelFromIndexedDB(tfModelPath, 'flow_matching_model');
        resolve({ modelPath: tfModelPath, worker });
      },
      () => console.log("Intermediate epoch callback")
    );
  });
}

export async function generateSamples(
  modelPath: string,
  numSamples: number,
  numberOfSteps: number,
  settings: TrainingSettings,
  samplingWorkerUrl: string
): Promise<{ allTimeSamples: number[][][]; sourceDistribution: number[][] }> {
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

export async function trainRectifiedFlow(
  settings: TrainingSettings,
  trainWorkerUrl: string,
  onEpochCallback?: (epoch: number, rectifiedStep: number) => void,
  onRectifiedStepCallback?: (rectifiedStep: number, trajectories: number[][] | null) => void
): Promise<{ data: RectifiedFlowData; worker: Worker }> {
  console.log('Starting rectified flow training...');
  const modelConfig = settings.modelConfig;
  const rectifiedFlowConfig = settings.rectifiedFlowTrainingConfig;
  const datasetPath = globalSettings.targetDistributionPointsPath;

  return new Promise((resolve) => {
    console.log("Starting rectified flow training worker thread...");
    const worker = callRectifiedFlowTrainingWorker(
      trainWorkerUrl,
      'Flow Matching', // trainingObjective is constant
      modelConfig,
      datasetPath,
      rectifiedFlowConfig,
      // Finish callback
      async (tfModelPath: string, allRectifiedTrajectories: number[][][][]) => {
        console.log('Rectified flow training finished!', tfModelPath);
        console.log('Collected', allRectifiedTrajectories.length, 'rectified steps');

        // Auto-download the trained rectified flow model
        await downloadModelFromIndexedDB(tfModelPath, 'rectified_flow_model');

        const data: RectifiedFlowData = {
          allRectifiedTrajectories,
          modelPath: tfModelPath
        };

        resolve({ data, worker });
      },
      // Epoch callback
      (epoch: number, rectifiedStep: number, _intermediateSamples: number[][] | null) => {
        console.log(`Rectified step ${rectifiedStep}, epoch ${epoch}`);
        onEpochCallback?.(epoch, rectifiedStep);
      },
      // Rectified step callback
      (rectifiedStep: number, trajectories: number[][] | null) => {
        console.log(`Completed rectified step ${rectifiedStep}`);
        if (trajectories) {
          console.log('  Trajectories shape:', trajectories.length, 'samples');
        }
        onRectifiedStepCallback?.(rectifiedStep, trajectories);
      }
    );
  });
}
