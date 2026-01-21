/**
 * Post-Processing Module
 *
 * Reusable post-processing effects for WebGPU rendering.
 *
 * Usage:
 * ```typescript
 * import { BloomEffect } from '@diffusion-explorer/ui/plotting/post-processing';
 *
 * // Create effect
 * const bloom = await BloomEffect.create(device, format, width, height);
 *
 * // Per frame
 * const encoder = device.createCommandEncoder();
 * bloom.apply(encoder, sourceTexture, canvasView, {
 *   threshold: 0.6,
 *   intensity: 1.2,
 *   radius: 10
 * });
 * device.queue.submit([encoder.finish()]);
 *
 * // Cleanup
 * bloom.destroy();
 * ```
 */

// Types
export type { PostProcessEffect, BloomOptions } from './types';
export { DEFAULT_BLOOM_OPTIONS } from './types';

// Effects
export { BloomEffect } from './bloom';
