/**
 * Animation classes and drawing helpers for the streamline generation visualization.
 *
 * This file contains:
 * - FlashFadeAnimation class implementing the Animation interface
 * - Drawing functions for grid and pathlines
 */

import type { Animation, Clip } from "@diffusion-explorer/ui";

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------

export interface PathlineStyle {
  strokeWidth?: number;
  color?: string;
  opacity?: number;
  showHeadMarker?: boolean;
  headMarkerRadius?: number;
}

// ----------------------------------------------------------------
// FlashFadeAnimationState
// ----------------------------------------------------------------

export interface FlashFadeAnimationState {
  flashFadeProgress: number; // 0-1 normalized
}

// ----------------------------------------------------------------
// FlashFadeAnimation Options
// ----------------------------------------------------------------

export interface FlashFadeOptions {
  gridNx: number;
  gridNy: number;
  canvasWidth: number;
  canvasHeight: number;
  margin?: number;
  /** Number of flash cycles before fade */
  numFlashes?: number;
  /** Ratio of flash phase to total duration (0-1). Computed as numFlashes*msPerFlash / totalMs */
  flashPhaseRatio?: number;
  rectangleColor?: string;
  pathlineColor?: string;
  pathlineStrokeWidth?: number;
}

// ----------------------------------------------------------------
// FlashFadeAnimation (implements Animation interface)
// ----------------------------------------------------------------

/**
 * Single normalized animation for collision effect:
 * - 0.0-flashPhaseRatio: Rectangle flashes red (multiple on/off cycles)
 * - flashPhaseRatio-1.0: Rectangle fades + trajectory fades out
 */
export class FlashFadeAnimation<TState extends FlashFadeAnimationState>
  implements Animation<TState>
{
  readonly clip: Clip<TState>;

  private gridCell: [number, number];
  private pathline: number[][];
  private options: FlashFadeOptions;

  // Context storage
  private ctx: CanvasRenderingContext2D | null = null;
  private _initialized = false;

  private constructor(
    gridCell: [number, number],
    pathline: number[][],
    options: FlashFadeOptions
  ) {
    this.gridCell = gridCell;
    this.pathline = pathline;
    this.options = options;

    this.clip = {
      name: "flash-fade",
      reduce: (t: number) => ({ flashFadeProgress: t }) as Partial<TState>,
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

  draw(state: TState): void {
    if (!this.ctx) {
      console.warn('FlashFadeAnimation.draw() called before init()');
      return;
    }
    const ctx = this.ctx;
    const { flashFadeProgress } = state;
    const {
      gridNx,
      gridNy,
      canvasWidth,
      canvasHeight,
      margin = 0,
      numFlashes = 3,
      flashPhaseRatio = 0.5,
      rectangleColor = "#ef4444",
      pathlineColor = "#ef4444",
      pathlineStrokeWidth = 2,
    } = this.options;

    const gridWidth = canvasWidth - 2 * margin;
    const gridHeight = canvasHeight - 2 * margin;
    const cellWidth = gridWidth / gridNx;
    const cellHeight = gridHeight / gridNy;
    const [cx, cy] = this.gridCell;

    // Calculate alpha based on progress
    let rectAlpha: number;
    let pathlineAlpha: number;

    if (flashFadeProgress < flashPhaseRatio) {
      // Flash phase: multiple on/off cycles
      const flashProgress = flashFadeProgress / flashPhaseRatio;
      const cyclePosition = (flashProgress * numFlashes) % 1;
      // Use sine wave for smooth flash: 0->1->0 per cycle
      rectAlpha = Math.sin(cyclePosition * Math.PI);
      pathlineAlpha = 1.0;
    } else {
      // Fade phase: both fade out
      const fadeProgress = (flashFadeProgress - flashPhaseRatio) / (1 - flashPhaseRatio);
      rectAlpha = 1 - fadeProgress;
      pathlineAlpha = 1 - fadeProgress;
    }

    ctx.save();

    // Draw flashing/fading rectangle
    ctx.fillStyle = rectangleColor;
    ctx.globalAlpha = rectAlpha * 0.5;
    ctx.fillRect(margin + cx * cellWidth, margin + cy * cellHeight, cellWidth, cellHeight);

    // Draw rectangle border
    ctx.strokeStyle = rectangleColor;
    ctx.lineWidth = 2;
    ctx.globalAlpha = rectAlpha;
    ctx.strokeRect(margin + cx * cellWidth, margin + cy * cellHeight, cellWidth, cellHeight);

    // Draw fading pathline
    if (this.pathline.length > 1) {
      ctx.globalAlpha = pathlineAlpha;
      ctx.strokeStyle = pathlineColor;
      ctx.lineWidth = pathlineStrokeWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      ctx.beginPath();
      ctx.moveTo(this.pathline[0][0], this.pathline[0][1]);
      for (let i = 1; i < this.pathline.length; i++) {
        ctx.lineTo(this.pathline[i][0], this.pathline[i][1]);
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    this.ctx = null;
    this._initialized = false;
  }

  static create<TState extends FlashFadeAnimationState>(
    gridCell: [number, number],
    pathline: number[][],
    options: FlashFadeOptions
  ): FlashFadeAnimation<TState> {
    return new FlashFadeAnimation<TState>(gridCell, pathline, options);
  }
}

// ----------------------------------------------------------------
// Drawing Functions
// ----------------------------------------------------------------

/**
 * Draw a grid overlay on the canvas.
 */
export function drawGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  nx: number,
  ny: number,
  style: { lineColor?: string; lineWidth?: number; margin?: number } = {}
): void {
  const { lineColor = "#ddd", lineWidth = 0.5, margin = 0 } = style;

  const gridWidth = width - 2 * margin;
  const gridHeight = height - 2 * margin;
  const cellWidth = gridWidth / nx;
  const cellHeight = gridHeight / ny;

  ctx.save();
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();

  for (let i = 1; i < nx; i++) {
    ctx.moveTo(margin + i * cellWidth, margin);
    ctx.lineTo(margin + i * cellWidth, margin + gridHeight);
  }
  for (let j = 1; j < ny; j++) {
    ctx.moveTo(margin, margin + j * cellHeight);
    ctx.lineTo(margin + gridWidth, margin + j * cellHeight);
  }

  ctx.stroke();

  // Draw boundary rectangle
  ctx.strokeRect(margin, margin, gridWidth, gridHeight);

  ctx.restore();
}

/**
 * Draw a single pathline up to a given segment index.
 */
export function drawPathline(
  ctx: CanvasRenderingContext2D,
  pathline: number[][],
  segmentIndex: number,
  style: PathlineStyle = {}
): void {
  const {
    strokeWidth = 2,
    color = "#3b82f6",
    opacity = 0.8,
    showHeadMarker = true,
    headMarkerRadius = 3,
  } = style;

  if (pathline.length < 2 || segmentIndex < 1) return;

  const endIndex = Math.min(segmentIndex + 1, pathline.length);

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = opacity;

  // Draw path
  ctx.beginPath();
  ctx.moveTo(pathline[0][0], pathline[0][1]);
  for (let i = 1; i < endIndex; i++) {
    ctx.lineTo(pathline[i][0], pathline[i][1]);
  }
  ctx.stroke();

  // Draw head marker
  if (showHeadMarker && endIndex > 0) {
    const headPoint = pathline[endIndex - 1];
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(headPoint[0], headPoint[1], headMarkerRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/**
 * Draw a complete pathline (all segments).
 */
export function drawCompletedPathline(
  ctx: CanvasRenderingContext2D,
  pathline: number[][],
  style: PathlineStyle = {}
): void {
  const { strokeWidth = 2, color = "#3b82f6", opacity = 0.6 } = style;

  if (pathline.length < 2) return;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = opacity;

  ctx.beginPath();
  ctx.moveTo(pathline[0][0], pathline[0][1]);
  for (let i = 1; i < pathline.length; i++) {
    ctx.lineTo(pathline[i][0], pathline[i][1]);
  }
  ctx.stroke();

  ctx.restore();
}
