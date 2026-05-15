/**
 * Helpers for working with a cached time-varying velocity grid produced by
 * `compute_velocity_grid.ts`-style scripts.
 *
 * The cached `velocity_grids.bin` is a Float32Array laid out as
 *   [timestep][gridY][gridX][vx, vy]
 * with metadata describing the domain, gridSize, and numTimesteps.
 *
 * These helpers are deliberately framework-agnostic — no canvas, no Svelte —
 * so they can be reused by any figure that loads the same artifact format.
 */

export interface VelocityGridDomain {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export interface VelocityGridMetadata {
  numTimesteps: number;
  gridSize: number;
  domain: VelocityGridDomain;
}

/**
 * Bilinearly interpolate the cached velocity grid at (x, y) for the given
 * timestep index. Coordinates are in domain space (the same coordinate system
 * as `meta.domain`). Returns [vx, vy].
 */
export function sampleVelocityGrid(
  grids: Float32Array,
  timeIndex: number,
  x: number,
  y: number,
  meta: VelocityGridMetadata
): [number, number] {
  const { gridSize, domain } = meta;

  // Map (x, y) into grid coordinates with a 0.5 half-cell shift so that
  // grid index `i` is the *center* of cell `i`, matching the layout produced
  // by `generateGridPoints()` in compute_velocity_grid.ts.
  const gx = ((x - domain.xMin) / (domain.xMax - domain.xMin)) * gridSize - 0.5;
  const gy = ((y - domain.yMin) / (domain.yMax - domain.yMin)) * gridSize - 0.5;

  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;

  const cx0 = Math.max(0, Math.min(gridSize - 1, x0));
  const cy0 = Math.max(0, Math.min(gridSize - 1, y0));
  const cx1 = Math.max(0, Math.min(gridSize - 1, x0 + 1));
  const cy1 = Math.max(0, Math.min(gridSize - 1, y0 + 1));

  const timeOffset = timeIndex * gridSize * gridSize * 2;

  const v00x = grids[timeOffset + (cy0 * gridSize + cx0) * 2];
  const v00y = grids[timeOffset + (cy0 * gridSize + cx0) * 2 + 1];
  const v10x = grids[timeOffset + (cy0 * gridSize + cx1) * 2];
  const v10y = grids[timeOffset + (cy0 * gridSize + cx1) * 2 + 1];
  const v01x = grids[timeOffset + (cy1 * gridSize + cx0) * 2];
  const v01y = grids[timeOffset + (cy1 * gridSize + cx0) * 2 + 1];
  const v11x = grids[timeOffset + (cy1 * gridSize + cx1) * 2];
  const v11y = grids[timeOffset + (cy1 * gridSize + cx1) * 2 + 1];

  const vx =
    (1 - fx) * (1 - fy) * v00x +
    fx * (1 - fy) * v10x +
    (1 - fx) * fy * v01x +
    fx * fy * v11x;
  const vy =
    (1 - fx) * (1 - fy) * v00y +
    fx * (1 - fy) * v10y +
    (1 - fx) * fy * v01y +
    fx * fy * v11y;

  return [vx, vy];
}

/**
 * Build a uniform `size × size` sample grid over `domain`, optionally inset
 * from the edges by a fraction of each dimension (so arrows / dots don't run
 * off the canvas). Returns positions in domain coords.
 */
export function buildUniformGrid(
  size: number,
  domain: VelocityGridDomain,
  insetFraction = 0
): number[][] {
  const xRange = domain.xMax - domain.xMin;
  const yRange = domain.yMax - domain.yMin;
  const insetX = xRange * insetFraction;
  const insetY = yRange * insetFraction;
  const xMin = domain.xMin + insetX;
  const xMax = domain.xMax - insetX;
  const yMin = domain.yMin + insetY;
  const yMax = domain.yMax - insetY;

  const points: number[][] = [];
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = size === 1 ? 0.5 : i / (size - 1);
      const v = size === 1 ? 0.5 : j / (size - 1);
      points.push([xMin + u * (xMax - xMin), yMin + v * (yMax - yMin)]);
    }
  }
  return points;
}

/**
 * Convenience: evaluate the velocity grid at every point in `points` for the
 * given timestep. Returns velocities in the same order as the input points.
 */
export function sampleVelocityGridAt(
  grids: Float32Array,
  timeIndex: number,
  points: number[][],
  meta: VelocityGridMetadata
): number[][] {
  return points.map(([x, y]) => sampleVelocityGrid(grids, timeIndex, x, y, meta));
}
