import {
  callSamplingWorkerThreadFromInitialPoints,
  callSamplingWorkerThreadVectorFieldGrid,
  loadTargetDistribution,
  loadCachedTrajectories,
  loadCachedVectorField,
  loadCachedRectifiedFlowTrajectories,
  validateModelPath,
  type VectorFieldData,
  type RectifiedFlowData
} from '@diffusion-explorer/diffusion';
import { type TrainingSettings } from '../settings';
import {
  generateUniformGridSamples,
  generateClippedGaussianSamples
} from './utils';

// Re-export types for convenience
export type { VectorFieldData, RectifiedFlowData, TrainingSettings };

// Re-export utility functions for convenience
export { generateUniformGridSamples, generateClippedGaussianSamples, validateModelPath };

// Re-export caching functions for convenience
export { loadTargetDistribution, loadCachedTrajectories, loadCachedVectorField, loadCachedRectifiedFlowTrajectories };

// ========== SAMPLING FUNCTIONS ==========

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
    const worker = callSamplingWorkerThreadFromInitialPoints(
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
    const worker = callSamplingWorkerThreadFromInitialPoints(
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
    const result = await new Promise<{ velocities: number[][]; gridPoints?: number[][] }>((resolve, reject) => {
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
        } else if (e.data.type === 'error') {
          reject(new Error(e.data.error));
        }
      };

      // Add error handler
      worker.onerror = (e) => {
        console.error('[VectorField Worker Error]', e.message);
        reject(new Error(e.message));
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
