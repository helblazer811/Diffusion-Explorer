/**
 * CPU-based contour renderer using D3.
 *
 * This class provides a Canvas 2D-based contour renderer that matches
 * the GPU renderer's API for seamless fallback.
 */

import * as d3 from 'd3';
import { computeContours, plotContours, type ComputedContours } from './contours';
import type { ContourDomain, ColorScaleFn } from '../types';
import { defaultColorScale } from '../types';

/**
 * Options for creating a CPU contour renderer.
 */
export interface CPUContourRendererOptions {
  gridSize?: number;
  bandwidth?: number;
  numLevels?: number;
  opacity?: number;
  colorScale?: ColorScaleFn;
}

/**
 * CPU-based contour renderer using D3 and Canvas 2D.
 *
 * Provides the same API as the GPU renderer for seamless fallback.
 */
export class CPUContourRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private gridSize: number;
  private bandwidth: number;
  private numLevels: number;
  private opacity: number;
  private colorScale: ColorScaleFn;

  // Single-frame state
  private points: [number, number][] = [];
  private domain: ContourDomain | null = null;
  private cachedContours: ComputedContours | null = null;

  // Multi-frame state
  private pendingFrames: Map<number, { points: [number, number][]; domain: ContourDomain | null }> = new Map();
  private frameContours: Map<number, ComputedContours> = new Map();

  constructor(canvas: HTMLCanvasElement, options: CPUContourRendererOptions = {}) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D context from canvas');
    }
    this.ctx = ctx;
    this.gridSize = options.gridSize ?? 100;
    this.bandwidth = options.bandwidth ?? 20;
    this.numLevels = options.numLevels ?? 10;
    this.opacity = options.opacity ?? 1.0;
    this.colorScale = options.colorScale ?? defaultColorScale;
  }

  // ============================================================================
  // Single-frame API
  // ============================================================================

  /**
   * Set point data for rendering.
   */
  setPoints(points: Float32Array | number[][], domain?: ContourDomain): void {
    this.points = normalizeToPointArray(points);
    this.domain = domain ?? null;
    this.cachedContours = null; // Invalidate cache
  }

  /**
   * Draw contours to the canvas.
   */
  draw(): void {
    // Compute if needed
    if (!this.cachedContours && this.points.length > 0) {
      this.cachedContours = computeContours(this.points, {
        gridSize: this.gridSize,
        bandwidth: this.bandwidth,
        thresholds: this.numLevels,
        domain: this.domain
          ? [this.domain.xMin, this.domain.xMax, this.domain.yMin, this.domain.yMax]
          : undefined,
      });
    }

    // Clear and draw
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (this.cachedContours) {
      this.drawContours(this.cachedContours);
    }
  }

  // ============================================================================
  // Multi-frame API
  // ============================================================================

  /**
   * Queue points for a specific frame (no computation yet).
   */
  setPointsForFrame(frameIndex: number, points: Float32Array | number[][], domain?: ContourDomain): void {
    this.pendingFrames.set(frameIndex, {
      points: normalizeToPointArray(points),
      domain: domain ?? null,
    });
  }

  /**
   * Compute all queued frames sequentially.
   */
  async computeAllFrames(): Promise<void> {
    for (const [frameIndex, { points, domain }] of this.pendingFrames) {
      const contours = computeContours(points, {
        gridSize: this.gridSize,
        bandwidth: this.bandwidth,
        thresholds: this.numLevels,
        domain: domain
          ? [domain.xMin, domain.xMax, domain.yMin, domain.yMax]
          : undefined,
      });
      this.frameContours.set(frameIndex, contours);
    }
    this.pendingFrames.clear();
  }

  /**
   * Draw a specific pre-computed frame.
   */
  drawFrame(frameIndex: number): void {
    const contours = this.frameContours.get(frameIndex);
    if (!contours) return;

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawContours(contours);
  }

  /**
   * Get number of computed frames.
   */
  getFrameCount(): number {
    return this.frameContours.size;
  }

  /**
   * Clear all cached frames.
   */
  clearFrames(): void {
    this.pendingFrames.clear();
    this.frameContours.clear();
  }

  // ============================================================================
  // Style updates
  // ============================================================================

  /**
   * Update the color scale.
   */
  setColorScale(colorScale: ColorScaleFn): void {
    this.colorScale = colorScale;
  }

  /**
   * Update the opacity.
   */
  setOpacity(opacity: number): void {
    this.opacity = opacity;
  }

  /**
   * Resize the canvas.
   */
  resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    this.clearFrames();
    this.cachedContours = null;
    this.points = [];
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  /**
   * Draw contours to canvas using the current style settings.
   */
  private drawContours(contours: ComputedContours): void {
    const [xMin, xMax, yMin, yMax] = contours.domain;
    const xScale = d3.scaleLinear().domain([xMin, xMax]).range([0, this.canvas.width]);
    const yScale = d3.scaleLinear().domain([yMin, yMax]).range([this.canvas.height, 0]);

    // Convert ColorScaleFn (returns RGBA 0-1) to string color scale for plotContours
    const stringColorScale = (t: number): string => {
      const [r, g, b, a] = this.colorScale(t);
      return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
    };

    plotContours(this.ctx, contours, {
      colorScale: stringColorScale,
      opacity: this.opacity,
      fill: true,
      stroke: false,
      xScale,
      yScale,
    });
  }
}

/**
 * Convert Float32Array or number[][] to [number, number][] format.
 */
function normalizeToPointArray(points: Float32Array | number[][]): [number, number][] {
  if (points instanceof Float32Array) {
    const result: [number, number][] = [];
    for (let i = 0; i < points.length; i += 2) {
      result.push([points[i], points[i + 1]]);
    }
    return result;
  }
  return points as [number, number][];
}
