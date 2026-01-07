/**
 * Streamline generation using sequential bidirectional integration.
 * Based on Jobard & Lefer (1997) evenly-spaced streamlines algorithm.
 */

export type VectorFieldFn = (x: number, y: number) => [number, number];

interface CellOccupancy {
  streamlineIndex: number;
  step: number;
}

export interface StreamlineOptions {
  deltaT: number;               // Integration time step
  minD: number;                 // Minimum spacing between streamlines (spatial hash cell size)
  domainMin: [number, number];  // Domain bounds [xMin, yMin]
  domainMax: [number, number];  // Domain bounds [xMax, yMax]
  maxSteps?: number;            // Max integration steps per direction (default: 1000)
  convergenceThreshold?: number; // Velocity magnitude to stop at sinks (default: 1e-6)
  selfCollisionSteps?: number;  // Min steps before self-collision counts (default: 20)
  minPathLength?: number;       // Minimum streamline path length to keep (default: minD * 20)
  seedSpacing?: number;         // Distance between candidate seeds along streamline (default: minD * 2)
  maxSeedAttempts?: number;     // Max consecutive failed seeds before stopping (default: 50)
  domainPadding?: number;       // Fraction to expand domain for integration (default: 0, e.g., 0.2 = 20% padding)
  minStreamlines?: number;      // Minimum streamlines before allowing termination (default: 0)
}

function getCellKey(x: number, y: number, minD: number, domainMin: [number, number]): string {
  const cellX = Math.floor((x - domainMin[0]) / minD);
  const cellY = Math.floor((y - domainMin[1]) / minD);
  return `${cellX},${cellY}`;
}

function isInDomain(x: number, y: number, domainMin: [number, number], domainMax: [number, number]): boolean {
  return x >= domainMin[0] && x <= domainMax[0] && y >= domainMin[1] && y <= domainMax[1];
}

/**
 * Compute the total path length of a streamline.
 */
function computePathLength(streamline: number[][]): number {
  let length = 0;
  for (let i = 1; i < streamline.length; i++) {
    const dx = streamline[i][0] - streamline[i - 1][0];
    const dy = streamline[i][1] - streamline[i - 1][1];
    length += Math.sqrt(dx * dx + dy * dy);
  }
  return length;
}

/**
 * Try to find a random seed in an unoccupied cell.
 */
function tryRandomSeed(
  domainMin: [number, number],
  domainMax: [number, number],
  spatialHash: Map<string, CellOccupancy>,
  minD: number,
  maxAttempts: number = 10
): [number, number] | null {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const x = domainMin[0] + Math.random() * (domainMax[0] - domainMin[0]);
    const y = domainMin[1] + Math.random() * (domainMax[1] - domainMin[1]);
    const key = getCellKey(x, y, minD, domainMin);
    if (!spatialHash.has(key)) return [x, y];
  }
  return null;
}

/**
 * Generate candidate seeds perpendicular to a streamline with small random offset.
 */
function generateCandidateSeeds(
  streamline: number[][],
  deltaT: number,
  minD: number,
  seedSpacing: number,
  spatialHash: Map<string, CellOccupancy>,
  domainMin: [number, number],
  domainMax: [number, number]
): Array<[number, number]> {
  const candidates: Array<[number, number]> = [];
  const stepInterval = Math.max(1, Math.floor(seedSpacing / deltaT));
  const randOffset = 0.2 * minD;  // 20% random offset

  for (let i = 0; i < streamline.length - 1; i += stepInterval) {
    const [x1, y1] = streamline[i];
    const [x2, y2] = streamline[i + 1];

    // Compute direction vector
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-10) continue;

    // Perpendicular direction (normalized)
    const px = -dy / len;
    const py = dx / len;

    // Try both sides at distance minD with random offset
    for (const sign of [1, -1]) {
      const cx = x1 + sign * minD * px + (Math.random() - 0.5) * randOffset;
      const cy = y1 + sign * minD * py + (Math.random() - 0.5) * randOffset;

      if (isInDomain(cx, cy, domainMin, domainMax)) {
        const cellKey = getCellKey(cx, cy, minD, domainMin);
        if (!spatialHash.has(cellKey)) {
          candidates.push([cx, cy]);
        }
      }
    }
  }

  // Shuffle candidates for non-directional ordering
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  return candidates;
}

/**
 * Integrate a streamline in one direction until termination.
 * Returns the points and cell keys added to the spatial hash.
 */
function integrateDirection(
  seed: [number, number],
  vectorField: VectorFieldFn,
  direction: 1 | -1,  // 1 for forward, -1 for backward
  spatialHash: Map<string, CellOccupancy>,
  streamlineIndex: number,
  options: {
    deltaT: number;
    minD: number;
    domainMin: [number, number];
    domainMax: [number, number];
    maxSteps: number;
    convergenceThreshold: number;
    selfCollisionSteps: number;
  }
): { points: number[][]; cellKeys: string[] } {
  const { deltaT, minD, domainMin, domainMax, maxSteps, convergenceThreshold, selfCollisionSteps } = options;
  const points: number[][] = [];
  const cellKeys: string[] = [];

  let [x, y] = seed;

  for (let step = 0; step < maxSteps; step++) {
    // Get velocity at current position
    const [vx, vy] = vectorField(x, y);
    const speed = Math.sqrt(vx * vx + vy * vy);

    // Check convergence (sink/source)
    if (speed < convergenceThreshold) {
      break;
    }

    // Compute next position
    const xNew = x + direction * deltaT * vx;
    const yNew = y + direction * deltaT * vy;

    // Check domain bounds
    if (!isInDomain(xNew, yNew, domainMin, domainMax)) {
      break;
    }

    // Check spatial hash for collisions
    const cellKey = getCellKey(xNew, yNew, minD, domainMin);
    const existing = spatialHash.get(cellKey);

    if (existing !== undefined) {
      if (existing.streamlineIndex !== streamlineIndex) {
        // Different streamline - always terminate
        break;
      }
      // Same streamline - check step distance
      if (step - existing.step > selfCollisionSteps) {
        // True loop back - terminate
        break;
      }
      // Recent step in same cell - continue (slow movement)
    }

    // Add point and update cell occupancy
    points.push([xNew, yNew]);
    cellKeys.push(cellKey);
    spatialHash.set(cellKey, { streamlineIndex, step });
    x = xNew;
    y = yNew;
  }

  return { points, cellKeys };
}

/**
 * Generates evenly-spaced streamlines using sequential bidirectional integration.
 * Uses perpendicular seeding with random offset for natural coverage.
 *
 * @param vectorField - Function that returns velocity [vx, vy] at position (x, y)
 * @param options - Configuration options
 * @returns Array of streamlines, each streamline is an array of [x, y] points (variable length)
 */
export function generateStreamlines(
  vectorField: VectorFieldFn,
  options: StreamlineOptions
): number[][][] {
  const { deltaT, minD, domainMin, domainMax } = options;
  const maxSteps = options.maxSteps ?? 1000;
  const convergenceThreshold = options.convergenceThreshold ?? 1e-6;
  const selfCollisionSteps = options.selfCollisionSteps ?? 20;
  const minPathLength = options.minPathLength ?? minD * 20;
  const seedSpacing = options.seedSpacing ?? minD * 2;
  const maxSeedAttempts = options.maxSeedAttempts ?? 50;
  const domainPadding = options.domainPadding ?? 0;
  const minStreamlines = options.minStreamlines ?? 0;

  // Calculate padded domain for integration (allows paths to leave and re-enter)
  const domainWidth = domainMax[0] - domainMin[0];
  const domainHeight = domainMax[1] - domainMin[1];
  const paddedDomainMin: [number, number] = [
    domainMin[0] - domainPadding * domainWidth,
    domainMin[1] - domainPadding * domainHeight
  ];
  const paddedDomainMax: [number, number] = [
    domainMax[0] + domainPadding * domainWidth,
    domainMax[1] + domainPadding * domainHeight
  ];

  // Initialize spatial hash (tracks which streamline occupies each cell and when)
  const spatialHash = new Map<string, CellOccupancy>();

  const streamlines: number[][][] = [];
  // Use padded domain for integration
  const integrationOptions = { deltaT, minD, domainMin: paddedDomainMin, domainMax: paddedDomainMax, maxSteps, convergenceThreshold, selfCollisionSteps };
  let streamlineIndex = 0;

  // Initialize seed queue with a random seed
  const seedQueue: Array<[number, number]> = [];
  const initialSeed: [number, number] = [
    domainMin[0] + Math.random() * (domainMax[0] - domainMin[0]),
    domainMin[1] + Math.random() * (domainMax[1] - domainMin[1])
  ];
  seedQueue.push(initialSeed);

  // Track consecutive failed seeds for termination
  let consecutiveFailures = 0;

  // Main loop: process seeds until queue is empty or too many failures (after reaching minStreamlines)
  while (seedQueue.length > 0 && (streamlines.length < minStreamlines || consecutiveFailures < maxSeedAttempts)) {
    const seed = seedQueue.pop()!;

    // Skip if seed's cell is now occupied (use padded domain for consistent hashing)
    const seedKey = getCellKey(seed[0], seed[1], minD, paddedDomainMin);
    if (spatialHash.has(seedKey)) {
      consecutiveFailures++;
      continue;
    }

    // Add seed to spatial hash
    spatialHash.set(seedKey, { streamlineIndex, step: 0 });

    // Integrate forward and backward
    const { points: forward, cellKeys: forwardKeys } = integrateDirection(seed, vectorField, 1, spatialHash, streamlineIndex, integrationOptions);
    const { points: backward, cellKeys: backwardKeys } = integrateDirection(seed, vectorField, -1, spatialHash, streamlineIndex, integrationOptions);

    // Combine into streamline: [...backward.reverse(), seed, ...forward]
    const streamline: number[][] = [
      ...backward.reverse(),
      [seed[0], seed[1]],
      ...forward
    ];

    // Discard short streamlines and free up their spatial hash cells
    if (computePathLength(streamline) < minPathLength) {
      for (const key of [...forwardKeys, ...backwardKeys, seedKey]) {
        spatialHash.delete(key);
      }
      consecutiveFailures++;
      continue;
    }

    // Success - reset failure counter
    consecutiveFailures = 0;
    streamlines.push(streamline);

    // Generate perpendicular candidates and add to queue
    const candidates = generateCandidateSeeds(
      streamline,
      deltaT,
      minD,
      seedSpacing,
      spatialHash,
      domainMin,
      domainMax
    );
    seedQueue.push(...candidates);

    // Add random seeds to explore isolated regions
    for (let i = 0; i < 3; i++) {
      const randomSeed = tryRandomSeed(domainMin, domainMax, spatialHash, minD);
      if (randomSeed) {
        seedQueue.push(randomSeed);
      }
    }

    streamlineIndex++;
  }

  return streamlines;
}
