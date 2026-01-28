/**
 * Shared type definitions for contour generation and rendering.
 *
 * These types are used by both CPU and GPU backends.
 */

/**
 * Domain bounds for contour computation.
 */
export interface ContourDomain {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/**
 * Options for computing contours from point data.
 */
export interface ContourOptions {
  /** Grid resolution for density estimation (default: 100) */
  gridSize?: number;
  /** Bandwidth for kernel density estimation - larger = smoother (default: 20) */
  bandwidth?: number;
  /** Number of contour levels or explicit threshold values (default: 10) */
  thresholds?: number | number[];
  /** Domain bounds [xMin, xMax, yMin, yMax] - if not provided, computed from points */
  domain?: [number, number, number, number];
}

/**
 * Options for GPU contour computation.
 */
export interface ContourGPUOptions {
  /** Grid resolution for density estimation (default: 100) */
  gridSize?: number;
  /**
   * Bandwidth for kernel density estimation (default: 20).
   * Uses the same scale as D3's contourDensity bandwidth parameter.
   * Internally converted to blur radius using D3's formula:
   * r = (sqrt(4 * bandwidth^2 + 1) - 1) / 2
   */
  bandwidth?: number;
  /**
   * Threshold specification for contour levels.
   * - If a number: generates that many uniformly-spaced thresholds
   * - If an array: uses those exact percentile values (should be in [0, 1])
   * Default: 10
   */
  thresholds?: number | number[];
  /** Domain bounds - if not provided, computed from points */
  domain?: ContourDomain;
}

/**
 * Normalized threshold configuration after processing options.
 */
export interface NormalizedThresholds {
  /** The actual threshold values in ascending order */
  values: number[];
  /** The number of threshold levels */
  count: number;
}

/**
 * Normalize threshold configuration to an array of explicit values.
 */
export function normalizeThresholds(thresholds?: number | number[]): NormalizedThresholds {
  if (Array.isArray(thresholds)) {
    const sorted = [...thresholds].sort((a, b) => a - b);
    return { values: sorted, count: sorted.length };
  }
  const count = thresholds ?? 10;
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    values.push((i + 1) / (count + 1));
  }
  return { values, count };
}

/**
 * Color scale function mapping normalized value [0, 1] to RGBA.
 */
export type ColorScaleFn = (t: number) => [number, number, number, number];

/**
 * Options for rendering contours.
 */
export interface ContourRenderOptions {
  /** Color scale function mapping [0, 1] to RGBA (values 0-1) */
  colorScale?: ColorScaleFn;
  /** Single fill color as RGBA (values 0-1) - overrides colorScale if provided */
  fillColor?: [number, number, number, number];
  /** Global opacity (default: 1) */
  opacity?: number;
}

/**
 * Parsed color as normalized RGBA values [0-1].
 */
export type RGBAColor = [number, number, number, number];

/**
 * Parse a color string or array to RGBA values [0-1].
 */
export function parseContourColor(color: string | [number, number, number] | RGBAColor): RGBAColor {
  if (Array.isArray(color)) {
    if (color.length === 4) {
      return color as RGBAColor;
    }
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

/**
 * Create a simple linear color scale between two colors.
 */
export function createLinearColorScale(
  startColor: RGBAColor,
  endColor: RGBAColor
): ColorScaleFn {
  return (t: number): RGBAColor => {
    const clampedT = Math.max(0, Math.min(1, t));
    return [
      startColor[0] + (endColor[0] - startColor[0]) * clampedT,
      startColor[1] + (endColor[1] - startColor[1]) * clampedT,
      startColor[2] + (endColor[2] - startColor[2]) * clampedT,
      startColor[3] + (endColor[3] - startColor[3]) * clampedT,
    ];
  };
}

/**
 * Default blue color scale with alpha gradient for compositing.
 * Outer levels (low t) are more transparent, inner levels (high t) are more opaque.
 * This creates a layered effect where overlapping regions appear more saturated.
 */
export const defaultColorScale: ColorScaleFn = createLinearColorScale(
  [0.3, 0.5, 1.0, 0.25],    // Outer levels: lighter blue, more transparent
  [0.1, 0.3, 0.9, 0.6]      // Inner levels: darker blue, more opaque
);
