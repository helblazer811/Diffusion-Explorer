/**
 * GPU-accelerated streamline rendering using WebGPU compute shaders.
 *
 * This module provides shader-based rendering of animated streamlines,
 * using spatial hashing for efficient O(1) per-pixel segment lookup.
 *
 * @example
 * ```typescript
 * import { StreamlineShaderRenderer } from './streamline-shader';
 *
 * const renderer = await StreamlineShaderRenderer.create({
 *   streamlines,
 *   lengthData,
 *   offsets,
 *   options: {
 *     width: 800,
 *     height: 600,
 *     strokeWidth: 2.5,
 *     pulseWidth: 30,
 *     pulsePauseWidth: 50,
 *     baseOpacity: 0.8,
 *     color: [0.23, 0.51, 0.96],
 *   }
 * });
 *
 * // Render each frame
 * const result = await renderer.render(phase);
 * ctx.putImageData(result.imageData, 0, 0);
 *
 * renderer.destroy();
 * ```
 */

export { StreamlineShaderRenderer } from './streamline-shader-renderer';
export type { StreamlineShaderResult } from './streamline-shader-renderer';

export { buildSpatialHash, packSpatialHashForGPU, buildPackedStreamlineData } from './spatial-hash';

export type {
  StreamlineSegment,
  StreamlineSpatialHash,
  PackedStreamlineData,
  SpatialHashOptions,
  StreamlineShaderOptions
} from './types';
