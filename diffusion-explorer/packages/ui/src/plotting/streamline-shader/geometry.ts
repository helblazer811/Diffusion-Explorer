/**
 * Unified streamline geometry representation.
 *
 * Provides a single source of truth for streamline data that both
 * canvas and shader renderers can use, eliminating redundancy.
 */

import type { StreamlineSegment } from './types';

/**
 * Per-streamline metadata.
 */
export interface StreamlineMeta {
  /** Index of first segment in the segments array */
  startSegmentIdx: number;
  /** Number of segments in this streamline */
  segmentCount: number;
  /** Total arc length of the streamline (pixels) */
  totalLength: number;
  /** Phase offset for animation (0-1) */
  offset: number;
}

/**
 * Unified geometry representation for streamlines.
 * This is the single source of truth for all streamline data.
 */
export interface StreamlineGeometry {
  /** All segments across all streamlines (flattened) */
  segments: StreamlineSegment[];
  /** Per-streamline metadata */
  streamlineMeta: StreamlineMeta[];
  /** Original polylines for canvas path drawing (point sequences) */
  polylines: number[][][];
}

/**
 * Build unified streamline geometry from raw polylines.
 *
 * @param polylines - Array of streamlines, each is array of [x, y] points in pixels
 * @param offsets - Per-streamline phase offsets (0-1)
 * @returns Unified geometry with segments and metadata
 */
export function buildStreamlineGeometry(
  polylines: number[][][],
  offsets: number[]
): StreamlineGeometry {
  const segments: StreamlineSegment[] = [];
  const streamlineMeta: StreamlineMeta[] = [];

  for (let streamlineIdx = 0; streamlineIdx < polylines.length; streamlineIdx++) {
    const polyline = polylines[streamlineIdx];
    const offset = offsets[streamlineIdx] ?? 0;

    if (polyline.length < 2) {
      // Streamline with no segments
      streamlineMeta.push({
        startSegmentIdx: segments.length,
        segmentCount: 0,
        totalLength: 0,
        offset
      });
      continue;
    }

    const startSegmentIdx = segments.length;
    let cumulativeLength = 0;

    // Build segments for this streamline
    for (let i = 0; i < polyline.length - 1; i++) {
      const p0 = polyline[i] as [number, number];
      const p1 = polyline[i + 1] as [number, number];

      const dx = p1[0] - p0[0];
      const dy = p1[1] - p0[1];
      const segmentLength = Math.sqrt(dx * dx + dy * dy);

      const arcLengthStart = cumulativeLength;
      cumulativeLength += segmentLength;
      const arcLengthEnd = cumulativeLength;

      segments.push({
        p0,
        p1,
        arcLengthStart,
        arcLengthEnd,
        totalLength: 0, // Will be filled in after we know total
        offset
      });
    }

    const totalLength = cumulativeLength;
    const segmentCount = polyline.length - 1;

    // Update totalLength in all segments for this streamline
    for (let i = startSegmentIdx; i < segments.length; i++) {
      segments[i].totalLength = totalLength;
    }

    streamlineMeta.push({
      startSegmentIdx,
      segmentCount,
      totalLength,
      offset
    });
  }

  return {
    segments,
    streamlineMeta,
    polylines
  };
}

/**
 * Get cumulative lengths for a streamline (for compatibility with existing code).
 * Derives this from the segment data without storing it separately.
 *
 * @param geometry - Unified geometry
 * @param streamlineIdx - Index of the streamline
 * @returns Array of cumulative lengths at each point
 */
export function getCumulativeLengths(
  geometry: StreamlineGeometry,
  streamlineIdx: number
): number[] {
  const meta = geometry.streamlineMeta[streamlineIdx];
  if (!meta || meta.segmentCount === 0) {
    return [0];
  }

  const lengths: number[] = [0]; // First point is at 0
  for (let i = 0; i < meta.segmentCount; i++) {
    const segment = geometry.segments[meta.startSegmentIdx + i];
    lengths.push(segment.arcLengthEnd);
  }
  return lengths;
}

/**
 * Compute alpha values for a streamline using the unified geometry.
 * This replaces the pattern-indices-based approach with direct segment iteration.
 *
 * @param geometry - Unified geometry
 * @param streamlineIdx - Index of the streamline
 * @param phase - Animation phase (0-1)
 * @param pulseWidth - Width of pulse in pixels
 * @param pulseSpacing - Total period (pulseWidth + pauseWidth) in pixels
 * @param baseOpacity - Maximum opacity
 * @param binaryPulse - If true, no gradient
 * @returns Array of alpha values per point
 */
export function computeStreamlineAlphas(
  geometry: StreamlineGeometry,
  streamlineIdx: number,
  phase: number,
  pulseWidth: number,
  pulseSpacing: number,
  baseOpacity: number,
  binaryPulse: boolean
): number[] {
  const meta = geometry.streamlineMeta[streamlineIdx];
  if (!meta || meta.segmentCount === 0) {
    return [0];
  }

  const offset = meta.offset;
  const alphas: number[] = [];

  // Compute alpha at each point (segment start + final segment end)
  for (let i = 0; i <= meta.segmentCount; i++) {
    let arcLength: number;
    if (i < meta.segmentCount) {
      arcLength = geometry.segments[meta.startSegmentIdx + i].arcLengthStart;
    } else {
      // Last point uses end of last segment
      arcLength = geometry.segments[meta.startSegmentIdx + i - 1].arcLengthEnd;
    }

    // Compute position in pattern
    const shiftedPos = arcLength - (phase + offset) * pulseSpacing;
    let posInPattern = shiftedPos % pulseSpacing;
    if (posInPattern < 0) posInPattern += pulseSpacing;

    // Compute alpha
    let alpha = 0;
    if (posInPattern < pulseWidth) {
      if (binaryPulse) {
        alpha = baseOpacity;
      } else {
        // Gradient: 0 at front, baseOpacity at back
        alpha = baseOpacity * (posInPattern / pulseWidth);
      }
    }
    alphas.push(alpha);
  }

  return alphas;
}

/**
 * Precompute pattern indices for a streamline (for LUT-based alpha computation).
 * This provides backward compatibility with the existing fast-path.
 *
 * @param geometry - Unified geometry
 * @param streamlineIdx - Index of the streamline
 * @param spacing - Total period (pulseWidth + pauseWidth) in pixels
 * @param lutResolution - Resolution of the alpha LUT (default 256)
 * @returns Uint16Array of LUT indices per point
 */
export function precomputePatternIndices(
  geometry: StreamlineGeometry,
  streamlineIdx: number,
  spacing: number,
  lutResolution: number = 256
): Uint16Array {
  const meta = geometry.streamlineMeta[streamlineIdx];
  if (!meta) {
    return new Uint16Array(0);
  }

  const numPoints = meta.segmentCount + 1;
  const indices = new Uint16Array(numPoints);
  const scale = lutResolution / spacing;

  for (let i = 0; i < numPoints; i++) {
    let arcLength: number;
    if (i < meta.segmentCount) {
      arcLength = geometry.segments[meta.startSegmentIdx + i].arcLengthStart;
    } else {
      arcLength = geometry.segments[meta.startSegmentIdx + i - 1].arcLengthEnd;
    }

    const posInPattern = arcLength % spacing;
    indices[i] = Math.floor(posInPattern * scale) % lutResolution;
  }

  return indices;
}
