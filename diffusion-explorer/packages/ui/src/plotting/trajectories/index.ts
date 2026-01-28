/**
 * Trajectory rendering module with GPU/CPU backends.
 *
 * This module provides:
 * - `drawTrajectories`: Unified function with automatic GPU/CPU selection
 * - GPU backend: Time-based z-ordering, outline support, opacity gradients
 * - CPU backend: Canvas 2D rendering
 *
 * @example
 * ```typescript
 * // CPU rendering - pass ctx
 * drawTrajectories(ctx, trajectories, segmentIndex, style);
 *
 * // GPU rendering - pass canvas element (use useCanvasWebGPU)
 * const trajCanvas = useCanvasWebGPU(width, height);
 * await drawTrajectories(trajCanvas.canvas, trajectories, segmentIndex, style);
 * ```
 */

import { GPUTrajectoryRenderer } from './gpu';
import {
  drawTrajectories as cpuDrawTrajectories,
  drawTrajectoriesWithOpacityGradient,
  drawPartialTrajectory,
} from './cpu';
import type {
  TrajectoryStyleOptions,
} from './types';


// Re-export CPU functions
export {
  drawTrajectoriesWithOpacityGradient,
  drawPartialTrajectory,
  type PartialTrajectoryOptions,
} from './cpu';

// Re-export types from central location
export type {
  TrajectoryDomain,
  TrajectoryStyleOptions,
  TrajectoryOutlineOptions,
  HeadStyle,
  OpacityGradientOptions,
  GPUTrajectoryData,
} from './types';

// Re-export GPU renderer for advanced use
export { GPUTrajectoryRenderer, type GPUTrajectoryRendererOptions } from './gpu';


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
 * Normalize style to ensure opacityGradient is set from legacy perSegmentAlphas if needed.
 */
function normalizeStyle(style: TrajectoryStyleOptions): TrajectoryStyleOptions {
  // If opacityGradient is already set, use it as-is
  if (style.opacityGradient) {
    return style;
  }
  // Convert legacy perSegmentAlphas to opacityGradient
  if (style.perSegmentAlphas) {
    return {
      ...style,
      opacityGradient: { mode: 'custom', perSegmentAlphas: style.perSegmentAlphas },
    };
  }
  return style;
}

/**
 * Options for drawTrajectories.
 */
export interface DrawTrajectoriesOptions {
  /** Whether to clear the canvas before drawing (default: true for GPU, ignored for CPU) */
  clearCanvas?: boolean;
}

/**
 * Draw trajectories with automatic GPU/CPU selection.
 *
 * - Pass a `CanvasRenderingContext2D` → CPU rendering
 * - Pass an `HTMLCanvasElement` (pristine, no 2D context) → GPU rendering
 *
 * On first GPU call, awaits renderer creation before drawing.
 * Subsequent calls use cached renderer synchronously.
 *
 * @param target - Canvas 2D context (CPU) or HTMLCanvasElement (GPU)
 * @param trajectories - Array of trajectories in pixel coords: [trajectory][timestep][x,y]
 * @param segmentIndex - Current segment index for animation progress
 * @param style - Styling options (strokeWidth, color, opacity, etc.)
 * @param options - Additional options (clearCanvas, etc.)
 *
 * @example
 * ```typescript
 * // CPU rendering - pass ctx
 * drawTrajectories(ctx, trajectories, segmentIndex, style);
 *
 * // GPU rendering - pass canvas element (use useCanvasWebGPU)
 * const trajCanvas = useCanvasWebGPU(width, height);
 * await drawTrajectories(trajCanvas.canvas, trajectories, segmentIndex, style);
 *
 * // GPU rendering - draw multiple sets without clearing between calls
 * await drawTrajectories(canvas, trajectories1, segmentIndex1, style1, { clearCanvas: true });
 * await drawTrajectories(canvas, trajectories2, segmentIndex2, style2, { clearCanvas: false });
 * ```
 */
export async function drawTrajectories(
  target: CanvasRenderingContext2D | HTMLCanvasElement,
  trajectories: number[][][],
  segmentIndex: number,
  style: TrajectoryStyleOptions,
  options?: DrawTrajectoriesOptions
): Promise<void> {
  // Normalize style (convert legacy perSegmentAlphas to opacityGradient)
  const normalizedStyle = normalizeStyle(style);
  const shouldClear = options?.clearCanvas ?? true;

  // Detect if target is canvas element (GPU path) or ctx (CPU path)
  const isCanvasElement = target instanceof HTMLCanvasElement;

  if (isCanvasElement) {
    // GPU path - canvas element passed directly (pristine, no 2D context)
    const canvas = target;
    const cached = gpuRendererCache.get(canvas);
    const clearColor = shouldClear ? [0, 0, 0, 0] as [number, number, number, number] : undefined;

    if (cached) {
      // Use cached GPU renderer
      cached.draw(trajectories, segmentIndex, normalizedStyle, clearColor);
      return;
    }

    // First call - await GPU renderer creation
    const renderer = await getGPURenderer(canvas);
    if (!renderer) {
      console.warn('[drawTrajectories] GPU renderer creation failed');
      return;
    }

    // Draw with newly created renderer
    renderer.draw(trajectories, segmentIndex, normalizedStyle, clearColor);
  } else {
    // CPU path - 2D context passed (clearCanvas option ignored, CPU doesn't auto-clear)
    cpuDrawTrajectories(target, trajectories, segmentIndex, normalizedStyle);
  }
}
