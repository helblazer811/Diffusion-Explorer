/**
 * Type definitions for GPU-accelerated streamline rendering.
 *
 * The rendering approach:
 * 1. Streamlines are decomposed into segments
 * 2. Each segment is rendered as a quad (instanced rendering)
 * 3. Vertex shader expands segments into quads with rounded cap margins
 * 4. Fragment shader uses SDF for smooth edges and computes pulse animation
 */

import type { WebGPUContext } from '../line-integral-convolution/types';

export type { WebGPUContext };

/**
 * A single segment within a streamline.
 * Packed for GPU buffer upload (32 bytes per segment).
 */
export interface StreamlineSegment {
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
  /** Total length of the parent streamline (pixels) */
  totalLength: number;
  /** Phase offset for this streamline (0-1) */
  phaseOffset: number;
  /** Padding for alignment */
  _padding: number;
}

/**
 * Prepared GPU data for a set of streamlines.
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
 * Uniforms for the streamline shader.
 */
export interface StreamlineUniforms {
  /** Canvas width in pixels */
  width: number;
  /** Canvas height in pixels */
  height: number;
  /** Animation phase (0-1) */
  phase: number;
  /** Line thickness in pixels */
  thickness: number;
  /** Pulse width in pixels */
  pulseWidth: number;
  /** Total spacing (pulse + gap) in pixels */
  pulseSpacing: number;
  /** Base opacity at pulse peak (0-1) */
  baseOpacity: number;
  /** Whether to use binary (non-gradient) pulses */
  binaryPulse: number;
  /** Line color (RGBA) */
  color: [number, number, number, number];
}

/**
 * Options for creating a StreamlineRenderer.
 */
export interface StreamlineRendererOptions {
  /** Line thickness in pixels (default: 2.5) */
  thickness?: number;
  /** Pulse width in pixels (default: 30) */
  pulseWidth?: number;
  /** Gap between pulses in pixels (default: 50) */
  pulseGap?: number;
  /** Base opacity at pulse peak (default: 0.8) */
  baseOpacity?: number;
  /** Whether to use binary pulses (default: false) */
  binaryPulse?: boolean;
  /** Line color as hex string or RGB array (default: '#3b82f6') */
  color?: string | [number, number, number];
  /** Phase offsets: 'random' or 'synchronized' (default: 'synchronized') */
  offsets?: 'random' | 'synchronized';
}

/**
 * Style options for rendering (can be changed between draws).
 */
export interface StreamlineRenderStyle {
  /** Animation phase (0-1) */
  phase: number;
  /** Optional override for thickness */
  thickness?: number;
  /** Optional override for color */
  color?: string | [number, number, number];
  /** Optional override for base opacity */
  baseOpacity?: number;
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
