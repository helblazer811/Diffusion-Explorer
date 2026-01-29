/**
 * Type definitions for GPU-accelerated pulsing paths rendering.
 *
 * The rendering approach:
 * 1. Paths are decomposed into segments
 * 2. Each segment is rendered as a quad (instanced rendering)
 * 3. Vertex shader expands segments into quads with rounded cap margins
 * 4. Fragment shader uses SDF for smooth edges and computes pulse animation
 */

import type { WebGPUContext } from '../../line-integral-convolution/types';

export type { WebGPUContext };

/**
 * A single segment within a path.
 * Packed for GPU buffer upload (32 bytes per segment).
 */
export interface PathSegment {
  /** Start point x coordinate (pixels) */
  x0: number;
  /** Start point y coordinate (pixels) */
  y0: number;
  /** End point x coordinate (pixels) */
  x1: number;
  /** End point y coordinate (pixels) */
  y1: number;
  /** Cumulative arc length at start of this segment (pixels) */
  cumulativeLengthStart: number;
  /** Total length of the parent path (pixels) */
  totalLength: number;
  /** Phase offset for this path (0-1) */
  phaseOffset: number;
  /** Segment flags: 1=first, 2=last, 3=both */
  segmentFlags: number;
}

/**
 * Prepared GPU data for a set of paths.
 */
export interface PulsingPathsGPUData {
  /** Segment data packed for GPU upload */
  segments: Float32Array;
  /** Number of segments */
  segmentCount: number;
  /** Number of paths */
  pathCount: number;
}

/**
 * Uniforms for the pulsing paths shader.
 */
export interface PulsingPathsUniforms {
  /** Canvas width in physical pixels */
  width: number;
  /** Canvas height in physical pixels */
  height: number;
  /** Device pixel ratio */
  dpr: number;
  /** Animation phase (0-1) */
  phase: number;
  /** Line thickness in logical/CSS pixels */
  thickness: number;
  /** Pulse width in logical/CSS pixels */
  pulseWidth: number;
  /** Total spacing (pulse + gap) in logical/CSS pixels */
  pulseSpacing: number;
  /** Base opacity at pulse peak (0-1) */
  baseOpacity: number;
  /** Whether to use binary (non-gradient) pulses */
  binaryPulse: number;
  /** Line color (RGBA) */
  color: [number, number, number, number];
}

/**
 * Options for creating a PulsingPathsRenderer.
 *
 * All pixel values (thickness, pulseWidth, pulseGap) are in logical/CSS pixels.
 * They will be automatically scaled by DPR for rendering.
 */
export interface PulsingPathsRendererOptions {
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
}

/**
 * Style options for rendering (can be changed between draws).
 */
export interface PulsingPathsRenderStyle {
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
}

/**
 * Parsed color as normalized RGBA values.
 */
export type RGBAColor = [number, number, number, number];

/**
 * Parse a color string or array to RGBA values [0-1].
 */
export function parseColor(color: string | [number, number, number]): RGBAColor {
  if (Array.isArray(color)) {
    return [color[0] / 255, color[1] / 255, color[2] / 255, 1.0];
  }

  // Parse hex color
  const hex = color.replace('#', '');
  if (hex.length === 3) {
    const r = parseInt(hex[0] + hex[0], 16) / 255;
    const g = parseInt(hex[1] + hex[1], 16) / 255;
    const b = parseInt(hex[2] + hex[2], 16) / 255;
    return [r, g, b, 1.0];
  } else if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    return [r, g, b, 1.0];
  }

  // Default to blue
  return [0.231, 0.510, 0.965, 1.0]; // #3b82f6
}
