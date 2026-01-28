/**
 * Surface-aware divergence arrow animation that draws arrows growing outward
 * from the centers of grid cells that are fully inside a closed curve.
 *
 * Visualizes divergence by showing 4 arrows (up, down, left, right) emanating
 * from the center of each valid grid cell, all growing simultaneously.
 */

import type { Clip, Animation } from '@diffusion-explorer/ui';
import { drawArrow } from '@diffusion-explorer/ui';
import type { CurveFn, ToPixelFn } from './divergence_theorem';
import {
  type SurfaceSamples,
  type BoundingBox,
  sampleSurfacePoints,
  computeBoundingBox,
  isPointInside,
} from './grid-animation';

// ===== Types =====

export type DivergenceArrowAnimationState = {
  arrowProgress: number; // 0-1, how much arrows have grown
};

type GridCell = {
  center: [number, number]; // Domain coordinates
  cellWidth: number;
  cellHeight: number;
};

export type DivergenceArrowAnimationOptions = {
  // Surface function (parametric curve, theta: 0 to 2π)
  curveFn: CurveFn;

  // Grid parameters
  gridResolution: number; // e.g., 3 for 3x3 grid

  // Coordinate transforms
  toPixel: ToPixelFn;
  scaleLength: (domainLen: number) => number;

  // Arrow styling
  color?: string;
  strokeWidth?: number;
  headRadius?: number;
  padding?: number; // Fraction of cell to leave as padding (0-1)
  initialLengthFraction?: number; // Starting length as fraction of max (0-1), default 0

  // Clip options
  clipDuration?: number;
};

// ===== Utility Functions =====

/**
 * Compute grid cells that are fully inside the surface (non-boundary cells).
 * A cell is considered a boundary cell if any of its corners is outside the surface.
 */
function computeValidCells(
  surfaceSamples: SurfaceSamples,
  boundingBox: BoundingBox,
  gridResolution: number
): GridCell[] {
  const { xMin, xMax, yMin, yMax } = boundingBox;

  // Use max dimension for square cells
  const maxDim = Math.max(xMax - xMin, yMax - yMin);
  const step = maxDim / gridResolution;
  const cellWidth = step;
  const cellHeight = step;

  const cells: GridCell[] = [];

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

      // Check if any corner is outside (boundary cell)
      const corners: [number, number][] = [
        [cellXMin, cellYMin],
        [cellXMax, cellYMin],
        [cellXMin, cellYMax],
        [cellXMax, cellYMax],
      ];
      const isBoundary = !corners.every((corner) =>
        isPointInside(corner, surfaceSamples)
      );

      // Only include non-boundary cells
      if (!isBoundary) {
        cells.push({ center, cellWidth, cellHeight });
      }
    }
  }

  return cells;
}

// ===== Class Implementation =====

export class DivergenceArrowAnimation<
  TState extends DivergenceArrowAnimationState
> implements Animation<TState>
{
  readonly clip: Clip<TState>;

  // Pre-computed data
  private readonly cells: GridCell[];
  private readonly toPixel: ToPixelFn;
  private readonly scaleLength: (domainLen: number) => number;

  // Style options
  private readonly color: string;
  private readonly strokeWidth: number;
  private readonly headRadius: number;
  private readonly padding: number;
  private readonly initialLengthFraction: number;

  // Context storage
  private ctx: CanvasRenderingContext2D | null = null;
  private _initialized = false;

  private constructor(options: DivergenceArrowAnimationOptions) {
    const {
      curveFn,
      gridResolution,
      toPixel,
      scaleLength,
      color = '#000000',
      strokeWidth = 2,
      headRadius = 4,
      padding = 0.3,
      initialLengthFraction = 0,
      clipDuration = 1,
    } = options;

    this.toPixel = toPixel;
    this.scaleLength = scaleLength;
    this.color = color;
    this.strokeWidth = strokeWidth;
    this.headRadius = headRadius;
    this.padding = padding;
    this.initialLengthFraction = initialLengthFraction;

    // Compute surface samples and bounding box
    const surfaceSamples = sampleSurfacePoints(curveFn);
    const boundingBox = computeBoundingBox(surfaceSamples.points);

    // Compute valid (non-boundary) cells
    this.cells = computeValidCells(surfaceSamples, boundingBox, gridResolution);

    // Create the clip
    this.clip = {
      name: 'ArrowProgress',
      duration: clipDuration,
      reduce(t: number) {
        return { arrowProgress: t } as Partial<TState>;
      },
    };
  }

  /**
   * Initialize the animation with a canvas element.
   */
  async init(canvas: HTMLCanvasElement): Promise<void> {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D rendering context');
    }
    this.ctx = ctx;
    this._initialized = true;
  }

  /**
   * Check if the animation has been initialized.
   */
  get initialized(): boolean {
    return this._initialized;
  }

  /**
   * Draw the divergence arrows at the current animation state.
   */
  draw(state: TState): void {
    if (!this.ctx) {
      console.warn('DivergenceArrowAnimation.draw() called before init()');
      return;
    }

    const progress = state.arrowProgress;
    if (progress <= 0) return;

    this.ctx.strokeStyle = this.color;
    this.ctx.fillStyle = this.color;
    this.ctx.lineWidth = this.strokeWidth;
    this.ctx.lineCap = 'round';

    for (const cell of this.cells) {
      this.drawCellArrows(cell, progress);
    }
  }

  /**
   * Draw 4 arrows from cell center, scaled by progress.
   */
  private drawCellArrows(cell: GridCell, progress: number): void {
    if (!this.ctx) return;

    const [cx, cy] = this.toPixel(cell.center);

    // Arrow length (from center to near edge, with padding)
    const maxArrowLenX =
      this.scaleLength((cell.cellWidth / 2) * (1 - this.padding));
    const maxArrowLenY =
      this.scaleLength((cell.cellHeight / 2) * (1 - this.padding));

    // Interpolate from initial length to max length based on progress
    const lengthFraction = this.initialLengthFraction + (1 - this.initialLengthFraction) * progress;
    const arrowLenX = maxArrowLenX * lengthFraction;
    const arrowLenY = maxArrowLenY * lengthFraction;

    // Draw 4 arrows: right, left, up, down
    const directions: Array<{ dx: number; dy: number; len: number }> = [
      { dx: 1, dy: 0, len: arrowLenX }, // Right
      { dx: -1, dy: 0, len: arrowLenX }, // Left
      { dx: 0, dy: -1, len: arrowLenY }, // Up (negative in canvas coords)
      { dx: 0, dy: 1, len: arrowLenY }, // Down
    ];

    for (const { dx, dy, len } of directions) {
      const endX = cx + dx * len;
      const endY = cy + dy * len;
      drawArrow(this.ctx, cx, cy, endX, endY, this.headRadius);
    }
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    this.ctx = null;
    this._initialized = false;
  }

  /**
   * Create a new DivergenceArrowAnimation instance.
   */
  static create<TState extends DivergenceArrowAnimationState>(
    options: DivergenceArrowAnimationOptions
  ): DivergenceArrowAnimation<TState> {
    return new DivergenceArrowAnimation<TState>(options);
  }
}
