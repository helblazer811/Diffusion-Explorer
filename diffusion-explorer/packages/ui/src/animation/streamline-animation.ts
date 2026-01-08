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
import { generateStreamlines, computeAlphaTrail, type VectorFieldFn } from '../plotting/streamlines';
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

  // Animation (optional)
  pulseWidth?: number;
  pulsePauseWidth?: number;
  baseOpacity?: number;
  offsets?: 'random' | 'synchronized';

  // Clip options (optional)
  clipDuration?: number;
  loopMultiplier?: number;

  // Style (optional)
  color?: string;
  strokeWidth?: number;
  gradientSubdivisions?: number;
};

/**
 * Data exposed by StreamlineAnimation.
 */
export type StreamlineData = {
  /** Generated streamlines in pixel coordinates */
  streamlines: number[][][];
  /** Per-streamline animation offsets */
  offsets: number[];
};

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
 * timeline.add(anim.clip, 0);
 *
 * // In draw function:
 * anim.draw(ctx, state);
 */
export class StreamlineAnimation<TState extends StreamlineAnimationState>
  implements AnimationWithData<TState, StreamlineData> {

  readonly clip: Clip<TState>;
  readonly data: StreamlineData;

  // Style options (stored for draw)
  private readonly pulseWidth: number;
  private readonly pulsePauseWidth: number;
  private readonly baseOpacity: number;
  private readonly color: string;
  private readonly strokeWidth: number;
  private readonly gradientSubdivisions: number;

  private constructor(options: StreamlineAnimationOptions) {
    const {
      vectorFieldFn,
      domain,
      toPixel,
      // Generation defaults
      density = 1.0,
      minPathLength = 2.0,
      segmentLength = 0.01,
      integrationDirection = 'both',
      startPoints,
      // Animation defaults
      pulseWidth = 0.2,
      pulsePauseWidth = 0.05,
      baseOpacity = 0.8,
      offsets: offsetMode = 'synchronized',
      // Clip defaults
      clipDuration = 1,
      loopMultiplier = 1,
      // Style defaults
      color = '#3b82f6',
      strokeWidth = 2.5,
      gradientSubdivisions = 12,
    } = options;

    // Store style options
    this.pulseWidth = pulseWidth;
    this.pulsePauseWidth = pulsePauseWidth;
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

    // Convert to pixel coordinates
    const streamlines = rawStreamlines.map((streamline) =>
      streamline.map((point) => toPixel(point as [number, number]))
    );

    // Generate offsets
    const offsets =
      offsetMode === 'random'
        ? streamlines.map(() => Math.random())
        : streamlines.map(() => 0);

    // Store data
    this.data = { streamlines, offsets };

    // Create the clip
    this.clip = {
      name: 'StreamlinePhase',
      duration: clipDuration,
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
    const { streamlines, offsets } = this.data;
    if (streamlines.length === 0) return;

    const phase = state.streamlinePhase;

    // Compute per-segment alphas for pulse animation
    const perSegmentAlphas: number[][] = streamlines.map((streamline, i) => {
      const numSegments = streamline.length - 1;
      const offset = offsets[i] ?? 0;
      return computeAlphaTrail(
        numSegments,
        phase,
        offset,
        this.pulseWidth,
        this.pulsePauseWidth,
        this.baseOpacity
      );
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

