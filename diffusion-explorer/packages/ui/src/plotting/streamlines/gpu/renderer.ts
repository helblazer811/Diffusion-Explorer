/**
 * GPU-accelerated streamline rendering using WebGPU.
 *
 * This module wraps PulsingPathsRenderer for backwards compatibility,
 * providing streamline-specific terminology and API.
 *
 * Both implementations now share the same shader with max blending
 * for idempotent overlapping renders.
 */

import {
  PulsingPathsRenderer,
  preparePathData,
} from '../../pulsing-paths/gpu/renderer';

import type {
  WebGPUContext,
  PulsingPathsGPUData,
} from '../../pulsing-paths/gpu/types';

import type {
  StreamlineRendererOptions,
  StreamlineRenderStyle,
  StreamlineGPUData,
} from './types';

import {
  toStreamlineGPUData,
  toPulsingPathsOptions,
  toPulsingPathsStyle,
} from './types';

// Re-export types for convenience
export type {
  StreamlineRendererOptions,
  StreamlineRenderStyle,
  StreamlineGPUData,
  WebGPUContext,
};

/**
 * Prepare streamline data for GPU upload.
 *
 * Converts an array of streamlines (each streamline is an array of [x, y] points)
 * into a flat Float32Array suitable for GPU storage buffer.
 *
 * @param streamlines - Array of streamlines in pixel coordinates
 * @param offsets - Phase offsets per streamline ('random' or 'synchronized')
 * @param minSegmentLength - Minimum segment length; shorter segments are merged (default: 0 = no merging)
 * @returns GPU-ready data structure
 */
export function prepareStreamlineData(
  streamlines: number[][][],
  offsets: 'random' | 'synchronized' = 'synchronized',
  minSegmentLength: number = 0
): StreamlineGPUData {
  const pathData = preparePathData(streamlines, offsets, minSegmentLength);
  return toStreamlineGPUData(pathData);
}

/**
 * GPU-accelerated streamline renderer.
 *
 * This is a wrapper around PulsingPathsRenderer that provides
 * streamline-specific terminology for backwards compatibility.
 *
 * @example
 * ```typescript
 * const renderer = await StreamlineRenderer.create(canvas, {
 *   thickness: 3,
 *   color: '#ff6b6b',
 *   pulseWidth: 40,
 * });
 *
 * renderer.setStreamlines(streamlines);
 *
 * function animate(time) {
 *   renderer.render({ phase: (time / 2000) % 1 });
 *   requestAnimationFrame(animate);
 * }
 * ```
 */
export class StreamlineRenderer {
  private renderer: PulsingPathsRenderer;

  private constructor(renderer: PulsingPathsRenderer) {
    this.renderer = renderer;
  }

  /**
   * Create a new StreamlineRenderer for a canvas.
   *
   * The canvas should already be sized for the device pixel ratio:
   * - canvas.width = cssWidth * dpr (physical pixels)
   * - canvas.height = cssHeight * dpr (physical pixels)
   * - canvas.style.width = cssWidth + 'px' (CSS pixels)
   * - canvas.style.height = cssHeight + 'px' (CSS pixels)
   *
   * Streamline coordinates should be in CSS/logical pixels. The renderer
   * will automatically scale them to physical pixels based on DPR.
   *
   * @param canvas - HTML canvas element to render to (already DPR-sized)
   * @param options - Renderer configuration options
   * @param gpuContext - Optional existing WebGPU context
   * @returns Promise resolving to the renderer instance
   * @throws Error if WebGPU is not available
   */
  static async create(
    canvas: HTMLCanvasElement,
    options: StreamlineRendererOptions = {},
    gpuContext?: WebGPUContext
  ): Promise<StreamlineRenderer> {
    const pulsingRenderer = await PulsingPathsRenderer.create(
      canvas,
      toPulsingPathsOptions(options),
      gpuContext
    );
    return new StreamlineRenderer(pulsingRenderer);
  }

  /**
   * Set the streamlines to render.
   *
   * This uploads the streamline data to the GPU. Call this once when
   * streamlines change, not every frame.
   *
   * @param streamlines - Array of streamlines in pixel coordinates
   * @param offsets - Phase offset mode ('random' or 'synchronized')
   */
  setStreamlines(
    streamlines: number[][][],
    offsets: 'random' | 'synchronized' = 'synchronized'
  ): void {
    this.renderer.setPaths(streamlines, offsets);
  }

  /**
   * Set streamlines from pre-prepared GPU data.
   *
   * Useful when you want to prepare data once and reuse it.
   *
   * @param gpuData - Pre-prepared GPU data from prepareStreamlineData()
   */
  setStreamlineData(gpuData: StreamlineGPUData): void {
    // Convert StreamlineGPUData to PulsingPathsGPUData
    const pathData: PulsingPathsGPUData = {
      segments: gpuData.segments,
      segmentCount: gpuData.segmentCount,
      pathCount: gpuData.streamlineCount,
    };
    this.renderer.setPathData(pathData);
  }

  /**
   * Update canvas size.
   *
   * Call this if the canvas is resized.
   *
   * @param width - New canvas width in physical pixels
   * @param height - New canvas height in physical pixels
   * @param dpr - Optional new device pixel ratio
   */
  resize(width: number, height: number, dpr?: number): void {
    this.renderer.resize(width, height, dpr);
  }

  /**
   * Get the current device pixel ratio.
   */
  getDpr(): number {
    return this.renderer.getDpr();
  }

  /**
   * Render the streamlines.
   *
   * Call this every frame with the current animation phase.
   *
   * @param style - Render style with animation phase and optional overrides
   * @param clearColor - Optional background color to clear with (RGBA 0-1)
   */
  render(
    style: StreamlineRenderStyle,
    clearColor?: [number, number, number, number]
  ): void {
    this.renderer.render(toPulsingPathsStyle(style), clearColor);
  }

  /**
   * Render to an offscreen texture (for compositing).
   *
   * @param style - Render style with animation phase
   * @param targetView - GPU texture view to render to
   * @param clearColor - Optional background color to clear with
   */
  renderToTexture(
    style: StreamlineRenderStyle,
    targetView: GPUTextureView,
    clearColor?: [number, number, number, number]
  ): GPUCommandBuffer {
    return this.renderer.renderToTexture(toPulsingPathsStyle(style), targetView, clearColor);
  }

  /**
   * Update rendering options.
   *
   * @param options - New options to apply
   */
  updateOptions(options: Partial<StreamlineRendererOptions>): void {
    this.renderer.updateOptions(options);
  }

  /**
   * Get the current segment count.
   */
  getSegmentCount(): number {
    return this.renderer.getSegmentCount();
  }

  /**
   * Get the GPU device used by this renderer.
   */
  getDevice(): GPUDevice {
    return this.renderer.getDevice();
  }

  /**
   * Get the texture format used by this renderer.
   */
  getFormat(): GPUTextureFormat {
    return this.renderer.getFormat();
  }

  /**
   * Get the canvas context for direct access.
   */
  getContext(): GPUCanvasContext {
    return this.renderer.getContext();
  }

  /**
   * Get the current canvas dimensions in physical pixels.
   */
  getCanvasSize(): { width: number; height: number } {
    return this.renderer.getCanvasSize();
  }

  /**
   * Destroy the renderer and release GPU resources.
   */
  destroy(): void {
    this.renderer.destroy();
  }
}
