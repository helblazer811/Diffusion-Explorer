/**
 * Type definitions for Line Integral Convolution (LIC) visualization.
 */

import type { VectorFieldFn } from '../streamlines';

export type { VectorFieldFn };

/**
 * Domain bounds for LIC computation.
 */
export interface LICDomain {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/**
 * RGB color tuple [r, g, b] with values in [0, 255].
 */
export type RGBColor = [number, number, number];

/**
 * Color palette for magnitude-based coloring.
 * Maps normalized magnitude [0, 1] to RGB colors.
 */
export type ColorPalette = (t: number) => RGBColor;

/**
 * Options for colored ImageData output.
 */
export interface LICColorOptions {
  /** Color palette function mapping [0, 1] to RGB */
  palette: ColorPalette;
  /** Minimum magnitude for color mapping (default: auto from data) */
  minMagnitude?: number;
  /** Maximum magnitude for color mapping (default: auto from data) */
  maxMagnitude?: number;
  /** Background color to blend toward (default: [0, 0, 0] black) */
  backgroundColor?: RGBColor;
}

/**
 * Configuration options for LIC computation.
 */
export interface LICOptions {
  /** Vector field function mapping (x, y) to [vx, vy] */
  vectorField: VectorFieldFn;
  /** Domain bounds in world coordinates */
  domain: LICDomain;
  /** Output image width in pixels */
  width: number;
  /** Output image height in pixels */
  height: number;
  /** Maximum iterations per direction (safety limit, default: 20) */
  integrationSteps?: number;
  /** Step size in pixels (default: 0.5) */
  stepSize?: number;
  /** Maximum arc length in pixels (default: 20.0) */
  maxArcLength?: number;
  /** Random seed for noise generation (default: random) */
  seed?: number;
  /** Contrast enhancement factor (default: 1.0) */
  contrast?: number;
  /**
   * Scale factor for noise texture (default: 1.0).
   * Values > 1 create larger noise blobs = wider streaks.
   * E.g., noiseScale: 4 means each noise "pixel" covers 4x4 screen pixels.
   */
  noiseScale?: number;
  /**
   * Use nearest neighbor interpolation for velocity field sampling (default: false).
   * When false, uses bilinear interpolation for smoother streamlines.
   * When true, uses nearest neighbor for sharper/blockier appearance.
   */
  nearestNeighborVelocity?: boolean;
  /**
   * Use Euler integration instead of RK4 (default: false).
   * Euler is faster but less accurate than 4th-order Runge-Kutta.
   */
  useEuler?: boolean;
  /**
   * Scale factor for velocity field resolution (default: 1.0).
   * Values < 1 create a coarser velocity grid for blockier nearest-neighbor sampling.
   * E.g., velocityScale: 0.25 uses 1/4 resolution for velocity lookups.
   */
  velocityScale?: number;
}

/**
 * Result of LIC computation with convenience methods for rendering.
 */
export interface LICResult {
  /** Raw LIC intensity values as Float32Array [0, 1] */
  data: Float32Array;
  /** Vector field magnitude at each pixel as Float32Array */
  magnitude: Float32Array;
  /** Image width in pixels */
  width: number;
  /** Image height in pixels */
  height: number;
  /** Convert to grayscale ImageData for canvas rendering */
  toImageData(): ImageData;
  /** Convert to colored ImageData using magnitude-based palette */
  toColoredImageData(options: LICColorOptions): ImageData;
  /** Convert to ImageBitmap for efficient rendering */
  toImageBitmap(): Promise<ImageBitmap>;
}

/**
 * WebGPU context for reusing device across multiple computations.
 */
export interface WebGPUContext {
  adapter: GPUAdapter;
  device: GPUDevice;
  /** Release WebGPU resources */
  destroy(): void;
}

// ============================================================================
// Dynamic LIC (DLIC) Types
// ============================================================================

/**
 * Time-varying vector field function.
 * Maps (x, y, t) to velocity [vx, vy].
 */
export type TimeVaryingVectorFieldFn = (x: number, y: number, t: number) => [number, number];

/**
 * Configuration options for Dynamic LIC computation.
 * Extends LICOptions with animation-specific parameters.
 */
export interface DLICOptions extends LICOptions {
  /** Animation phase (0-1), controls position in animation cycle.
   *  Ignored when frameCount is set (phases are auto-computed as i/frameCount). */
  phase: number;
  /** Wavelength in pixels - how far noise travels per cycle (default: 40.0) */
  wavelength?: number;
  /** Time parameter for time-varying vector fields (deprecated, use timeVaryingVelocityBuffer instead) */
  time?: number;
  /** Time-varying vector field function (deprecated, use timeVaryingVelocityBuffer instead) */
  timeVaryingVectorField?: TimeVaryingVectorFieldFn;
  /** Padding in pixels to compute beyond output boundaries (default: 0).
   *  Helps eliminate edge artifacts by allowing full integration at boundaries.
   *  Recommended: 32-64 pixels, or match maxArcLength. */
  padding?: number;
  /** Number of frames to compute (phases 0/n, 1/n, ..., (n-1)/n).
   *  When set, returns DLICResult[] instead of DLICResult.
   *  For time-varying fields, this should equal numTimeSlices. */
  frameCount?: number;
  /** Frames per GPU command submission (default: 8).
   *  Only used when frameCount is set. */
  batchSize?: number;

  // ============================================================================
  // Time-varying vector field support (new API)
  // ============================================================================

  /** Pre-computed velocity buffer for time-varying fields.
   *  Layout: Float32Array of [numTimeSlices * velocityHeight * velocityWidth * 2]
   *  where each slice contains [vx, vy] pairs in row-major order.
   *  When provided, frameCount is automatically set to numTimeSlices. */
  timeVaryingVelocityBuffer?: Float32Array;
  /** Number of time slices in the velocity buffer (default: 1 for static fields).
   *  Required when timeVaryingVelocityBuffer is provided. */
  numTimeSlices?: number;
}

/**
 * Result type for Dynamic LIC computation (same structure as LICResult).
 */
export type DLICResult = LICResult;
