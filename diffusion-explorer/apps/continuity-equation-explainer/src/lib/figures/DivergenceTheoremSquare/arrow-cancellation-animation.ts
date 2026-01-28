/**
 * Arrow cancellation animation for the right canvas (square grid).
 *
 * Handles the multi-phase cancellation sequence:
 * 1. Dim all arrows
 * 2. Highlight horizontal (left-right) internal arrows
 * 3. Fade horizontal arrows
 * 4. Highlight vertical (up-down) internal arrows
 * 5. Fade vertical arrows
 * 6. Fade remaining internal arrows, restore boundary arrows
 */

import type { Animation, Clip } from '@diffusion-explorer/ui';
import { drawArrow } from '@diffusion-explorer/ui';

// ===== Types =====

export type CancellationPhase =
  | 'none'
  | 'dim_all'
  | 'highlight_horizontal'
  | 'fade_horizontal'
  | 'highlight_vertical'
  | 'fade_vertical'
  | 'fade_internal';

export type ArrowCancellationState = {
  rightCancellationPhase: CancellationPhase;
  rightCancellationProgress: number; // 0-1 within current phase
};

type ArrowSpec = {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  category: 'horizontal' | 'vertical' | 'boundary';
};

type GridCell = {
  x: number; // Pixel x coordinate of cell center
  y: number; // Pixel y coordinate of cell center
  width: number; // Cell width in pixels
  height: number; // Cell height in pixels
  row: number; // Row index (0-based)
  col: number; // Column index (0-based)
};

export type ArrowCancellationOptions = {
  // Grid cell positions (pixel coordinates) - 2x2 grid = 4 cells
  cells: GridCell[];
  gridResolution: number; // 2 for 2x2 grid

  // Arrow styling
  color?: string;
  strokeWidth?: number;
  headRadius?: number;
  padding?: number; // Fraction of cell to leave as padding (0-1)

  // Opacity levels
  dimmedOpacity?: number;
  highlightOpacity?: number;
};

// ===== Utility Functions =====

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ===== Class Implementation =====

export class ArrowCancellationAnimation<TState extends ArrowCancellationState>
  implements Animation<TState>
{
  readonly clip: Clip<TState>;

  // Pre-computed arrow specifications
  private readonly arrows: ArrowSpec[];

  // Style options
  private readonly color: string;
  private readonly strokeWidth: number;
  private readonly headRadius: number;
  private readonly dimmedOpacity: number;
  private readonly highlightOpacity: number;

  // Context storage
  private ctx: CanvasRenderingContext2D | null = null;
  private _initialized = false;

  private constructor(options: ArrowCancellationOptions) {
    const {
      cells,
      gridResolution,
      color = '#f97316',
      strokeWidth = 2,
      headRadius = 3,
      padding = 0.35,
      dimmedOpacity = 0.3,
      highlightOpacity = 1.0,
    } = options;

    this.color = color;
    this.strokeWidth = strokeWidth;
    this.headRadius = headRadius;
    this.dimmedOpacity = dimmedOpacity;
    this.highlightOpacity = highlightOpacity;

    // Compute all arrows and categorize them
    this.arrows = this.computeArrows(cells, gridResolution, padding);

    // Create a dummy clip (state is controlled externally)
    this.clip = {
      name: 'ArrowCancellation',
      reduce(_t: number) {
        return {} as Partial<TState>;
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
   * Compute all arrows and categorize as horizontal internal, vertical internal, or boundary.
   * For a 2x2 grid:
   * - Horizontal internal: arrows that point left/right at internal vertical edges
   * - Vertical internal: arrows that point up/down at internal horizontal edges
   * - Boundary: arrows that point outward at the grid boundary
   */
  private computeArrows(
    cells: GridCell[],
    gridResolution: number,
    padding: number
  ): ArrowSpec[] {
    const arrows: ArrowSpec[] = [];

    for (const cell of cells) {
      const { x: cx, y: cy, width, height, row, col } = cell;

      const maxArrowLenX = (width / 2) * (1 - padding);
      const maxArrowLenY = (height / 2) * (1 - padding);

      // Right arrow
      const rightCategory = col === gridResolution - 1 ? 'boundary' : 'horizontal';
      arrows.push({
        startX: cx,
        startY: cy,
        endX: cx + maxArrowLenX,
        endY: cy,
        category: rightCategory,
      });

      // Left arrow
      const leftCategory = col === 0 ? 'boundary' : 'horizontal';
      arrows.push({
        startX: cx,
        startY: cy,
        endX: cx - maxArrowLenX,
        endY: cy,
        category: leftCategory,
      });

      // Up arrow (negative y in canvas coords)
      const upCategory = row === 0 ? 'boundary' : 'vertical';
      arrows.push({
        startX: cx,
        startY: cy,
        endX: cx,
        endY: cy - maxArrowLenY,
        category: upCategory,
      });

      // Down arrow
      const downCategory = row === gridResolution - 1 ? 'boundary' : 'vertical';
      arrows.push({
        startX: cx,
        startY: cy,
        endX: cx,
        endY: cy + maxArrowLenY,
        category: downCategory,
      });
    }

    return arrows;
  }

  /**
   * Compute opacity for each arrow category based on current phase and progress.
   */
  private computeOpacities(phase: CancellationPhase, progress: number): {
    horizontal: number;
    vertical: number;
    boundary: number;
  } {
    const dim = this.dimmedOpacity;
    const bright = this.highlightOpacity;

    switch (phase) {
      case 'none':
        return { horizontal: 1.0, vertical: 1.0, boundary: 1.0 };

      case 'dim_all':
        // All arrows fade from 1.0 to dimmedOpacity
        const allOpacity = lerp(1.0, dim, progress);
        return { horizontal: allOpacity, vertical: allOpacity, boundary: allOpacity };

      case 'highlight_horizontal':
        // Horizontal arrows brighten, others stay dimmed
        return {
          horizontal: lerp(dim, bright, progress),
          vertical: dim,
          boundary: dim,
        };

      case 'fade_horizontal':
        // Horizontal arrows fade out
        return {
          horizontal: lerp(bright, 0, progress),
          vertical: dim,
          boundary: dim,
        };

      case 'highlight_vertical':
        // Vertical arrows brighten
        return {
          horizontal: 0, // Already faded
          vertical: lerp(dim, bright, progress),
          boundary: dim,
        };

      case 'fade_vertical':
        // Vertical arrows fade out
        return {
          horizontal: 0,
          vertical: lerp(bright, 0, progress),
          boundary: dim,
        };

      case 'fade_internal':
        // Boundary arrows restore to full opacity
        // (horizontal and vertical are already at 0)
        return {
          horizontal: 0,
          vertical: 0,
          boundary: lerp(dim, bright, progress),
        };

      default:
        return { horizontal: 1.0, vertical: 1.0, boundary: 1.0 };
    }
  }

  /**
   * Draw all arrows with appropriate opacities based on cancellation state.
   */
  draw(state: TState): void {
    if (!this.ctx) {
      console.warn('ArrowCancellationAnimation.draw() called before init()');
      return;
    }

    const { rightCancellationPhase, rightCancellationProgress } = state;

    if (rightCancellationPhase === 'none') {
      // Before cancellation, draw all arrows at full opacity
      this.ctx.save();
      this.ctx.strokeStyle = this.color;
      this.ctx.fillStyle = this.color;
      this.ctx.lineWidth = this.strokeWidth;
      this.ctx.lineCap = 'round';

      for (const arrow of this.arrows) {
        drawArrow(this.ctx, arrow.startX, arrow.startY, arrow.endX, arrow.endY, this.headRadius);
      }

      this.ctx.restore();
      return;
    }

    const opacities = this.computeOpacities(rightCancellationPhase, rightCancellationProgress);

    this.ctx.save();
    this.ctx.strokeStyle = this.color;
    this.ctx.fillStyle = this.color;
    this.ctx.lineWidth = this.strokeWidth;
    this.ctx.lineCap = 'round';

    for (const arrow of this.arrows) {
      const opacity = opacities[arrow.category];
      if (opacity <= 0) continue;

      this.ctx.globalAlpha = opacity;
      drawArrow(this.ctx, arrow.startX, arrow.startY, arrow.endX, arrow.endY, this.headRadius);
    }

    this.ctx.restore();
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    this.ctx = null;
    this._initialized = false;
  }

  /**
   * Create a new ArrowCancellationAnimation instance.
   */
  static create<TState extends ArrowCancellationState>(
    options: ArrowCancellationOptions
  ): ArrowCancellationAnimation<TState> {
    return new ArrowCancellationAnimation<TState>(options);
  }
}
