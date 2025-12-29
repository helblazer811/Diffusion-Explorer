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

export function downloadJSON(data, filename = 'data.json') {
    const jsonStr = JSON.stringify(data, null, 2); // pretty-print
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();

    URL.revokeObjectURL(url); // Clean up
}