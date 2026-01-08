/**
 * Streamline generation for 2D vector fields.
 *
 * Based on matplotlib's streamplot algorithm:
 * - Uses RK12 (Heun's method) with adaptive step size for integration
 * - Density-based mask grid controls streamline spacing (density=1 → 30x30 grid)
 * - Spiral seeding pattern from boundary inward for even coverage
 * - Supports user-specified start points for custom seeding
 */

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
    // Check if within grid
    if (!dmap.isWithinGrid(xi, yi)) {
      // Take Euler step to boundary
      const [x, y] = dmap.grid2data(xi, yi);
      const [vx, vy] = vectorField(x, y);
      const speed = Math.sqrt(vx * vx + vy * vy);
      if (speed > 1e-10) {
        // Compute scaled velocity in grid coordinates
        const vxi = direction * vx * dmap.x_data2grid;
        const vyi = direction * vy * dmap.y_data2grid;
        // Find distance to boundary
        let dsx = Infinity, dsy = Infinity;
        if (vxi !== 0) {
          dsx = vxi < 0 ? xi / -vxi : (dmap.nx - 1 - xi) / vxi;
        }
        if (vyi !== 0) {
          dsy = vyi < 0 ? yi / -vyi : (dmap.ny - 1 - yi) / vyi;
        }
        const finalDs = Math.min(dsx, dsy);
        if (isFinite(finalDs) && finalDs > 0) {
          const xiFinal = xi + vxi * finalDs;
          const yiFinal = yi + vyi * finalDs;
          const [xFinal, yFinal] = dmap.grid2data(xiFinal, yiFinal);
          points.push([xFinal, yFinal]);
          stotal += finalDs;
        }
      }
      break;
    }

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

      // Check bounds
      if (!dmap.isWithinGrid(xiNew, yiNew)) {
        // Out of bounds - will be handled in next iteration
        xi = xiNew;
        yi = yiNew;
        continue;
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
    maxerror = 0.003
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

  return streamlines;
}

/**
 * Resample a streamline to have approximately equal-length segments.
 *
 * @param streamline - Array of [x, y] points
 * @param segmentLength - Desired length of each segment (in domain units)
 * @returns Resampled streamline with equal-length segments
 */
export function resampleStreamline(
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
 * Resample all streamlines to have equal-length segments.
 *
 * @param streamlines - Array of streamlines
 * @param segmentLength - Desired length of each segment
 * @returns Resampled streamlines
 */
export function resampleStreamlines(
  streamlines: number[][][],
  segmentLength: number
): number[][][] {
  return streamlines.map(s => resampleStreamline(s, segmentLength));
}
