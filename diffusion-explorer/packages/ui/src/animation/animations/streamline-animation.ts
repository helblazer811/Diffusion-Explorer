/**
 * Unified streamline animation class supporting both CPU and GPU backends.
 *
 * Provides a class-based animation that:
 * - Generates streamlines from a vector field
 * - Creates a Clip for Timeline integration
 * - Renders animated pulse effects along streamlines
 * - Supports both Canvas 2D (CPU) and WebGPU (GPU) rendering
 *
 * @example
 * // CPU backend (default)
 * const anim = StreamlineAnimation.create<MyState>({
 *   vectorFieldFn,
 *   domain: { xMin: -2, xMax: 2, yMin: -2, yMax: 2 },
 *   toPixel,
 *   color: '#3b82f6',
 * });
 *
 * // GPU backend
 * const animGPU = StreamlineAnimation.create<MyState>({
 *   backend: 'gpu',
 *   vectorFieldFn,
 *   domain: { xMin: -2, xMax: 2, yMin: -2, yMax: 2 },
 *   toPixel,
 *   color: '#3b82f6',
 * });
 * await animGPU.init(canvas);
 *
 * // In animation loop:
 * anim.draw(ctx, state);        // CPU
 * animGPU.render(state);        // GPU
 */

import type { Clip } from '../timeline';
import type { AnimationWithData } from '../animation';
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
  loopMultiplier?: number;

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
 * // CPU backend (default)
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
 *
 * @example
 * // GPU backend
 * const anim = StreamlineAnimation.create<MyState>({
 *   backend: 'gpu',
 *   vectorFieldFn,
 *   domain,
 *   toPixel,
 * });
 *
 * await anim.init(canvas);  // Required for GPU
 * anim.render(state);       // Use render() instead of draw()
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
   * Initialize the GPU renderer with a canvas element.
   * Required for GPU backend before rendering.
   *
   * @param canvas - HTML canvas element to render to
   * @throws Error if WebGPU is not available or if backend is 'cpu'
   */
  async init(canvas: HTMLCanvasElement): Promise<void> {
    if (this.backend !== 'gpu') {
      throw new Error('init() is only available for GPU backend');
    }

    if (!this.rendererOptions) {
      throw new Error('GPU renderer options not configured');
    }

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
   * Check if the GPU animation has been initialized.
   */
  get initialized(): boolean {
    return this.isInitialized;
  }

  /**
   * Draw the streamlines at the current animation state (CPU backend).
   *
   * @param ctx - Canvas 2D rendering context
   * @param state - Current animation state (uses streamlinePhase)
   */
  draw(ctx: CanvasRenderingContext2D, state: TState): void {
    if (this.backend === 'gpu') {
      console.warn('StreamlineAnimation.draw() called on GPU backend - use render() instead');
      return;
    }

    if (!this.alphaLUT || !this.alphaBuffers || !this.cpuLengthData) {
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
   * Render the streamlines at the current animation state (GPU backend).
   *
   * @param state - Current animation state (uses streamlinePhase)
   * @param clearColor - Optional background color (RGBA 0-1), default transparent
   */
  render(
    state: TState,
    clearColor: [number, number, number, number] = [0, 0, 0, 0]
  ): void {
    if (this.backend !== 'gpu') {
      console.warn('StreamlineAnimation.render() called on CPU backend - use draw() instead');
      return;
    }

    if (!this.renderer || !this.isInitialized) {
      console.warn('StreamlineAnimation: render() called before init()');
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
      // Clip defaults
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
