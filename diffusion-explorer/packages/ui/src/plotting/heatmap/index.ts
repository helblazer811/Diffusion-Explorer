/**
 * Heatmap rendering module.
 *
 * Provides:
 * - drawHeatmap() - Synchronous heatmap rendering (backward compatible)
 * - precomputeHeatmap() - Async precomputation for GPU acceleration
 * - initHeatmapGPU() - Initialize reusable GPU context
 */

import * as d3 from "d3";
import { computeNormalizedDensity } from "./cpu";
import { computeHeatmapGPU, initHeatmapGPU } from "./gpu";
import type {
  HeatmapOptions,
  HeatmapBounds,
  PrecomputedHeatmap,
  PrecomputeOptions,
  HeatmapGPUContext,
} from "./types";

// Re-export types
export type {
  HeatmapOptions,
  HeatmapBounds,
  PrecomputedHeatmap,
  PrecomputeOptions,
  HeatmapGPUContext,
};

// Re-export utilities
export { computeHeatmapDensity, computeNormalizedDensity } from "./cpu";
export { initHeatmapGPU, computeHeatmapGPU } from "./gpu";

/**
 * Compute domain from points with 10% padding.
 */
function computeDomain(points: number[][]): [number, number, number, number] {
  const xExtent = d3.extent(points, (p) => p[0]) as [number, number];
  const yExtent = d3.extent(points, (p) => p[1]) as [number, number];
  const xPad = (xExtent[1] - xExtent[0]) * 0.1 || 0.1;
  const yPad = (yExtent[1] - yExtent[0]) * 0.1 || 0.1;
  return [xExtent[0] - xPad, xExtent[1] + xPad, yExtent[0] - yPad, yExtent[1] + yPad];
}

/**
 * Render density grid to canvas.
 */
function renderDensityToCanvas(
  ctx: CanvasRenderingContext2D,
  density: Float32Array,
  resolution: number,
  domain: [number, number, number, number],
  options: HeatmapOptions
): void {
  const { colorScale = d3.interpolatePlasma, opacity = 1, blendMode, bounds } = options;
  const [xMin, xMax, yMin, yMax] = domain;

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.strokeStyle = "transparent";
  ctx.lineWidth = 0;
  ctx.imageSmoothingEnabled = false;
  if (blendMode) {
    ctx.globalCompositeOperation = blendMode;
  }

  // Create pixel scale functions
  let xScale: (x: number) => number;
  let yScale: (y: number) => number;

  if (bounds) {
    xScale = d3.scaleLinear().domain([xMin, xMax]).range([bounds.x, bounds.x + bounds.width]);
    yScale = d3.scaleLinear().domain([yMin, yMax]).range([bounds.y + bounds.height, bounds.y]);
  } else if (options.xScale && options.yScale) {
    xScale = options.xScale;
    yScale = options.yScale;
  } else {
    throw new Error("drawHeatmap: Either bounds or xScale/yScale must be provided");
  }

  // Create ImageData
  const imageData = ctx.createImageData(resolution, resolution);
  const data = imageData.data;

  for (let gy = 0; gy < resolution; gy++) {
    for (let gx = 0; gx < resolution; gx++) {
      const normalizedDensity = density[gy * resolution + gx];

      const color = d3.color(colorScale(normalizedDensity));
      const rgb = color?.rgb() ?? d3.rgb(0, 0, 0);

      // Flip y-axis for canvas coordinates
      const pixelIndex = ((resolution - 1 - gy) * resolution + gx) * 4;
      data[pixelIndex] = rgb.r;
      data[pixelIndex + 1] = rgb.g;
      data[pixelIndex + 2] = rgb.b;
      data[pixelIndex + 3] = Math.round(255 * opacity);
    }
  }

  // Draw to temporary canvas, then scale
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = resolution;
  tempCanvas.height = resolution;
  const tempCtx = tempCanvas.getContext("2d")!;
  tempCtx.putImageData(imageData, 0, 0);

  const targetX = xScale(xMin);
  const targetY = yScale(yMax);
  const targetX2 = xScale(xMax);
  const targetY2 = yScale(yMin);
  const targetWidth = Math.abs(targetX2 - targetX);
  const targetHeight = Math.abs(targetY2 - targetY);

  ctx.drawImage(
    tempCanvas,
    Math.min(targetX, targetX2),
    Math.min(targetY, targetY2),
    targetWidth,
    targetHeight
  );

  ctx.restore();
}

/**
 * Precompute heatmap density for later rendering.
 * Use GPU by default if available, falls back to CPU.
 *
 * @param points - Array of [x, y] points in data coordinates
 * @param options - Precomputation options
 * @returns Promise<PrecomputedHeatmap> - Precomputed density data
 *
 * @example
 * ```typescript
 * // Precompute once
 * const precomputed = await precomputeHeatmap(points, { resolution: 100, bandwidth: 20 });
 *
 * // Render multiple times (fast)
 * drawHeatmap(ctx, points, { precomputed, bounds: { x: 0, y: 0, width: 500, height: 500 } });
 * ```
 */
export async function precomputeHeatmap(
  points: number[][],
  options: PrecomputeOptions = {}
): Promise<PrecomputedHeatmap> {
  const { resolution = 100, bandwidth = 20, backend, gpuContext } = options;

  if (points.length === 0) {
    return {
      density: new Float32Array(resolution * resolution),
      resolution,
      domain: [0, 1, 0, 1],
      backend: "cpu",
    };
  }

  const domain = options.domain ?? computeDomain(points);

  // Determine backend
  let useGPU = backend === "gpu" || (backend !== "cpu" && typeof navigator !== "undefined" && !!navigator.gpu);

  if (useGPU) {
    try {
      const density = await computeHeatmapGPU(points, domain, resolution, bandwidth, gpuContext);
      return { density, resolution, domain, backend: "gpu" };
    } catch (e) {
      console.warn("[precomputeHeatmap] GPU unavailable, falling back to CPU:", e);
      useGPU = false;
    }
  }

  const density = computeNormalizedDensity(points, domain, resolution, bandwidth);
  return { density, resolution, domain, backend: "cpu" };
}

/**
 * Draw a continuous density heatmap from scattered 2D points.
 * Uses kernel density estimation (KDE) to compute density at each grid cell.
 *
 * This function is synchronous. For GPU acceleration, use precomputeHeatmap()
 * first and pass the result via options.precomputed.
 *
 * @param ctx - Canvas 2D rendering context
 * @param points - Array of [x, y] points in data coordinates
 * @param options - Heatmap configuration options
 *
 * @example
 * ```typescript
 * // Simple usage (CPU, synchronous)
 * drawHeatmap(ctx, points, {
 *   resolution: 50,
 *   bandwidth: 15,
 *   colorScale: d3.interpolateInferno,
 *   bounds: { x: 0, y: 0, width: 500, height: 500 },
 * });
 *
 * // With precomputed density (GPU accelerated)
 * const precomputed = await precomputeHeatmap(points, { resolution: 100 });
 * drawHeatmap(ctx, points, { precomputed, bounds: { x: 0, y: 0, width: 500, height: 500 } });
 * ```
 */
export function drawHeatmap(
  ctx: CanvasRenderingContext2D,
  points: number[][],
  options: HeatmapOptions
): void {
  const { resolution = 100, bandwidth = 20 } = options;

  if (points.length === 0) return;

  // Use precomputed density if provided
  if (options.precomputed) {
    renderDensityToCanvas(
      ctx,
      options.precomputed.density,
      options.precomputed.resolution,
      options.precomputed.domain,
      options
    );
    return;
  }

  // Compute domain
  const domain = options.domain ?? computeDomain(points);

  // Compute density on CPU (synchronous)
  const density = computeNormalizedDensity(points, domain, resolution, bandwidth);

  renderDensityToCanvas(ctx, density, resolution, domain, options);
}
