/**
 * GPU-accelerated pulsing pathline animation.
 *
 * Provides a class-based animation that:
 * - Renders animated pulse effects along arbitrary paths
 * - Uses WebGPU for high-performance rendering
 * - Integrates with Timeline via a Clip
 *
 * Lifecycle:
 * 1. Create with PulsingPathlineAnimation.create()
 * 2. Initialize with await anim.init(canvas)
 * 3. Draw with anim.draw(state)
 * 4. Cleanup with anim.destroy()
 *
 * @example
 * const anim = PulsingPathlineAnimation.create<MyState>({
 *   paths: trajectories,  // [path][point][x,y] in pixel coords
 *   duration: 4,          // seconds (should match timeline duration)
 *   pulseFrequency: 1,    // pulses per second
 *   color: '#f17720',
 *   pulseWidth: 40,
 *   pulseGap: 60,
 * });
 *
 * await anim.init(canvas);
 *
 * // In animation loop:
 * anim.draw(state);
 */

import type { Animation, Clip } from 'tempus';
import {
  PulsingPathsRenderer,
  type PulsingPathsRendererOptions,
} from '../../plotting/pulsing-paths';

// ============================================================================
// Types
// ============================================================================

/**
 * Base animation state type for pulsing paths animations.
 * Users extend this for their own animation state.
 *
 * @example
 * type MyAnimationState = PulsingPathlineAnimationState & {
 *   contourFrameIndex: number;
 * };
 */
export type PulsingPathlineAnimationState = {
  pulsingPathlinePhase: number;
};

/**
 * Options for creating a PulsingPathlineAnimation.
 */
export interface PulsingPathlineAnimationOptions {
  /** Paths to animate. Each path is an array of [x, y] points in pixel coordinates. */
  paths: number[][][];

  /** Line color (hex string or RGB array). Default: '#3b82f6' */
  color?: string | [number, number, number];

  /** Line thickness in logical pixels. Default: 2.5 */
  thickness?: number;

  /** Pulse width in logical pixels. Default: 40 */
  pulseWidth?: number;

  /** Gap between pulses in logical pixels. Default: 60 */
  pulseGap?: number;

  /** Base opacity at pulse peak (0-1). Default: 0.8 */
  baseOpacity?: number;

  /** Use binary (solid) pulses instead of gradient. Default: false */
  binaryPulse?: boolean;

  /** Phase offsets per path. Default: 'synchronized' */
  offsets?: 'random' | 'synchronized';

  /** Duration of the animation in seconds. Should match the timeline duration. */
  duration: number;

  /** Pulse frequency in pulses per second. Default: 1 */
  pulseFrequency?: number;

  /** Device pixel ratio. Default: window.devicePixelRatio */
  dpr?: number;

  /** Show a static preview line behind the pulses. Default: false */
  showPreview?: boolean;

  /** Opacity of the preview line (0-1). Default: 0.3 */
  previewOpacity?: number;

  /** Show arrowheads at the front of each pulse. Default: false */
  showArrowhead?: boolean;

  /** Arrowhead size as multiple of thickness. Default: 2.0 */
  arrowheadSize?: number;
}

// ============================================================================
// Animation Class
// ============================================================================

/**
 * GPU-accelerated pulsing paths animation.
 *
 * Wraps PulsingPathsRenderer with the Animation interface for Timeline integration.
 */
export class PulsingPathlineAnimation<TState extends PulsingPathlineAnimationState>
  implements Animation<TState>
{
  readonly clip: Clip<TState>;

  private renderer: PulsingPathsRenderer | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private isInitialized = false;

  private paths: number[][][];
  private rendererOptions: PulsingPathsRendererOptions;
  private offsetMode: 'random' | 'synchronized';

  private constructor(
    paths: number[][][],
    clip: Clip<TState>,
    rendererOptions: PulsingPathsRendererOptions,
    offsetMode: 'random' | 'synchronized'
  ) {
    this.paths = paths;
    this.clip = clip;
    this.rendererOptions = rendererOptions;
    this.offsetMode = offsetMode;
  }

  /**
   * Create a new PulsingPathlineAnimation.
   *
   * @param options - Animation configuration
   * @returns A new PulsingPathlineAnimation instance
   */
  static create<TState extends PulsingPathlineAnimationState>(
    options: PulsingPathlineAnimationOptions
  ): PulsingPathlineAnimation<TState> {
    const {
      paths,
      color = '#3b82f6',
      thickness = 2.5,
      pulseWidth = 40,
      pulseGap = 60,
      baseOpacity = 0.8,
      binaryPulse = false,
      offsets = 'synchronized',
      duration,
      pulseFrequency = 1,
      dpr,
      showPreview = false,
      previewOpacity = 0.3,
      showArrowhead = false,
      arrowheadSize = 2.0,
    } = options;

    // Compute loop multiplier from frequency and duration
    const loopMultiplier = pulseFrequency * duration;

    // Create the animation clip
    const clip: Clip<TState> = {
      name: 'PulsingPathlinePhase',
      reduce(t: number) {
        return { pulsingPathlinePhase: (t * loopMultiplier) % 1 } as Partial<TState>;
      },
    };

    // Prepare renderer options
    const rendererOptions: PulsingPathsRendererOptions = {
      color,
      thickness,
      pulseWidth,
      pulseGap,
      baseOpacity,
      binaryPulse,
      dpr,
      showPreview,
      previewOpacity,
      showArrowhead,
      arrowheadSize,
    };

    return new PulsingPathlineAnimation<TState>(paths, clip, rendererOptions, offsets);
  }

  /**
   * Initialize the animation with a canvas.
   *
   * This creates the WebGPU renderer and uploads path data to the GPU.
   * The canvas should be configured for WebGPU (not 2D context).
   *
   * @param canvas - The canvas element to render to
   */
  async init(canvas: HTMLCanvasElement): Promise<void> {
    // Idempotent: return early if already initialized with same canvas
    if (this.isInitialized && this.canvas === canvas) {
      return;
    }

    // Cleanup any existing renderer
    if (this.renderer) {
      this.renderer.destroy();
      this.renderer = null;
    }

    // Create new renderer
    this.canvas = canvas;
    this.renderer = await PulsingPathsRenderer.create(canvas, this.rendererOptions);
    this.renderer.setPaths(this.paths, this.offsetMode);
    this.isInitialized = true;
  }

  /**
   * Check if the animation has been initialized.
   */
  get initialized(): boolean {
    return this.isInitialized;
  }

  /**
   * Draw the animation at the current state.
   *
   * If showPreview is enabled, this renders:
   * 1. The preview line (static, low opacity)
   * 2. The animated pulses on top
   *
   * @param state - The current animation state (must include pulsingPathlinePhase)
   * @param clearColor - Optional background color to clear with (RGBA 0-1)
   */
  draw(
    state: TState,
    clearColor?: [number, number, number, number]
  ): void {
    if (!this.isInitialized || !this.renderer) {
      console.warn('PulsingPathlineAnimation.draw() called before init()');
      return;
    }

    const showPreview = this.rendererOptions.showPreview ?? false;

    if (showPreview) {
      // First pass: render preview line (clear canvas)
      this.renderer.render(
        { phase: state.pulsingPathlinePhase, showPreview: true },
        clearColor
      );
      // Second pass: render pulses on top (no clear)
      this.renderer.render(
        { phase: state.pulsingPathlinePhase, showPreview: false }
      );
    } else {
      // Single pass: just render pulses
      this.renderer.render({ phase: state.pulsingPathlinePhase }, clearColor);
    }
  }

  /**
   * Update the paths being animated.
   *
   * Use this when trajectories change dynamically.
   *
   * @param paths - New paths in pixel coordinates
   */
  updatePaths(paths: number[][][]): void {
    this.paths = paths;
    if (this.renderer) {
      this.renderer.setPaths(paths, this.offsetMode);
    }
  }

  /**
   * Update rendering options.
   *
   * @param options - Partial options to update
   */
  updateOptions(options: Partial<PulsingPathsRendererOptions>): void {
    if (this.renderer) {
      this.renderer.updateOptions(options);
    }
    // Also update stored options for future reinits
    Object.assign(this.rendererOptions, options);
  }

  /**
   * Handle canvas resize.
   *
   * @param width - New width in physical pixels
   * @param height - New height in physical pixels
   * @param dpr - Optional new device pixel ratio
   */
  resize(width: number, height: number, dpr?: number): void {
    if (this.renderer) {
      this.renderer.resize(width, height, dpr);
    }
  }

  /**
   * Get the current segment count.
   */
  getSegmentCount(): number {
    return this.renderer?.getSegmentCount() ?? 0;
  }

  /**
   * Destroy the animation and release GPU resources.
   */
  destroy(): void {
    if (this.renderer) {
      this.renderer.destroy();
      this.renderer = null;
    }
    this.canvas = null;
    this.isInitialized = false;
  }
}
