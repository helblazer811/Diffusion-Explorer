import * as tf from '@tensorflow/tfjs';
import { sampleMultivariateNormal } from '@diffusion-explorer/diffusion';

// ========== GRID AND SAMPLING HELPERS ==========

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

// ========== CLIPPING FUNCTIONS ==========

/**
 * Clip samples to only include those within a given radius from the origin.
 * @param samples Array of [x, y] coordinates
 * @param radius Maximum distance from origin to include
 * @returns Filtered array containing only samples within the radius
 */
export function clipSamplesToRadius(samples: number[][], radius: number): number[][] {
  return samples.filter(sample => {
    const [x, y] = sample;
    const distance = Math.sqrt(x * x + y * y);
    return distance <= radius;
  });
}

/**
 * Clip trajectories to only include samples whose starting point is within a given radius.
 * @param trajectories Array of trajectories: [timestep][sample][dim]
 * @param radius Maximum distance from origin for starting points
 * @returns Filtered trajectories with only samples that start within the radius
 */
export function clipTrajectoriesToStartingRadius(
  trajectories: number[][][],
  radius: number
): number[][][] {
  if (!trajectories || trajectories.length === 0) return trajectories;

  // Get starting points (timestep 0)
  const startingPoints = trajectories[0];

  // Find indices of samples whose starting point is within the radius
  const validIndices: number[] = [];
  for (let i = 0; i < startingPoints.length; i++) {
    const [x, y] = startingPoints[i];
    const distance = Math.sqrt(x * x + y * y);
    if (distance <= radius) {
      validIndices.push(i);
    }
  }

  // Filter all timesteps to keep only valid samples
  return trajectories.map(timestep =>
    validIndices.map(i => timestep[i])
  );
}

/**
 * Clip all rectified flow trajectories to only include samples whose starting point is within a given radius.
 * @param allRectifiedTrajectories Array: [rectifiedStep][timestep][sample][dim]
 * @param radius Maximum distance from origin for starting points
 * @returns Filtered trajectories for all rectified steps
 */
export function clipAllRectifiedTrajectoriesToStartingRadius(
  allRectifiedTrajectories: number[][][][],
  radius: number
): number[][][][] {
  if (!allRectifiedTrajectories || allRectifiedTrajectories.length === 0) {
    return allRectifiedTrajectories;
  }

  return allRectifiedTrajectories.map(rectStep =>
    clipTrajectoriesToStartingRadius(rectStep, radius)
  );
}