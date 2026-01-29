/**
 * Pulsing 2D Animation
 *
 * Animates trajectories flowing INWARD toward a clicked point in 2D space.
 * Pulses travel along backward trajectories (from source distribution toward
 * the click point), creating a visual "inward flow" effect.
 *
 * Uses the same alpha LUT approach as StreamlineAnimation for efficient
 * per-frame pulse computation.
 */

import type { Clip, TrajectoryOutlineOptions } from "@diffusion-explorer/ui";
import {
  createAlphaLUT,
  precomputePatternIndices,
  computeAlphaTrail,
  computeStreamlineLengths,
  drawTrajectories,
  drawArrowHead,
} from "@diffusion-explorer/ui";

// ============================================================================
// Types
// ============================================================================

/**
 * Animation state for 2D pulsing region.
 */
export interface Pulsing2DAnimationState {
  pulsePhase: number; // 0-1, drives pulse position
}

/**
 * Represents a clicked region with inward trajectories in 2D.
 */
export interface Pulsing2DRegion {
  id: string;
  clickPoint: [number, number]; // Click location in pixel coords
  trajectories: number[][][]; // [sample][point][x,y] in pixel coords
}

/**
 * Options for creating a Pulsing2DAnimation.
 */
export interface Pulsing2DAnimationOptions {
  // Required
  region: Pulsing2DRegion;

  // Pulse appearance
  pulseWidthPixels?: number; // Width of each pulse (default: 40)
  pulsePauseWidthPixels?: number; // Gap between pulses (default: 60)
  baseOpacity?: number; // Max opacity (default: 0.8)
  binaryPulse?: boolean; // Sharp edges vs gradient (default: false)

  // Animation
  loopMultiplier?: number; // Loops per timeline duration (default: 2)

  // Style
  color?: string; // Stroke color (default: #ff8c00)
  strokeWidth?: number; // Line width (default: 2.5)
  gradientSubdivisions?: number; // Smoothness of alpha transitions (default: 8)

  // Preview & markers
  showPreview?: boolean; // Show full trajectory as preview (default: false)
  previewOpacity?: number; // Opacity of preview (default: 0.3)
  showHeadMarker?: boolean; // Show marker at head of trajectory (default: false)
  pointRadius?: number; // Radius of head marker (default: 4)

  // Outline
  outline?: TrajectoryOutlineOptions; // Optional outline styling

  // Arrow heads
  showArrowHeads?: boolean; // Show arrow heads at pulse fronts (default: false)
  arrowHeadRadius?: number; // Size of arrow heads (default: 6)
}

/**
 * Precomputed data for a single trajectory.
 */
interface TrajectoryLengthData {
  cumulativeLengths: number[];
  totalLength: number;
  patternIndices: Uint16Array;
}

// ============================================================================
// Pulsing2DAnimation Class
// ============================================================================

export class Pulsing2DAnimation<
  TState extends Pulsing2DAnimationState,
> {
  readonly clip: Clip<TState>;

  // Region data
  private readonly region: Pulsing2DRegion;

  // Style
  private readonly color: string;
  private readonly strokeWidth: number;
  private readonly baseOpacity: number;
  private readonly gradientSubdivisions: number;

  // Preview & markers
  private readonly showPreview: boolean;
  private readonly previewOpacity: number;
  private readonly showHeadMarker: boolean;
  private readonly pointRadius: number;

  // Outline
  private readonly outline?: TrajectoryOutlineOptions;

  // Arrow heads
  private readonly showArrowHeads: boolean;
  private readonly arrowHeadRadius: number;

  // Precomputed pulse data
  private readonly alphaLUT: Float32Array;
  private readonly spacing: number;
  private lengthData: TrajectoryLengthData[];
  private alphaBuffers: Float32Array[];

  // Canvas context (set in init)
  private ctx: CanvasRenderingContext2D | null = null;

  constructor(options: Pulsing2DAnimationOptions) {
    const {
      region,
      pulseWidthPixels = 40,
      pulsePauseWidthPixels = 60,
      baseOpacity = 0.8,
      binaryPulse = false,
      loopMultiplier = 2,
      color = "#ff8c00",
      strokeWidth = 2.5,
      gradientSubdivisions = 8,
      showPreview = false,
      previewOpacity = 0.3,
      showHeadMarker = false,
      pointRadius = 4,
      outline,
      showArrowHeads = false,
      arrowHeadRadius = 6,
    } = options;

    this.region = region;
    this.showArrowHeads = showArrowHeads;
    this.arrowHeadRadius = arrowHeadRadius;
    this.color = color;
    this.strokeWidth = strokeWidth;
    this.baseOpacity = baseOpacity;
    this.gradientSubdivisions = gradientSubdivisions;
    this.showPreview = showPreview;
    this.previewOpacity = previewOpacity;
    this.showHeadMarker = showHeadMarker;
    this.pointRadius = pointRadius;
    this.outline = outline;

    // Create the clip
    this.clip = {
      name: "Pulsing2D",
      reduce(t: number) {
        return { pulsePhase: (t * loopMultiplier) % 1 } as Partial<TState>;
      },
    };

    // Create alpha LUT
    this.spacing = pulseWidthPixels + pulsePauseWidthPixels;
    this.alphaLUT = createAlphaLUT(
      pulseWidthPixels,
      this.spacing,
      baseOpacity,
      256,
      binaryPulse
    );

    // Precompute length data and alpha buffers
    this.lengthData = region.trajectories.map((traj) => {
      const { cumulativeLengths, totalLength } = computeStreamlineLengths(traj);
      const patternIndices = precomputePatternIndices(
        cumulativeLengths,
        this.spacing
      );
      return { cumulativeLengths, totalLength, patternIndices };
    });
    this.alphaBuffers = region.trajectories.map(
      (traj) => new Float32Array(traj.length)
    );
  }

  /**
   * Initialize with a canvas context.
   */
  init(ctx: CanvasRenderingContext2D): void {
    this.ctx = ctx;
  }

  /**
   * Draw the pulsing trajectories at the current animation state.
   * Pulses flow inward (toward the click point), so phase is reversed.
   */
  draw(state: TState): void {
    if (!this.ctx) return;

    const { trajectories } = this.region;
    if (trajectories.length === 0) return;

    // Reverse phase so pulses flow toward click point
    // (trajectories go from source → click, we want visual flow in that direction)
    const phase = state.pulsePhase;

    // Compute per-segment alphas
    const perSegmentAlphas = trajectories.map((traj, i) => {
      const { patternIndices } = this.lengthData[i];
      const outBuffer = this.alphaBuffers[i];

      // Compute base pulse alphas
      computeAlphaTrail(patternIndices, this.alphaLUT, phase, 0, outBuffer);

      // Convert to regular array
      const alphas: number[] = new Array(traj.length);
      for (let j = 0; j < traj.length; j++) {
        alphas[j] = outBuffer[j];
      }
      return alphas;
    });

    // segmentIndex = full length so all segments are drawn
    const maxSegments = trajectories.reduce((max, t) => Math.max(max, t.length - 1), 0);

    drawTrajectories(this.ctx, trajectories, maxSegments, {
      strokeWidth: this.strokeWidth,
      color: this.color,
      opacity: this.baseOpacity,
      pointRadius: this.pointRadius,
      showPreview: this.showPreview,
      previewOpacity: this.previewOpacity,
      showHeadMarker: this.showHeadMarker,
      perSegmentAlphas,
      gradientSubdivisions: this.gradientSubdivisions,
      outline: this.outline,
    });

    // Draw arrow heads at pulse fronts with interpolated positions
    // Uses direct phase-based computation to avoid flickering from discrete point selection
    if (this.showArrowHeads && this.ctx) {
      this.ctx.fillStyle = this.color;

      // The LUT encodes alpha from 0 at front to baseOpacity at back of pulse
      // Phase shifts the pattern: phase=0 means pattern start is at distance 0
      // As phase increases, the pattern slides forward along the trajectory
      const phaseShift = phase * this.spacing;

      for (let i = 0; i < trajectories.length; i++) {
        const traj = trajectories[i];
        const { cumulativeLengths, totalLength } = this.lengthData[i];
        if (traj.length < 2 || totalLength === 0) continue;

        // Find all pulse fronts along this trajectory
        // Pulse front is where pattern position = 0 (start of bright region)
        // Pattern position at distance d = (d - phaseShift) % spacing
        // Front is where (d - phaseShift) % spacing = 0, i.e., d = phaseShift + k*spacing
        let dist = phaseShift % this.spacing;
        if (dist < 0) dist += this.spacing;

        while (dist < totalLength) {
          // Binary search to find segment containing this distance
          let lo = 0, hi = cumulativeLengths.length - 1;
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (cumulativeLengths[mid] < dist) lo = mid + 1;
            else hi = mid;
          }
          const segIdx = lo;

          if (segIdx > 0 && segIdx < traj.length) {
            // Interpolate position within segment
            const segStart = cumulativeLengths[segIdx - 1];
            const segEnd = cumulativeLengths[segIdx];
            const segLen = segEnd - segStart;
            const t = segLen > 0 ? (dist - segStart) / segLen : 0;

            const from = traj[segIdx - 1];
            const to = traj[segIdx];
            const x = from[0] + t * (to[0] - from[0]);
            const y = from[1] + t * (to[1] - from[1]);

            // Compute direction for arrow head
            const dx = to[0] - from[0];
            const dy = to[1] - from[1];
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len > 0) {
              const dirX = dx / len;
              const dirY = dy / len;
              // Draw arrow pointing in direction of travel at full opacity
              this.ctx.globalAlpha = this.baseOpacity;
              drawArrowHead(
                this.ctx,
                x - dirX * this.arrowHeadRadius,
                y - dirY * this.arrowHeadRadius,
                x, y,
                this.arrowHeadRadius
              );
            }
          }

          dist += this.spacing;
        }
      }
      this.ctx.globalAlpha = 1.0;
    }
  }

  /**
   * Update the region's trajectories (for streaming updates).
   */
  updateRegion(region: Pulsing2DRegion): void {
    // Update trajectory references
    (this.region as any).trajectories = region.trajectories;

    // Recompute length data for new trajectories
    this.lengthData = region.trajectories.map((traj) => {
      if (traj.length === 0) {
        return { cumulativeLengths: [], totalLength: 0, patternIndices: new Uint16Array(0) };
      }
      const { cumulativeLengths, totalLength } = computeStreamlineLengths(traj);
      const patternIndices = precomputePatternIndices(
        cumulativeLengths,
        this.spacing
      );
      return { cumulativeLengths, totalLength, patternIndices };
    });

    // Resize alpha buffers if needed
    this.alphaBuffers = region.trajectories.map((traj, i) => {
      if (this.alphaBuffers[i] && this.alphaBuffers[i].length >= traj.length) {
        return this.alphaBuffers[i];
      }
      return new Float32Array(traj.length);
    });
  }

  /**
   * Destroy the animation and release resources.
   */
  destroy(): void {
    this.ctx = null;
  }
}
