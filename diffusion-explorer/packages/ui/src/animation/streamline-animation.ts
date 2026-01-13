/**
 * Reusable streamline animation abstraction.
 *
 * Provides a class-based animation that:
 * - Generates streamlines from a vector field
 * - Creates a Clip for Timeline integration
 * - Renders animated pulse effects along streamlines
 */

import type { Clip } from './timeline';
import type { AnimationWithData } from './animation';
import {
  generateStreamlines,
  computeStreamlineLengths,
  createAlphaLUT,
  precomputePatternIndices,
  computeAlphaTrail,
  type VectorFieldFn
} from '../plotting/streamlines';
import { drawTrajectories } from '../plotting/trajectories';

// ===== Types =====

/**
 * Base animation state type for streamline animations.
 * Users extend this for their own animation state.
 *
 * @example
 * type MyAnimationState = StreamlineAnimationState & {
 *   theta: number;  // rotation angle
 * };
 */
export type StreamlineAnimationState = {
  streamlinePhase: number;
};

/**
 * Domain bounds for streamline generation.
 */
export type StreamlineDomain = {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
};

/**
 * Options for creating a streamline animation.
 */
export type StreamlineAnimationOptions = {
  // Required
  vectorFieldFn: VectorFieldFn;
  domain: StreamlineDomain;
  toPixel: (p: [number, number]) => [number, number];

  // Generation (optional)
  density?: number | [number, number];
  minPathLength?: number;
  segmentLength?: number;
  integrationDirection?: 'forward' | 'backward' | 'both';
  startPoints?: [number, number][];  // Custom seed points for streamlines
  subdivisionFactor?: number;  // Subdivide each segment into N pieces (default: 1 = no subdivision)

  // Animation (optional)
  pulseWidthPixels?: number;      // Pulse width in pixels (default: 30)
  pulsePauseWidthPixels?: number; // Gap between pulses in pixels (default: 50)
  baseOpacity?: number;           // Maximum opacity at pulse back (default: 0.8)
  offsets?: 'random' | 'synchronized';  // How to offset pulses between streamlines
  binaryPulse?: boolean;          // If true, no alpha gradient - just on/off streaks

  // Clip options (optional)
  /** Number of pulse animation loops per clip duration (default: 1) */
  loopMultiplier?: number;

  // Style (optional)
  color?: string;
  strokeWidth?: number;
  gradientSubdivisions?: number;
};

/**
 * Per-streamline length data for animation.
 */
export type StreamlineLengthData = {
  cumulativeLengths: number[];
  totalLength: number;
  /** Precomputed LUT indices for alpha computation */
  patternIndices: Uint16Array;
};

/**
 * Data exposed by StreamlineAnimation.
 */
export type StreamlineData = {
  /** Generated streamlines in pixel coordinates */
  streamlines: number[][][];
  /** Per-streamline animation offsets */
  offsets: number[];
  /** Per-streamline length data (for pixel-based animation) */
  lengthData: StreamlineLengthData[];
  /** Maximum streamline length across all streamlines */
  maxLength: number;
};

// ===== Helper Functions =====

/**
 * Subdivide each segment of a streamline into smaller pieces.
 * Preserves relative segment lengths (longer segments remain proportionally longer).
 *
 * @param points - Array of [x, y] points
 * @param factor - Number of pieces to split each segment into (1 = no subdivision)
 * @returns New array with interpolated points
 */
function subdivideStreamline(points: number[][], factor: number): number[][] {
  if (factor <= 1 || points.length < 2) return points;

  const result: number[][] = [points[0]];

  for (let i = 0; i < points.length - 1; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];

    // Add intermediate points
    for (let k = 1; k <= factor; k++) {
      const t = k / factor;
      result.push([
        x1 + (x2 - x1) * t,
        y1 + (y2 - y1) * t
      ]);
    }
  }

  return result;
}

// ===== Class Implementation =====

/**
 * Animated streamlines for visualizing vector fields.
 *
 * Implements AnimationWithData to provide:
 * - A clip for Timeline integration
 * - A draw method for rendering
 * - Access to generated streamline data
 *
 * @example
 * const anim = StreamlineAnimation.create<MyState>({
 *   vectorFieldFn,
 *   domain: { xMin: -2, xMax: 2, yMin: -2, yMax: 2 },
 *   toPixel,
 *   density: 0.8,
 *   color: '#3b82f6',
 * });
 *
 * timeline.add(anim.clip, { start: 0, end: 1 });
 *
 * // In draw function:
 * anim.draw(ctx, state);
 */
export class StreamlineAnimation<TState extends StreamlineAnimationState>
  implements AnimationWithData<TState, StreamlineData> {

  readonly clip: Clip<TState>;
  readonly data: StreamlineData;

  // Style options
  private readonly baseOpacity: number;
  private readonly color: string;
  private readonly strokeWidth: number;
  private readonly gradientSubdivisions: number;

  // Animation data
  private readonly alphaLUT: Float32Array;
  private readonly alphaBuffers: Float32Array[];

  private constructor(options: StreamlineAnimationOptions) {
    const {
      vectorFieldFn,
      domain,
      toPixel,
      // Generation defaults
      density = 1.0,
      minPathLength = 2.0,
      segmentLength,
      integrationDirection = 'both',
      startPoints,
      subdivisionFactor = 1,
      // Animation defaults
      pulseWidthPixels = 30,
      pulsePauseWidthPixels = 50,
      baseOpacity = 0.8,
      offsets: offsetMode = 'synchronized',
      binaryPulse = false,
      // Clip defaults
      loopMultiplier = 1,
      // Style defaults
      color = '#3b82f6',
      strokeWidth = 2.5,
      gradientSubdivisions = 12,
    } = options;

    // Store style options
    this.baseOpacity = baseOpacity;
    this.color = color;
    this.strokeWidth = strokeWidth;
    this.gradientSubdivisions = gradientSubdivisions;

    // Generate streamlines in domain coordinates
    const rawStreamlines = generateStreamlines(vectorFieldFn, {
      domainMin: [domain.xMin, domain.yMin],
      domainMax: [domain.xMax, domain.yMax],
      density,
      integrationDirection,
      minlength: minPathLength,
      segmentLength,
      startPoints,
    });

    // Convert to pixel coordinates and apply subdivision
    const streamlines = rawStreamlines.map((streamline) => {
      const pixelPoints = streamline.map((point) => toPixel(point as [number, number]));
      return subdivideStreamline(pixelPoints, subdivisionFactor);
    });

    // Compute spacing for precomputation
    const spacing = pulseWidthPixels + pulsePauseWidthPixels;

    // Compute cumulative lengths and precompute pattern indices for each streamline
    const lengthData: StreamlineLengthData[] = streamlines.map((streamline) => {
      const { cumulativeLengths, totalLength } = computeStreamlineLengths(streamline);
      const patternIndices = precomputePatternIndices(cumulativeLengths, spacing);
      return { cumulativeLengths, totalLength, patternIndices };
    });

    // Find max length across all streamlines
    const maxLength = Math.max(...lengthData.map((d) => d.totalLength), 0);

    // Generate offsets
    const offsets =
      offsetMode === 'random'
        ? streamlines.map(() => Math.random())
        : streamlines.map(() => 0);

    // Create alpha LUT and reusable buffers
    this.alphaLUT = createAlphaLUT(pulseWidthPixels, spacing, baseOpacity, 256, binaryPulse);
    this.alphaBuffers = streamlines.map((s) => new Float32Array(s.length));

    // Store data
    this.data = { streamlines, offsets, lengthData, maxLength };

    // Create the clip
    this.clip = {
      name: 'StreamlinePhase',
      reduce(t: number) {
        return { streamlinePhase: (t * loopMultiplier) % 1 } as Partial<TState>;
      },
    };
  }

  /**
   * Draw the streamlines at the current animation state.
   *
   * @param ctx - Canvas 2D rendering context
   * @param state - Current animation state (uses streamlinePhase)
   */
  draw(ctx: CanvasRenderingContext2D, state: TState): void {
    const { streamlines, offsets, lengthData } = this.data;
    if (streamlines.length === 0) return;

    const phase = state.streamlinePhase;

    // Compute per-segment alphas using precomputed LUT and pattern indices
    const perSegmentAlphas = streamlines.map((_, i) => {
      const { patternIndices } = lengthData[i];
      const offset = offsets[i] ?? 0;
      const outBuffer = this.alphaBuffers[i];

      computeAlphaTrail(
        patternIndices,
        this.alphaLUT,
        phase,
        offset,
        outBuffer
      );
      return Array.from(outBuffer);
    });

    // Draw all streamlines
    drawTrajectories(ctx, streamlines, 0, {
      strokeWidth: this.strokeWidth,
      color: this.color,
      progressOpacity: this.baseOpacity,
      pointRadius: 0,
      showPreview: false,
      showHeadMarker: false,
      perSegmentAlphas,
      gradientSubdivisions: this.gradientSubdivisions,
    });
  }

  /**
   * Create a new StreamlineAnimation instance.
   *
   * @param options - Configuration options for the animation
   * @returns A new StreamlineAnimation instance
   */
  static create<TState extends StreamlineAnimationState>(
    options: StreamlineAnimationOptions
  ): StreamlineAnimation<TState> {
    return new StreamlineAnimation<TState>(options);
  }
}

