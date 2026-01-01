import {
  FlowModelClient,
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

  const client = new FlowModelClient(
    samplingWorkerUrl,
    modelPath,
    'Flow Matching',
    settings.modelConfig,
    settings.domainRange
  );

  const { promise } = client.sample(numSamples, numberOfSteps);
  const allSamples = await promise;

  console.log('Generated samples:', allSamples.length);
  return {
    allTimeSamples: allSamples,
    sourceDistribution: allSamples[0]
  };
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

  const client = new FlowModelClient(
    samplingWorkerUrl,
    modelPath,
    'Flow Matching',
    settings.modelConfig,
    gridDomainRange
  );

  const initialPoints = generateUniformGridSamples(gridResolution, gridDomainRange);
  const { promise } = client.sampleFromInitialPoints(initialPoints, numberOfSteps);
  const allSamples = await promise;

  console.log('Generated uniform grid samples:', allSamples.length, 'timesteps');
  return {
    allTimeSamples: allSamples,
    sourceDistribution: allSamples[0]
  };
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

  const client = new FlowModelClient(
    samplingWorkerUrl,
    modelPath,
    'Flow Matching',
    settings.modelConfig,
    domainRange
  );

  // Generate time steps
  const timeSteps: number[] = [];
  for (let i = 0; i < numTimeSteps; i++) {
    timeSteps.push(i / (numTimeSteps - 1));
  }

  // Generate grid points
  const gridPoints: number[][] = generateUniformGridSamples(gridResolution, domainRange);

  // Collect velocities for all time steps
  const allVelocities: number[][][] = [];

  for (let i = 0; i < timeSteps.length; i++) {
    const t = timeSteps[i];
    console.log(`Sampling vector field at t=${t.toFixed(2)}...`);

    const { promise } = client.vectorFieldGrid(gridResolution, domainRange, t);
    const velocities = await promise;
    allVelocities.push(velocities as unknown as number[][]);
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
