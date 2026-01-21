/**
 * Post-Processing Types
 *
 * Interfaces and options for post-processing effects.
 */

/**
 * Base interface for all post-processing effects.
 * Effects apply transformations to rendered textures.
 */
export interface PostProcessEffect {
  /** Unique name identifier for the effect */
  readonly name: string;

  /**
   * Apply the effect using an existing command encoder.
   *
   * @param encoder - GPU command encoder to record commands to
   * @param source - Source texture to process
   * @param target - Target texture view to render result to
   * @param uniforms - Optional effect-specific uniform values
   */
  apply(
    encoder: GPUCommandEncoder,
    source: GPUTexture,
    target: GPUTextureView,
    uniforms?: Record<string, number>
  ): void;

  /**
   * Resize internal resources when canvas size changes.
   *
   * @param width - New width in pixels
   * @param height - New height in pixels
   */
  resize(width: number, height: number): void;

  /**
   * Release all GPU resources.
   */
  destroy(): void;
}

/**
 * Options for bloom effect.
 */
export interface BloomOptions {
  /**
   * Luminance threshold for bloom (0-1).
   * Pixels brighter than this contribute to bloom.
   * @default 0.5
   */
  threshold?: number;

  /**
   * Soft knee for threshold transition (0-1).
   * Higher values create smoother falloff.
   * @default 0.5
   */
  softKnee?: number;

  /**
   * Glow intensity multiplier.
   * Higher values create stronger bloom.
   * @default 1.0
   */
  intensity?: number;

  /**
   * Blur radius in pixels.
   * Larger radius creates wider glow.
   * @default 8
   */
  radius?: number;

  /**
   * Number of blur iterations.
   * More iterations create smoother blur.
   * @default 2
   */
  iterations?: number;
}

/**
 * Default bloom options.
 */
export const DEFAULT_BLOOM_OPTIONS: Required<BloomOptions> = {
  threshold: 0.5,
  softKnee: 0.5,
  intensity: 1.0,
  radius: 8,
  iterations: 2,
};
