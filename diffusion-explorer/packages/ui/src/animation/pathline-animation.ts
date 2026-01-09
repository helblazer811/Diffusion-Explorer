/**
 * PathlineAnimation - Reusable animation class for pathline visualization.
 *
 * Encapsulates the common pattern of animating pathlines by segment index,
 * following the Animation interface pattern used by StreamlineAnimation.
 *
 * @example
 * const animation = PathlineAnimation.fromTrajectories<MyState>(pixelPathlines, {
 *   style: { strokeWidth: 2, color: '#3b82f6', progressOpacity: 0.8, pointRadius: 4 }
 * });
 *
 * timeline.add(animation.clip, 0);
 * timeline.onTick((_, state) => {
 *   ctx.clearRect(0, 0, width, height);
 *   animation.draw(ctx, state);
 * });
 */

import type { AnimationWithData } from './animation';
import type { Clip } from './timeline';
import { drawTrajectories, type TrajectoryStyleOptions } from '../plotting/trajectories';

/**
 * Base animation state for pathline animation.
 * Users extend this for their own animation state.
 *
 * @example
 * type MyAnimationState = PathlineAnimationState & {
 *   highlightIndex: number;
 * };
 */
export interface PathlineAnimationState {
  segmentIndex: number;
  /** Optional per-segment alphas: [trajectory][segment] -> alpha (0-1), multiplies with progressOpacity */
  perSegmentAlphas?: number[][];
  /** Optional pathlines override: if provided, uses these instead of this.data.pathlines */
  pathlines?: number[][][];
}

/**
 * Options for creating a PathlineAnimation.
 */
export interface PathlineAnimationOptions {
  /** Styling options passed to drawTrajectories */
  style?: Partial<TrajectoryStyleOptions>;
}

/**
 * Data exposed by PathlineAnimation.
 */
export interface PathlineData {
  /** Pre-computed pathlines in pixel coordinates: [pathline][point][x,y] */
  pathlines: number[][][];
  /** Number of segments (points - 1) in the longest pathline */
  numSegments: number;
}

/**
 * Reusable pathline animation class.
 *
 * Implements AnimationWithData to provide:
 * - A clip that maps normalized time (0-1) to segmentIndex
 * - A draw function that renders pathlines at the current state
 * - Access to pathline data
 */
export class PathlineAnimation<TState extends PathlineAnimationState>
  implements AnimationWithData<TState, PathlineData> {

  readonly clip: Clip<TState>;
  readonly data: PathlineData;
  private style: Partial<TrajectoryStyleOptions>;

  private constructor(
    pathlines: number[][][],
    options: PathlineAnimationOptions = {}
  ) {
    // Calculate numSegments from the longest pathline
    const numSegments = pathlines.length > 0
      ? Math.max(...pathlines.map(t => (t?.length ?? 1) - 1), 1)
      : 1;

    this.data = { pathlines, numSegments };
    this.style = options.style ?? {};

    // Create clip that maps normalized time to segmentIndex
    this.clip = {
      name: 'pathline-animation',
      duration: 1,
      reduce: (t: number): Partial<TState> => ({
        segmentIndex: Math.floor(t * numSegments)
      } as Partial<TState>)
    };
  }

  /**
   * Draw pathlines at the current animation state.
   *
   * @param ctx - Canvas 2D rendering context
   * @param state - Current animation state (must include segmentIndex)
   * @param styleOverride - Optional style overrides (e.g., progressOpacity for dimming)
   */
  draw(
    ctx: CanvasRenderingContext2D,
    state: TState,
    styleOverride?: Partial<TrajectoryStyleOptions>
  ): void {
    // Use state.pathlines if provided, otherwise fall back to stored pathlines
    const pathlines = state.pathlines ?? this.data.pathlines;
    if (pathlines.length === 0) return;

    // Build style: defaults -> constructor style -> override -> state.perSegmentAlphas
    const fullStyle: TrajectoryStyleOptions = {
      strokeWidth: this.style.strokeWidth ?? 2,
      color: this.style.color ?? '#3b82f6',
      progressOpacity: this.style.progressOpacity ?? 0.8,
      pointRadius: this.style.pointRadius ?? 4,
      ...this.style,
      ...styleOverride,
      perSegmentAlphas: state.perSegmentAlphas,
    };

    drawTrajectories(ctx, pathlines, state.segmentIndex, fullStyle);
  }

  /**
   * Create a PathlineAnimation from pre-computed trajectories.
   *
   * @param pathlines - Pre-computed pathlines in pixel coordinates
   * @param options - Animation options including styling
   * @returns A new PathlineAnimation instance
   */
  static fromTrajectories<TState extends PathlineAnimationState>(
    pathlines: number[][][],
    options: PathlineAnimationOptions = {}
  ): PathlineAnimation<TState> {
    return new PathlineAnimation<TState>(pathlines, options);
  }
}
