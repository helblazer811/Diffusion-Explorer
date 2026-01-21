/**
 * Spatial hash construction for efficient GPU-based streamline segment lookup.
 *
 * The spatial hash divides the canvas into a grid of cells. Each cell stores
 * references to segments that pass through it. This allows O(1) lookup per pixel
 * in the shader - threads with no nearby streamlines can exit early.
 */

import type {
  StreamlineSegment,
  StreamlineSpatialHash,
  PackedStreamlineData,
  SpatialHashOptions
} from './types';
import type { StreamlineLengthData } from '../../animation/streamline-animation';

/**
 * Check if a line segment intersects or passes through a cell.
 * Uses a conservative check that includes cells the segment might touch.
 */
function segmentIntersectsCell(
  x0: number, y0: number,
  x1: number, y1: number,
  cellMinX: number, cellMinY: number,
  cellMaxX: number, cellMaxY: number,
  strokeWidth: number
): boolean {
  // Expand cell bounds by stroke width to catch segments that are close
  const halfWidth = strokeWidth / 2;
  const expandedMinX = cellMinX - halfWidth;
  const expandedMinY = cellMinY - halfWidth;
  const expandedMaxX = cellMaxX + halfWidth;
  const expandedMaxY = cellMaxY + halfWidth;

  // Check if segment's bounding box intersects expanded cell
  const segMinX = Math.min(x0, x1);
  const segMinY = Math.min(y0, y1);
  const segMaxX = Math.max(x0, x1);
  const segMaxY = Math.max(y0, y1);

  if (segMaxX < expandedMinX || segMinX > expandedMaxX ||
      segMaxY < expandedMinY || segMinY > expandedMaxY) {
    return false;
  }

  return true;
}

/**
 * Build a spatial hash from streamlines in pixel coordinates.
 *
 * @param streamlines - Array of streamlines, each is array of [x, y] points in pixels
 * @param lengthData - Per-streamline length data from precomputation
 * @param offsets - Per-streamline phase offsets (0-1)
 * @param options - Spatial hash configuration
 * @returns Spatial hash structure
 */
export function buildSpatialHash(
  streamlines: number[][][],
  lengthData: StreamlineLengthData[],
  offsets: number[],
  options: SpatialHashOptions
): StreamlineSpatialHash {
  const { width, height, strokeWidth } = options;

  // Cell size should be large enough to limit segments per cell,
  // but small enough that threads can skip cells efficiently.
  // A good heuristic: 2-4x the stroke width, minimum 8 pixels
  const cellSize = options.cellSize ?? Math.max(8, strokeWidth * 3);

  const gridWidth = Math.ceil(width / cellSize);
  const gridHeight = Math.ceil(height / cellSize);
  const numCells = gridWidth * gridHeight;

  // First pass: collect all segments and count segments per cell
  const segments: StreamlineSegment[] = [];
  const cellSegmentLists: number[][] = new Array(numCells);
  for (let i = 0; i < numCells; i++) {
    cellSegmentLists[i] = [];
  }

  for (let streamlineIdx = 0; streamlineIdx < streamlines.length; streamlineIdx++) {
    const streamline = streamlines[streamlineIdx];
    const lengths = lengthData[streamlineIdx];
    const offset = offsets[streamlineIdx] ?? 0;

    if (streamline.length < 2) continue;

    for (let segIdx = 0; segIdx < streamline.length - 1; segIdx++) {
      const p0 = streamline[segIdx] as [number, number];
      const p1 = streamline[segIdx + 1] as [number, number];

      const segment: StreamlineSegment = {
        p0,
        p1,
        arcLengthStart: lengths.cumulativeLengths[segIdx],
        arcLengthEnd: lengths.cumulativeLengths[segIdx + 1],
        totalLength: lengths.totalLength,
        offset
      };

      const segmentIndex = segments.length;
      segments.push(segment);

      // Find all cells this segment touches
      const minCellX = Math.max(0, Math.floor((Math.min(p0[0], p1[0]) - strokeWidth) / cellSize));
      const maxCellX = Math.min(gridWidth - 1, Math.floor((Math.max(p0[0], p1[0]) + strokeWidth) / cellSize));
      const minCellY = Math.max(0, Math.floor((Math.min(p0[1], p1[1]) - strokeWidth) / cellSize));
      const maxCellY = Math.min(gridHeight - 1, Math.floor((Math.max(p0[1], p1[1]) + strokeWidth) / cellSize));

      for (let cy = minCellY; cy <= maxCellY; cy++) {
        for (let cx = minCellX; cx <= maxCellX; cx++) {
          const cellMinX = cx * cellSize;
          const cellMinY = cy * cellSize;
          const cellMaxX = cellMinX + cellSize;
          const cellMaxY = cellMinY + cellSize;

          if (segmentIntersectsCell(
            p0[0], p0[1], p1[0], p1[1],
            cellMinX, cellMinY, cellMaxX, cellMaxY,
            strokeWidth
          )) {
            const cellIdx = cy * gridWidth + cx;
            cellSegmentLists[cellIdx].push(segmentIndex);
          }
        }
      }
    }
  }

  // Build packed arrays
  const cellOffsets = new Uint32Array(numCells + 1);
  const cellCounts = new Uint32Array(numCells);

  let totalSegmentRefs = 0;
  for (let i = 0; i < numCells; i++) {
    cellOffsets[i] = totalSegmentRefs;
    cellCounts[i] = cellSegmentLists[i].length;
    totalSegmentRefs += cellSegmentLists[i].length;
  }
  cellOffsets[numCells] = totalSegmentRefs;

  const segmentIndices = new Uint32Array(totalSegmentRefs);
  let writeIdx = 0;
  for (let i = 0; i < numCells; i++) {
    for (const segIdx of cellSegmentLists[i]) {
      segmentIndices[writeIdx++] = segIdx;
    }
  }

  return {
    cellSize,
    gridWidth,
    gridHeight,
    cellOffsets,
    cellCounts,
    segmentIndices,
    segments
  };
}

/**
 * Pack spatial hash into GPU-friendly format.
 *
 * @param hash - Spatial hash structure
 * @param options - Rendering options
 * @returns Packed data ready for GPU upload
 */
export function packSpatialHashForGPU(
  hash: StreamlineSpatialHash,
  options: SpatialHashOptions
): PackedStreamlineData {
  const { segments, cellOffsets, segmentIndices, cellSize, gridWidth, gridHeight } = hash;

  // Pack segment data: 8 floats per segment
  // [x0, y0, x1, y1, arcLengthStart, arcLengthEnd, totalLength, offset]
  const segmentData = new Float32Array(segments.length * 8);
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const base = i * 8;
    segmentData[base + 0] = seg.p0[0];
    segmentData[base + 1] = seg.p0[1];
    segmentData[base + 2] = seg.p1[0];
    segmentData[base + 3] = seg.p1[1];
    segmentData[base + 4] = seg.arcLengthStart;
    segmentData[base + 5] = seg.arcLengthEnd;
    segmentData[base + 6] = seg.totalLength;
    segmentData[base + 7] = seg.offset;
  }

  return {
    uniforms: {
      width: options.width,
      height: options.height,
      cellSize,
      gridWidth,
      gridHeight,
      strokeWidth: options.strokeWidth,
      pulseWidth: options.pulseWidth,
      pulseSpacing: options.pulseWidth + options.pulsePauseWidth,
      baseOpacity: options.baseOpacity,
      binaryPulse: options.binaryPulse ?? false
    },
    cellOffsets,
    segmentIndices,
    segmentData,
    segmentCount: segments.length
  };
}

/**
 * Build and pack streamline data for GPU rendering.
 * Convenience function that combines buildSpatialHash and packSpatialHashForGPU.
 *
 * @param streamlines - Array of streamlines in pixel coordinates
 * @param lengthData - Per-streamline length data
 * @param offsets - Per-streamline phase offsets
 * @param options - Rendering options
 * @returns Packed data ready for GPU upload
 */
export function buildPackedStreamlineData(
  streamlines: number[][][],
  lengthData: StreamlineLengthData[],
  offsets: number[],
  options: SpatialHashOptions
): PackedStreamlineData {
  const hash = buildSpatialHash(streamlines, lengthData, offsets, options);
  return packSpatialHashForGPU(hash, options);
}
