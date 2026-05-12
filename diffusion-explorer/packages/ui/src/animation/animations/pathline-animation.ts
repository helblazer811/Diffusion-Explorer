/**
 * PathlineAnimation - Reusable animation class for pathline visualization.
 *
 * Encapsulates the common pattern of animating pathlines by segment index,
 * following the Animation interface pattern.
 *
 * @example
 * const animation = PathlineAnimation.fromTrajectories<MyState>(pixelPathlines, {
 *   style: { strokeWidth: 2, color: '#3b82f6', opacity: 0.8, pointRadius: 4 }
 * });
 *
 * await animation.init(canvas);
 * timeline.add(animation.clip, { start: 0, end: 1 });
 * timeline.onTick((_, state) => {
 *   ctx.clearRect(0, 0, width, height);
 *   animation.draw(state);
 * });
 */

import type { AnimationWithData, Clip } from 'tempus';
import {
  drawTrajectories,
  isGPUTrajectoryRendererActive,
  type TrajectoryStyleOptions,
} from '../../plotting/trajectories';

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
  /** Optional per-segment alphas: [trajectory][segment] -> alpha (0-1), multiplies with opacity */
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
  /**
   * Rendering backend.
   * - `'cpu'` (default): uses Canvas 2D. Compatible with any canvas.
   * - `'gpu'`: uses WebGPU via the shared `GPUTrajectoryRenderer`. The canvas
   *   passed to `init()` must be pristine (no prior `getContext('2d')` call).
   * - `'auto'`: picks `'gpu'` when `navigator.gpu` is available, else `'cpu'`.
   *   Runtime GPU failures fall back to CPU silently inside `drawTrajectories`.
   */
  backend?: 'cpu' | 'gpu' | 'auto';
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

function resolveBackend(requested: 'cpu' | 'gpu' | 'auto'): 'cpu' | 'gpu' {
  if (requested !== 'auto') return requested;
  return typeof navigator !== 'undefined' && 'gpu' in navigator ? 'gpu' : 'cpu';
}

function buildStyle(
  base: Partial<TrajectoryStyleOptions>,
  override?: Partial<TrajectoryStyleOptions>,
  perSegmentAlphas?: number[][]
): TrajectoryStyleOptions {
  return {
    strokeWidth: base.strokeWidth ?? 2,
    color: base.color ?? '#3b82f6',
    opacity: base.opacity ?? 0.8,
    pointRadius: base.pointRadius ?? 4,
    ...base,
    ...override,
    perSegmentAlphas,
  };
}

/**
 * Reusable pathline animation class.
 *
 * Implements AnimationWithData to provide:
 * - A clip that maps normalized time (0-1) to segmentIndex
 * - A draw function that renders pathlines at the current state
 * - Access to pathline data
 *
 * Lifecycle:
 * 1. Create with fromTrajectories()
 * 2. Initialize with init(canvas)
 * 3. Draw with draw(state)
 * 4. Cleanup with destroy()
 */
export class PathlineAnimation<TState extends PathlineAnimationState>
  implements AnimationWithData<TState, PathlineData> {

  readonly clip: Clip<TState>;
  readonly data: PathlineData;
  private style: Partial<TrajectoryStyleOptions>;
  private requestedBackend: 'cpu' | 'gpu' | 'auto';

  // Backend storage for init/draw pattern.
  // CPU mode stores the 2D context; GPU mode stores the bare canvas.
  private ctx: CanvasRenderingContext2D | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private resolvedBackend: 'cpu' | 'gpu' = 'cpu';
  private _initialized = false;

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
    this.requestedBackend = options.backend ?? 'cpu';

    // Create clip that maps normalized time to segmentIndex
    this.clip = {
      name: 'pathline-animation',
      reduce: (t: number): Partial<TState> => ({
        segmentIndex: Math.floor(t * numSegments)
      } as Partial<TState>)
    };
  }

  /**
   * Initialize the animation with a canvas element.
   *
   * - In `'cpu'` mode: acquires a 2D rendering context from the canvas.
   * - In `'gpu'` mode: stores the bare canvas and pre-warms the shared
   *   `GPUTrajectoryRenderer` cache by issuing an empty draw call, so that
   *   subsequent `draw()` calls dispatch synchronously.
   *
   * @param canvas - HTML canvas element to render to
   * @throws Error if the 2D context cannot be obtained (CPU mode)
   */
  async init(canvas: HTMLCanvasElement): Promise<void> {
    this.resolvedBackend = resolveBackend(this.requestedBackend);

    if (this.resolvedBackend === 'gpu') {
      this.canvas = canvas;
      // Pre-warm the GPU renderer cache so future draw() calls are sync.
      // An empty trajectories array creates the renderer without rendering anything.
      await drawTrajectories(
        canvas,
        [],
        0,
        buildStyle(this.style),
        { clearCanvas: false }
      );

      // If the user explicitly requested 'gpu' but the dispatcher silently fell
      // back to CPU (no WebGPU, adapter request failed, etc.), surface that.
      // 'auto' callers don't get this warning — they opted in to fallback.
      // The dispatcher's internal `gpuFailed` set continues to route subsequent
      // draws on this canvas to CPU, so functionally everything keeps working.
      if (this.requestedBackend === 'gpu' && !isGPUTrajectoryRendererActive(canvas)) {
        console.warn(
          '[PathlineAnimation] backend: "gpu" was requested but WebGPU is unavailable; ' +
          'rendering is falling back to the CPU 2D context. Pass backend: "auto" to ' +
          'silence this, or backend: "cpu" if you want CPU explicitly.'
        );
      }
    } else {
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Failed to get 2D rendering context');
      }
      this.ctx = ctx;
    }

    this._initialized = true;
  }

  /**
   * Check if the animation has been initialized.
   */
  get initialized(): boolean {
    return this._initialized;
  }

  /**
   * Draw pathlines at the current animation state.
   * Requires init() to be called first.
   *
   * @param state - Current animation state (must include segmentIndex)
   * @param styleOverride - Optional style overrides (e.g., opacity for dimming)
   */
  draw(
    state: TState,
    styleOverride?: Partial<TrajectoryStyleOptions>
  ): void {
    if (!this._initialized) {
      console.warn('PathlineAnimation.draw() called before init()');
      return;
    }

    // Use state.pathlines if provided, otherwise fall back to stored pathlines
    const pathlines = state.pathlines ?? this.data.pathlines;
    if (pathlines.length === 0) return;

    const fullStyle = buildStyle(this.style, styleOverride, state.perSegmentAlphas);

    if (this.resolvedBackend === 'gpu') {
      // GPU renderer was pre-warmed in init(); this call dispatches synchronously
      // via the cached renderer (the returned Promise is already resolved).
      void drawTrajectories(this.canvas!, pathlines, state.segmentIndex, fullStyle);
    } else {
      drawTrajectories(this.ctx!, pathlines, state.segmentIndex, fullStyle);
    }
  }

  /**
   * Clean up resources.
   *
   * Note: the shared `GPUTrajectoryRenderer` is keyed on the canvas via WeakMap
   * inside the trajectories module and is cleaned up when the canvas is GC'd,
   * so we don't need to explicitly destroy it here.
   */
  destroy(): void {
    this.ctx = null;
    this.canvas = null;
    this._initialized = false;
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
