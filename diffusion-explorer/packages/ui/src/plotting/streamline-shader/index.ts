/**
 * GPU-accelerated streamline rendering using WebGPU compute shaders.
 *
 * This module provides shader-based rendering of animated streamlines,
 * using spatial hashing for efficient O(1) per-pixel segment lookup.
 *
 * The unified geometry representation (`StreamlineGeometry`) serves as the
 * single source of truth for both canvas and shader rendering, eliminating
 * redundancy in arc length computation and segment data.
 *
 * @example
 * ```typescript
 * import {
 *   buildStreamlineGeometry,
 *   StreamlineShaderRenderer
 * } from './streamline-shader';
 *
 * // Build unified geometry once
 * const geometry = buildStreamlineGeometry(polylines, offsets);
 *
 * // Use for shader rendering
 * const renderer = await StreamlineShaderRenderer.create({
 *   geometry,
 *   options: { width: 800, height: 600, ... }
 * });
 *
 * // Or use geometry directly for canvas rendering
 * const alphas = computeStreamlineAlphas(geometry, 0, phase, ...);
 * ```
 */

export { StreamlineShaderRenderer } from './streamline-shader-renderer';
export type { StreamlineShaderResult } from './streamline-shader-renderer';

export {
  buildSpatialHashFromGeometry,
  packSpatialHashForGPU,
  buildPackedStreamlineData
} from './spatial-hash';

export {
  buildStreamlineGeometry,
  getCumulativeLengths,
  computeStreamlineAlphas,
  precomputePatternIndices
} from './geometry';

export type {
  StreamlineGeometry,
  StreamlineMeta
} from './geometry';

export type {
  StreamlineSegment,
  StreamlineSpatialHash,
  PackedStreamlineData,
  SpatialHashOptions,
  StreamlineShaderOptions
} from './types';
