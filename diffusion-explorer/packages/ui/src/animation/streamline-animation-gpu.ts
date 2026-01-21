/**
 * GPU-accelerated streamline animation that mirrors the StreamlineAnimation API.
 *
 * This provides a drop-in replacement for StreamlineAnimation that uses
 * WebGPU for rendering instead of Canvas 2D. The main differences:
 * - Requires a canvas configured for WebGPU (not Canvas 2D)
 * - Uses `render(state)` instead of `draw(ctx, state)`
 * - Must call `init(canvas)` before rendering
 *
 * @example
 * ```typescript
 * const anim = await StreamlineAnimationGPU.create({
 *   vectorFieldFn,
 *   domain: { xMin: -2, xMax: 2, yMin: -2, yMax: 2 },
 *   toPixel,
 *   color: '#3b82f6',
 * });
 *
 * // Initialize with canvas element
 * await anim.init(canvas);
 *
 * // Add to timeline
 * timeline.add(anim.clip, { start: 0, end: 1 });
 *
 * // In animation loop:
 * anim.render(state);
 * ```
 */

import type { Clip } from './timeline';
import type { AnimationWithData } from './animation';
import {
  generateStreamlines,
  computeStreamlineLengths,
  type VectorFieldFn,
} from '../plotting/streamlines';
import {
  StreamlineRenderer,
  type StreamlineRendererOptions,
  type StreamlineGPUData,
} from '../plotting/streamlines-gpu';

// ===== Types =====

/**
 * Base animation state type for GPU streamline animations.
 */
export type StreamlineAnimationGPUState = {
  streamlinePhase: number;
};

/**
 * Domain bounds for streamline generation.
 */
export type StreamlineGPUDomain = {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
};

/**
 * Options for creating a GPU streamline animation.
 * Mirrors StreamlineAnimationOptions for compatibility.
 */
export type StreamlineAnimationGPUOptions = {
  // Required
  vectorFieldFn: VectorFieldFn;
  domain: StreamlineGPUDomain;
  toPixel: (p: [number, number]) => [number, number];

  // Generation (optional)
  density?: number | [number, number];
  minPathLength?: number;
  integrationDirection?: 'forward' | 'backward' | 'both';
  startPoints?: [number, number][];

  // Animation (optional)
  pulseWidthPixels?: number;      // Pulse width in pixels (default: 30)
  pulsePauseWidthPixels?: number; // Gap between pulses in pixels (default: 50)
  baseOpacity?: number;           // Maximum opacity at pulse back (default: 0.8)
  offsets?: 'random' | 'synchronized';
  binaryPulse?: boolean;

  // Clip options (optional)
  loopMultiplier?: number;

  // Style (optional)
  color?: string | [number, number, number];
  strokeWidth?: number;

  // GPU-specific (optional)
  dpr?: number;
};

/**
 * Per-streamline length data for animation.
 */
export type StreamlineGPULengthData = {
  cumulativeLengths: number[];
  totalLength: number;
};

/**
 * Data exposed by StreamlineAnimationGPU.
 */
export type StreamlineGPUData = {
  /** Generated streamlines in pixel coordinates */
  streamlines: number[][][];
  /** Per-streamline animation offsets */
  offsets: number[];
  /** Per-streamline length data */
  lengthData: StreamlineGPULengthData[];
  /** Maximum streamline length across all streamlines */
  maxLength: number;
};

// ===== Class Implementation =====

/**
 * GPU-accelerated animated streamlines for visualizing vector fields.
 *
 * Implements a similar interface to StreamlineAnimation but uses WebGPU
 * for high-performance rendering.
 */
export class StreamlineAnimationGPU<TState extends StreamlineAnimationGPUState>
  implements AnimationWithData<TState, StreamlineGPUData>
{
  readonly clip: Clip<TState>;
  readonly data: StreamlineGPUData;

  // Stored options for renderer creation
  private readonly options: StreamlineAnimationGPUOptions;
  private readonly rendererOptions: StreamlineRendererOptions;
  private readonly offsetMode: 'random' | 'synchronized';

  // Renderer (created on init)
  private renderer: StreamlineRenderer | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private isInitialized = false;

  private constructor(
    options: StreamlineAnimationGPUOptions,
    data: StreamlineGPUData,
    rendererOptions: StreamlineRendererOptions,
    offsetMode: 'random' | 'synchronized',
    loopMultiplier: number
  ) {
    this.options = options;
    this.data = data;
    this.rendererOptions = rendererOptions;
    this.offsetMode = offsetMode;

    // Create the clip
    this.clip = {
      name: 'StreamlinePhaseGPU',
      reduce(t: number) {
        return { streamlinePhase: (t * loopMultiplier) % 1 } as Partial<TState>;
      },
    };
  }

  /**
   * Initialize the renderer with a canvas element.
   *
   * The canvas should be sized appropriately:
   * - canvas.width = cssWidth * dpr (physical pixels)
   * - canvas.height = cssHeight * dpr (physical pixels)
   * - canvas.style.width/height set for CSS sizing
   *
   * @param canvas - HTML canvas element to render to
   * @throws Error if WebGPU is not available
   */
  async init(canvas: HTMLCanvasElement): Promise<void> {
    if (this.isInitialized && this.canvas === canvas) {
      return; // Already initialized with this canvas
    }

    // Destroy existing renderer if switching canvas
    if (this.renderer) {
      this.renderer.destroy();
      this.renderer = null;
    }

    this.canvas = canvas;

    // Create renderer
    this.renderer = await StreamlineRenderer.create(canvas, this.rendererOptions);

    // Upload streamlines
    this.renderer.setStreamlines(this.data.streamlines, this.offsetMode);

    this.isInitialized = true;
  }

  /**
   * Check if the animation has been initialized.
   */
  get initialized(): boolean {
    return this.isInitialized;
  }

  /**
   * Render the streamlines at the current animation state.
   *
   * @param state - Current animation state (uses streamlinePhase)
   * @param clearColor - Optional background color (RGBA 0-1), default transparent
   */
  render(
    state: TState,
    clearColor: [number, number, number, number] = [0, 0, 0, 0]
  ): void {
    if (!this.renderer || !this.isInitialized) {
      console.warn('StreamlineAnimationGPU: render() called before init()');
      return;
    }

    this.renderer.render({ phase: state.streamlinePhase }, clearColor);
  }

  /**
   * Draw method for compatibility with AnimationWithData interface.
   * Note: This is a no-op for GPU animation since it uses render() instead.
   * The GPU renderer writes directly to its canvas, not a 2D context.
   */
  draw(_ctx: CanvasRenderingContext2D, _state: TState): void {
    // No-op - GPU rendering doesn't use Canvas 2D context
    // Use render() method instead
    console.warn(
      'StreamlineAnimationGPU.draw() called - use render() for GPU rendering'
    );
  }

  /**
   * Update rendering options.
   */
  updateOptions(options: Partial<StreamlineRendererOptions>): void {
    if (this.renderer) {
      this.renderer.updateOptions(options);
    }
  }

  /**
   * Resize the canvas.
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
   * Get the underlying renderer (for advanced use).
   */
  getRenderer(): StreamlineRenderer | null {
    return this.renderer;
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

  /**
   * Create a new StreamlineAnimationGPU instance.
   *
   * @param options - Configuration options for the animation
   * @returns A new StreamlineAnimationGPU instance (not yet initialized)
   */
  static create<TState extends StreamlineAnimationGPUState>(
    options: StreamlineAnimationGPUOptions
  ): StreamlineAnimationGPU<TState> {
    const {
      vectorFieldFn,
      domain,
      toPixel,
      // Generation defaults
      density = 1.0,
      minPathLength = 2.0,
      integrationDirection = 'both',
      startPoints,
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
      // GPU-specific
      dpr,
    } = options;

    // Generate streamlines in domain coordinates
    const rawStreamlines = generateStreamlines(vectorFieldFn, {
      domainMin: [domain.xMin, domain.yMin],
      domainMax: [domain.xMax, domain.yMax],
      density,
      integrationDirection,
      minlength: minPathLength,
      startPoints,
    });

    // Convert to pixel coordinates
    const streamlines = rawStreamlines.map((streamline) =>
      streamline.map((point) => toPixel(point as [number, number]))
    );

    // Compute lengths for each streamline
    const lengthData: StreamlineGPULengthData[] = streamlines.map((streamline) => {
      const { cumulativeLengths, totalLength } = computeStreamlineLengths(streamline);
      return { cumulativeLengths, totalLength };
    });

    // Find max length
    const maxLength = Math.max(...lengthData.map((d) => d.totalLength), 0);

    // Generate offsets (stored for reference, actual offsets applied during setStreamlines)
    const offsets =
      offsetMode === 'random'
        ? streamlines.map(() => Math.random())
        : streamlines.map(() => 0);

    // Create data object
    const data: StreamlineGPUData = {
      streamlines,
      offsets,
      lengthData,
      maxLength,
    };

    // Create renderer options
    const rendererOptions: StreamlineRendererOptions = {
      dpr,
      thickness: strokeWidth,
      pulseWidth: pulseWidthPixels,
      pulseGap: pulsePauseWidthPixels,
      baseOpacity,
      binaryPulse,
      color,
    };

    return new StreamlineAnimationGPU<TState>(
      options,
      data,
      rendererOptions,
      offsetMode,
      loopMultiplier
    );
  }
}
