/**
 * Streamline generation and rendering module.
 *
 * This module provides:
 * - Streamline generation for 2D vector fields (shared by CPU and GPU backends)
 * - CPU-based Canvas 2D rendering with optional chevron markers
 * - GPU-accelerated WebGPU rendering (see ./gpu/ submodule)
 *
 * The module structure:
 * - types.ts: Shared type definitions (VectorFieldFn, StreamlineDomain, etc.)
 * - generation.ts: Streamline generation algorithm (generateStreamlines)
 * - lengths.ts: Arc length computation (computeStreamlineLengths)
 * - selection.ts: Density-based trajectory selection
 * - cpu/: CPU rendering (alpha LUTs, Canvas 2D drawing)
 * - gpu/: GPU rendering (WebGPU renderer, shaders)
 *
 * @module streamlines
 */

// ============================================================================
// Shared Types
// ============================================================================

export type {
  VectorFieldFn,
  StreamlineDomain,
  StreamlineOptions,
  StreamlineLengthData,
  SelectTrajectoriesOptions,
} from './types';

// Type alias for backward compatibility
export type { StreamlineDomain as StreamlineGPUDomain } from './types';

// ============================================================================
// Generation (shared by CPU and GPU)
// ============================================================================

export { generateStreamlines, StreamMask, DomainMap } from './generation';

// ============================================================================
// Length Computation (shared by CPU and GPU)
// ============================================================================

export { computeStreamlineLengths } from './lengths';

// ============================================================================
// Selection (shared by CPU and GPU)
// ============================================================================

export { selectTrajectoriesWithMask } from './selection';

// ============================================================================
// CPU Rendering
// ============================================================================

export {
  // Alpha/LUT functions for animated pulses
  createAlphaLUT,
  precomputePatternIndices,
  computeAlphaTrail,
  // Drawing functions
  drawStreamlines,
  generateStreamlinePath2D,
  drawStreamlinePath,
  // Types
  type ChevronStyle,
  type DrawStreamlinesOptions,
  type DrawStreamlinePathOptions,
} from './cpu';

// ============================================================================
// GPU Rendering (re-exported for convenience)
// ============================================================================

export {
  StreamlineRenderer,
  prepareStreamlineData,
  parseColor,
  type StreamlineRendererOptions,
  type StreamlineRenderStyle,
  type StreamlineGPUData,
  type StreamlineSegment,
  type StreamlineUniforms,
  type WebGPUContext,
  type RGBAColor,
} from './gpu';
