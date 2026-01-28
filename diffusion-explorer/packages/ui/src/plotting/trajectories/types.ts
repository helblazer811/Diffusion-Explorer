/**
 * Shared type definitions for trajectory rendering.
 */

/**
 * Domain bounds for trajectory rendering.
 */
export interface TrajectoryDomain {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/**
 * Outline styling options.
 */
export interface TrajectoryOutlineOptions {
  /** Outline color (default: black) */
  color?: string;
  /** Outline stroke width in pixels - added to trajectory strokeWidth to get total outline width (default: 2) */
  strokeWidth?: number;
  /** Outline opacity (default: same as stroke opacity) */
  opacity?: number;
}

/**
 * Head marker styling options.
 */
export interface HeadStyle {
  /** Shape of head marker (default: 'circle') */
  type: 'circle' | 'arrow';
  /** Radius for circle, or size for arrow (default: pointRadius) */
  radius?: number;
  /** Head color (default: same as trajectory color) */
  color?: string;
  /** Head opacity (default: same as trajectory opacity) */
  opacity?: number;
}

/**
 * Opacity gradient configuration.
 */
export interface OpacityGradientOptions {
  /** Gradient mode */
  mode: 'none' | 'recency' | 'custom';
  /** Fraction (0-1) of trajectory to show with fading opacity (for 'recency' mode) */
  timeWindow?: number;
  /** Custom alphas per trajectory per segment: [trajectory][segment] -> alpha (0-1) */
  perSegmentAlphas?: number[][];
}

/**
 * Unified style options for trajectory rendering (CPU and GPU).
 */
export interface TrajectoryStyleOptions {
  /** Stroke width in pixels */
  strokeWidth: number;
  /** Stroke color as CSS color string (e.g., '#3b82f6') */
  color: string;
  /** Base opacity (0-1) */
  opacity: number;
  /** Point/marker radius in pixels */
  pointRadius: number;

  // Preview (CPU-only, ignored by GPU)
  /** Show full trajectory path as preview (CPU only) */
  showPreview?: boolean;
  /** Preview opacity (CPU only) */
  previewOpacity?: number;
  /** Whether to show marker at trajectory head (default: true) */
  showHeadMarker?: boolean;

  /** Optional outline styling */
  outline?: TrajectoryOutlineOptions;
  /** Head marker styling */
  headStyle?: HeadStyle;

  // Opacity gradients - supports both formats for backwards compatibility
  /** Opacity gradient configuration (preferred) */
  opacityGradient?: OpacityGradientOptions;
  /** Legacy: per-segment alphas [trajectory][segment] -> alpha (0-1) */
  perSegmentAlphas?: number[][];
  /** Subdivisions per segment for smooth gradient (CPU only) */
  gradientSubdivisions?: number;
}

/**
 * Packed segment data for GPU rendering.
 * Each segment is 8 floats (32 bytes):
 * [x0, y0, x1, y1, alphaStart, alphaEnd, zValue, padding]
 */
export interface GPUTrajectoryData {
  /** Packed segment data */
  segments: Float32Array;
  /** Number of segments */
  segmentCount: number;
  /** Number of trajectories */
  trajectoryCount: number;
  /** Maximum time index (for z-value normalization) */
  maxTimeIndex: number;
  /** Head marker positions: [x, y, zValue, alpha] per trajectory */
  headPositions: Float32Array;
}
