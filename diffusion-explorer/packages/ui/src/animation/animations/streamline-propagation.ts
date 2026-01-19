/**
 * Streamline propagation algorithm for time-varying vector fields.
 *
 * Takes streamlines generated at t=0 and propagates them through time
 * by integrating each point along its trajectory using the ODE dx/dt = v(x, t).
 *
 * This creates smooth, visually stable animations of time-varying fields
 * by maintaining connectivity of the original streamline structure.
 */

import { generateStreamlines, generateStreamlinePath2D, type StreamlineOptions, type VectorFieldFn } from '../../plotting/streamlines';

/**
 * A time-varying vector field function.
 * Returns velocity [vx, vy] at position (x, y) and time t.
 */
export type TimeVaryingVectorFieldFn = (x: number, y: number, t: number) => [number, number];

/**
 * Data structure for propagated streamlines over time.
 */
export interface PropagatedStreamlineData {
  /** curves[timeIndex][streamlineIndex][pointIndex] = [x, y] */
  curves: number[][][][];
  /** Array of time values (0 to 1) */
  timeSteps: number[];
  /** Number of streamlines */
  numStreamlines: number;
  /** Number of points per streamline */
  numPointsPerStreamline: number;
  /** Total number of time steps */
  numTimeSteps: number;
}

/**
 * Data structure for discrete streamline snapshots.
 */
export interface DiscreteStreamlineData {
  /** snapshots[snapshotIndex][streamlineIndex][pointIndex] = [x, y] */
  snapshots: number[][][][];
  /** Array of time values for each snapshot (e.g., [0, 0.1, 0.2, ..., 1.0]) */
  timeSnapshots: number[];
}

/**
 * Options for streamline propagation.
 */
export interface PropagateOptions {
  /** Number of time steps for propagation (default: 100) */
  numTimeSteps?: number;
  /** Number of points to sample per streamline (default: 60) */
  pointsPerStreamline?: number;
  /** ODE integration method (default: 'euler') */
  integrationMethod?: 'euler' | 'rk2';
}

/**
 * Compute the total arc length of a streamline.
 */
function computeArcLength(streamline: number[][]): number {
  let length = 0;
  for (let i = 1; i < streamline.length; i++) {
    const dx = streamline[i][0] - streamline[i - 1][0];
    const dy = streamline[i][1] - streamline[i - 1][1];
    length += Math.sqrt(dx * dx + dy * dy);
  }
  return length;
}

/**
 * Sample a streamline uniformly by arc length.
 *
 * @param streamline - Original streamline points
 * @param numPoints - Number of points to sample
 * @returns Uniformly sampled streamline
 */
export function sampleStreamlineUniformly(
  streamline: number[][],
  numPoints: number
): number[][] {
  if (streamline.length < 2) return streamline;
  if (numPoints <= 2) {
    return [streamline[0], streamline[streamline.length - 1]];
  }

  const totalLength = computeArcLength(streamline);
  if (totalLength === 0) return [streamline[0]];

  const result: number[][] = [];
  const segmentLength = totalLength / (numPoints - 1);

  // Always include first point
  result.push([...streamline[0]]);

  let currentDist = 0;
  let targetDist = segmentLength;
  let segmentStart = 0;

  for (let i = 1; i < streamline.length && result.length < numPoints; i++) {
    const [x0, y0] = streamline[i - 1];
    const [x1, y1] = streamline[i];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.sqrt(dx * dx + dy * dy);

    const segEnd = currentDist + len;

    // Place points within this segment
    while (targetDist <= segEnd && result.length < numPoints - 1) {
      const t = (targetDist - currentDist) / len;
      result.push([x0 + t * dx, y0 + t * dy]);
      targetDist += segmentLength;
    }

    currentDist = segEnd;
  }

  // Always include last point
  result.push([...streamline[streamline.length - 1]]);

  return result;
}

/**
 * Propagate a set of initial streamlines through time.
 *
 * Algorithm:
 * 1. For each streamline, sample it densely into `pointsPerStreamline` points
 * 2. For each time step from t=0 to t=1:
 *    - For each point, compute new position: p' = p + dt * v(p, t)
 *    - Store the curve (connected points) at this time step
 *
 * @param initialStreamlines - Streamlines computed at t=0
 * @param vectorField - Time-varying vector field v(x, y, t)
 * @param options - Configuration options
 * @returns PropagatedStreamlineData with curves at each time step
 */
export function propagateStreamlines(
  initialStreamlines: number[][][],
  vectorField: TimeVaryingVectorFieldFn,
  options?: PropagateOptions
): PropagatedStreamlineData {
  const {
    numTimeSteps = 100,
    pointsPerStreamline = 60,
    integrationMethod = 'euler'
  } = options ?? {};

  // 1. Sample each streamline uniformly
  const sampledStreamlines = initialStreamlines.map(s =>
    sampleStreamlineUniformly(s, pointsPerStreamline)
  );

  // 2. Initialize output structure
  const curves: number[][][][] = [];
  const dt = 1 / numTimeSteps;
  const timeSteps: number[] = [];

  // 3. Store initial streamlines at t=0
  curves.push(sampledStreamlines.map(s => s.map(p => [...p])));
  timeSteps.push(0);

  // 4. Current state of all points
  let currentPoints = sampledStreamlines.map(s => s.map(p => [...p]));

  // 5. Integrate forward in time
  for (let step = 1; step <= numTimeSteps; step++) {
    const t = (step - 1) * dt;

    const nextPoints = currentPoints.map(streamline =>
      streamline.map(point => {
        if (integrationMethod === 'euler') {
          const [vx, vy] = vectorField(point[0], point[1], t);
          return [point[0] + dt * vx, point[1] + dt * vy];
        } else {
          // RK2 (midpoint method)
          const [vx, vy] = vectorField(point[0], point[1], t);
          const midX = point[0] + 0.5 * dt * vx;
          const midY = point[1] + 0.5 * dt * vy;
          const tMid = t + 0.5 * dt;
          const [vmx, vmy] = vectorField(midX, midY, tMid);
          return [point[0] + dt * vmx, point[1] + dt * vmy];
        }
      })
    );

    curves.push(nextPoints.map(s => s.map(p => [...p])));
    timeSteps.push(step * dt);
    currentPoints = nextPoints;
  }

  return {
    curves,
    timeSteps,
    numStreamlines: sampledStreamlines.length,
    numPointsPerStreamline: pointsPerStreamline,
    numTimeSteps: curves.length
  };
}

/**
 * Generate discrete streamline snapshots at fixed time intervals.
 *
 * @param vectorField - Time-varying vector field v(x, y, t)
 * @param domain - Domain bounds
 * @param timeSnapshots - Array of time values to compute streamlines at
 * @param streamlineOptions - Options passed to generateStreamlines
 * @returns DiscreteStreamlineData with streamlines at each snapshot time
 */
export function generateDiscreteStreamlines(
  vectorField: TimeVaryingVectorFieldFn,
  domain: { xMin: number; xMax: number; yMin: number; yMax: number },
  timeSnapshots: number[],
  streamlineOptions?: Partial<StreamlineOptions>
): DiscreteStreamlineData {
  const snapshots = timeSnapshots.map(t => {
    // Create a frozen vector field at time t
    const frozenField: VectorFieldFn = (x, y) => vectorField(x, y, t);

    return generateStreamlines(frozenField, {
      domainMin: [domain.xMin, domain.yMin],
      domainMax: [domain.xMax, domain.yMax],
      ...streamlineOptions
    });
  });

  return {
    snapshots,
    timeSnapshots
  };
}

/**
 * Interpolate propagated curves at an arbitrary time value.
 *
 * @param data - Propagated streamline data
 * @param t - Time value (0-1)
 * @returns Interpolated curves at time t
 */
export function interpolateCurves(
  data: PropagatedStreamlineData,
  t: number
): number[][][] {
  const { curves, timeSteps } = data;

  // Clamp t to valid range
  const clampedT = Math.max(0, Math.min(1, t));

  // Find bounding time indices
  const idx = clampedT * (timeSteps.length - 1);
  const i0 = Math.floor(idx);
  const i1 = Math.min(i0 + 1, timeSteps.length - 1);

  // If at exact time step, return that directly
  if (i0 === i1 || idx === i0) {
    return curves[i0].map(s => s.map(p => [...p]));
  }

  // Linearly interpolate between curves[i0] and curves[i1]
  const frac = idx - i0;
  const curves0 = curves[i0];
  const curves1 = curves[i1];

  return curves0.map((streamline, si) =>
    streamline.map((point, pi) => [
      point[0] + frac * (curves1[si][pi][0] - point[0]),
      point[1] + frac * (curves1[si][pi][1] - point[1])
    ])
  );
}

/**
 * Get the discrete snapshot for a given time value.
 * Returns the snapshot whose time is <= t.
 *
 * @param data - Discrete streamline data
 * @param t - Time value (0-1)
 * @returns The curves and snapshot index
 */
export function getDiscreteSnapshot(
  data: DiscreteStreamlineData,
  t: number
): { curves: number[][][]; index: number } {
  const { snapshots, timeSnapshots } = data;

  // Find the snapshot whose time is <= t
  let idx = 0;
  for (let i = 0; i < timeSnapshots.length; i++) {
    if (timeSnapshots[i] <= t) {
      idx = i;
    } else {
      break;
    }
  }

  return {
    curves: snapshots[idx],
    index: idx
  };
}

/**
 * Pre-compute Path2D objects for all time steps of propagated streamlines.
 *
 * This allows efficient per-frame rendering by just selecting the appropriate
 * pre-computed path instead of rebuilding geometry each frame.
 *
 * @param data - Propagated streamline data
 * @param toPixel - Coordinate transform from domain to pixel coordinates
 * @returns Array of Path2D objects, one per time step
 */
export function precomputePropagatedPaths(
  data: PropagatedStreamlineData,
  toPixel: (p: [number, number]) => [number, number]
): Path2D[] {
  return data.curves.map((curvesAtTime) => {
    const pixelCurves = curvesAtTime.map((curve) =>
      curve.map((p) => toPixel(p as [number, number]))
    );
    return generateStreamlinePath2D(pixelCurves);
  });
}

/**
 * Pre-compute Path2D objects for all snapshots of discrete streamlines.
 *
 * @param data - Discrete streamline data
 * @param toPixel - Coordinate transform from domain to pixel coordinates
 * @returns Array of Path2D objects, one per snapshot
 */
export function precomputeDiscretePaths(
  data: DiscreteStreamlineData,
  toPixel: (p: [number, number]) => [number, number]
): Path2D[] {
  return data.snapshots.map((snapshotCurves) => {
    const pixelCurves = snapshotCurves.map((curve) =>
      curve.map((p) => toPixel(p as [number, number]))
    );
    return generateStreamlinePath2D(pixelCurves);
  });
}

/**
 * Get the path index for a given time value in propagated data.
 * Snaps to the nearest stored time step.
 *
 * @param data - Propagated streamline data
 * @param t - Time value (0-1)
 * @returns Index into the paths array
 */
export function getPropagatedPathIndex(
  data: PropagatedStreamlineData,
  t: number
): number {
  const clampedT = Math.max(0, Math.min(1, t));
  return Math.round(clampedT * (data.numTimeSteps - 1));
}

/**
 * Get the path index for a given time value in discrete data.
 * Returns the index of the snapshot whose time is <= t.
 *
 * @param data - Discrete streamline data
 * @param t - Time value (0-1)
 * @returns Index into the paths array
 */
export function getDiscretePathIndex(
  data: DiscreteStreamlineData,
  t: number
): number {
  const { timeSnapshots } = data;
  let idx = 0;
  for (let i = 0; i < timeSnapshots.length; i++) {
    if (timeSnapshots[i] <= t) {
      idx = i;
    } else {
      break;
    }
  }
  return idx;
}
