/*
    Pathline filtering algorithm for time-dependent vector fields.

    The goal here is to create an animation of path-lines that emphasize the curvature
    (or lack thereof) of the trajectories in a time-dependent vector field, while
    avoiding visual clutter. Our algorithm is a space-time variation of the
    Jobard & Lefer (1997): Evenly Spaced Streamlines method.

    The algorithm works as follows:
    Inputs: vector field v(x,t), time interval [0,1], number of path-lines N,
            time window size window_delta_t (fraction of [0,1] interval),
            minimum spacing distance d_min
    1. Sample a large number of path-lines from the vector field.
    2. Initialize a list of active path-lines as full.
    3. Initialize a list of time steps when path-lines became inactive, set to infinity.
    4. Convert window_delta_t to an integer number of timesteps: windowSteps = floor(window_delta_t * numTimesteps)
    5. For each discrete time t_i in [0,1] with step size delta_t:
        a. Clear any grid cells that were occupied more than windowSteps ago
           (cells store the timestep when they were occupied).
        b. For each active path-line, get its position at time t_i.
        c. Create a 2D grid over the spatial domain with cell size d_min.
        d. For each active path-line:
            i. Determine which grid cell its position at time t_i falls into.
            ii. If the cell is unoccupied (or expired), mark it as occupied with current timestep.
            iii. If the cell is already occupied (within the time window), mark the path-line as inactive.
                Record the time t_i as the time it became inactive.
    6. Render the stored positions of active path-lines over time to create the animation.

    This algorithm ensures that at each time step, path-lines are spaced apart by at least
    d_min within the time window, reducing visual clutter and highlighting the flow structure.
    The time window allows cells to be reused after enough time has passed, enabling
    pathlines to pass through areas that were previously occupied.
*/

export interface TemporalSpacingOptions {
  dMin: number; // Minimum spacing distance (grid cell size)
  windowDeltaT?: number; // Time window as fraction of [0,1] interval (default: 1.0 = entire interval)
  domainMin?: [number, number]; // Spatial domain min [x, y]
  domainMax?: [number, number]; // Spatial domain max [x, y]
}

export interface SpatialSpacingOptions {
  dMin: number; // Minimum spacing distance (grid cell size)
  domainMin?: [number, number]; // Spatial domain min [x, y]
  domainMax?: [number, number]; // Spatial domain max [x, y]
}

/**
 * Computes deactivation times for pathlines based on spatial grid occupancy.
 * At each time step, pathlines are checked for collisions in a 2D grid.
 * If a pathline's grid cell is already occupied by another active pathline
 * (within the time window), it becomes inactive and its deactivation time is recorded.
 *
 * @param pathlines - Array of pathlines, each pathline is [timestep][x, y]
 * @param options - Configuration options including dMin, windowDeltaT, and optional domain bounds
 * @returns Array of deactivation time indices for each pathline (Infinity if never deactivated)
 */
export function generateTemporallySpacedPathlines(
  pathlines: number[][][],
  options: TemporalSpacingOptions
): number[] {
  const { dMin, windowDeltaT = 1.0 } = options;

  if (pathlines.length === 0) {
    return [];
  }

  const numPathlines = pathlines.length;
  const numTimesteps = pathlines[0].length;

  // Convert windowDeltaT (fraction of [0,1] interval) to integer timesteps
  const windowSteps = Math.floor(windowDeltaT * numTimesteps);

  // Compute domain bounds if not provided
  let domainMin = options.domainMin;
  let domainMax = options.domainMax;

  if (!domainMin || !domainMax) {
    let minX = Infinity,
      minY = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity;

    for (const pathline of pathlines) {
      for (const point of pathline) {
        minX = Math.min(minX, point[0]);
        minY = Math.min(minY, point[1]);
        maxX = Math.max(maxX, point[0]);
        maxY = Math.max(maxY, point[1]);
      }
    }

    domainMin = domainMin ?? [minX, minY];
    domainMax = domainMax ?? [maxX, maxY];
  }

  console.log("Pathlines domain:", { domainMin, domainMax, dMin, windowDeltaT, numPathlines, numTimesteps });

  // Create shuffled indices to randomize processing order
  const shuffledIndices = Array.from({ length: numPathlines }, (_, i) => i);
  for (let i = shuffledIndices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledIndices[i], shuffledIndices[j]] = [shuffledIndices[j], shuffledIndices[i]];
  }

  // Initialize state
  const activeFlags: boolean[] = new Array(numPathlines).fill(true);
  const deactivationTimes: number[] = new Array(numPathlines).fill(Infinity);

  // Grid cell buffer: stores [timestep, pathlineIndex] when each cell was occupied
  const cellOccupancy = new Map<string, { time: number; pathlineIdx: number }>();

  // Process each time step
  for (let t = 0; t < numTimesteps; t++) {
    // Clear expired cells (occupied more than windowSteps ago)
    for (const [cellKey, occupancy] of cellOccupancy) {
      if (t - occupancy.time > windowSteps) {
        cellOccupancy.delete(cellKey);
      }
    }

    // Process pathlines in shuffled order
    for (const i of shuffledIndices) {
      // Skip if already inactive
      if (!activeFlags[i]) {
        continue;
      }

      const point = pathlines[i][t];
      const x = point[0];
      const y = point[1];

      // Compute grid cell indices
      const cellX = Math.floor((x - domainMin[0]) / dMin);
      const cellY = Math.floor((y - domainMin[1]) / dMin);
      const cellKey = `${cellX},${cellY}`;
      console.log(`Timestep ${t}, Pathline ${i}, Position (${x.toFixed(2)}, ${y.toFixed(2)}), Cell (${cellX}, ${cellY})`);

      const existingOccupancy = cellOccupancy.get(cellKey);

      if (existingOccupancy && existingOccupancy.pathlineIdx !== i) {
        // Cell is occupied by a DIFFERENT pathline within the time window, deactivate this one
        activeFlags[i] = false;
        deactivationTimes[i] = t;
      } else {
        // Mark cell as occupied by this pathline (update timestamp if same pathline)
        cellOccupancy.set(cellKey, { time: t, pathlineIdx: i });
      }
    }
  }

  return deactivationTimes;
}

/**
 * Selects pathlines based on spatial spacing across the entire time horizon.
 * Unlike the temporal version, this considers all positions of each pathline
 * across all timesteps simultaneously. A pathline is only selected if none of
 * its positions (at any timestep) conflict with positions from already-selected
 * pathlines.
 *
 * @param pathlines - Array of pathlines, each pathline is [timestep][x, y]
 * @param options - Configuration options including dMin and optional domain bounds
 * @returns Array of selected pathlines (subset of input)
 */
export function generateSpatiallySpacedPathlines(
  pathlines: number[][][],
  options: SpatialSpacingOptions
): number[][][] {
  const { dMin } = options;

  if (pathlines.length === 0) {
    return [];
  }

  // Compute domain bounds if not provided
  let domainMin = options.domainMin;
  let domainMax = options.domainMax;

  if (!domainMin || !domainMax) {
    let minX = Infinity,
      minY = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity;

    for (const pathline of pathlines) {
      for (const point of pathline) {
        minX = Math.min(minX, point[0]);
        minY = Math.min(minY, point[1]);
        maxX = Math.max(maxX, point[0]);
        maxY = Math.max(maxY, point[1]);
      }
    }

    domainMin = domainMin ?? [minX, minY];
    domainMax = domainMax ?? [maxX, maxY];
  }

  const numPathlines = pathlines.length;

  // Create shuffled indices to randomize processing order
  const shuffledIndices = Array.from({ length: numPathlines }, (_, i) => i);
  for (let i = shuffledIndices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledIndices[i], shuffledIndices[j]] = [shuffledIndices[j], shuffledIndices[i]];
  }

  // Global set of occupied cells (no time tracking needed)
  const occupiedCells = new Set<string>();
  const selectedPathlines: number[][][] = [];

  // Process each pathline in shuffled order
  for (const i of shuffledIndices) {
    const pathline = pathlines[i];

    // Collect all unique grid cells this pathline occupies across all timesteps
    const pathlineCells = new Set<string>();
    for (const point of pathline) {
      const cellX = Math.floor((point[0] - domainMin[0]) / dMin);
      const cellY = Math.floor((point[1] - domainMin[1]) / dMin);
      pathlineCells.add(`${cellX},${cellY}`);
    }

    // Check if any cell conflicts with already-occupied cells
    let hasConflict = false;
    for (const cellKey of pathlineCells) {
      if (occupiedCells.has(cellKey)) {
        hasConflict = true;
        break;
      }
    }

    // If no conflict, select this pathline and mark all its cells as occupied
    if (!hasConflict) {
      selectedPathlines.push(pathline);
      for (const cellKey of pathlineCells) {
        occupiedCells.add(cellKey);
      }
    }
  }

  return selectedPathlines;
}

/**
 * Returns indices of spatially well-separated pathlines.
 * Same algorithm as generateSpatiallySpacedPathlines but returns indices instead of pathlines.
 */
export function getSpatiallySpacedIndices(
  pathlines: number[][][],
  options: SpatialSpacingOptions
): number[] {
  const { dMin } = options;

  if (pathlines.length === 0) {
    return [];
  }

  // Compute domain bounds if not provided
  let domainMin = options.domainMin;
  let domainMax = options.domainMax;

  if (!domainMin || !domainMax) {
    let minX = Infinity,
      minY = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity;

    for (const pathline of pathlines) {
      for (const point of pathline) {
        minX = Math.min(minX, point[0]);
        minY = Math.min(minY, point[1]);
        maxX = Math.max(maxX, point[0]);
        maxY = Math.max(maxY, point[1]);
      }
    }

    domainMin = domainMin ?? [minX, minY];
    domainMax = domainMax ?? [maxX, maxY];
  }

  const numPathlines = pathlines.length;

  // Create shuffled indices to randomize processing order
  const shuffledIndices = Array.from({ length: numPathlines }, (_, i) => i);
  for (let i = shuffledIndices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledIndices[i], shuffledIndices[j]] = [shuffledIndices[j], shuffledIndices[i]];
  }

  const occupiedCells = new Set<string>();
  const selectedIndices: number[] = [];

  for (const i of shuffledIndices) {
    const pathline = pathlines[i];

    // Collect all unique grid cells this pathline occupies
    const pathlineCells = new Set<string>();
    for (const point of pathline) {
      const cellX = Math.floor((point[0] - domainMin[0]) / dMin);
      const cellY = Math.floor((point[1] - domainMin[1]) / dMin);
      pathlineCells.add(`${cellX},${cellY}`);
    }

    // Check for conflicts
    let hasConflict = false;
    for (const cellKey of pathlineCells) {
      if (occupiedCells.has(cellKey)) {
        hasConflict = true;
        break;
      }
    }

    if (!hasConflict) {
      selectedIndices.push(i);
      for (const cellKey of pathlineCells) {
        occupiedCells.add(cellKey);
      }
    }
  }

  return selectedIndices.sort((a, b) => a - b);
}

/**
 * Selects pathlines that are spatially well-separated in BOTH of two trajectory sets.
 * Runs spatial filtering on each set independently and returns the intersection of indices.
 *
 * @param pathlinesA - First set of pathlines [sample][timestep][x, y]
 * @param pathlinesB - Second set of pathlines [sample][timestep][x, y] (same indices as A)
 * @param options - Configuration options including dMin and optional domain bounds
 * @returns Object containing selected indices and the corresponding pathlines from both sets
 */
export function generateJointSpatiallySpacedPathlines(
  pathlinesA: number[][][],
  pathlinesB: number[][][],
  options: SpatialSpacingOptions
): { indices: number[]; pathlinesA: number[][][]; pathlinesB: number[][][] } {
  if (pathlinesA.length === 0 || pathlinesB.length === 0) {
    return { indices: [], pathlinesA: [], pathlinesB: [] };
  }

  // Get indices from each set independently
  const indicesA = new Set(getSpatiallySpacedIndices(pathlinesA, options));
  const indicesB = new Set(getSpatiallySpacedIndices(pathlinesB, options));

  // Find intersection
  const intersectedIndices = [...indicesA].filter(i => indicesB.has(i)).sort((a, b) => a - b);

  // Extract pathlines at intersected indices
  const selectedA = intersectedIndices.map(i => pathlinesA[i]);
  const selectedB = intersectedIndices.map(i => pathlinesB[i]);

  console.log(`Joint spatial filtering: ${indicesA.size} from A, ${indicesB.size} from B, ${intersectedIndices.length} in intersection`);

  return {
    indices: intersectedIndices,
    pathlinesA: selectedA,
    pathlinesB: selectedB
  };
}