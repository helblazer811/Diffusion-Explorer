/**
 * Pulsing Region Animation
 *
 * Animates trajectories flowing INTO and OUT OF a clicked region.
 * Pulses flow toward the click point from t=0 (backward trajectories)
 * and away from the click point toward t=1 (forward trajectories).
 *
 * Uses the same alpha LUT approach as StreamlineAnimation for efficient
 * per-frame pulse computation.
 */

import type { Clip } from "@diffusion-explorer/ui";
import {
  createAlphaLUT,
  precomputePatternIndices,
  computeAlphaTrail,
  computeStreamlineLengths,
  drawTrajectories,
} from "@diffusion-explorer/ui";

// ============================================================================
// Types
// ============================================================================

/**
 * Animation state for pulsing region.
 */
export interface PulsingRegionAnimationState {
  pulsePhase: number; // 0-1, drives pulse position
}

/**
 * Represents a clicked region with bidirectional trajectories.
 */
export interface PulsingRegion {
  id: string;
  clickTime: number; // t_click (0-1)
  clickY: number; // y_click in domain coordinates
  backwardTrajectories: number[][][]; // [sample][point][x,y] in pixels
  forwardTrajectories: number[][][]; // [sample][point][x,y] in pixels
}

/**
 * Options for creating a PulsingRegionAnimation.
 */
/**
 * D3-like scale with invert method.
 */
interface ScaleWithInvert {
  (t: number): number;
  invert(x: number): number;
}

export interface PulsingRegionAnimationOptions {
  // Required
  region: PulsingRegion;
  xScale: ScaleWithInvert; // Time to pixel scale (d3 scale)

  // Time window
  pulseTimeWindow: number; // Total width of visible window (e.g., 0.3)
  fadeWidth?: number; // Fraction of window for edge fade (default: 0.1)

  // Pulse appearance
  pulseWidthPixels?: number; // Width of each pulse (default: 25)
  pulsePauseWidthPixels?: number; // Gap between pulses (default: 40)
  baseOpacity?: number; // Max opacity (default: 0.8)
  binaryPulse?: boolean; // Sharp edges vs gradient (default: false)

  // Animation
  loopMultiplier?: number; // Loops per timeline duration (default: 2)

  // Style
  color?: string; // Stroke color (default: white)
  strokeWidth?: number; // Line width (default: 2.5)
  gradientSubdivisions?: number; // Smoothness of alpha transitions (default: 8)
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
// PulsingRegionAnimation Class
// ============================================================================

export class PulsingRegionAnimation<
  TState extends PulsingRegionAnimationState,
> {
  readonly clip: Clip<TState>;

  // Region data
  private readonly region: PulsingRegion;
  private readonly xScale: ScaleWithInvert;

  // Time window
  private readonly pulseTimeWindow: number;
  private readonly fadeWidth: number;

  // Style
  private readonly color: string;
  private readonly strokeWidth: number;
  private readonly baseOpacity: number;
  private readonly gradientSubdivisions: number;

  // Precomputed pulse data
  private readonly alphaLUT: Float32Array;
  private readonly backwardLengthData: TrajectoryLengthData[];
  private readonly forwardLengthData: TrajectoryLengthData[];
  private readonly backwardAlphaBuffers: Float32Array[];
  private readonly forwardAlphaBuffers: Float32Array[];

  // Canvas context (set in init)
  private ctx: CanvasRenderingContext2D | null = null;

  constructor(options: PulsingRegionAnimationOptions) {
    const {
      region,
      xScale,
      pulseTimeWindow,
      fadeWidth = 0.1,
      pulseWidthPixels = 25,
      pulsePauseWidthPixels = 40,
      baseOpacity = 0.8,
      binaryPulse = false,
      loopMultiplier = 2,
      color = "#ffffff",
      strokeWidth = 2.5,
      gradientSubdivisions = 8,
    } = options;

    this.region = region;
    this.xScale = xScale;
    this.pulseTimeWindow = pulseTimeWindow;
    this.fadeWidth = fadeWidth;
    this.color = color;
    this.strokeWidth = strokeWidth;
    this.baseOpacity = baseOpacity;
    this.gradientSubdivisions = gradientSubdivisions;

    // Create the clip
    this.clip = {
      name: "PulsingRegion",
      reduce(t: number) {
        return { pulsePhase: (t * loopMultiplier) % 1 } as Partial<TState>;
      },
    };

    // Create alpha LUT
    const spacing = pulseWidthPixels + pulsePauseWidthPixels;
    this.alphaLUT = createAlphaLUT(
      pulseWidthPixels,
      spacing,
      baseOpacity,
      256,
      binaryPulse
    );

    // Precompute length data and alpha buffers for backward trajectories
    this.backwardLengthData = region.backwardTrajectories.map((traj) => {
      const { cumulativeLengths, totalLength } = computeStreamlineLengths(traj);
      const patternIndices = precomputePatternIndices(
        cumulativeLengths,
        spacing
      );
      return { cumulativeLengths, totalLength, patternIndices };
    });
    this.backwardAlphaBuffers = region.backwardTrajectories.map(
      (traj) => new Float32Array(traj.length)
    );

    // Precompute length data and alpha buffers for forward trajectories
    this.forwardLengthData = region.forwardTrajectories.map((traj) => {
      const { cumulativeLengths, totalLength } = computeStreamlineLengths(traj);
      const patternIndices = precomputePatternIndices(
        cumulativeLengths,
        spacing
      );
      return { cumulativeLengths, totalLength, patternIndices };
    });
    this.forwardAlphaBuffers = region.forwardTrajectories.map(
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
   * Draw the pulsing region at the current animation state.
   */
  draw(state: TState): void {
    if (!this.ctx) return;

    const phase = state.pulsePhase;
    const { clickTime, backwardTrajectories, forwardTrajectories } =
      this.region;

    // Compute time window bounds
    const tMin = clickTime - this.pulseTimeWindow / 2;
    const tMax = clickTime + this.pulseTimeWindow / 2;

    // Draw backward trajectories (pulses flow toward click point)
    // For backward, we want pulses to move left-to-right toward t_click
    // This means we need to reverse the phase direction
    if (backwardTrajectories.length > 0) {
      const backwardAlphas = this.computeAlphasWithTimeWindow(
        backwardTrajectories,
        this.backwardLengthData,
        this.backwardAlphaBuffers,
        1 - phase, // Reverse phase for backward flow
        tMin,
        tMax
      );

      drawTrajectories(this.ctx, backwardTrajectories, 0, {
        strokeWidth: this.strokeWidth,
        color: this.color,
        opacity: this.baseOpacity,
        pointRadius: 0,
        showPreview: false,
        showHeadMarker: false,
        perSegmentAlphas: backwardAlphas,
        gradientSubdivisions: this.gradientSubdivisions,
      });
    }

    // Draw forward trajectories (pulses flow away from click point)
    // Standard phase direction
    if (forwardTrajectories.length > 0) {
      const forwardAlphas = this.computeAlphasWithTimeWindow(
        forwardTrajectories,
        this.forwardLengthData,
        this.forwardAlphaBuffers,
        phase, // Standard phase for forward flow
        tMin,
        tMax
      );

      drawTrajectories(this.ctx, forwardTrajectories, 0, {
        strokeWidth: this.strokeWidth,
        color: this.color,
        opacity: this.baseOpacity,
        pointRadius: 0,
        showPreview: false,
        showHeadMarker: false,
        perSegmentAlphas: forwardAlphas,
        gradientSubdivisions: this.gradientSubdivisions,
      });
    }
  }

  /**
   * Compute per-segment alphas with time window clipping and edge fade.
   */
  private computeAlphasWithTimeWindow(
    trajectories: number[][][],
    lengthData: TrajectoryLengthData[],
    alphaBuffers: Float32Array[],
    phase: number,
    tMin: number,
    tMax: number
  ): number[][] {
    const fadeWidthTime = this.pulseTimeWindow * this.fadeWidth;

    return trajectories.map((traj, i) => {
      const { patternIndices } = lengthData[i];
      const outBuffer = alphaBuffers[i];

      // Compute base pulse alphas
      computeAlphaTrail(patternIndices, this.alphaLUT, phase, 0, outBuffer);

      // Apply time window clipping and fade
      const alphas: number[] = [];
      for (let j = 0; j < traj.length; j++) {
        const pixelX = traj[j][0];
        const t = this.xScale.invert(pixelX);

        let windowAlpha = 1.0;

        // Outside window: zero alpha
        if (t < tMin || t > tMax) {
          windowAlpha = 0;
        }
        // Fade at left edge
        else if (t < tMin + fadeWidthTime) {
          windowAlpha = (t - tMin) / fadeWidthTime;
        }
        // Fade at right edge
        else if (t > tMax - fadeWidthTime) {
          windowAlpha = (tMax - t) / fadeWidthTime;
        }

        alphas.push(outBuffer[j] * Math.max(0, Math.min(1, windowAlpha)));
      }

      return alphas;
    });
  }

  /**
   * Update the region's trajectories (for streaming updates).
   */
  updateRegion(region: PulsingRegion): void {
    // Update trajectory references
    (this.region as any).backwardTrajectories = region.backwardTrajectories;
    (this.region as any).forwardTrajectories = region.forwardTrajectories;

    // Recompute length data for new trajectories
    const spacing =
      this.alphaLUT.length > 0
        ? 256 / this.alphaLUT.length
        : 65; // Default spacing

    // Update backward data
    for (let i = 0; i < region.backwardTrajectories.length; i++) {
      const traj = region.backwardTrajectories[i];
      if (traj.length > 0) {
        const { cumulativeLengths, totalLength } =
          computeStreamlineLengths(traj);
        const patternIndices = precomputePatternIndices(
          cumulativeLengths,
          spacing
        );
        this.backwardLengthData[i] = {
          cumulativeLengths,
          totalLength,
          patternIndices,
        };
        // Resize buffer if needed
        if (this.backwardAlphaBuffers[i].length < traj.length) {
          this.backwardAlphaBuffers[i] = new Float32Array(traj.length);
        }
      }
    }

    // Update forward data
    for (let i = 0; i < region.forwardTrajectories.length; i++) {
      const traj = region.forwardTrajectories[i];
      if (traj.length > 0) {
        const { cumulativeLengths, totalLength } =
          computeStreamlineLengths(traj);
        const patternIndices = precomputePatternIndices(
          cumulativeLengths,
          spacing
        );
        this.forwardLengthData[i] = {
          cumulativeLengths,
          totalLength,
          patternIndices,
        };
        // Resize buffer if needed
        if (this.forwardAlphaBuffers[i].length < traj.length) {
          this.forwardAlphaBuffers[i] = new Float32Array(traj.length);
        }
      }
    }
  }

  /**
   * Destroy the animation and release resources.
   */
  destroy(): void {
    this.ctx = null;
  }
}
