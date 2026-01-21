/**
 * GPU-accelerated streamline rendering module.
 *
 * This module provides high-performance streamline visualization using WebGPU.
 * The rendering approach uses:
 * - Instanced rendering (one instance per segment)
 * - Vertex shader expansion of segments into quads
 * - Fragment shader SDF for smooth edges
 * - Sawtooth pulse animation along streamlines
 *
 * @example
 * ```typescript
 * import { StreamlineRenderer } from './streamlines/gpu';
 *
 * // Create renderer
 * const renderer = await StreamlineRenderer.create(canvas, {
 *   thickness: 3,
 *   color: '#3b82f6',
 *   pulseWidth: 40,
 *   pulseGap: 60,
 * });
 *
 * // Set streamlines (do once when data changes)
 * renderer.setStreamlines(streamlines, 'random');
 *
 * // Render each frame
 * function animate(time) {
 *   const phase = (time / 2000) % 1;
 *   renderer.render({ phase });
 *   requestAnimationFrame(animate);
 * }
 * ```
 *
 * @module streamlines/gpu
 */

export { StreamlineRenderer, prepareStreamlineData } from './renderer';
export type {
  StreamlineRendererOptions,
  StreamlineRenderStyle,
  StreamlineGPUData,
  StreamlineSegment,
  StreamlineUniforms,
  WebGPUContext,
  RGBAColor,
} from './types';
export { parseColor } from './types';
