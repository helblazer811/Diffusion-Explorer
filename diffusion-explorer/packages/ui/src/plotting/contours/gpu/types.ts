/**
 * Type definitions for GPU-accelerated contour rendering.
 *
 * The rendering pipeline:
 * 1. Points are binned into a density grid (GPU compute)
 * 2. Grid is blurred with box blur kernel (GPU compute)
 * 3. Threshold-based fill renders per-pixel alpha (GPU render)
 * 4. Result is cached to framebuffer for repeated draws
 */

import type { WebGPUContext } from '../../line-integral-convolution/types';
import type { ContourDomain, ColorScaleFn } from '../types';

export type { WebGPUContext };

/**
 * Uniforms for threshold-based fill shader.
 */
export interface ThresholdFillUniforms {
  /** Canvas width in physical pixels */
  width: number;
  /** Canvas height in physical pixels */
  height: number;
  /** Grid width in cells */
  gridWidth: number;
  /** Grid height in cells */
  gridHeight: number;
  /** Number of contour levels */
  numLevels: number;
  /** Global opacity multiplier */
  opacity: number;
}

/**
 * Uniforms for the contour compute shaders.
 */
export interface ContourComputeUniforms {
  /** Grid width in cells */
  gridWidth: number;
  /** Grid height in cells */
  gridHeight: number;
  /** Number of contour levels */
  numLevels: number;
  /** Number of points (for binning) */
  numPoints: number;
  /** Domain bounds */
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  /** Blur radius in cells */
  blurRadius: number;
}

/**
 * Uniforms for the contour render shaders.
 */
export interface ContourRenderUniforms {
  /** Canvas width in physical pixels */
  width: number;
  /** Canvas height in physical pixels */
  height: number;
  /** Device pixel ratio */
  dpr: number;
  /** Number of contour levels */
  numLevels: number;
  /** Current contour level being rendered */
  currentLevel: number;
  /** Domain bounds for coordinate mapping */
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/**
 * Options for creating a ContourRenderer.
 */
export interface ContourRendererOptions {
  /** Device pixel ratio (default: window.devicePixelRatio or 1) */
  dpr?: number;
  /** Grid resolution for density estimation (default: 100) */
  gridSize?: number;
  /**
   * Bandwidth for kernel density estimation (default: 20).
   * Uses the same scale as D3's contourDensity bandwidth parameter.
   * Internally converted to blur radius using D3's formula:
   * r = (sqrt(4 * bandwidth^2 + 1) - 1) / 2
   */
  bandwidth?: number;
  /**
   * Threshold specification for contour levels.
   * - If a number: generates that many uniformly-spaced thresholds
   * - If an array: uses those exact percentile values (should be in [0, 1])
   * Default: 10
   */
  thresholds?: number | number[];
  /** Color scale function (default: blue gradient) */
  colorScale?: ColorScaleFn;
  /** Global opacity (default: 1.0) */
  opacity?: number;
}

/**
 * Render style options (can be changed between draws).
 */
export interface ContourRenderStyle {
  /** Optional override for color scale */
  colorScale?: ColorScaleFn;
  /** Optional override for opacity */
  opacity?: number;
  /** Optional override for device pixel ratio */
  dpr?: number;
}

/**
 * Pipeline stages for performance profiling.
 */
export interface ContourPipelineTimings {
  /** Time for histogram binning (ms) */
  binning: number;
  /** Time for Gaussian blur (ms) */
  blur: number;
  /** Time for marching squares (ms) */
  marchingSquares: number;
  /** Time for triangle rendering (ms) */
  render: number;
  /** Total pipeline time (ms) */
  total: number;
}

/**
 * Compute uniform buffer size (must be 16-byte aligned).
 */
export const COMPUTE_UNIFORM_BUFFER_SIZE = 64; // Padded for alignment

/**
 * Threshold fill uniform buffer size (must be 16-byte aligned).
 * Layout: width(f32), height(f32), gridWidth(u32), gridHeight(u32),
 *         numLevels(u32), opacity(f32), pad0(u32), pad1(u32)
 */
export const THRESHOLD_FILL_UNIFORM_SIZE = 32; // 8 values * 4 bytes
