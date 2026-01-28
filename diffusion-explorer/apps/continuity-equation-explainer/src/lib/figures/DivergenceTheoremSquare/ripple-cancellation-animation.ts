/**
 * Ripple cancellation animation for the left canvas (curved surface).
 *
 * Animates the cancellation of internal divergence arrows by:
 * 1. Starting from a central grid cell
 * 2. Rippling outward to neighbors in concentric waves
 * 3. Fading out arrows as the wavefront passes each cell
 */

import type { Animation, Clip } from '@diffusion-explorer/ui';
import { drawArrow } from '@diffusion-explorer/ui';
import type { CurveFn, ToPixelFn } from '../DivergenceTheorem/divergence_theorem';
import {
  type SurfaceSamples,
  type BoundingBox,
  sampleSurfacePoints,
  computeBoundingBox,
  isPointInside,
} from '../DivergenceTheorem/grid-animation';

// ===== Types =====

export type RippleCancellationState = {
  leftRippleProgress: number; // 0-1, controls the ripple wavefront
};

type GridCell = {
  center: [number, number]; // Domain coordinates
  cellWidth: number;
  cellHeight: number;
  distanceFromCenter: number; // Manhattan distance from the chosen central cell
  row: number;
  col: number;
};

export type RippleCancellationOptions = {
  // Surface function (parametric curve, theta: 0 to 2π)
  curveFn: CurveFn;

  // Grid parameters - final resolution after subdivision (e.g., 8 for 8x8)
  gridResolution: number;

  // Center cell to start ripple from (row, col in final grid)
  // If not specified, will pick a cell near the center of the surface
  centerRow?: number;
  centerCol?: number;

  // Coordinate transforms
  toPixel: ToPixelFn;
  scaleLength: (domainLen: number) => number;

  // Arrow styling
  color?: string;
  strokeWidth?: number;
  headRadius?: number;
  padding?: number;

  // Ripple settings
  wavefrontWidth?: number; // How many distance units the fade takes (default 1)
};

// ===== Class Implementation =====

export class RippleCancellationAnimation<TState extends RippleCancellationState>
  implements Animation<TState>
{
  readonly clip: Clip<TState>;

  // Pre-computed cell data sorted by distance from center
  private readonly cells: GridCell[];
  private readonly maxDistance: number;
  private readonly toPixel: ToPixelFn;
  private readonly scaleLength: (domainLen: number) => number;

  // Style options
  private readonly color: string;
  private readonly strokeWidth: number;
  private readonly headRadius: number;
  private readonly padding: number;
  private readonly wavefrontWidth: number;

  private constructor(options: RippleCancellationOptions) {
    const {
      curveFn,
      gridResolution,
      centerRow,
      centerCol,
      toPixel,
      scaleLength,
      color = '#f97316',
      strokeWidth = 2,
      headRadius = 3,
      padding = 0.3,
      wavefrontWidth = 1,
    } = options;

    this.toPixel = toPixel;
    this.scaleLength = scaleLength;
    this.color = color;
    this.strokeWidth = strokeWidth;
    this.headRadius = headRadius;
    this.padding = padding;
    this.wavefrontWidth = wavefrontWidth;

    // Compute surface samples and bounding box
    const surfaceSamples = sampleSurfacePoints(curveFn);
    const boundingBox = computeBoundingBox(surfaceSamples.points);

    // Compute all valid cells with distances
    const { cells, maxDistance } = this.computeCellsWithDistances(
      surfaceSamples,
      boundingBox,
      gridResolution,
      centerRow,
      centerCol
    );

    this.cells = cells;
    this.maxDistance = maxDistance;

    // Create the clip
    this.clip = {
      name: 'RippleCancellation',
      reduce(t: number) {
        return { leftRippleProgress: t } as Partial<TState>;
      },
    };
  }

  /**
   * Compute valid grid cells and their distances from the center cell.
   */
  private computeCellsWithDistances(
    surfaceSamples: SurfaceSamples,
    boundingBox: BoundingBox,
    gridResolution: number,
    specifiedCenterRow?: number,
    specifiedCenterCol?: number
  ): { cells: GridCell[]; maxDistance: number } {
    const { xMin, xMax, yMin, yMax } = boundingBox;

    const maxDim = Math.max(xMax - xMin, yMax - yMin);
    const step = maxDim / gridResolution;
    const cellWidth = step;
    const cellHeight = step;

    // First pass: find all valid cells (non-boundary, fully inside)
    const validCells: Array<{
      center: [number, number];
      row: number;
      col: number;
    }> = [];

    for (let row = 0; row < gridResolution; row++) {
      for (let col = 0; col < gridResolution; col++) {
        const cellXMin = xMin + col * step;
        const cellXMax = xMin + (col + 1) * step;
        const cellYMin = yMin + row * step;
        const cellYMax = yMin + (row + 1) * step;
        const center: [number, number] = [
          (cellXMin + cellXMax) / 2,
          (cellYMin + cellYMax) / 2,
        ];

        // Check if center is inside
        if (!isPointInside(center, surfaceSamples)) {
          continue;
        }

        // Check if all corners are inside (non-boundary cell)
        const corners: [number, number][] = [
          [cellXMin, cellYMin],
          [cellXMax, cellYMin],
          [cellXMin, cellYMax],
          [cellXMax, cellYMax],
        ];
        const allCornersInside = corners.every((corner) =>
          isPointInside(corner, surfaceSamples)
        );

        if (allCornersInside) {
          validCells.push({ center, row, col });
        }
      }
    }

    if (validCells.length === 0) {
      return { cells: [], maxDistance: 0 };
    }

    // Determine center cell
    let centerRow: number;
    let centerCol: number;

    if (specifiedCenterRow !== undefined && specifiedCenterCol !== undefined) {
      // Use specified center
      centerRow = specifiedCenterRow;
      centerCol = specifiedCenterCol;
    } else {
      // Find cell closest to grid center
      const gridCenterRow = (gridResolution - 1) / 2;
      const gridCenterCol = (gridResolution - 1) / 2;

      let minDist = Infinity;
      let closestCell = validCells[0];

      for (const cell of validCells) {
        const dist = Math.abs(cell.row - gridCenterRow) + Math.abs(cell.col - gridCenterCol);
        if (dist < minDist) {
          minDist = dist;
          closestCell = cell;
        }
      }

      centerRow = closestCell.row;
      centerCol = closestCell.col;
    }

    // Compute Manhattan distances from center for all valid cells
    let maxDistance = 0;
    const cells: GridCell[] = validCells.map((vc) => {
      const distance = Math.abs(vc.row - centerRow) + Math.abs(vc.col - centerCol);
      maxDistance = Math.max(maxDistance, distance);

      return {
        center: vc.center,
        cellWidth,
        cellHeight,
        distanceFromCenter: distance,
        row: vc.row,
        col: vc.col,
      };
    });

    // Sort by distance (for potential optimization, though we draw all)
    cells.sort((a, b) => a.distanceFromCenter - b.distanceFromCenter);

    return { cells, maxDistance };
  }

  /**
   * Draw cell arrows with opacity based on wavefront position.
   */
  draw(ctx: CanvasRenderingContext2D, state: TState): void {
    const { leftRippleProgress } = state;

    if (this.cells.length === 0) return;

    // Wavefront position (in distance units)
    // When progress = 1, wavefront should have passed all cells
    const wavefrontDistance = leftRippleProgress * (this.maxDistance + this.wavefrontWidth + 1);

    ctx.save();
    ctx.strokeStyle = this.color;
    ctx.fillStyle = this.color;
    ctx.lineWidth = this.strokeWidth;
    ctx.lineCap = 'round';

    for (const cell of this.cells) {
      // Calculate how far behind the wavefront this cell is
      const distBehindWave = wavefrontDistance - cell.distanceFromCenter;

      let opacity: number;

      if (distBehindWave < 0) {
        // Cell is ahead of wavefront - fully visible
        opacity = 1.0;
      } else if (distBehindWave < this.wavefrontWidth) {
        // Cell is at the wavefront - fading
        opacity = 1.0 - distBehindWave / this.wavefrontWidth;
      } else {
        // Cell is behind wavefront - faded out
        opacity = 0;
      }

      if (opacity > 0) {
        ctx.globalAlpha = opacity;
        this.drawCellArrows(ctx, cell);
      }
    }

    ctx.restore();
  }

  /**
   * Draw 4 arrows from cell center.
   */
  private drawCellArrows(ctx: CanvasRenderingContext2D, cell: GridCell): void {
    const [cx, cy] = this.toPixel(cell.center);

    const maxArrowLenX = this.scaleLength((cell.cellWidth / 2) * (1 - this.padding));
    const maxArrowLenY = this.scaleLength((cell.cellHeight / 2) * (1 - this.padding));

    // Draw 4 arrows: right, left, up, down
    const directions: Array<{ dx: number; dy: number; len: number }> = [
      { dx: 1, dy: 0, len: maxArrowLenX }, // Right
      { dx: -1, dy: 0, len: maxArrowLenX }, // Left
      { dx: 0, dy: -1, len: maxArrowLenY }, // Up (negative in canvas coords)
      { dx: 0, dy: 1, len: maxArrowLenY }, // Down
    ];

    for (const { dx, dy, len } of directions) {
      const endX = cx + dx * len;
      const endY = cy + dy * len;
      drawArrow(ctx, cx, cy, endX, endY, this.headRadius);
    }
  }

  /**
   * Create a new RippleCancellationAnimation instance.
   */
  static create<TState extends RippleCancellationState>(
    options: RippleCancellationOptions
  ): RippleCancellationAnimation<TState> {
    return new RippleCancellationAnimation<TState>(options);
  }
}
