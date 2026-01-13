/**
 * Streamline generation for 2D vector fields.
 *
 * Based on matplotlib's streamplot algorithm:
 * - Uses RK12 (Heun's method) with adaptive step size for integration
 * - Density-based mask grid controls streamline spacing (density=1 → 30x30 grid)
 * - Spiral seeding pattern from boundary inward for even coverage
 * - Supports user-specified start points for custom seeding
 */

/**
 * Options for selecting trajectories with a density mask.
 */
export interface SelectTrajectoriesOptions {
  /** Domain bounds [xMin, yMin] */
  domainMin: [number, number];
  /** Domain bounds [xMax, yMax] */
  domainMax: [number, number];
  /** Controls grid density (default 1.0 -> 30x30 grid) */
  density?: number;
  /** Maximum number of trajectories to select */
  maxCount?: number;
}

/**
 * Select evenly-spaced trajectories using a density mask.
 * Similar to streamline generation, but for pre-computed trajectories.
 *
 * @param pathlines - Array of pathlines, each is [[x,y], [x,y], ...]
 * @param options - Configuration options
 * @returns Selected pathlines that are spatially well-distributed
 */
export function selectTrajectoriesWithMask(
  pathlines: number[][][],
  options: SelectTrajectoriesOptions
): number[][][] {
  const { domainMin, domainMax, density = 1.0, maxCount = Infinity } = options;

  // Create mask grid (same sizing as StreamMask)
  const gridSize = Math.max(1, Math.floor(30 * density));
  const mask = new Uint8Array(gridSize * gridSize);

  // Scale functions to map data coords to grid coords
  const xRange = domainMax[0] - domainMin[0];
  const yRange = domainMax[1] - domainMin[1];
  const toGridX = (x: number) =>
    Math.max(0, Math.min(gridSize - 1, Math.floor(((x - domainMin[0]) / xRange) * gridSize)));
  const toGridY = (y: number) =>
    Math.max(0, Math.min(gridSize - 1, Math.floor(((y - domainMin[1]) / yRange) * gridSize)));

  const selected: number[][][] = [];

  for (const pathline of pathlines) {
    if (selected.length >= maxCount) break;

    // Check how many points pass through unoccupied cells
    let unoccupiedCount = 0;
    const cellsToMark: Set<number> = new Set();

    for (const point of pathline) {
      const gx = toGridX(point[0]);
      const gy = toGridY(point[1]);
      const idx = gy * gridSize + gx;

      if (mask[idx] === 0) {
        unoccupiedCount++;
        cellsToMark.add(idx);
      }
    }

    // Accept if most cells are unoccupied (trajectory passes through new areas)
    if (unoccupiedCount > pathline.length * 0.5) {
      selected.push(pathline);
      for (const idx of cellsToMark) {
        mask[idx] = 1;
      }
    }
  }

  return selected;
}

export type VectorFieldFn = (x: number, y: number) => [number, number];

/**
 * Options for streamline generation.
 */
export interface StreamlineOptions {
  domainMin: [number, number];                 // Domain bounds [xMin, yMin]
  domainMax: [number, number];                 // Domain bounds [xMax, yMax]
  density?: number | [number, number];         // Default: 1.0 -> 30x30 mask grid
  integrationDirection?: 'forward' | 'backward' | 'both';  // Default: 'both'
  maxlength?: number;                          // Max streamline length in domain units
  minlength?: number;                          // Min length to keep (reject shorter)
  startPoints?: [number, number][];            // User-specified seeds (optional)
  brokenStreamlines?: boolean;                 // Stop at collisions (default: true)
  maxerror?: number;                           // RK12 error tolerance (default: 0.003)
  segmentLength?: number;                      // If provided, resample to equal-length segments
}

/**
 * Mask to track which cells have been traversed by streamlines.
 * Each cell can have at most one traversing streamline.
 */
class StreamMask {
  readonly nx: number;
  readonly ny: number;
  private mask: Uint8Array;
  private trajectory: Array<[number, number]>;
  private currentXY: [number, number] | null;

  constructor(density: number | [number, number]) {
    const [dx, dy] = Array.isArray(density) ? density : [density, density];
    this.nx = Math.max(1, Math.floor(30 * dx));
    this.ny = Math.max(1, Math.floor(30 * dy));
    this.mask = new Uint8Array(this.nx * this.ny);
    this.trajectory = [];
    this.currentXY = null;
  }

  private index(xm: number, ym: number): number {
    return ym * this.nx + xm;
  }

  isOccupied(xm: number, ym: number): boolean {
    if (xm < 0 || xm >= this.nx || ym < 0 || ym >= this.ny) return true;
    return this.mask[this.index(xm, ym)] !== 0;
  }

  startTrajectory(xm: number, ym: number, brokenStreamlines: boolean): boolean {
    this.trajectory = [];
    return this.updateTrajectory(xm, ym, brokenStreamlines);
  }

  updateTrajectory(xm: number, ym: number, brokenStreamlines: boolean): boolean {
    const xy: [number, number] = [xm, ym];

    if (this.currentXY === null || this.currentXY[0] !== xm || this.currentXY[1] !== ym) {
      if (!this.isOccupied(xm, ym)) {
        this.trajectory.push(xy);
        this.mask[this.index(xm, ym)] = 1;
        this.currentXY = xy;
        return true;
      } else {
        if (brokenStreamlines) {
          return false; // Collision - terminate
        }
        // Continue without marking (non-broken mode)
        return true;
      }
    }
    return true;
  }

  undoTrajectory(): void {
    for (const [xm, ym] of this.trajectory) {
      this.mask[this.index(xm, ym)] = 0;
    }
    this.trajectory = [];
    this.currentXY = null;
  }

  resetCurrentXY(xm: number, ym: number): void {
    this.currentXY = [xm, ym];
  }
}

/**
 * Coordinate transformation between data, grid, and mask coordinates.
 */
class DomainMap {
  private mask: StreamMask;
  private domainMin: [number, number];

  // Grid dimensions (number of samples in velocity field)
  readonly nx: number;
  readonly ny: number;

  // Domain dimensions
  readonly width: number;
  readonly height: number;

  // Conversion factors (public for use in integration)
  readonly x_data2grid: number;
  readonly y_data2grid: number;
  private x_grid2mask: number;
  private y_grid2mask: number;
  private x_mask2grid: number;
  private y_mask2grid: number;

  constructor(
    domainMin: [number, number],
    domainMax: [number, number],
    mask: StreamMask,
    gridResolution: number = 100  // Number of grid cells for integration
  ) {
    this.mask = mask;
    this.domainMin = domainMin;

    this.width = domainMax[0] - domainMin[0];
    this.height = domainMax[1] - domainMin[1];

    // Use a virtual grid for integration coordinates
    this.nx = gridResolution;
    this.ny = gridResolution;

    // Data to grid conversion
    this.x_data2grid = (this.nx - 1) / this.width;
    this.y_data2grid = (this.ny - 1) / this.height;

    // Grid to mask conversion
    this.x_grid2mask = (mask.nx - 1) / (this.nx - 1);
    this.y_grid2mask = (mask.ny - 1) / (this.ny - 1);
    this.x_mask2grid = 1 / this.x_grid2mask;
    this.y_mask2grid = 1 / this.y_grid2mask;
  }

  data2grid(x: number, y: number): [number, number] {
    const xi = (x - this.domainMin[0]) * this.x_data2grid;
    const yi = (y - this.domainMin[1]) * this.y_data2grid;
    return [xi, yi];
  }

  grid2data(xi: number, yi: number): [number, number] {
    const x = xi / this.x_data2grid + this.domainMin[0];
    const y = yi / this.y_data2grid + this.domainMin[1];
    return [x, y];
  }

  grid2mask(xi: number, yi: number): [number, number] {
    return [Math.round(xi * this.x_grid2mask), Math.round(yi * this.y_grid2mask)];
  }

  mask2grid(xm: number, ym: number): [number, number] {
    return [xm * this.x_mask2grid, ym * this.y_mask2grid];
  }

  isWithinGrid(xi: number, yi: number): boolean {
    return xi >= 0 && xi <= this.nx - 1 && yi >= 0 && yi <= this.ny - 1;
  }

  startTrajectory(xi: number, yi: number, brokenStreamlines: boolean): boolean {
    const [xm, ym] = this.grid2mask(xi, yi);
    return this.mask.startTrajectory(xm, ym, brokenStreamlines);
  }

  updateTrajectory(xi: number, yi: number, brokenStreamlines: boolean): boolean {
    const [xm, ym] = this.grid2mask(xi, yi);
    return this.mask.updateTrajectory(xm, ym, brokenStreamlines);
  }

  resetStartPoint(xi: number, yi: number): void {
    const [xm, ym] = this.grid2mask(xi, yi);
    this.mask.resetCurrentXY(xm, ym);
  }

  undoTrajectory(): void {
    this.mask.undoTrajectory();
  }

  isMaskOccupied(xm: number, ym: number): boolean {
    return this.mask.isOccupied(xm, ym);
  }

  getMask(): StreamMask {
    return this.mask;
  }
}

/**
 * 2nd-order Runge-Kutta integration with adaptive step size (Heun's method).
 */
function integrateRK12(
  vectorField: VectorFieldFn,
  dmap: DomainMap,
  x0: number,
  y0: number,
  direction: 1 | -1,
  maxlength: number,
  options: {
    maxerror: number;
    brokenStreamlines: boolean;
  }
): { points: number[][]; length: number } {
  const { maxerror, brokenStreamlines } = options;
  const mask = dmap.getMask();

  // Max step size based on mask resolution
  const maxds = Math.min(1 / mask.nx, 1 / mask.ny, 0.1);

  let ds = maxds;
  let stotal = 0;
  let [xi, yi] = dmap.data2grid(x0, y0);
  const points: number[][] = [[x0, y0]];

  const maxSteps = 10000; // Safety limit

  for (let step = 0; step < maxSteps && stotal < maxlength; step++) {
    // Get velocity at current position
    const [x, y] = dmap.grid2data(xi, yi);
    const [vx, vy] = vectorField(x, y);
    const speed = Math.sqrt(vx * vx + vy * vy);

    // Check for stagnation point
    if (speed < 1e-10) {
      break;
    }

    // Scale velocity to grid coordinates
    const k1x = direction * vx * dmap.x_data2grid;
    const k1y = direction * vy * dmap.y_data2grid;

    // Trial step
    const xiTrial = xi + ds * k1x;
    const yiTrial = yi + ds * k1y;

    // Get velocity at trial position
    const [xTrial, yTrial] = dmap.grid2data(xiTrial, yiTrial);
    const [vxTrial, vyTrial] = vectorField(xTrial, yTrial);
    const k2x = direction * vxTrial * dmap.x_data2grid;
    const k2y = direction * vyTrial * dmap.y_data2grid;

    // Euler estimate
    const dx1 = ds * k1x;
    const dy1 = ds * k1y;

    // RK2 estimate (Heun's method)
    const dx2 = ds * 0.5 * (k1x + k2x);
    const dy2 = ds * 0.5 * (k1y + k2y);

    // Error normalized to grid coordinates
    const error = Math.sqrt(
      Math.pow((dx2 - dx1) / (dmap.nx - 1), 2) +
      Math.pow((dy2 - dy1) / (dmap.ny - 1), 2)
    );

    // Only accept step if within error tolerance
    if (error < maxerror) {
      const xiNew = xi + dx2;
      const yiNew = yi + dy2;

      // Check bounds - if stepping out, find boundary crossing and terminate
      if (!dmap.isWithinGrid(xiNew, yiNew)) {
        // Compute intersection with grid boundary from current position
        // We're at (xi, yi) inside, stepping to (xiNew, yiNew) outside
        const dxi = xiNew - xi;
        const dyi = yiNew - yi;

        // Find parameter t where we cross each boundary
        let tMin = 1.0;

        // Left boundary (x = 0)
        if (dxi < 0 && xiNew < 0) {
          const t = -xi / dxi;
          if (t > 0 && t < tMin) tMin = t;
        }
        // Right boundary (x = nx-1)
        if (dxi > 0 && xiNew > dmap.nx - 1) {
          const t = (dmap.nx - 1 - xi) / dxi;
          if (t > 0 && t < tMin) tMin = t;
        }
        // Bottom boundary (y = 0)
        if (dyi < 0 && yiNew < 0) {
          const t = -yi / dyi;
          if (t > 0 && t < tMin) tMin = t;
        }
        // Top boundary (y = ny-1)
        if (dyi > 0 && yiNew > dmap.ny - 1) {
          const t = (dmap.ny - 1 - yi) / dyi;
          if (t > 0 && t < tMin) tMin = t;
        }

        // Add boundary point if valid
        if (tMin > 0 && tMin < 1) {
          const xiBoundary = xi + dxi * tMin;
          const yiBoundary = yi + dyi * tMin;
          const [xBoundary, yBoundary] = dmap.grid2data(xiBoundary, yiBoundary);
          points.push([xBoundary, yBoundary]);
          stotal += Math.sqrt(dxi * dxi + dyi * dyi) * tMin;
        }
        break;
      }

      // Update mask
      if (!dmap.updateTrajectory(xiNew, yiNew, brokenStreamlines)) {
        break; // Collision
      }

      // Accept step
      xi = xiNew;
      yi = yiNew;
      const [xNew, yNew] = dmap.grid2data(xi, yi);
      points.push([xNew, yNew]);
      stotal += Math.sqrt(dx2 * dx2 + dy2 * dy2);
    }

    // Adjust step size based on error
    if (error === 0) {
      ds = maxds;
    } else {
      ds = Math.min(maxds, 0.85 * ds * Math.sqrt(maxerror / error));
    }
  }

  return { points, length: stotal };
}

/**
 * Generate starting points in a spiral pattern from boundary inward.
 * This produces higher quality streamlines by starting at edges.
 */
function* spiralStartingPoints(mask: StreamMask): Generator<[number, number]> {
  const nx = mask.nx;
  const ny = mask.ny;

  let x = 0, y = 0;
  let direction: 'right' | 'up' | 'left' | 'down' = 'right';
  let xFirst = 0, yFirst = 1;
  let xLast = nx - 1, yLast = ny - 1;

  for (let i = 0; i < nx * ny; i++) {
    yield [x, y];

    switch (direction) {
      case 'right':
        x++;
        if (x >= xLast) {
          xLast--;
          direction = 'up';
        }
        break;
      case 'up':
        y++;
        if (y >= yLast) {
          yLast--;
          direction = 'left';
        }
        break;
      case 'left':
        x--;
        if (x <= xFirst) {
          xFirst++;
          direction = 'down';
        }
        break;
      case 'down':
        y--;
        if (y <= yFirst) {
          yFirst++;
          direction = 'right';
        }
        break;
    }
  }
}

/**
 * Compute total path length of a streamline.
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
 * Integrate a single streamline forward and/or backward.
 */
function integrateStreamline(
  vectorField: VectorFieldFn,
  dmap: DomainMap,
  x0: number,
  y0: number,
  xi: number,
  yi: number,
  integrationDirection: 'forward' | 'backward' | 'both',
  maxlength: number,
  options: { maxerror: number; brokenStreamlines: boolean }
): number[][] | null {
  // Start trajectory
  if (!dmap.startTrajectory(xi, yi, options.brokenStreamlines)) {
    return null;
  }

  let forward: { points: number[][]; length: number } | null = null;
  let backward: { points: number[][]; length: number } | null = null;

  // Integrate backward first
  if (integrationDirection === 'backward' || integrationDirection === 'both') {
    backward = integrateRK12(vectorField, dmap, x0, y0, -1, maxlength, options);
  }

  // Reset to start point before forward integration
  if (integrationDirection === 'both') {
    dmap.resetStartPoint(xi, yi);
  }

  // Integrate forward
  if (integrationDirection === 'forward' || integrationDirection === 'both') {
    forward = integrateRK12(vectorField, dmap, x0, y0, 1, maxlength, options);
  }

  // Combine streamline
  const streamline: number[][] = [];

  if (backward && backward.points.length > 1) {
    // Add backward points in reverse (excluding the starting point)
    for (let i = backward.points.length - 1; i >= 1; i--) {
      streamline.push(backward.points[i]);
    }
  }

  streamline.push([x0, y0]);

  if (forward && forward.points.length > 1) {
    // Add forward points (excluding the starting point)
    for (let i = 1; i < forward.points.length; i++) {
      streamline.push(forward.points[i]);
    }
  }

  return streamline.length > 1 ? streamline : null;
}

/**
 * Generate evenly-spaced streamlines for a 2D vector field.
 *
 * @param vectorField - Function that returns velocity [vx, vy] at position (x, y)
 * @param options - Configuration options
 * @returns Array of streamlines, each streamline is an array of [x, y] points
 */
export function generateStreamlines(
  vectorField: VectorFieldFn,
  options: StreamlineOptions
): number[][][] {
  const {
    domainMin,
    domainMax,
    density = 1.0,
    integrationDirection = 'both',
    maxlength = Infinity,
    minlength = 0,
    startPoints,
    brokenStreamlines = true,
    maxerror = 0.003,
    segmentLength
  } = options;

  // Initialize mask and domain map
  const mask = new StreamMask(density);
  const dmap = new DomainMap(domainMin, domainMax, mask);

  const streamlines: number[][][] = [];

  // Effective maxlength per direction
  const dirMaxlength = integrationDirection === 'both' ? maxlength / 2 : maxlength;

  // Process seeds
  if (startPoints && startPoints.length > 0) {
    // User-specified start points
    for (const [x0, y0] of startPoints) {
      // Check bounds
      if (x0 < domainMin[0] || x0 > domainMax[0] ||
          y0 < domainMin[1] || y0 > domainMax[1]) {
        continue;
      }

      const [xi, yi] = dmap.data2grid(x0, y0);
      const [xm, ym] = dmap.grid2mask(xi, yi);

      if (mask.isOccupied(xm, ym)) {
        continue;
      }

      const streamline = integrateStreamline(
        vectorField, dmap, x0, y0, xi, yi,
        integrationDirection, dirMaxlength, { maxerror, brokenStreamlines }
      );

      if (streamline && computePathLength(streamline) >= minlength) {
        streamlines.push(streamline);
      } else {
        dmap.undoTrajectory();
      }
    }
  } else {
    // Automatic seeding using spiral pattern
    for (const [xm, ym] of spiralStartingPoints(mask)) {
      if (mask.isOccupied(xm, ym)) {
        continue;
      }

      const [xi, yi] = dmap.mask2grid(xm, ym);
      const [x0, y0] = dmap.grid2data(xi, yi);

      const streamline = integrateStreamline(
        vectorField, dmap, x0, y0, xi, yi,
        integrationDirection, dirMaxlength, { maxerror, brokenStreamlines }
      );

      if (streamline && computePathLength(streamline) >= minlength) {
        streamlines.push(streamline);
      } else {
        dmap.undoTrajectory();
      }
    }
  }

  // Resample if segmentLength specified
  if (segmentLength !== undefined) {
    return streamlines.map(s => resampleStreamline(s, segmentLength));
  }

  return streamlines;
}

/**
 * Resample a streamline to have approximately equal-length segments.
 *
 * @param streamline - Array of [x, y] points
 * @param segmentLength - Desired length of each segment (in domain units)
 * @returns Resampled streamline with equal-length segments
 */
function resampleStreamline(
  streamline: number[][],
  segmentLength: number
): number[][] {
  if (streamline.length < 2) return streamline;

  const result: number[][] = [streamline[0]];
  let accumulatedLength = 0;
  let prevPoint = streamline[0];

  for (let i = 1; i < streamline.length; i++) {
    const currPoint = streamline[i];
    const dx = currPoint[0] - prevPoint[0];
    const dy = currPoint[1] - prevPoint[1];
    const segLen = Math.sqrt(dx * dx + dy * dy);

    if (segLen === 0) continue;

    // Direction unit vector
    const ux = dx / segLen;
    const uy = dy / segLen;

    // Walk along this segment, placing points at segmentLength intervals
    let remaining = segLen;
    let startX = prevPoint[0];
    let startY = prevPoint[1];

    while (remaining > 0) {
      const distToNext = segmentLength - accumulatedLength;

      if (remaining >= distToNext) {
        // Place a point
        startX += ux * distToNext;
        startY += uy * distToNext;
        result.push([startX, startY]);
        remaining -= distToNext;
        accumulatedLength = 0;
      } else {
        // Accumulate and move to next segment
        accumulatedLength += remaining;
        remaining = 0;
      }
    }

    prevPoint = currPoint;
  }

  // Add the final point if it's not too close to the last added point
  const lastAdded = result[result.length - 1];
  const finalPoint = streamline[streamline.length - 1];
  const finalDx = finalPoint[0] - lastAdded[0];
  const finalDy = finalPoint[1] - lastAdded[1];
  const finalDist = Math.sqrt(finalDx * finalDx + finalDy * finalDy);

  if (finalDist > segmentLength * 0.1) {
    result.push(finalPoint);
  }

  return result;
}

/**
 * Compute cumulative lengths along a streamline (in pixel coordinates).
 *
 * @param streamline - Array of [x, y] points in pixel coordinates
 * @returns Object with segmentLengths, cumulativeLengths, and totalLength
 */
export function computeStreamlineLengths(streamline: number[][]): {
  segmentLengths: number[];
  cumulativeLengths: number[];
  totalLength: number;
} {
  const segmentLengths: number[] = [];
  const cumulativeLengths: number[] = [0];
  let totalLength = 0;

  for (let i = 1; i < streamline.length; i++) {
    const dx = streamline[i][0] - streamline[i - 1][0];
    const dy = streamline[i][1] - streamline[i - 1][1];
    const len = Math.sqrt(dx * dx + dy * dy);
    segmentLengths.push(len);
    totalLength += len;
    cumulativeLengths.push(totalLength);
  }

  return { segmentLengths, cumulativeLengths, totalLength };
}

/**
 * Create a lookup table for alpha values across one pulse period.
 *
 * The LUT covers positions from 0 to spacing, with alpha values
 * that fade from 0 at front to baseOpacity at the back of the pulse.
 *
 * @param pulseWidth - Width of the pulse in pixels
 * @param spacing - Total period (pulseWidth + pulsePauseWidth) in pixels
 * @param baseOpacity - Maximum opacity at pulse back
 * @param resolution - Number of entries in the LUT (default 256)
 * @returns Float32Array of alpha values
 */
export function createAlphaLUT(
  pulseWidth: number,
  spacing: number,
  baseOpacity: number,
  resolution: number = 256,
  binary: boolean = false
): Float32Array {
  const lut = new Float32Array(resolution);
  const invPulseWidth = 1 / pulseWidth;

  for (let i = 0; i < resolution; i++) {
    const posInPattern = (i / resolution) * spacing;
    if (posInPattern < pulseWidth) {
      if (binary) {
        // Binary mode: full opacity, no gradient
        lut[i] = baseOpacity;
      } else {
        // Gradient mode: fade from 0 at front to baseOpacity at back
        const u = posInPattern * invPulseWidth; // 0 at front → 1 at back
        lut[i] = baseOpacity * u;
      }
    }
    // else lut[i] stays 0 (gap region)
  }

  return lut;
}

/**
 * Precompute pattern positions for a streamline.
 *
 * Computes (pos % spacing) for each point, normalized to LUT indices.
 * This allows fast lookup during animation.
 *
 * @param cumulativeLengths - Cumulative pixel length at each point
 * @param spacing - Total period (pulseWidth + pulsePauseWidth) in pixels
 * @param lutResolution - Resolution of the alpha LUT
 * @returns Uint16Array of LUT indices for each point
 */
export function precomputePatternIndices(
  cumulativeLengths: number[],
  spacing: number,
  lutResolution: number = 256
): Uint16Array {
  const numPoints = cumulativeLengths.length;
  const indices = new Uint16Array(numPoints);
  const scale = lutResolution / spacing;

  for (let i = 0; i < numPoints; i++) {
    const pos = cumulativeLengths[i];
    const posInPattern = pos % spacing;
    indices[i] = Math.floor(posInPattern * scale) % lutResolution;
  }

  return indices;
}

/**
 * Compute alpha values for animated pulses along a streamline.
 *
 * Uses precomputed pattern indices and LUT for efficient per-frame computation.
 *
 * @param patternIndices - Precomputed LUT indices for each point (from precomputePatternIndices)
 * @param alphaLUT - Precomputed alpha lookup table (from createAlphaLUT)
 * @param phase - Animation phase [0, 1)
 * @param offset - Random phase offset for this streamline (0-1)
 * @param outAlphas - Output buffer for alpha values (reused to avoid allocation)
 */
export function computeAlphaTrail(
  patternIndices: Uint16Array,
  alphaLUT: Float32Array,
  phase: number,
  offset: number,
  outAlphas: Float32Array
): void {
  const numPoints = patternIndices.length;
  const lutResolution = alphaLUT.length;

  // Phase shift in LUT indices
  const shiftAmount = Math.floor(((phase + offset) % 1) * lutResolution);

  for (let i = 0; i < numPoints; i++) {
    // Shift index and wrap around
    let idx = patternIndices[i] - shiftAmount;
    if (idx < 0) idx += lutResolution;
    outAlphas[i] = alphaLUT[idx];
  }
}

/**
 * Chevron style options for direction indicators on streamlines.
 */
export interface ChevronStyle {
  /** Distance between chevrons in pixels (default: 40) */
  spacingPixels?: number;
  /** Length of each chevron leg in pixels (default: 6) */
  size?: number;
  /** Angle from perpendicular in radians (default: Math.PI/6 = 30 degrees) */
  angle?: number;
  /** Stroke width ratio relative to streamline width (default: 0.6) */
  strokeWidthRatio?: number;
}

/**
 * Options for drawing streamlines.
 */
export interface DrawStreamlinesOptions {
  /** Stroke color */
  color: string;
  /** Stroke width in pixels */
  strokeWidth: number;
  /** Opacity (0-1, default: 1) */
  opacity?: number;
  /** Optional chevron direction indicators */
  chevron?: ChevronStyle;
}

/**
 * Private helper to draw chevron direction indicators on streamlines.
 * Batches all chevrons into a single path for efficient rendering.
 */
function _drawChevrons(
  ctx: CanvasRenderingContext2D,
  streamlines: number[][][],
  options: DrawStreamlinesOptions
): void {
  const chevron = options.chevron!;
  const spacingPixels = chevron.spacingPixels ?? 40;
  const size = chevron.size ?? 6;
  const angle = chevron.angle ?? Math.PI / 6; // 30 degrees from perpendicular
  const strokeWidthRatio = chevron.strokeWidthRatio ?? 0.6;

  // Precompute trig values
  const cosAngle = Math.cos(angle);
  const sinAngle = Math.sin(angle);

  ctx.strokeStyle = options.color;
  ctx.lineWidth = options.strokeWidth * strokeWidthRatio;
  ctx.lineCap = 'round';
  ctx.globalAlpha = options.opacity ?? 1;

  // Batch all chevrons into a single path
  ctx.beginPath();

  for (const streamline of streamlines) {
    if (streamline.length < 2) continue;

    // Compute cumulative arc length and place chevrons at fixed intervals
    let cumulativeLength = 0;
    let nextChevronPos = spacingPixels / 2; // Start at half spacing for centering

    for (let i = 1; i < streamline.length; i++) {
      const [x0, y0] = streamline[i - 1];
      const [x1, y1] = streamline[i];
      const dx = x1 - x0;
      const dy = y1 - y0;
      const segmentLength = Math.sqrt(dx * dx + dy * dy);

      if (segmentLength === 0) continue;

      const startLength = cumulativeLength;
      const endLength = cumulativeLength + segmentLength;

      // Place chevrons within this segment
      while (nextChevronPos <= endLength) {
        // Interpolate position along segment
        const t = (nextChevronPos - startLength) / segmentLength;
        const cx = x0 + t * dx;
        const cy = y0 + t * dy;

        // Compute tangent direction (normalized)
        const tx = dx / segmentLength;
        const ty = dy / segmentLength;

        // Perpendicular to tangent
        const perpX = -ty;
        const perpY = tx;

        // Left leg: backward + angled left
        const leftX = -tx * cosAngle + perpX * sinAngle;
        const leftY = -ty * cosAngle + perpY * sinAngle;

        // Right leg: backward + angled right
        const rightX = -tx * cosAngle - perpX * sinAngle;
        const rightY = -ty * cosAngle - perpY * sinAngle;

        // Add chevron to path (moveTo breaks the subpath so each chevron is separate)
        ctx.moveTo(cx + leftX * size, cy + leftY * size);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx + rightX * size, cy + rightY * size);

        nextChevronPos += spacingPixels;
      }

      cumulativeLength = endLength;
    }
  }

  // Single stroke call for all chevrons
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/**
 * Draw streamlines on a canvas context.
 *
 * @param ctx - Canvas 2D rendering context
 * @param streamlines - Array of streamlines in pixel coords: [streamline][point][x,y]
 * @param options - Styling options including optional chevron markers
 */
export function drawStreamlines(
  ctx: CanvasRenderingContext2D,
  streamlines: number[][][],
  options: DrawStreamlinesOptions
): void {
  const startTime = performance.now();
  const { color, strokeWidth, opacity = 1 } = options;

  // Count total points for logging
  let totalPoints = 0;
  for (const s of streamlines) totalPoints += s.length;

  ctx.strokeStyle = color;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = opacity;

  // Draw streamline curves - batched into single path
  const curvesStart = performance.now();
  ctx.beginPath();
  for (const streamline of streamlines) {
    if (streamline.length < 2) continue;

    ctx.moveTo(streamline[0][0], streamline[0][1]);
    for (let i = 1; i < streamline.length; i++) {
      ctx.lineTo(streamline[i][0], streamline[i][1]);
    }
  }
  ctx.stroke();
  const curvesTime = performance.now() - curvesStart;

  // Draw chevrons if specified
  let chevronsTime = 0;
  if (options.chevron) {
    const chevronsStart = performance.now();
    _drawChevrons(ctx, streamlines, options);
    chevronsTime = performance.now() - chevronsStart;
  }

  ctx.globalAlpha = 1;

  const totalTime = performance.now() - startTime;
  console.log(
    `[drawStreamlines] ${streamlines.length} streamlines, ${totalPoints} points | ` +
    `curves: ${curvesTime.toFixed(2)}ms, chevrons: ${chevronsTime.toFixed(2)}ms, total: ${totalTime.toFixed(2)}ms`
  );
}

/**
 * Create a Path2D from streamlines for efficient repeated drawing.
 *
 * Pre-computing Path2D objects allows the browser to cache the path geometry,
 * making repeated draws much faster than rebuilding paths with moveTo/lineTo.
 *
 * @param streamlines - Array of streamlines in pixel coordinates: [streamline][point][x,y]
 * @returns A Path2D containing all streamlines
 */
export function generateStreamlinePath2D(streamlines: number[][][]): Path2D {
  const path = new Path2D();
  for (const streamline of streamlines) {
    if (streamline.length < 2) continue;
    path.moveTo(streamline[0][0], streamline[0][1]);
    for (let i = 1; i < streamline.length; i++) {
      path.lineTo(streamline[i][0], streamline[i][1]);
    }
  }
  return path;
}

/**
 * Options for drawing a pre-computed streamline Path2D.
 */
export interface DrawStreamlinePathOptions {
  /** Stroke color */
  color: string;
  /** Stroke width in pixels */
  strokeWidth: number;
  /** Opacity (0-1, default: 1) */
  opacity?: number;
}

/**
 * Draw a pre-computed streamline Path2D.
 *
 * This is the fast path for rendering streamlines when geometry doesn't change.
 * Use generateStreamlinePath2D() to create the path once, then call this repeatedly.
 *
 * @param ctx - Canvas 2D rendering context
 * @param path - Pre-computed Path2D from generateStreamlinePath2D()
 * @param options - Styling options
 */
export function drawStreamlinePath(
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  options: DrawStreamlinePathOptions
): void {
  const { color, strokeWidth, opacity = 1 } = options;

  ctx.strokeStyle = color;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = opacity;
  ctx.stroke(path);
  ctx.globalAlpha = 1;
}

