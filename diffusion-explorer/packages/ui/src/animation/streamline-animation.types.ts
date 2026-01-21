/**
 * Shared type definitions for streamline animations.
 *
 * These types are used by both CPU and GPU animation backends.
 */

import type { VectorFieldFn, StreamlineDomain, StreamlineLengthData } from '../plotting/streamlines';

// Re-export for convenience
export type { VectorFieldFn, StreamlineDomain, StreamlineLengthData };

/**
 * Backend selection for streamline animation.
 */
export type StreamlineBackend = 'cpu' | 'gpu';

/**
 * Base animation state type for streamline animations.
 * Users extend this for their own animation state.
 *
 * @example
 * type MyAnimationState = StreamlineAnimationState & {
 *   theta: number;  // rotation angle
 * };
 */
export type StreamlineAnimationState = {
  streamlinePhase: number;
};

/**
 * Data exposed by StreamlineAnimation.
 */
export type StreamlineAnimationData = {
  /** Generated streamlines in pixel coordinates */
  streamlines: number[][][];
  /** Per-streamline animation offsets */
  offsets: number[];
  /** Per-streamline length data (for pixel-based animation) */
  lengthData: StreamlineLengthData[];
  /** Maximum streamline length across all streamlines */
  maxLength: number;
};

/**
 * Base options for creating a streamline animation.
 * Shared by both CPU and GPU backends.
 */
export interface StreamlineAnimationBaseOptions {
  // Required
  vectorFieldFn: VectorFieldFn;
  domain: StreamlineDomain;
  toPixel: (p: [number, number]) => [number, number];

  // Generation (optional)
  density?: number | [number, number];
  minPathLength?: number;
  segmentLength?: number;
  integrationDirection?: 'forward' | 'backward' | 'both';
  startPoints?: [number, number][];

  // Animation (optional)
  pulseWidthPixels?: number;
  pulsePauseWidthPixels?: number;
  baseOpacity?: number;
  offsets?: 'random' | 'synchronized';
  binaryPulse?: boolean;
  loopMultiplier?: number;

  // Style (optional)
  color?: string | [number, number, number];
  strokeWidth?: number;
}

/**
 * CPU-specific options.
 */
export interface StreamlineAnimationCPUOptions extends StreamlineAnimationBaseOptions {
  backend?: 'cpu';
  /** Subdivide each segment into N pieces (default: 1 = no subdivision) */
  subdivisionFactor?: number;
  /** Number of gradient subdivisions for smooth alpha transitions */
  gradientSubdivisions?: number;
}

/**
 * GPU-specific options.
 */
export interface StreamlineAnimationGPUOptions extends StreamlineAnimationBaseOptions {
  backend: 'gpu';
  /** Device pixel ratio (default: window.devicePixelRatio) */
  dpr?: number;
}

/**
 * Combined options type that supports both backends.
 */
export type StreamlineAnimationOptions =
  | StreamlineAnimationCPUOptions
  | StreamlineAnimationGPUOptions;
