/**
 * Shared type definitions for heatmap rendering.
 */

/**
 * Pixel bounds for heatmap rendering.
 */
export interface HeatmapBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Precomputed heatmap density data.
 * Can be passed to drawHeatmap to skip density computation.
 */
export interface PrecomputedHeatmap {
  /** Normalized density grid [0, 1], row-major order */
  density: Float32Array;
  /** Grid resolution (cells per axis) */
  resolution: number;
  /** Domain bounds [xMin, xMax, yMin, yMax] */
  domain: [number, number, number, number];
  /** Which backend computed the density */
  backend: "gpu" | "cpu";
}

/**
 * GPU context for heatmap computation.
 * Can be reused across multiple precomputeHeatmap calls.
 */
export interface HeatmapGPUContext {
  device: GPUDevice;
  destroy(): void;
}

/**
 * Options for precomputing heatmap density.
 */
export interface PrecomputeOptions {
  /** Grid resolution (cells per axis). Default: 100 */
  resolution?: number;
  /** KDE bandwidth (larger = smoother). Default: 20 */
  bandwidth?: number;
  /** Domain bounds [xMin, xMax, yMin, yMax]. Auto-computed if not provided */
  domain?: [number, number, number, number];
  /** Backend to use. Default: 'gpu' if available, else 'cpu' */
  backend?: "gpu" | "cpu";
  /** Reusable GPU context (avoids re-initialization) */
  gpuContext?: HeatmapGPUContext;
}

/**
 * Options for drawing a heatmap from scattered points.
 */
export interface HeatmapOptions {
  /** Grid resolution (cells per axis). Default: 100 */
  resolution?: number;
  /** KDE bandwidth (larger = smoother). Default: 20 */
  bandwidth?: number;
  /** Domain bounds [xMin, xMax, yMin, yMax]. Auto-computed if not provided */
  domain?: [number, number, number, number];
  /** Color scale function mapping [0, 1] to color string. Default: d3.interpolatePlasma */
  colorScale?: (t: number) => string;
  /** Global opacity. Default: 1 */
  opacity?: number;
  /** Canvas blend mode */
  blendMode?: GlobalCompositeOperation;
  /** Pixel bounds {x, y, width, height}. If provided, xScale/yScale are optional */
  bounds?: HeatmapBounds;
  /** Scale function: data x -> pixel x. Required if bounds not provided */
  xScale?: (x: number) => number;
  /** Scale function: data y -> pixel y. Required if bounds not provided */
  yScale?: (y: number) => number;
  /** Precomputed density data. If provided, skips density computation */
  precomputed?: PrecomputedHeatmap;
}
