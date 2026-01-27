/**
 * Trajectory rendering module with GPU/CPU backends.
 *
 * This module provides:
 * - `drawTrajectories`: Simple function with automatic GPU/CPU selection
 * - GPU backend (default): Time-based z-ordering, outline support, opacity gradients
 * - CPU backend: Existing canvas-based rendering (fallback when WebGPU unavailable)
 *
 * @example
 * ```typescript
 * // GPU rendering (default) - recommended
 * drawTrajectories(ctx, trajectories, segmentIndex, style);
 *
 * // Force CPU rendering
 * drawTrajectories(ctx, trajectories, segmentIndex, style, { backend: 'cpu' });
 * ```
 */

import { GPUTrajectoryRenderer } from './gpu';
import {
  drawTrajectories as cpuDrawTrajectories,
  drawTrajectoriesWithOpacityGradient,
  drawPartialTrajectory,
  type TrajectoryStyleOptions as CPUTrajectoryStyleOptions,
} from './cpu';
import type {
  GPUTrajectoryStyleOptions,
} from './types';
import { parseColor } from './types';

// Re-export other CPU functions unchanged
export {
  drawTrajectoriesWithOpacityGradient,
  drawPartialTrajectory,
  type PartialTrajectoryOptions,
  type TrajectoryOutlineOptions,
  type HeadStyle,
} from './cpu';

// Re-export types
export type {
  TrajectoryDomain,
  TrajectoryRendererOptions,
  GPUTrajectoryStyleOptions,
  OpacityGradientOptions,
  GPUTrajectoryData,
} from './types';

// Re-export GPU renderer for advanced use
export { GPUTrajectoryRenderer, type GPUTrajectoryRendererOptions } from './gpu';

/**
 * Style options for trajectory rendering.
 */
export type TrajectoryStyleOptions = CPUTrajectoryStyleOptions;

/**
 * Options for controlling trajectory rendering behavior.
 */
export interface TrajectoryRenderOptions {
  /** Backend to use: 'gpu' for WebGPU acceleration (default), 'cpu' for canvas 2D */
  backend?: 'gpu' | 'cpu';
}

// Cache GPU renderers per canvas to avoid recreating WebGPU context each frame
const gpuRendererCache = new WeakMap<HTMLCanvasElement, GPUTrajectoryRenderer>();
const gpuRendererInitializing = new WeakMap<HTMLCanvasElement, Promise<GPUTrajectoryRenderer | null>>();

/**
 * Get or create a cached GPU renderer for a canvas.
 */
async function getGPURenderer(canvas: HTMLCanvasElement): Promise<GPUTrajectoryRenderer | null> {
  // Return cached renderer if available
  const cached = gpuRendererCache.get(canvas);
  if (cached) {
    return cached;
  }

  // Check if initialization is in progress
  const initializing = gpuRendererInitializing.get(canvas);
  if (initializing) {
    return initializing;
  }

  // Start initialization
  const initPromise = (async () => {
    try {
      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
      const renderer = await GPUTrajectoryRenderer.create(canvas, { dpr });
      gpuRendererCache.set(canvas, renderer);
      return renderer;
    } catch (e) {
      console.warn('[drawTrajectories] GPU unavailable, falling back to CPU:', e);
      return null;
    } finally {
      gpuRendererInitializing.delete(canvas);
    }
  })();

  gpuRendererInitializing.set(canvas, initPromise);
  return initPromise;
}

/**
 * Convert CPU style to GPU style.
 */
function cpuStyleToGPUStyle(style: TrajectoryStyleOptions): GPUTrajectoryStyleOptions {
  return {
    strokeWidth: style.strokeWidth,
    color: style.color,
    opacity: style.progressOpacity,
    pointRadius: style.pointRadius,
    outline: style.outline,
    headStyle: style.headStyle,
    opacityGradient: style.perSegmentAlphas
      ? { mode: 'custom', perSegmentAlphas: style.perSegmentAlphas }
      : undefined,
  };
}

/**
 * Draw trajectories with animated progress.
 *
 * Supports both GPU and CPU rendering:
 * - GPU (default): Time-based z-ordering, smooth outline support
 * - CPU: Fallback when WebGPU unavailable, or via `{ backend: 'cpu' }`
 *
 * @param ctx - Canvas 2D rendering context
 * @param trajectories - Array of trajectories in pixel coords: [trajectory][timestep][x,y]
 * @param segmentIndex - Current segment index for animation progress
 * @param style - Styling options (strokeWidth, color, opacity, etc.)
 * @param options - Render options (backend selection)
 *
 * @example
 * ```typescript
 * // GPU rendering (default) - recommended
 * drawTrajectories(ctx, trajectories, segmentIndex, {
 *   strokeWidth: 2,
 *   color: '#3b82f6',
 *   progressOpacity: 0.8,
 *   pointRadius: 4,
 * });
 *
 * // Force CPU rendering
 * drawTrajectories(ctx, trajectories, segmentIndex, style, { backend: 'cpu' });
 * ```
 */
export function drawTrajectories(
  ctx: CanvasRenderingContext2D,
  trajectories: number[][][],
  segmentIndex: number,
  style: TrajectoryStyleOptions,
  options?: TrajectoryRenderOptions
): void {
  const canvas = ctx.canvas;
  const useGPU = options?.backend !== 'cpu';

  if (useGPU) {
    // GPU path - async but we don't await (fire-and-forget for animation frames)
    const cached = gpuRendererCache.get(canvas);
    if (cached) {
      // Use GPU renderer
      cached.setTrajectories(trajectories, segmentIndex, cpuStyleToGPUStyle(style));
      cached.draw();
    } else {
      // Initialize GPU renderer async, fall back to CPU for this frame
      getGPURenderer(canvas).then(() => {
        // GPU ready for next frame
      });

      // Fall back to CPU for this frame
      cpuDrawTrajectories(ctx, trajectories, segmentIndex, style);
    }
  } else {
    // CPU path
    cpuDrawTrajectories(ctx, trajectories, segmentIndex, style);
  }
}

/**
 * Unified trajectory renderer class for advanced use cases.
 * Prefer using `drawTrajectories()` function for simple cases.
 */
export { TrajectoryRenderer } from './TrajectoryRenderer';
