/**
 * GPU-accelerated contour rendering module.
 *
 * This module provides WebGPU-based contour rendering with:
 * - GPU histogram binning
 * - GPU box blur
 * - Threshold-based per-pixel fill rendering
 *
 * @module contours/gpu
 */

export { ContourRenderer } from './renderer';

export type {
  ContourRendererOptions,
  ContourRenderStyle,
  ContourPipelineTimings,
  ContourComputeUniforms,
  ContourRenderUniforms,
  ThresholdFillUniforms,
  WebGPUContext,
} from './types';

export {
  COMPUTE_UNIFORM_BUFFER_SIZE,
  THRESHOLD_FILL_UNIFORM_SIZE,
} from './types';

// Legacy exports for backward compatibility (deprecated)
/** @deprecated No longer used - threshold fill replaces segment-based rendering */
export interface ContourSegment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  contourLevel: number;
  contourIndex: number;
  valid: number;
  _padding: number;
}

/** @deprecated No longer used - threshold fill replaces segment-based rendering */
export interface ContourGPUData {
  segments: Float32Array;
  maxSegmentSlots: number;
  numLevels: number;
  gridWidth: number;
  gridHeight: number;
  domain: { xMin: number; xMax: number; yMin: number; yMax: number };
  thresholds: Float32Array;
}

/** @deprecated Use THRESHOLD_FILL_UNIFORM_SIZE instead */
export const CONTOUR_SEGMENT_SIZE = 32;
/** @deprecated Use THRESHOLD_FILL_UNIFORM_SIZE instead */
export const CONTOUR_SEGMENT_FLOATS = 8;
/** @deprecated No longer used */
export const RENDER_UNIFORM_BUFFER_SIZE = 64;
