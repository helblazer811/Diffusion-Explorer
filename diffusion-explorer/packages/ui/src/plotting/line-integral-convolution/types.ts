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
  /** Number of integration steps in each direction (default: 20) */
  integrationSteps?: number;
  /** Step size in pixels (default: 0.5) */
  stepSize?: number;
  /** Random seed for noise generation (default: random) */
  seed?: number;
  /** Contrast enhancement factor (default: 1.0) */
  contrast?: number;
}

/**
 * Result of LIC computation with convenience methods for rendering.
 */
export interface LICResult {
  /** Raw LIC intensity values as Float32Array [0, 1] */
  data: Float32Array;
  /** Image width in pixels */
  width: number;
  /** Image height in pixels */
  height: number;
  /** Convert to ImageData for canvas rendering */
  toImageData(): ImageData;
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
