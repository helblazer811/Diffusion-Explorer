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
  /** Outline width in pixels (default: strokeWidth + 2) */
  width?: number;
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
 * Style options for GPU trajectory rendering.
 */
export interface GPUTrajectoryStyleOptions {
  /** Stroke width in pixels */
  strokeWidth: number;
  /** Stroke color as RGB tuple [0-1] or CSS color string */
  color: string | [number, number, number];
  /** Base opacity (0-1) */
  opacity: number;
  /** Point/marker radius in pixels */
  pointRadius: number;
  /** Optional outline styling */
  outline?: TrajectoryOutlineOptions;
  /** Head marker styling */
  headStyle?: HeadStyle;
  /** Opacity gradient configuration */
  opacityGradient?: OpacityGradientOptions;
}

/**
 * Options for creating a TrajectoryRenderer.
 */
export interface TrajectoryRendererOptions {
  /** Canvas element to render to */
  canvas: HTMLCanvasElement;
  /** Whether to prefer GPU rendering (default: true) */
  preferGPU?: boolean;
  /** Device pixel ratio (default: window.devicePixelRatio) */
  dpr?: number;
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

/**
 * Parse a CSS color string to RGB values [0-1].
 */
export function parseColor(color: string | [number, number, number]): [number, number, number] {
  if (Array.isArray(color)) {
    return color;
  }

  // Handle hex colors
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    if (hex.length === 3) {
      return [
        parseInt(hex[0] + hex[0], 16) / 255,
        parseInt(hex[1] + hex[1], 16) / 255,
        parseInt(hex[2] + hex[2], 16) / 255,
      ];
    }
    return [
      parseInt(hex.slice(0, 2), 16) / 255,
      parseInt(hex.slice(2, 4), 16) / 255,
      parseInt(hex.slice(4, 6), 16) / 255,
    ];
  }

  // Handle rgb/rgba
  const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgbMatch) {
    return [
      parseInt(rgbMatch[1]) / 255,
      parseInt(rgbMatch[2]) / 255,
      parseInt(rgbMatch[3]) / 255,
    ];
  }

  // Default to white if parsing fails
  console.warn(`[parseColor] Could not parse color: ${color}, defaulting to white`);
  return [1, 1, 1];
}

/**
 * Prepare trajectory data for GPU rendering.
 */
export function prepareGPUTrajectoryData(
  trajectories: number[][][],
  segmentIndex: number,
  style: GPUTrajectoryStyleOptions
): GPUTrajectoryData {
  const numTrajectories = trajectories.length;
  if (numTrajectories === 0) {
    return {
      segments: new Float32Array(0),
      segmentCount: 0,
      trajectoryCount: 0,
      maxTimeIndex: 0,
      headPositions: new Float32Array(0),
    };
  }

  // Find max time index across all trajectories
  let maxTimeIndex = 0;
  for (const traj of trajectories) {
    const endIdx = Math.min(segmentIndex + 1, traj.length - 1);
    if (endIdx > maxTimeIndex) {
      maxTimeIndex = endIdx;
    }
  }

  // Count total segments
  let totalSegments = 0;
  for (const traj of trajectories) {
    const endIdx = Math.min(segmentIndex + 1, traj.length - 1);
    totalSegments += endIdx;
  }

  // Allocate buffers
  const segments = new Float32Array(totalSegments * 8);
  const headPositions = new Float32Array(numTrajectories * 4);

  let segIdx = 0;

  for (let trajIdx = 0; trajIdx < numTrajectories; trajIdx++) {
    const traj = trajectories[trajIdx];
    const endIdx = Math.min(segmentIndex + 1, traj.length - 1);

    // Compute per-segment alphas
    const alphas = computeSegmentAlphas(traj, endIdx, style.opacityGradient);

    for (let timeIdx = 0; timeIdx < endIdx; timeIdx++) {
      const baseIdx = segIdx * 8;

      // Segment endpoints
      segments[baseIdx + 0] = traj[timeIdx][0];
      segments[baseIdx + 1] = traj[timeIdx][1];
      segments[baseIdx + 2] = traj[timeIdx + 1][0];
      segments[baseIdx + 3] = traj[timeIdx + 1][1];

      // Alpha at start and end of segment
      segments[baseIdx + 4] = alphas[timeIdx];
      segments[baseIdx + 5] = alphas[timeIdx + 1];

      // Z-value: based on time index with trajectory tiebreaker
      // Higher values = closer to camera = drawn on top
      const zValue = (timeIdx + trajIdx * 0.0001) / Math.max(maxTimeIndex, 1);
      segments[baseIdx + 6] = zValue;
      segments[baseIdx + 7] = 0; // padding

      segIdx++;
    }

    // Head position
    const headIdx = endIdx;
    const headZValue = (headIdx + trajIdx * 0.0001) / Math.max(maxTimeIndex, 1);
    headPositions[trajIdx * 4 + 0] = traj[headIdx][0];
    headPositions[trajIdx * 4 + 1] = traj[headIdx][1];
    headPositions[trajIdx * 4 + 2] = headZValue;
    headPositions[trajIdx * 4 + 3] = alphas[headIdx];
  }

  return {
    segments,
    segmentCount: totalSegments,
    trajectoryCount: numTrajectories,
    maxTimeIndex,
    headPositions,
  };
}

/**
 * Compute per-point alpha values for a trajectory.
 */
function computeSegmentAlphas(
  trajectory: number[][],
  endIdx: number,
  opacityGradient?: OpacityGradientOptions
): number[] {
  const alphas = new Array(endIdx + 1);

  if (!opacityGradient || opacityGradient.mode === 'none') {
    // Uniform opacity
    for (let i = 0; i <= endIdx; i++) {
      alphas[i] = 1.0;
    }
  } else if (opacityGradient.mode === 'recency') {
    // Fading tail based on time window
    const timeWindow = opacityGradient.timeWindow ?? 0.8;
    const windowSize = Math.max(1, Math.floor(timeWindow * trajectory.length));
    const startIdx = Math.max(0, endIdx - windowSize);

    for (let i = 0; i <= endIdx; i++) {
      if (i < startIdx) {
        alphas[i] = 0.0;
      } else {
        alphas[i] = (i - startIdx) / Math.max(endIdx - startIdx, 1);
      }
    }
  } else if (opacityGradient.mode === 'custom' && opacityGradient.perSegmentAlphas) {
    // Use provided per-segment alphas (already flattened for this trajectory)
    const customAlphas = opacityGradient.perSegmentAlphas;
    for (let i = 0; i <= endIdx; i++) {
      // Find the alpha for this trajectory (customAlphas is [trajectory][segment])
      alphas[i] = customAlphas[0]?.[i] ?? 1.0;
    }
  } else {
    // Default to uniform
    for (let i = 0; i <= endIdx; i++) {
      alphas[i] = 1.0;
    }
  }

  return alphas;
}
