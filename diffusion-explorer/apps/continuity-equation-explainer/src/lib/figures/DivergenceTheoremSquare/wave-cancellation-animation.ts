/**
 * Wave-cancellation animation for the divergence-theorem square pane.
 *
 * Visualizes the pairwise cancellation of interior divergence arrows on a
 * subdivided square. A wavefront expands from the center cell outward; as it
 * passes each pair of opposing arrows on a shared interior edge, the pair is
 * briefly highlighted (opacity boost) and then fades. Once propagation is
 * done, the surviving inside boundary arrows fade out and new arrows emerge
 * JUST OUTSIDE the rectangle pointing outward — conveying "only the outward
 * boundary contributions survive, and they are the surface integral".
 * Near the end of the loop the outside arrows fade and the inside arrows
 * return, so the cycle restarts seamlessly.
 */

import type { Animation, Clip } from '@diffusion-explorer/ui';
import { drawArrow } from '@diffusion-explorer/ui';

// ============================================================================
// Types
// ============================================================================

export type WaveCancellationState = {
  wavePhase: number; // [0, 1] — single loop phase driving the animation
};

export type GridCellSpec = {
  cx: number; // pixel x of cell center
  cy: number; // pixel y of cell center
  row: number;
  col: number;
};

type ArrowSpec = {
  startX: number;
  startY: number;
  dx: number;
  dy: number;
  baseLength: number;
  halfCellPx: number; // distance from cell center to cell edge along (dx, dy)
  category: 'interior' | 'boundary';
  waveArrivalTime: number;
};

export type WaveCancellationOptions = {
  cells: GridCellSpec[];
  gridResolution: number;
  centerCell: { row: number; col: number };
  cellSizePx: number;

  arrowPadding?: number; // 0..1, fraction of half-cell to leave between center and arrow tip
  color?: string;
  strokeWidth?: number;
  headRadius?: number;

  // Wave timing — all in normalized loop fraction [0, 1].
  waveFade?: number;
  highlightOpacityBoost?: number;
  // Two-flash blink: each flash is a triangular opacity pulse of half-width
  // flashHalfWidth around its peak, with flashGap between the two peaks.
  // The arrow then fades out over waveFade.
  flashHalfWidth?: number;
  flashGap?: number;

  // Loop-time placement of each ring's wave arrival.
  ring1Time?: number;
  ring2Time?: number;

  // Swap: inside boundary arrows fade out, outside arrows emerge.
  swapStart?: number; // begin fade-out / emerge
  swapEnd?: number; // end fade-out / emerge (outside arrows fully present)
  outsideHoldEnd?: number; // hold outside arrows until this time
  // After outsideHoldEnd → 1.0: outside arrows fade out, inside arrows return.

  // Outside arrow geometry.
  outsideArrowLengthScale?: number; // multiplier on baseLength
};

// ============================================================================
// Class
// ============================================================================

export class WaveCancellationAnimation<TState extends WaveCancellationState>
  implements Animation<TState>
{
  readonly clip: Clip<TState>;

  private readonly arrows: ArrowSpec[];

  private readonly color: string;
  private readonly strokeWidth: number;
  private readonly headRadius: number;

  private readonly waveFade: number;
  private readonly highlightOpacityBoost: number;
  private readonly flashHalfWidth: number;
  private readonly flashGap: number;

  private readonly swapStart: number;
  private readonly swapEnd: number;
  private readonly outsideHoldEnd: number;
  private readonly outsideArrowLengthScale: number;

  private ctx: CanvasRenderingContext2D | null = null;
  private _initialized = false;

  private constructor(options: WaveCancellationOptions) {
    const {
      cells,
      gridResolution,
      centerCell,
      cellSizePx,
      arrowPadding = 0.32,
      color = '#1f2937',
      strokeWidth = 2,
      headRadius = 4,
      waveFade = 0.12,
      highlightOpacityBoost = 1.5,
      flashHalfWidth = 0.025,
      flashGap = 0.06,
      ring1Time = 0.275,
      ring2Time = 0.525,
      swapStart = 0.68,
      swapEnd = 0.80,
      outsideHoldEnd = 0.90,
      outsideArrowLengthScale = 1.0,
    } = options;

    this.color = color;
    this.strokeWidth = strokeWidth;
    this.headRadius = headRadius;
    this.waveFade = waveFade;
    this.highlightOpacityBoost = highlightOpacityBoost;
    this.flashHalfWidth = flashHalfWidth;
    this.flashGap = flashGap;
    this.swapStart = swapStart;
    this.swapEnd = swapEnd;
    this.outsideHoldEnd = outsideHoldEnd;
    this.outsideArrowLengthScale = outsideArrowLengthScale;

    this.arrows = this.buildArrows(
      cells,
      gridResolution,
      centerCell,
      cellSizePx,
      arrowPadding,
      ring1Time,
      ring2Time,
      swapStart,
      swapEnd
    );

    this.clip = {
      name: 'WaveCancellation',
      reduce(t: number) {
        return { wavePhase: t } as Partial<TState>;
      },
    };
  }

  async init(canvas: HTMLCanvasElement): Promise<void> {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D rendering context');
    this.ctx = ctx;
    this._initialized = true;
  }

  get initialized(): boolean {
    return this._initialized;
  }

  destroy(): void {
    this.ctx = null;
    this._initialized = false;
  }

  // --------------------------------------------------------------------------
  // Setup
  // --------------------------------------------------------------------------

  /**
   * Build every arrow on the grid, categorize it, and assign the loop-time at
   * which its associated edge cancels (interior) or swaps (boundary).
   */
  private buildArrows(
    cells: GridCellSpec[],
    gridResolution: number,
    center: { row: number; col: number },
    cellSizePx: number,
    arrowPadding: number,
    ring1Time: number,
    ring2Time: number,
    swapStart: number,
    swapEnd: number
  ): ArrowSpec[] {
    const halfPx = cellSizePx / 2;
    const arrowLen = halfPx * (1 - arrowPadding);
    const boundaryArrivalTime = (swapStart + swapEnd) / 2;

    const byRC = new Map<string, GridCellSpec>();
    for (const c of cells) byRC.set(`${c.row},${c.col}`, c);

    const dist = (r: number, c: number) =>
      Math.abs(r - center.row) + Math.abs(c - center.col);

    const ringTimeFor = (d: number) => {
      if (d <= 1) return ring1Time;
      if (d <= 2) return ring2Time;
      return Math.min(0.65, ring2Time + (d - 2) * 0.15);
    };

    const arrows: ArrowSpec[] = [];

    // Detect the row → canvas-y orientation from the cells themselves.
    // If a higher row index has a smaller canvas-y (visually higher), then
    // "visually up" pairs with row+1; otherwise it pairs with row-1.
    let upRowDelta = -1;
    for (const a of cells) {
      const b = cells.find((c) => c.col === a.col && c.row === a.row + 1);
      if (b) {
        upRowDelta = b.cy < a.cy ? 1 : -1;
        break;
      }
    }

    type Dir = { dx: number; dy: number; dRow: number; dCol: number };
    const dirs: Dir[] = [
      { dx: 1, dy: 0, dRow: 0, dCol: 1 }, // right
      { dx: -1, dy: 0, dRow: 0, dCol: -1 }, // left
      { dx: 0, dy: -1, dRow: upRowDelta, dCol: 0 }, // up
      { dx: 0, dy: 1, dRow: -upRowDelta, dCol: 0 }, // down
    ];

    for (const cell of cells) {
      for (const d of dirs) {
        const neighborRow = cell.row + d.dRow;
        const neighborCol = cell.col + d.dCol;
        const neighbor = byRC.get(`${neighborRow},${neighborCol}`);

        let category: 'interior' | 'boundary';
        let waveArrivalTime: number;

        if (
          neighbor === undefined ||
          neighborRow < 0 ||
          neighborRow >= gridResolution ||
          neighborCol < 0 ||
          neighborCol >= gridResolution
        ) {
          category = 'boundary';
          waveArrivalTime = boundaryArrivalTime;
        } else {
          category = 'interior';
          const pairDistance = Math.max(
            dist(cell.row, cell.col),
            dist(neighborRow, neighborCol)
          );
          waveArrivalTime = ringTimeFor(pairDistance);
        }

        arrows.push({
          startX: cell.cx,
          startY: cell.cy,
          dx: d.dx,
          dy: d.dy,
          baseLength: arrowLen,
          halfCellPx: halfPx,
          category,
          waveArrivalTime,
        });
      }
    }

    return arrows;
  }

  // --------------------------------------------------------------------------
  // Per-arrow opacity / length
  // --------------------------------------------------------------------------

  /**
   * Cancellation-aware opacity for interior arrows. Around the arrow's wave-
   * arrival time, opacity flashes twice (two triangular pulses peaking at
   * 1 + (boost - 1)), then the arrow fades to 0 over waveFade. Recovers to
   * 1.0 during the end-of-cycle window so the loop closes seamlessly.
   */
  private interiorOpacity(t: number, T: number): number {
    const { flashHalfWidth: hw, flashGap: gap, waveFade: fade, highlightOpacityBoost: boost } = this;
    const flash1Peak = T;
    const flash2Peak = T + gap;
    const flashEnd = flash2Peak + hw;

    // Triangular pulse: peak amplitude (boost - 1) at the peak time, linearly
    // tapering to 0 at peak ± hw.
    const pulse = (d: number) => {
      const ad = Math.abs(d);
      return ad < hw ? (boost - 1) * (1 - ad / hw) : 0;
    };

    const flashContrib = Math.max(pulse(t - flash1Peak), pulse(t - flash2Peak));

    let base: number;
    if (t < flashEnd) base = 1.0;
    else if (t < flashEnd + fade) base = 1.0 - (t - flashEnd) / fade;
    else base = 0;

    let opacity = base + flashContrib;

    // End-of-cycle recovery: ramp back to 1.0 for a seamless loop.
    if (t >= this.outsideHoldEnd) {
      const u = (t - this.outsideHoldEnd) / (1.0 - this.outsideHoldEnd);
      opacity = Math.max(opacity, u);
    }
    return opacity;
  }

  /**
   * Visibility envelope for the inside (in-cell) boundary arrows: full opacity
   * normally, fades out during the swap, returns at end of cycle.
   * Returns a multiplier in [0, 1] applied to the base 0.9 opacity.
   */
  private insideBoundaryAlpha(t: number): number {
    if (t < this.swapStart) return 1;
    if (t < this.swapEnd) return 1 - (t - this.swapStart) / (this.swapEnd - this.swapStart);
    if (t < this.outsideHoldEnd) return 0;
    // Recover at end of cycle.
    return (t - this.outsideHoldEnd) / (1.0 - this.outsideHoldEnd);
  }

  /**
   * Progress of the outside arrows: 0 before swap, ramps to 1 during swap,
   * holds at 1, then ramps back to 0 in the recovery window. Used for both
   * opacity and length scaling so the arrows "grow out of" the boundary.
   */
  private outsideArrowProgress(t: number): number {
    if (t < this.swapStart) return 0;
    if (t < this.swapEnd) return (t - this.swapStart) / (this.swapEnd - this.swapStart);
    if (t < this.outsideHoldEnd) return 1;
    return 1 - (t - this.outsideHoldEnd) / (1.0 - this.outsideHoldEnd);
  }

  // --------------------------------------------------------------------------
  // Draw
  // --------------------------------------------------------------------------

  draw(state: TState): void {
    if (!this.ctx) return;
    const t = state.wavePhase;
    const insideMult = this.insideBoundaryAlpha(t);
    const outProgress = this.outsideArrowProgress(t);

    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = this.color;
    ctx.fillStyle = this.color;
    ctx.lineWidth = this.strokeWidth;
    ctx.lineCap = 'round';

    for (const a of this.arrows) {
      if (a.category === 'interior') {
        const opacity = this.interiorOpacity(t, a.waveArrivalTime);
        if (opacity <= 0.001) continue;
        ctx.globalAlpha = opacity;
        drawArrow(
          ctx,
          a.startX,
          a.startY,
          a.startX + a.dx * a.baseLength,
          a.startY + a.dy * a.baseLength,
          this.headRadius
        );
      } else {
        // Inside boundary arrow (in-cell, pointing outward).
        const insideOpacity = 0.9 * insideMult;
        if (insideOpacity > 0.001) {
          ctx.globalAlpha = insideOpacity;
          drawArrow(
            ctx,
            a.startX,
            a.startY,
            a.startX + a.dx * a.baseLength,
            a.startY + a.dy * a.baseLength,
            this.headRadius
          );
        }

        // Outside arrow: anchored on the rectangle's outer edge, growing
        // outward as the swap progresses.
        if (outProgress > 0.001) {
          const edgeX = a.startX + a.dx * a.halfCellPx;
          const edgeY = a.startY + a.dy * a.halfCellPx;
          const outLen = a.baseLength * this.outsideArrowLengthScale * outProgress;
          ctx.globalAlpha = outProgress;
          drawArrow(
            ctx,
            edgeX,
            edgeY,
            edgeX + a.dx * outLen,
            edgeY + a.dy * outLen,
            this.headRadius
          );
        }
      }
    }

    ctx.restore();
  }

  // --------------------------------------------------------------------------
  // Factory
  // --------------------------------------------------------------------------

  static create<TState extends WaveCancellationState>(
    options: WaveCancellationOptions
  ): WaveCancellationAnimation<TState> {
    return new WaveCancellationAnimation<TState>(options);
  }
}
