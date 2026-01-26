/**
 * Type definitions for GPU-accelerated contour rendering.
 *
 * The rendering pipeline:
 * 1. Points are binned into a density grid (GPU compute)
 * 2. Grid is blurred with Gaussian kernel (GPU compute)
 * 3. Marching squares extracts contour segments (GPU compute)
 * 4. Stencil-based rendering fills contours (GPU render)
 * 5. Result is cached to framebuffer for repeated draws
 */

import type { WebGPUContext } from '../../line-integral-convolution/types';
import type { ContourDomain, RGBAColor, ColorScaleFn } from '../types';

export type { WebGPUContext };

/**
 * A single contour segment extracted by marching squares.
 * Packed for GPU buffer (32 bytes per segment).
 */
export interface ContourSegment {
  /** Start point x coordinate (normalized 0-1) */
  x0: number;
  /** Start point y coordinate (normalized 0-1) */
  y0: number;
  /** End point x coordinate (normalized 0-1) */
  x1: number;
  /** End point y coordinate (normalized 0-1) */
  y1: number;
  /** Threshold value of this contour level */
  contourLevel: number;
  /** Index of this contour level (0 to numLevels-1) */
  contourIndex: number;
  /** Validity flag (1.0 = valid, 0.0 = invalid) */
  valid: number;
  /** Padding for alignment */
  _padding: number;
}

/**
 * GPU data for contour rendering.
 */
export interface ContourGPUData {
  /** Segment data packed for GPU upload */
  segments: Float32Array;
  /** Maximum number of segment slots allocated */
  maxSegmentSlots: number;
  /** Number of contour levels */
  numLevels: number;
  /** Grid dimensions */
  gridWidth: number;
  gridHeight: number;
  /** Domain bounds */
  domain: ContourDomain;
  /** Threshold values for each level */
  thresholds: Float32Array;
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
  /** Blur radius in grid cells (default: 10) */
  blurRadius?: number;
  /** Number of contour levels (default: 10) */
  numLevels?: number;
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
  /** Time for stencil rendering (ms) */
  render: number;
  /** Total pipeline time (ms) */
  total: number;
}

/**
 * Buffer layout constants.
 */
export const CONTOUR_SEGMENT_SIZE = 32; // 8 floats * 4 bytes
export const CONTOUR_SEGMENT_FLOATS = 8;

/**
 * Compute uniform buffer size (must be 16-byte aligned).
 */
export const COMPUTE_UNIFORM_BUFFER_SIZE = 64; // Padded for alignment

/**
 * Render uniform buffer size (must be 16-byte aligned).
 */
export const RENDER_UNIFORM_BUFFER_SIZE = 64; // Padded for alignment
