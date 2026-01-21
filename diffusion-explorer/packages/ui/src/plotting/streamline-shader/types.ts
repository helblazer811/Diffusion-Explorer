/**
 * Type definitions for shader-based streamline rendering.
 */

/**
 * A single line segment within a streamline.
 * Contains endpoint positions and arc length information for pulse animation.
 */
export interface StreamlineSegment {
  /** Start point of segment in pixel coordinates */
  p0: [number, number];
  /** End point of segment in pixel coordinates */
  p1: [number, number];
  /** Cumulative arc length at start of segment (pixels) */
  arcLengthStart: number;
  /** Cumulative arc length at end of segment (pixels) */
  arcLengthEnd: number;
  /** Total length of the parent streamline (pixels) */
  totalLength: number;
  /** Phase offset for this streamline (0-1) */
  offset: number;
}

/**
 * Spatial hash for efficient segment lookup.
 * Each cell contains indices into a flat segment array.
 */
export interface StreamlineSpatialHash {
  /** Cell dimensions in pixels */
  cellSize: number;
  /** Grid dimensions */
  gridWidth: number;
  gridHeight: number;
  /** For each cell: starting index into segmentIndices array */
  cellOffsets: Uint32Array;
  /** For each cell: number of segments in that cell */
  cellCounts: Uint32Array;
  /** Flat array of segment indices, grouped by cell */
  segmentIndices: Uint32Array;
  /** Flat array of all segments */
  segments: StreamlineSegment[];
}

/**
 * GPU-friendly packed representation of spatial hash data.
 * All data is packed into typed arrays for efficient GPU upload.
 */
export interface PackedStreamlineData {
  /** Uniform data for shader */
  uniforms: {
    width: number;
    height: number;
    cellSize: number;
    gridWidth: number;
    gridHeight: number;
    strokeWidth: number;
    pulseWidth: number;
    pulseSpacing: number;
    baseOpacity: number;
    binaryPulse: boolean;
  };
  /**
   * Cell offsets: for cell i, cellOffsets[i] is the starting index
   * into segmentIndices. cellOffsets[gridWidth * gridHeight] is the total count.
   */
  cellOffsets: Uint32Array;
  /**
   * Segment indices grouped by cell.
   * segmentIndices[cellOffsets[i]..cellOffsets[i+1]] are the segment
   * indices for cell i.
   */
  segmentIndices: Uint32Array;
  /**
   * Packed segment data: each segment is 8 floats:
   * [x0, y0, x1, y1, arcLengthStart, arcLengthEnd, totalLength, offset]
   */
  segmentData: Float32Array;
  /** Number of segments */
  segmentCount: number;
}

/**
 * Options for building a spatial hash from streamlines.
 */
export interface SpatialHashOptions {
  /** Canvas width in pixels */
  width: number;
  /** Canvas height in pixels */
  height: number;
  /** Cell size in pixels (default: based on stroke width) */
  cellSize?: number;
  /** Stroke width in pixels (used for default cell size) */
  strokeWidth: number;
  /** Pulse width in pixels */
  pulseWidth: number;
  /** Gap between pulses in pixels */
  pulsePauseWidth: number;
  /** Maximum opacity */
  baseOpacity: number;
  /** Binary pulse mode (no gradient) */
  binaryPulse?: boolean;
}

/**
 * Options for shader-based streamline rendering.
 */
export interface StreamlineShaderOptions extends SpatialHashOptions {
  /** RGB color [0-1] range */
  color: [number, number, number];
}
