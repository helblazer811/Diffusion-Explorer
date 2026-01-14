/**
 * Pathline generation utilities for the streamline generation visualization.
 *
 * This file contains:
 * - Types for vector fields, domains, collision events, and precomputed data
 * - Vector field functions (divergingSpiral, doubleVortex)
 * - Pathline integration using RK4
 * - Collision detection and precomputation
 * - Seed point generation
 */

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------

export type VectorFieldFn = (x: number, y: number) => [number, number];

export interface CollisionEvent {
  pathlineIndex: number;
  step: number; // Integration step where collision occurred
  gridCell: [number, number]; // Grid cell that was already occupied
}

export interface Domain {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export interface PrecomputedData {
  /** Full pathlines for left panel (domain coords) */
  fullPathlines: number[][][];
  /** Truncated pathlines for right panel (domain coords) - truncated at collision */
  truncatedPathlines: number[][][];
  /** Collision events (only for pathlines that collided) */
  collisionEvents: CollisionEvent[];
  /** Indices of pathlines that survived (no collision) */
  survivingPathlineIndices: number[];
}

// ----------------------------------------------------------------
// Vector Field Functions
// ----------------------------------------------------------------

/**
 * Double vortex vector field with two counter-rotating vortices.
 * Creates interesting streamline patterns that tend to crowd together.
 */
export function doubleVortex(
  x: number,
  y: number,
  separation: number = 2.0,
  strength: number = 1.0
): [number, number] {
  // Left vortex (clockwise) at (-sep/2, 0)
  const x1 = x + separation / 2;
  const r1sq = x1 * x1 + y * y + 0.1; // Small epsilon to avoid singularity
  const vx1 = (strength * y) / r1sq;
  const vy1 = (-strength * x1) / r1sq;

  // Right vortex (counter-clockwise) at (sep/2, 0)
  const x2 = x - separation / 2;
  const r2sq = x2 * x2 + y * y + 0.1;
  const vx2 = (-strength * y) / r2sq;
  const vy2 = (strength * x2) / r2sq;

  return [vx1 + vx2, vy1 + vy2];
}

/**
 * Diverging spiral vector field.
 * Combines rotational flow with outward radial flow, creating spiraling outward trajectories.
 */
export function divergingSpiral(
  x: number,
  y: number,
  rotationStrength: number = 1.0,
  divergenceStrength: number = 0.3
): [number, number] {
  const r = Math.sqrt(x * x + y * y) + 0.1; // Small epsilon to avoid singularity

  // Rotational component (counter-clockwise): perpendicular to radius
  const vxRot = -y / r;
  const vyRot = x / r;

  // Divergence component (outward): along radius
  const vxDiv = x / r;
  const vyDiv = y / r;

  return [
    rotationStrength * vxRot + divergenceStrength * vxDiv,
    rotationStrength * vyRot + divergenceStrength * vyDiv,
  ];
}

// ----------------------------------------------------------------
// Pathline Integration
// ----------------------------------------------------------------

/**
 * Integrate a pathline from a seed point using RK4.
 */
export function integratePathline(
  vectorField: VectorFieldFn,
  seedPoint: [number, number],
  numSteps: number,
  dt: number,
  domain: Domain
): number[][] {
  const points: number[][] = [[seedPoint[0], seedPoint[1]]];

  let x = seedPoint[0];
  let y = seedPoint[1];

  for (let i = 0; i < numSteps; i++) {
    // RK4 integration
    const [k1x, k1y] = vectorField(x, y);
    const [k2x, k2y] = vectorField(x + (k1x * dt) / 2, y + (k1y * dt) / 2);
    const [k3x, k3y] = vectorField(x + (k2x * dt) / 2, y + (k2y * dt) / 2);
    const [k4x, k4y] = vectorField(x + k3x * dt, y + k3y * dt);

    x += ((k1x + 2 * k2x + 2 * k3x + k4x) * dt) / 6;
    y += ((k1y + 2 * k2y + 2 * k3y + k4y) * dt) / 6;

    // Check if out of bounds
    if (x < domain.xMin || x > domain.xMax || y < domain.yMin || y > domain.yMax) {
      break;
    }

    points.push([x, y]);
  }

  return points;
}

// ----------------------------------------------------------------
// Collision Detection and Precomputation
// ----------------------------------------------------------------

/**
 * Check if a point is in a grid cell that's already occupied.
 */
function getGridCell(
  point: [number, number],
  gridNx: number,
  gridNy: number,
  domain: Domain
): [number, number] {
  const cellX = Math.floor(
    ((point[0] - domain.xMin) / (domain.xMax - domain.xMin)) * gridNx
  );
  const cellY = Math.floor(
    ((point[1] - domain.yMin) / (domain.yMax - domain.yMin)) * gridNy
  );
  return [
    Math.max(0, Math.min(gridNx - 1, cellX)),
    Math.max(0, Math.min(gridNy - 1, cellY)),
  ];
}

/**
 * Precompute pathlines with collision detection for the right panel.
 *
 * For each pathline:
 * - Integrate fully for the left panel
 * - For the right panel, check each step for collision and truncate if collision occurs
 * - Only collides with cells occupied by OTHER pathlines (not self-collision)
 */
export function precomputeWithCollisions(
  vectorField: VectorFieldFn,
  seedPoints: [number, number][],
  gridNx: number,
  gridNy: number,
  domain: Domain,
  numSteps: number = 100,
  dt: number = 0.05
): PrecomputedData {
  const fullPathlines: number[][][] = [];
  const truncatedPathlines: number[][][] = [];
  const collisionEvents: CollisionEvent[] = [];
  const survivingPathlineIndices: number[] = [];

  // Track occupied cells for collision detection: cellKey -> pathlineIndex that owns it
  const occupiedCells = new Map<string, number>();

  for (let i = 0; i < seedPoints.length; i++) {
    const seedPoint = seedPoints[i];

    // Integrate full pathline for left panel
    const fullPathline = integratePathline(
      vectorField,
      seedPoint,
      numSteps,
      dt,
      domain
    );
    fullPathlines.push(fullPathline);

    // For right panel: check for collisions step by step
    let truncatedPathline: number[][] = [[seedPoint[0], seedPoint[1]]];
    let collided = false;
    let collisionStep = -1;
    let collisionCell: [number, number] = [0, 0];

    // Track cells occupied by THIS pathline (for self-collision avoidance)
    const selfOccupiedCells = new Set<string>();

    let x = seedPoint[0];
    let y = seedPoint[1];

    // Mark starting cell as self-occupied
    const startCell = getGridCell([seedPoint[0], seedPoint[1]], gridNx, gridNy, domain);
    selfOccupiedCells.add(`${startCell[0]},${startCell[1]}`);

    for (let step = 0; step < numSteps && !collided; step++) {
      // RK4 integration
      const [k1x, k1y] = vectorField(x, y);
      const [k2x, k2y] = vectorField(x + (k1x * dt) / 2, y + (k1y * dt) / 2);
      const [k3x, k3y] = vectorField(x + (k2x * dt) / 2, y + (k2y * dt) / 2);
      const [k4x, k4y] = vectorField(x + k3x * dt, y + k3y * dt);

      x += ((k1x + 2 * k2x + 2 * k3x + k4x) * dt) / 6;
      y += ((k1y + 2 * k2y + 2 * k3y + k4y) * dt) / 6;

      // Check bounds
      if (x < domain.xMin || x > domain.xMax || y < domain.yMin || y > domain.yMax) {
        break;
      }

      // Check for collision with OTHER pathlines (not self)
      const cell = getGridCell([x, y], gridNx, gridNy, domain);
      const cellKey = `${cell[0]},${cell[1]}`;

      // Skip if this is a cell we already occupy (self-collision)
      if (selfOccupiedCells.has(cellKey)) {
        truncatedPathline.push([x, y]);
        continue;
      }

      // Check if another pathline occupies this cell
      if (occupiedCells.has(cellKey)) {
        // Collision with different pathline detected!
        collided = true;
        collisionStep = step;
        collisionCell = cell;
      } else {
        // Mark cell as occupied by this pathline
        occupiedCells.set(cellKey, i);
        selfOccupiedCells.add(cellKey);
        truncatedPathline.push([x, y]);
      }
    }

    truncatedPathlines.push(truncatedPathline);

    if (collided) {
      collisionEvents.push({
        pathlineIndex: i,
        step: collisionStep,
        gridCell: collisionCell,
      });
    } else {
      survivingPathlineIndices.push(i);
    }
  }

  return {
    fullPathlines,
    truncatedPathlines,
    collisionEvents,
    survivingPathlineIndices,
  };
}

// ----------------------------------------------------------------
// Seed Point Generation
// ----------------------------------------------------------------

/**
 * Generate random seed points within a domain.
 */
export function generateSeedPoints(
  numPoints: number,
  domain: Domain,
  margin: number = 0.1
): [number, number][] {
  const points: [number, number][] = [];
  const width = domain.xMax - domain.xMin;
  const height = domain.yMax - domain.yMin;

  for (let i = 0; i < numPoints; i++) {
    const x = domain.xMin + margin * width + Math.random() * width * (1 - 2 * margin);
    const y = domain.yMin + margin * height + Math.random() * height * (1 - 2 * margin);
    points.push([x, y]);
  }

  return points;
}

// ----------------------------------------------------------------
// Bounding Box Computation
// ----------------------------------------------------------------

/**
 * Compute the bounding box of a set of pathlines with optional padding.
 */
export function computeBoundingBox(
  pathlines: number[][][],
  padding: number = 0.1
): Domain {
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;

  for (const pathline of pathlines) {
    for (const point of pathline) {
      xMin = Math.min(xMin, point[0]);
      xMax = Math.max(xMax, point[0]);
      yMin = Math.min(yMin, point[1]);
      yMax = Math.max(yMax, point[1]);
    }
  }

  // Handle empty case
  if (!isFinite(xMin)) {
    return { xMin: -1, xMax: 1, yMin: -1, yMax: 1 };
  }

  // Add padding as fraction of range
  const xRange = xMax - xMin;
  const yRange = yMax - yMin;
  const xPad = xRange * padding;
  const yPad = yRange * padding;

  return {
    xMin: xMin - xPad,
    xMax: xMax + xPad,
    yMin: yMin - yPad,
    yMax: yMax + yPad,
  };
}
