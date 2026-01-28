/**
 * GPU trajectory data preparation utilities.
 */

import type {
  TrajectoryStyleOptions,
  GPUTrajectoryData,
  OpacityGradientOptions,
} from '../types';

/**
 * Parse a CSS color string to RGB values [0-1].
 */
export function parseColor(color: string): [number, number, number] {
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
 * Segments are sorted back-to-front by z-value for correct alpha blending.
 */
export function prepareGPUTrajectoryData(
  trajectories: number[][][],
  segmentIndex: number,
  style: TrajectoryStyleOptions
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

  // Collect all segments with their z-values for sorting
  // Each entry: [x0, y0, x1, y1, alphaStart, alphaEnd, zValue, 0]
  const unsortedSegments: number[][] = [];
  const headPositions = new Float32Array(numTrajectories * 4);

  for (let trajIdx = 0; trajIdx < numTrajectories; trajIdx++) {
    const traj = trajectories[trajIdx];
    const endIdx = Math.min(segmentIndex + 1, traj.length - 1);

    // Compute per-segment alphas
    const alphas = computeSegmentAlphas(traj, endIdx, style.opacityGradient);

    for (let timeIdx = 0; timeIdx < endIdx; timeIdx++) {
      // Z-value: based on time index with trajectory tiebreaker
      // Higher values = closer to camera = drawn on top
      const zValue = (timeIdx + trajIdx * 0.0001) / Math.max(maxTimeIndex, 1);

      unsortedSegments.push([
        traj[timeIdx][0],
        traj[timeIdx][1],
        traj[timeIdx + 1][0],
        traj[timeIdx + 1][1],
        alphas[timeIdx],
        alphas[timeIdx + 1],
        zValue,
        0, // padding
      ]);
    }

    // Head position
    const headIdx = endIdx;
    const headZValue = (headIdx + trajIdx * 0.0001) / Math.max(maxTimeIndex, 1);
    headPositions[trajIdx * 4 + 0] = traj[headIdx][0];
    headPositions[trajIdx * 4 + 1] = traj[headIdx][1];
    headPositions[trajIdx * 4 + 2] = headZValue;
    headPositions[trajIdx * 4 + 3] = alphas[headIdx];
  }

  // Sort segments by z-value ascending (back-to-front for proper alpha blending)
  // Lower z = further back = drawn first, higher z = closer = drawn last (on top)
  unsortedSegments.sort((a, b) => a[6] - b[6]);

  // Pack sorted segments into Float32Array
  const segments = new Float32Array(totalSegments * 8);
  for (let i = 0; i < unsortedSegments.length; i++) {
    const seg = unsortedSegments[i];
    const baseIdx = i * 8;
    segments[baseIdx + 0] = seg[0];
    segments[baseIdx + 1] = seg[1];
    segments[baseIdx + 2] = seg[2];
    segments[baseIdx + 3] = seg[3];
    segments[baseIdx + 4] = seg[4];
    segments[baseIdx + 5] = seg[5];
    segments[baseIdx + 6] = seg[6];
    segments[baseIdx + 7] = seg[7];
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
