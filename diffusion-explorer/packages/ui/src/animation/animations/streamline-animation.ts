/**
 * Unified streamline animation class supporting both CPU and GPU backends.
 *
 * Provides a class-based animation that:
 * - Generates streamlines from a vector field
 * - Creates a Clip for Timeline integration
 * - Renders animated pulse effects along streamlines
 * - Supports both Canvas 2D (CPU) and WebGPU (GPU) rendering
 *
 * Both backends have identical lifecycle and API:
 * 1. Create with StreamlineAnimation.create()
 * 2. Initialize with await anim.init(canvas)
 * 3. Draw with anim.draw(state)
 * 4. Cleanup with anim.destroy()
 *
 * @example
 * const anim = StreamlineAnimation.create<MyState>({
 *   vectorFieldFn,
 *   domain: { xMin: -2, xMax: 2, yMin: -2, yMax: 2 },
 *   toPixel,
 *   duration: 4,          // seconds (should match timeline duration)
 *   pulseFrequency: 1,    // pulses per second
 *   color: '#3b82f6',
 *   backend: 'cpu', // or 'gpu'
 * });
 *
 * await anim.init(canvas);
 *
 * // In animation loop:
 * anim.draw(state);
 */

import type { AnimationWithData, Clip } from 'tempus';
import {
  generateStreamlines,
  computeStreamlineLengths,
  createAlphaLUT,
  precomputePatternIndices,
  computeAlphaTrail,
  StreamlineRenderer,
  type StreamlineRendererOptions,
  type StreamlineLengthData,
  type VectorFieldFn,
  type StreamlineDomain,
} from '../../plotting/streamlines/index';
import { drawTrajectories } from '../../plotting/trajectories';

// ============================================================================
// Types
// ============================================================================

/**
 * Backend selection for streamline animation.
 */
export type StreamlineBackend = 'cpu' | 'gpu';

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
 * Data exposed by StreamlineAnimation.
 */
export type StreamlineAnimationData = {
  /** Generated streamlines in pixel coordinates */
  streamlines: number[][][];
  /** Per-streamline animation offsets */
  offsets: number[];
  /** Per-streamline length data (for pixel-based animation) */
  lengthData: StreamlineLengthData[];
  /** Maximum streamline length across all streamlines */
  maxLength: number;
};

/**
 * Base options for creating a streamline animation.
 * Shared by both CPU and GPU backends.
 */
export interface StreamlineAnimationBaseOptions {
  // Required
  vectorFieldFn: VectorFieldFn;
  domain: StreamlineDomain;
  toPixel: (p: [number, number]) => [number, number];

  // Generation (optional)
  density?: number | [number, number];
  minPathLength?: number;
  segmentLength?: number;
  integrationDirection?: 'forward' | 'backward' | 'both';
  startPoints?: [number, number][];

  // Animation (optional)
  pulseWidthPixels?: number;
  pulsePauseWidthPixels?: number;
  baseOpacity?: number;
  offsets?: 'random' | 'synchronized';
  binaryPulse?: boolean;
  /**
   * Exponent on the pulse's tail->head alpha ramp (GPU backend only).
   *   1.0 (default) — linear gradient (current behavior).
   *   > 1 — head-loaded: trail dies off quickly, leading edge dominates.
   *   < 1 — tail-loaded: trail stays visible far behind head.
   */
  pulseGamma?: number;

  /** Duration of the animation in seconds. Should match the timeline duration. */
  duration: number;

  /** Pulse frequency in pulses per second. Default: 1 */
  pulseFrequency?: number;

  // Style (optional)
  color?: string | [number, number, number];
  strokeWidth?: number;
}

/**
 * CPU-specific options.
 */
export interface StreamlineAnimationCPUOptions extends StreamlineAnimationBaseOptions {
  backend?: 'cpu';
  /** Subdivide each segment into N pieces (default: 1 = no subdivision) */
  subdivisionFactor?: number;
  /** Number of gradient subdivisions for smooth alpha transitions */
  gradientSubdivisions?: number;
}

/**
 * GPU-specific options.
 */
export interface StreamlineAnimationGPUOptions extends StreamlineAnimationBaseOptions {
  backend: 'gpu';
  /** Device pixel ratio (default: window.devicePixelRatio) */
  dpr?: number;
}

/**
 * Combined options type that supports both backends.
 */
export type StreamlineAnimationOptions =
  | StreamlineAnimationCPUOptions
  | StreamlineAnimationGPUOptions;

// Re-export domain type for convenience
export type { StreamlineDomain };

// Legacy type aliases for backward compatibility
export type StreamlineData = StreamlineAnimationData;

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

/**
 * Internal: CPU-specific length data with pattern indices.
 */
type CPULengthData = StreamlineLengthData & {
  patternIndices: Uint16Array;
};

/**
 * Animated streamlines for visualizing vector fields.
 *
 * Implements AnimationWithData to provide:
 * - A clip for Timeline integration
 * - A draw method for rendering (CPU) or render method (GPU)
 * - Access to generated streamline data
 *
 * @example
 * const anim = StreamlineAnimation.create<MyState>({
 *   vectorFieldFn,
 *   domain: { xMin: -2, xMax: 2, yMin: -2, yMax: 2 },
 *   toPixel,
 *   duration: 4,
 *   density: 0.8,
 *   color: '#3b82f6',
 * });
 *
 * await anim.init(canvas);  // Required for both backends
 * timeline.add(anim.clip, { start: 0, end: 1 });
 *
 * // In draw function:
 * anim.draw(state);  // Works for both CPU and GPU
 */
export class StreamlineAnimation<TState extends StreamlineAnimationState>
  implements AnimationWithData<TState, StreamlineAnimationData> {

  readonly clip: Clip<TState>;
  readonly data: StreamlineAnimationData;
  readonly backend: StreamlineBackend;

  // CPU-specific state
  private readonly baseOpacity: number;
  private readonly color: string;
  private readonly strokeWidth: number;
  private readonly gradientSubdivisions: number;
  private readonly alphaLUT: Float32Array | null;
  private readonly alphaBuffers: Float32Array[] | null;
  private readonly cpuLengthData: CPULengthData[] | null;

  // CPU-specific runtime state
  private ctx: CanvasRenderingContext2D | null = null;

  // GPU-specific state
  private readonly rendererOptions: StreamlineRendererOptions | null;
  private readonly offsetMode: 'random' | 'synchronized';
  private renderer: StreamlineRenderer | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private isInitialized = false;

  private constructor(
    options: StreamlineAnimationOptions,
    data: StreamlineAnimationData,
    clip: Clip<TState>,
    cpuState: {
      baseOpacity: number;
      color: string;
      strokeWidth: number;
      gradientSubdivisions: number;
      alphaLUT: Float32Array | null;
      alphaBuffers: Float32Array[] | null;
      cpuLengthData: CPULengthData[] | null;
    } | null,
    gpuState: {
      rendererOptions: StreamlineRendererOptions;
      offsetMode: 'random' | 'synchronized';
    } | null
  ) {
    this.data = data;
    this.clip = clip;
    this.backend = options.backend ?? 'cpu';

    // CPU state
    if (cpuState) {
      this.baseOpacity = cpuState.baseOpacity;
      this.color = cpuState.color;
      this.strokeWidth = cpuState.strokeWidth;
      this.gradientSubdivisions = cpuState.gradientSubdivisions;
      this.alphaLUT = cpuState.alphaLUT;
      this.alphaBuffers = cpuState.alphaBuffers;
      this.cpuLengthData = cpuState.cpuLengthData;
    } else {
      this.baseOpacity = 0.8;
      this.color = '#3b82f6';
      this.strokeWidth = 2.5;
      this.gradientSubdivisions = 12;
      this.alphaLUT = null;
      this.alphaBuffers = null;
      this.cpuLengthData = null;
    }

    // GPU state
    if (gpuState) {
      this.rendererOptions = gpuState.rendererOptions;
      this.offsetMode = gpuState.offsetMode;
    } else {
      this.rendererOptions = null;
      this.offsetMode = 'synchronized';
    }
  }

  /**
   * Initialize the animation with a canvas element.
   * Required for both backends before drawing.
   *
   * For CPU backend: stores the 2D rendering context.
   * For GPU backend: creates the WebGPU renderer.
   *
   * @param canvas - HTML canvas element to render to
   * @throws Error if context cannot be obtained (CPU) or WebGPU not available (GPU)
   */
  async init(canvas: HTMLCanvasElement): Promise<void> {
    if (this.isInitialized && this.canvas === canvas) {
      return; // Already initialized with this canvas
    }

    // Handle CPU backend
    if (this.backend === 'cpu') {
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Failed to get 2D rendering context');
      }
      this.ctx = ctx;
      this.canvas = canvas;
      this.isInitialized = true;
      return;
    }

    // Handle GPU backend
    if (!this.rendererOptions) {
      throw new Error('GPU renderer options not configured');
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
   * Draw the streamlines at the current animation state.
   * Works for both CPU and GPU backends after init() has been called.
   *
   * @param state - Current animation state (uses streamlinePhase)
   * @param clearColor - Optional background color (RGBA 0-1), GPU only, default transparent
   */
  draw(
    state: TState,
    clearColor: [number, number, number, number] = [0, 0, 0, 0]
  ): void {
    if (!this.isInitialized) {
      console.warn('StreamlineAnimation.draw() called before init()');
      return;
    }

    if (this.backend === 'cpu') {
      this.drawCPU(state);
    } else {
      this.drawGPU(state, clearColor);
    }
  }

  /**
   * Internal: CPU rendering implementation.
   */
  private drawCPU(state: TState): void {
    if (!this.ctx || !this.alphaLUT || !this.alphaBuffers || !this.cpuLengthData) {
      return;
    }

    const { streamlines, offsets } = this.data;
    if (streamlines.length === 0) return;

    const phase = state.streamlinePhase;

    // Compute per-segment alphas using precomputed LUT and pattern indices
    const perSegmentAlphas = streamlines.map((_, i) => {
      const { patternIndices } = this.cpuLengthData![i];
      const offset = offsets[i] ?? 0;
      const outBuffer = this.alphaBuffers![i];

      computeAlphaTrail(
        patternIndices,
        this.alphaLUT!,
        phase,
        offset,
        outBuffer
      );
      return Array.from(outBuffer);
    });

    // Draw all streamlines
    drawTrajectories(this.ctx, streamlines, 0, {
      strokeWidth: this.strokeWidth,
      color: this.color,
      opacity: this.baseOpacity,
      pointRadius: 0,
      showPreview: false,
      showHeadMarker: false,
      perSegmentAlphas,
      gradientSubdivisions: this.gradientSubdivisions,
    });
  }

  /**
   * Internal: GPU rendering implementation.
   */
  private drawGPU(
    state: TState,
    clearColor: [number, number, number, number]
  ): void {
    if (!this.renderer) {
      return;
    }

    this.renderer.render({ phase: state.streamlinePhase }, clearColor);
  }

  /**
   * Update GPU rendering options (GPU backend only).
   */
  updateOptions(options: Partial<StreamlineRendererOptions>): void {
    if (this.renderer) {
      this.renderer.updateOptions(options);
    }
  }

  /**
   * Resize the canvas (GPU backend only).
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
   * Get the underlying GPU renderer (for advanced use).
   */
  getRenderer(): StreamlineRenderer | null {
    return this.renderer;
  }

  /**
   * Destroy the animation and release resources.
   */
  destroy(): void {
    if (this.renderer) {
      this.renderer.destroy();
      this.renderer = null;
    }
    this.ctx = null;
    this.canvas = null;
    this.isInitialized = false;
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
    const backend = options.backend ?? 'cpu';

    if (backend === 'gpu') {
      return StreamlineAnimation.createGPU<TState>(options as StreamlineAnimationGPUOptions);
    } else {
      return StreamlineAnimation.createCPU<TState>(options as StreamlineAnimationCPUOptions);
    }
  }

  /**
   * Create a CPU-backend StreamlineAnimation.
   *
   * @param options - CPU-specific configuration options
   * @returns A new StreamlineAnimation with CPU backend
   */
  static createCPU<TState extends StreamlineAnimationState>(
    options: StreamlineAnimationCPUOptions
  ): StreamlineAnimation<TState> {
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
      // Timing
      duration,
      pulseFrequency = 1,
      // Style defaults
      color = '#3b82f6',
      strokeWidth = 2.5,
      gradientSubdivisions = 12,
    } = options;

    // Compute loop multiplier from frequency and duration
    const loopMultiplier = pulseFrequency * duration;

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
    const cpuLengthData: CPULengthData[] = streamlines.map((streamline) => {
      const { cumulativeLengths, totalLength } = computeStreamlineLengths(streamline);
      const patternIndices = precomputePatternIndices(cumulativeLengths, spacing);
      return { cumulativeLengths, totalLength, patternIndices };
    });

    // Create generic length data for the public data object
    const lengthData: StreamlineLengthData[] = cpuLengthData.map(({ cumulativeLengths, totalLength, patternIndices }) => ({
      cumulativeLengths,
      totalLength,
      patternIndices,
    }));

    // Find max length across all streamlines
    const maxLength = Math.max(...lengthData.map((d) => d.totalLength), 0);

    // Generate offsets
    const offsets =
      offsetMode === 'random'
        ? streamlines.map(() => Math.random())
        : streamlines.map(() => 0);

    // Create alpha LUT and reusable buffers
    const alphaLUT = createAlphaLUT(pulseWidthPixels, spacing, baseOpacity, 256, binaryPulse);
    const alphaBuffers = streamlines.map((s) => new Float32Array(s.length));

    // Store data
    const data: StreamlineAnimationData = { streamlines, offsets, lengthData, maxLength };

    // Create the clip
    const clip: Clip<TState> = {
      name: 'StreamlinePhase',
      reduce(t: number) {
        return { streamlinePhase: (t * loopMultiplier) % 1 } as Partial<TState>;
      },
    };

    // Convert color to string if needed
    const colorStr = typeof color === 'string'
      ? color
      : `rgb(${color[0]}, ${color[1]}, ${color[2]})`;

    return new StreamlineAnimation<TState>(
      options,
      data,
      clip,
      {
        baseOpacity,
        color: colorStr,
        strokeWidth,
        gradientSubdivisions,
        alphaLUT,
        alphaBuffers,
        cpuLengthData,
      },
      null
    );
  }

  /**
   * Create a GPU-backend StreamlineAnimation.
   *
   * @param options - GPU-specific configuration options
   * @returns A new StreamlineAnimation with GPU backend (not yet initialized)
   */
  static createGPU<TState extends StreamlineAnimationState>(
    options: StreamlineAnimationGPUOptions
  ): StreamlineAnimation<TState> {
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
      pulseGamma = 1.0,
      // Timing
      duration,
      pulseFrequency = 1,
      // Style defaults
      color = '#3b82f6',
      strokeWidth = 2.5,
      // GPU-specific
      dpr,
    } = options;

    // Compute loop multiplier from frequency and duration
    const loopMultiplier = pulseFrequency * duration;

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
    const lengthData: StreamlineLengthData[] = streamlines.map((streamline) => {
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
    const data: StreamlineAnimationData = {
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
      pulseGamma,
      color,
    };

    // Create the clip
    const clip: Clip<TState> = {
      name: 'StreamlinePhaseGPU',
      reduce(t: number) {
        return { streamlinePhase: (t * loopMultiplier) % 1 } as Partial<TState>;
      },
    };

    return new StreamlineAnimation<TState>(
      options,
      data,
      clip,
      null,
      {
        rendererOptions,
        offsetMode,
      }
    );
  }
}
