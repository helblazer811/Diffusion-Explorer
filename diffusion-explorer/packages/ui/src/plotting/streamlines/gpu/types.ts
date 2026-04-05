/**
 * Type definitions for GPU-accelerated streamline rendering.
 *
 * This module re-exports from pulsing-paths with streamline-specific aliases
 * for backwards compatibility. The StreamlineRenderer is now a wrapper around
 * PulsingPathsRenderer.
 */

// Re-export core types from pulsing-paths
export type {
  WebGPUContext,
  RGBAColor,
  PathSegment as StreamlineSegment,
  PulsingPathsGPUData,
  PulsingPathsUniforms as StreamlineUniforms,
} from '../../pulsing-paths/gpu/types';

// Re-export parseColor function
export { parseColor } from '../../pulsing-paths/gpu/types';

// Import for local type aliases
import type {
  PulsingPathsGPUData,
  PulsingPathsRendererOptions,
  PulsingPathsRenderStyle,
} from '../../pulsing-paths/gpu/types';

/**
 * Prepared GPU data for a set of streamlines.
 * Alias for PulsingPathsGPUData with streamline terminology.
 */
export interface StreamlineGPUData {
  /** Segment data packed for GPU upload */
  segments: Float32Array;
  /** Number of segments */
  segmentCount: number;
  /** Number of streamlines */
  streamlineCount: number;
}

/**
 * Convert PulsingPathsGPUData to StreamlineGPUData.
 * @internal
 */
export function toStreamlineGPUData(data: PulsingPathsGPUData): StreamlineGPUData {
  return {
    segments: data.segments,
    segmentCount: data.segmentCount,
    streamlineCount: data.pathCount,
  };
}

/**
 * Options for creating a StreamlineRenderer.
 *
 * All pixel values (thickness, pulseWidth, pulseGap) are in logical/CSS pixels.
 * They will be automatically scaled by DPR for rendering.
 */
export interface StreamlineRendererOptions {
  /** Device pixel ratio (default: window.devicePixelRatio or 1) */
  dpr?: number;
  /** Line thickness in logical/CSS pixels (default: 2.5) */
  thickness?: number;
  /** Pulse width in logical/CSS pixels (default: 30) */
  pulseWidth?: number;
  /** Gap between pulses in logical/CSS pixels (default: 50) */
  pulseGap?: number;
  /** Base opacity at pulse peak (default: 0.8) */
  baseOpacity?: number;
  /** Whether to use binary pulses (default: false) */
  binaryPulse?: boolean;
  /** Line color as hex string or RGB array (default: '#3b82f6') */
  color?: string | [number, number, number];
  /** Phase offsets: 'random' or 'synchronized' (default: 'synchronized') */
  offsets?: 'random' | 'synchronized';
  /** Show a static preview line behind the pulses (default: false) */
  showPreview?: boolean;
  /** Opacity of the preview line (default: 0.3) */
  previewOpacity?: number;
  /** Show arrowheads at the front of each pulse (default: false) */
  showArrowhead?: boolean;
  /**
   * Arrowhead size as multiple of thickness.
   * Controls both length and half-base width.
   * Default: 2.0 (arrowhead length = 2 * thickness)
   */
  arrowheadSize?: number;
}

/**
 * Style options for rendering (can be changed between draws).
 */
export interface StreamlineRenderStyle {
  /** Animation phase (0-1) */
  phase: number;
  /** Optional override for device pixel ratio */
  dpr?: number;
  /** Optional override for thickness (in logical/CSS pixels) */
  thickness?: number;
  /** Optional override for color */
  color?: string | [number, number, number];
  /** Optional override for base opacity */
  baseOpacity?: number;
  /** Optional override for showing preview line */
  showPreview?: boolean;
  /** Optional override for preview opacity */
  previewOpacity?: number;
  /** Optional override for showing arrowheads */
  showArrowhead?: boolean;
  /** Optional override for arrowhead size */
  arrowheadSize?: number;
}

/**
 * Convert StreamlineRendererOptions to PulsingPathsRendererOptions.
 * @internal
 */
export function toPulsingPathsOptions(options: StreamlineRendererOptions): PulsingPathsRendererOptions {
  return options;
}

/**
 * Convert StreamlineRenderStyle to PulsingPathsRenderStyle.
 * @internal
 */
export function toPulsingPathsStyle(style: StreamlineRenderStyle): PulsingPathsRenderStyle {
  return style;
}
