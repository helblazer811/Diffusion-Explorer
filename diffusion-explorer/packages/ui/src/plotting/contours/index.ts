/**
 * Contour generation and rendering module.
 *
 * This module provides:
 * - CPU-based contour rendering using D3 and Canvas 2D
 * - GPU-accelerated contour rendering using WebGPU
 *
 * The module structure:
 * - types.ts: Shared type definitions
 * - cpu/: D3-based CPU implementation
 * - gpu/: WebGPU-based GPU implementation
 *
 * @module contours
 */

// ============================================================================
// Shared Types
// ============================================================================

export type {
  ContourDomain,
  ContourOptions,
  ContourGPUOptions,
  ContourRenderOptions,
  ColorScaleFn,
  // Note: RGBAColor is already exported from streamlines/gpu
} from './types';

export {
  parseContourColor,
  createLinearColorScale,
  defaultColorScale,
} from './types';

// ============================================================================
// CPU Rendering (D3-based)
// ============================================================================

export {
  computeContours,
  plotContours,
  plotSegments,
  type ComputedContours,
  type PlotContourOptions,
  type PlotSegmentsOptions,
  type ContourSegmentData,
} from './cpu';

// ============================================================================
// GPU Rendering (WebGPU-based)
// ============================================================================

export {
  ContourRenderer,
  type ContourRendererOptions,
  type ContourRenderStyle,
  type ContourGPUData,
  type ContourSegment,
  type ContourPipelineTimings,
  // Note: WebGPUContext is already exported from line-integral-convolution
} from './gpu';
