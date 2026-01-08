/**
 * Reusable streamline animation abstraction.
 *
 * Provides a single setup function that returns:
 * - A Clip for use with Timeline
 * - A draw function for rendering animated streamlines
 */

import type { Clip } from './animation';
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
 * Return type of createStreamlineAnimation.
 */
export type StreamlineAnimation<TState extends StreamlineAnimationState> = {
  /** Clip for use with Timeline - updates streamlinePhase state */
  clip: Clip<TState>;
  /** Draw function - renders streamlines at given phase */
  draw: (ctx: CanvasRenderingContext2D, phase: number) => void;
  /** Generated streamlines in pixel coordinates (for advanced use) */
  streamlines: number[][][];
  /** Per-streamline animation offsets */
  offsets: number[];
};

// ===== Factory Function =====

/**
 * Creates a reusable streamline animation.
 *
 * One call sets up everything:
 * - Generates streamlines from the vector field
 * - Converts to pixel coordinates
 * - Returns a clip for Timeline and a draw function
 *
 * @example
 * const anim = createStreamlineAnimation<MyState>({
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
 * anim.draw(ctx, state.streamlinePhase);
 */
export function createStreamlineAnimation<TState extends StreamlineAnimationState>(
  options: StreamlineAnimationOptions
): StreamlineAnimation<TState> {
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

  // Create the clip
  const clip: Clip<TState> = {
    name: 'StreamlinePhase',
    duration: clipDuration,
    reduce(t: number) {
      return { streamlinePhase: (t * loopMultiplier) % 1 } as Partial<TState>;
    },
  };

  // Create the draw function
  function draw(ctx: CanvasRenderingContext2D, phase: number): void {
    if (streamlines.length === 0) return;

    // Compute per-segment alphas for pulse animation
    const perSegmentAlphas: number[][] = streamlines.map((streamline, i) => {
      const numSegments = streamline.length - 1;
      const offset = offsets[i] ?? 0;
      return computeAlphaTrail(
        numSegments,
        phase,
        offset,
        pulseWidth,
        pulsePauseWidth,
        baseOpacity
      );
    });

    // Draw all streamlines
    drawTrajectories(ctx, streamlines, 0, {
      strokeWidth,
      color,
      progressOpacity: baseOpacity,
      pointRadius: 0,
      showPreview: false,
      showHeadMarker: false,
      perSegmentAlphas,
      gradientSubdivisions,
    });
  }

  return { clip, draw, streamlines, offsets };
}
