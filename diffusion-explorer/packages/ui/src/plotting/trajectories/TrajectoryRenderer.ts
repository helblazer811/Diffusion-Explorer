/**
 * Unified trajectory renderer class for advanced use cases.
 *
 * For simple use cases, prefer using the `drawTrajectories()` function directly.
 */

import { GPUTrajectoryRenderer } from './gpu';
import {
  drawTrajectories as cpuDrawTrajectories,
  type TrajectoryStyleOptions,
} from './cpu';
import type {
  TrajectoryRendererOptions,
  GPUTrajectoryStyleOptions,
} from './types';

/**
 * Backend interface for unified renderer.
 */
interface TrajectoryBackend {
  setTrajectories(
    trajectories: number[][][],
    segmentIndex: number,
    style: GPUTrajectoryStyleOptions
  ): void;
  draw(clearColor?: [number, number, number, number]): void;
  resize(width: number, height: number, dpr?: number): void;
  destroy(): void;
  readonly backend: 'gpu' | 'cpu';
}

/**
 * CPU backend wrapper that adapts the existing functions to the unified interface.
 */
class CPUTrajectoryBackend implements TrajectoryBackend {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private trajectories: number[][][] = [];
  private segmentIndex = 0;
  private style: TrajectoryStyleOptions | null = null;
  private _dpr: number;

  constructor(canvas: HTMLCanvasElement, dpr?: number) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D canvas context');
    }
    this.ctx = ctx;
    this._dpr = dpr ?? (typeof window !== 'undefined' ? window.devicePixelRatio : 1) ?? 1;
  }

  setTrajectories(
    trajectories: number[][][],
    segmentIndex: number,
    style: GPUTrajectoryStyleOptions
  ): void {
    this.trajectories = trajectories;
    this.segmentIndex = segmentIndex;

    // Convert GPU style to CPU style
    const color = typeof style.color === 'string'
      ? style.color
      : `rgb(${Math.round(style.color[0] * 255)}, ${Math.round(style.color[1] * 255)}, ${Math.round(style.color[2] * 255)})`;

    this.style = {
      strokeWidth: style.strokeWidth,
      color,
      progressOpacity: style.opacity,
      pointRadius: style.pointRadius,
      outline: style.outline,
      headStyle: style.headStyle,
      perSegmentAlphas: style.opacityGradient?.perSegmentAlphas,
    };
  }

  draw(clearColor?: [number, number, number, number]): void {
    if (!this.style) return;

    // Clear if requested
    if (clearColor) {
      this.ctx.fillStyle = `rgba(${Math.round(clearColor[0] * 255)}, ${Math.round(clearColor[1] * 255)}, ${Math.round(clearColor[2] * 255)}, ${clearColor[3]})`;
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    cpuDrawTrajectories(this.ctx, this.trajectories, this.segmentIndex, this.style);
  }

  resize(_width: number, _height: number, dpr?: number): void {
    if (dpr !== undefined) {
      this._dpr = dpr;
    }
  }

  destroy(): void {
    // Nothing to clean up for CPU backend
  }

  get backend(): 'cpu' {
    return 'cpu';
  }
}

/**
 * Unified trajectory renderer with automatic GPU/CPU backend selection.
 *
 * The GPU backend provides:
 * - Time-based z-ordering (more recent segments drawn on top)
 * - Smooth outline support via two-pass rendering
 * - Efficient handling of thousands of trajectories
 *
 * The CPU backend is used as a fallback when WebGPU is unavailable.
 *
 * @example
 * ```typescript
 * const renderer = await TrajectoryRenderer.create({
 *   canvas: myCanvas,
 *   preferGPU: true,
 * });
 *
 * console.log(renderer.backend); // 'gpu' or 'cpu'
 *
 * renderer.setTrajectories(trajectories, segmentIndex, {
 *   strokeWidth: 3,
 *   color: '#ff6b6b',
 *   opacity: 0.9,
 *   pointRadius: 4,
 *   outline: { color: '#000', width: 5, opacity: 0.5 },
 * });
 *
 * renderer.draw();
 * renderer.destroy();
 * ```
 */
export class TrajectoryRenderer {
  private _backend: TrajectoryBackend;

  private constructor(backend: TrajectoryBackend) {
    this._backend = backend;
  }

  /**
   * Create a new TrajectoryRenderer with automatic backend selection.
   *
   * @param options - Renderer configuration options
   * @returns A new TrajectoryRenderer instance
   */
  static async create(options: TrajectoryRendererOptions): Promise<TrajectoryRenderer> {
    const { canvas, preferGPU = true, dpr } = options;

    if (preferGPU) {
      try {
        const gpu = await GPUTrajectoryRenderer.create(canvas, { dpr });
        return new TrajectoryRenderer(gpu);
      } catch (e) {
        console.warn('[TrajectoryRenderer] GPU unavailable, using CPU:', e);
      }
    }

    const cpu = new CPUTrajectoryBackend(canvas, dpr);
    return new TrajectoryRenderer(cpu);
  }

  /**
   * The backend type being used ('gpu' or 'cpu').
   */
  get backend(): 'gpu' | 'cpu' {
    return this._backend.backend;
  }

  /**
   * Set trajectories to render.
   *
   * @param trajectories - Array of trajectories in pixel coords: [trajectory][timestep][x,y]
   * @param segmentIndex - Current animation progress (which segment to draw up to)
   * @param style - Styling options
   */
  setTrajectories(
    trajectories: number[][][],
    segmentIndex: number,
    style: GPUTrajectoryStyleOptions
  ): void {
    this._backend.setTrajectories(trajectories, segmentIndex, style);
  }

  /**
   * Draw the trajectories.
   *
   * @param clearColor - Optional background color (RGBA 0-1)
   */
  draw(clearColor?: [number, number, number, number]): void {
    this._backend.draw(clearColor);
  }

  /**
   * Resize the renderer.
   *
   * @param width - New canvas width in physical pixels
   * @param height - New canvas height in physical pixels
   * @param dpr - Optional new device pixel ratio
   */
  resize(width: number, height: number, dpr?: number): void {
    this._backend.resize(width, height, dpr);
  }

  /**
   * Destroy the renderer and release resources.
   */
  destroy(): void {
    this._backend.destroy();
  }
}
