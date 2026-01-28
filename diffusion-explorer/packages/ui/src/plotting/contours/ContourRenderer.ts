/**
 * Unified ContourRenderer with automatic GPU/CPU backend selection.
 *
 * This class provides a consistent API for contour rendering that:
 * - Auto-detects GPU availability, prefers GPU by default
 * - Falls back to CPU rendering when GPU is unavailable
 * - Provides identical API regardless of backend
 * - Supports both single-frame and multi-frame (animation) use cases
 */

import { GPUContourRenderer } from './gpu';
import { CPUContourRenderer } from './cpu';
import type { ContourDomain, ColorScaleFn } from './types';
import { defaultColorScale } from './types';

/**
 * Options for creating a ContourRenderer.
 */
export interface ContourRendererOptions {
  /** Canvas element to render to */
  canvas: HTMLCanvasElement;
  /** Grid size for density estimation (default: 100) */
  gridSize?: number;
  /** Bandwidth for kernel density estimation (default: 20) */
  bandwidth?: number;
  /**
   * Threshold specification for contour levels.
   * - If a number: generates that many uniformly-spaced thresholds
   * - If an array: uses those exact percentile values (should be in [0, 1])
   * Default: 10
   */
  thresholds?: number | number[];
  /** Opacity for contour fill (default: 1.0) */
  opacity?: number;
  /** Color scale function (default: blue scale) */
  colorScale?: ColorScaleFn;
  /** Whether to prefer GPU rendering (default: true) */
  preferGPU?: boolean;
  /** Device pixel ratio (default: window.devicePixelRatio) */
  dpr?: number;
}

type Backend = GPUContourRenderer | CPUContourRenderer;

/**
 * Unified contour renderer with automatic GPU/CPU backend selection.
 *
 * @example
 * ```typescript
 * // Create renderer (auto-selects GPU if available)
 * const renderer = await ContourRenderer.create({
 *   canvas: myCanvas,
 *   bandwidth: 15,
 *   thresholds: 10,  // or [0.2, 0.4, 0.6, 0.8] for explicit percentiles
 *   opacity: 0.5,
 * });
 *
 * console.log(renderer.backend); // 'gpu' or 'cpu'
 *
 * // Set data and draw
 * renderer.setPoints(points, { xMin: 0, xMax: 1, yMin: 0, yMax: 1 });
 * renderer.draw();
 *
 * // Update style without recomputing
 * renderer.setOpacity(0.8);
 * renderer.draw();
 * ```
 *
 * @example Multi-frame animation
 * ```typescript
 * const renderer = await ContourRenderer.create({ canvas, ... });
 *
 * // Set points for each timestep
 * for (let t = 0; t < numTimesteps; t++) {
 *   renderer.setPointsForFrame(t, allTimeSamples[t], domain);
 * }
 *
 * // Pre-compute all density fields (parallel on GPU)
 * await renderer.computeAllFrames();
 *
 * // Animation loop - just draws pre-computed frames
 * function animate(t: number) {
 *   const frameIndex = Math.floor(t * numTimesteps);
 *   renderer.drawFrame(frameIndex);
 *   requestAnimationFrame(animate);
 * }
 * ```
 */
export class ContourRenderer {
  private _backend: Backend;
  private _backendType: 'gpu' | 'cpu';

  private constructor(backend: Backend, type: 'gpu' | 'cpu') {
    this._backend = backend;
    this._backendType = type;
  }

  /**
   * Create a new ContourRenderer with automatic backend selection.
   *
   * @param options - Renderer configuration options
   * @returns A new ContourRenderer instance
   */
  static async create(options: ContourRendererOptions): Promise<ContourRenderer> {
    const { canvas, preferGPU = true, dpr, ...rest } = options;

    if (preferGPU) {
      try {
        const gpu = await GPUContourRenderer.create(canvas, { ...rest, dpr });
        return new ContourRenderer(gpu, 'gpu');
      } catch (e) {
        console.warn('[ContourRenderer] GPU unavailable, using CPU:', e);
      }
    }

    const cpu = new CPUContourRenderer(canvas, rest);
    return new ContourRenderer(cpu, 'cpu');
  }

  /**
   * The backend type being used ('gpu' or 'cpu').
   */
  get backend(): 'gpu' | 'cpu' {
    return this._backendType;
  }

  // ============================================================================
  // Single-frame API
  // ============================================================================

  /**
   * Set point data for contour computation.
   *
   * @param points - Point data as Float32Array (x,y pairs) or number[][]
   * @param domain - Optional domain bounds; auto-computed from points if not provided
   */
  setPoints(points: Float32Array | number[][], domain?: ContourDomain): void {
    this._backend.setPoints(points, domain);
  }

  /**
   * Draw contours to the canvas.
   * If data has changed since last draw, computation happens internally.
   */
  draw(): void {
    this._backend.draw();
  }

  // ============================================================================
  // Multi-frame API (for animations)
  // ============================================================================

  /**
   * Queue points for a specific frame (no computation yet).
   *
   * @param frameIndex - Index of the frame
   * @param points - Point data as Float32Array (x,y pairs) or number[][]
   * @param domain - Optional domain bounds
   */
  setPointsForFrame(frameIndex: number, points: Float32Array | number[][], domain?: ContourDomain): void {
    this._backend.setPointsForFrame(frameIndex, points, domain);
  }

  /**
   * Compute all queued frames.
   * On GPU, all frames are computed in parallel using a single command buffer.
   * On CPU, frames are computed sequentially.
   */
  async computeAllFrames(): Promise<void> {
    return this._backend.computeAllFrames();
  }

  /**
   * Draw a specific pre-computed frame.
   *
   * @param frameIndex - Index of the frame to draw
   */
  drawFrame(frameIndex: number): void {
    this._backend.drawFrame(frameIndex);
  }

  /**
   * Get number of computed frames.
   */
  getFrameCount(): number {
    return this._backend.getFrameCount();
  }

  /**
   * Clear all cached frames and release their resources.
   */
  clearFrames(): void {
    this._backend.clearFrames();
  }

  // ============================================================================
  // Style updates (no recomputation)
  // ============================================================================

  /**
   * Update the color scale.
   *
   * @param colorScale - New color scale function
   */
  setColorScale(colorScale: ColorScaleFn): void {
    this._backend.setColorScale(colorScale);
  }

  /**
   * Update the opacity.
   *
   * @param opacity - New opacity value (0-1)
   */
  setOpacity(opacity: number): void {
    this._backend.setOpacity(opacity);
  }

  /**
   * Resize the canvas.
   *
   * @param width - New width in pixels
   * @param height - New height in pixels
   */
  resize(width: number, height: number): void {
    this._backend.resize(width, height);
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    this._backend.destroy();
  }
}
