/**
 * GPU-accelerated contour rendering module.
 *
 * This module provides WebGPU-based contour rendering with:
 * - GPU histogram binning
 * - GPU Gaussian blur
 * - GPU marching squares
 * - Stencil-based fill rendering
 * - Framebuffer caching
 *
 * @module contours/gpu
 */

export { ContourRenderer } from './renderer';

export type {
  ContourSegment,
  ContourGPUData,
  ContourRendererOptions,
  ContourRenderStyle,
  ContourPipelineTimings,
  ContourComputeUniforms,
  ContourRenderUniforms,
  WebGPUContext,
} from './types';

export {
  CONTOUR_SEGMENT_SIZE,
  CONTOUR_SEGMENT_FLOATS,
  COMPUTE_UNIFORM_BUFFER_SIZE,
  RENDER_UNIFORM_BUFFER_SIZE,
} from './types';
