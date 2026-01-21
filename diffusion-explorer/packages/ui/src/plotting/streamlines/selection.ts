/**
 * Trajectory selection utilities.
 *
 * Provides density-based selection of trajectories/pathlines using a grid mask,
 * similar to how streamline generation uses a mask for spacing.
 */

import type { SelectTrajectoriesOptions } from './types';

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
