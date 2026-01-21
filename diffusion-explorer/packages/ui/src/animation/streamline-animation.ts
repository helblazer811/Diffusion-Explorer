/**
 * Reusable streamline animation abstraction.
 *
 * Provides a class-based animation that:
 * - Generates streamlines from a vector field
 * - Creates a Clip for Timeline integration
 * - Renders animated pulse effects along streamlines
 *
 * Supports two rendering modes:
 * - 'canvas': Traditional Canvas 2D rendering (default)
 * - 'shader': GPU-accelerated WebGPU compute shader rendering
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
import { StreamlineShaderRenderer } from '../plotting/streamline-shader';

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

  // Render mode (optional)
  /**
   * Rendering mode:
   * - 'canvas': Traditional Canvas 2D rendering (default)
   * - 'shader': GPU-accelerated WebGPU compute shader rendering
   *
   * Shader mode requires canvasWidth and canvasHeight to be specified.
   */
  renderMode?: 'canvas' | 'shader';
  /** Canvas width in pixels (required for shader mode) */
  canvasWidth?: number;
  /** Canvas height in pixels (required for shader mode) */
  canvasHeight?: number;
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
 * Parse a CSS color string to RGB values in [0, 1] range.
 *
 * @param color - CSS color string (hex, rgb, etc.)
 * @returns RGB tuple with values in [0, 1]
 */
function parseColorToRGB(color: string): [number, number, number] {
  // Handle hex colors
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16) / 255;
      const g = parseInt(hex[1] + hex[1], 16) / 255;
      const b = parseInt(hex[2] + hex[2], 16) / 255;
      return [r, g, b];
    } else if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16) / 255;
      const g = parseInt(hex.slice(2, 4), 16) / 255;
      const b = parseInt(hex.slice(4, 6), 16) / 255;
      return [r, g, b];
    }
  }

  // Handle rgb() colors
  const rgbMatch = color.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
  if (rgbMatch) {
    return [
      parseInt(rgbMatch[1]) / 255,
      parseInt(rgbMatch[2]) / 255,
      parseInt(rgbMatch[3]) / 255
    ];
  }

  // Default to blue if parsing fails
  console.warn(`Could not parse color "${color}", defaulting to blue`);
  return [0.23, 0.51, 0.96]; // #3b82f6
}

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

  // Shader rendering (optional)
  private readonly renderMode: 'canvas' | 'shader';
  private shaderRenderer: StreamlineShaderRenderer | null = null;
  private shaderInitPromise: Promise<void> | null = null;
  private readonly shaderOptions: {
    width: number;
    height: number;
    strokeWidth: number;
    pulseWidth: number;
    pulsePauseWidth: number;
    baseOpacity: number;
    binaryPulse: boolean;
    color: [number, number, number];
  } | null = null;

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
      // Render mode defaults
      renderMode = 'canvas',
      canvasWidth,
      canvasHeight,
    } = options;

    // Store render mode
    this.renderMode = renderMode;

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

    // Initialize shader renderer if in shader mode
    if (renderMode === 'shader') {
      if (canvasWidth === undefined || canvasHeight === undefined) {
        throw new Error('canvasWidth and canvasHeight are required for shader render mode');
      }

      // Parse color string to RGB [0-1]
      const colorRGB = parseColorToRGB(color);

      // Store shader options for lazy initialization
      this.shaderOptions = {
        width: canvasWidth,
        height: canvasHeight,
        strokeWidth,
        pulseWidth: pulseWidthPixels,
        pulsePauseWidth: pulsePauseWidthPixels,
        baseOpacity,
        binaryPulse,
        color: colorRGB
      };

      // Start async initialization
      this.shaderInitPromise = this.initShaderRenderer();
    }
  }

  /**
   * Initialize the WebGPU shader renderer asynchronously.
   */
  private async initShaderRenderer(): Promise<void> {
    if (!this.shaderOptions) return;

    try {
      this.shaderRenderer = await StreamlineShaderRenderer.create({
        streamlines: this.data.streamlines,
        lengthData: this.data.lengthData,
        offsets: this.data.offsets,
        options: this.shaderOptions
      });
    } catch (error) {
      console.warn('Failed to initialize shader renderer, falling back to canvas:', error);
      // Keep shaderRenderer as null, draw() will fall back to canvas
    }
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

    // Use shader renderer if available
    if (this.renderMode === 'shader' && this.shaderRenderer) {
      // Shader render is async, but we handle it synchronously here
      // by caching the last rendered ImageData
      this.renderWithShader(ctx, phase);
      return;
    }

    // Canvas rendering (default)
    this.renderWithCanvas(ctx, phase);
  }

  /**
   * Render using Canvas 2D API.
   */
  private renderWithCanvas(ctx: CanvasRenderingContext2D, phase: number): void {
    const { streamlines, offsets, lengthData } = this.data;

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

  // Cache for shader rendering
  private lastShaderPhase: number = -1;
  private lastShaderImageData: ImageData | null = null;
  private shaderRenderPending: boolean = false;

  /**
   * Render using WebGPU shader.
   * Uses cached ImageData if phase hasn't changed, otherwise triggers async render.
   */
  private renderWithShader(ctx: CanvasRenderingContext2D, phase: number): void {
    // If we have cached data for this phase, use it
    if (this.lastShaderImageData && Math.abs(this.lastShaderPhase - phase) < 0.0001) {
      ctx.putImageData(this.lastShaderImageData, 0, 0);
      return;
    }

    // If a render is already pending, use cached data or fall back to canvas
    if (this.shaderRenderPending) {
      if (this.lastShaderImageData) {
        ctx.putImageData(this.lastShaderImageData, 0, 0);
      } else {
        this.renderWithCanvas(ctx, phase);
      }
      return;
    }

    // Start async render
    this.shaderRenderPending = true;
    this.shaderRenderer!.render(phase).then((result) => {
      this.lastShaderPhase = phase;
      this.lastShaderImageData = result.imageData;
      this.shaderRenderPending = false;
    }).catch((error) => {
      console.warn('Shader render failed:', error);
      this.shaderRenderPending = false;
    });

    // For this frame, use cached data or fall back to canvas
    if (this.lastShaderImageData) {
      ctx.putImageData(this.lastShaderImageData, 0, 0);
    } else {
      this.renderWithCanvas(ctx, phase);
    }
  }

  /**
   * Wait for shader renderer initialization to complete.
   * Useful if you want to ensure shader is ready before first render.
   */
  async waitForShaderInit(): Promise<boolean> {
    if (this.shaderInitPromise) {
      await this.shaderInitPromise;
    }
    return this.shaderRenderer !== null;
  }

  /**
   * Clean up resources. Call when done with the animation.
   */
  destroy(): void {
    if (this.shaderRenderer) {
      this.shaderRenderer.destroy();
      this.shaderRenderer = null;
    }
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

