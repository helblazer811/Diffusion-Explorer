/**
 * Marching squares compute shader.
 *
 * Extracts contour segments from a density grid for multiple threshold levels.
 * Uses fixed allocation with validity flags to handle variable output.
 *
 * Each grid cell can produce 0, 1, or 2 segments depending on the
 * marching squares case (16 possible cases).
 */

struct Uniforms {
  gridWidth: u32,
  gridHeight: u32,
  numLevels: u32,
  numPoints: u32,
  xMin: f32,
  xMax: f32,
  yMin: f32,
  yMax: f32,
  blurRadius: u32,
  _pad1: u32,
  _pad2: u32,
  _pad3: u32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> densityGrid: array<f32>;
@group(0) @binding(2) var<storage, read_write> segments: array<f32>;
@group(0) @binding(3) var<storage, read> thresholds: array<f32>;

// Marching squares edge table.
// For each of the 16 cases, stores which edges to connect.
// Edges: 0=bottom, 1=right, 2=top, 3=left
// Format: [edge0_start, edge0_end, edge1_start, edge1_end]
// Value of -1 means no edge.
const EDGE_TABLE = array<vec4<i32>, 16>(
  vec4<i32>(-1, -1, -1, -1),  // 0:  0000 - no edges
  vec4<i32>(0, 3, -1, -1),    // 1:  0001 - bottom-left corner
  vec4<i32>(0, 1, -1, -1),    // 2:  0010 - bottom-right corner
  vec4<i32>(1, 3, -1, -1),    // 3:  0011 - left-right horizontal
  vec4<i32>(1, 2, -1, -1),    // 4:  0100 - top-right corner
  vec4<i32>(0, 1, 2, 3),      // 5:  0101 - saddle: bottom-right + top-left
  vec4<i32>(0, 2, -1, -1),    // 6:  0110 - bottom-top vertical
  vec4<i32>(2, 3, -1, -1),    // 7:  0111 - top-left corner
  vec4<i32>(2, 3, -1, -1),    // 8:  1000 - top-left corner
  vec4<i32>(0, 2, -1, -1),    // 9:  1001 - bottom-top vertical
  vec4<i32>(0, 3, 1, 2),      // 10: 1010 - saddle: bottom-left + top-right
  vec4<i32>(1, 2, -1, -1),    // 11: 1011 - top-right corner
  vec4<i32>(1, 3, -1, -1),    // 12: 1100 - left-right horizontal
  vec4<i32>(0, 1, -1, -1),    // 13: 1101 - bottom-right corner
  vec4<i32>(0, 3, -1, -1),    // 14: 1110 - bottom-left corner
  vec4<i32>(-1, -1, -1, -1),  // 15: 1111 - no edges (all inside)
);

/**
 * Linear interpolation for finding edge crossing point.
 */
fn lerp(v0: f32, v1: f32, threshold: f32) -> f32 {
  if (abs(v1 - v0) < 0.00001) {
    return 0.5;
  }
  return clamp((threshold - v0) / (v1 - v0), 0.0, 1.0);
}

/**
 * Get the interpolated position on an edge.
 * edge: 0=bottom, 1=right, 2=top, 3=left
 * Returns position in normalized coordinates [0, 1] relative to grid.
 */
fn getEdgePoint(
  cellX: u32,
  cellY: u32,
  edge: i32,
  threshold: f32,
  v00: f32, v10: f32, v01: f32, v11: f32
) -> vec2<f32> {
  let fx = f32(cellX);
  let fy = f32(cellY);
  let cellW = f32(uniforms.gridWidth - 1u);
  let cellH = f32(uniforms.gridHeight - 1u);

  switch (edge) {
    case 0: {
      // Bottom edge (between v00 and v10)
      let t = lerp(v00, v10, threshold);
      return vec2<f32>((fx + t) / cellW, fy / cellH);
    }
    case 1: {
      // Right edge (between v10 and v11)
      let t = lerp(v10, v11, threshold);
      return vec2<f32>((fx + 1.0) / cellW, (fy + t) / cellH);
    }
    case 2: {
      // Top edge (between v01 and v11)
      let t = lerp(v01, v11, threshold);
      return vec2<f32>((fx + t) / cellW, (fy + 1.0) / cellH);
    }
    case 3: {
      // Left edge (between v00 and v01)
      let t = lerp(v00, v01, threshold);
      return vec2<f32>(fx / cellW, (fy + t) / cellH);
    }
    default: {
      return vec2<f32>(0.0, 0.0);
    }
  }
}

/**
 * Write a segment to the output buffer.
 * Segment layout: [x0, y0, x1, y1, contourLevel, contourIndex, valid, _pad]
 */
fn writeSegment(
  slotIdx: u32,
  p0: vec2<f32>,
  p1: vec2<f32>,
  threshold: f32,
  levelIdx: u32,
  valid: f32
) {
  let baseIdx = slotIdx * 8u;
  segments[baseIdx + 0u] = p0.x;
  segments[baseIdx + 1u] = p0.y;
  segments[baseIdx + 2u] = p1.x;
  segments[baseIdx + 3u] = p1.y;
  segments[baseIdx + 4u] = threshold;
  segments[baseIdx + 5u] = f32(levelIdx);
  segments[baseIdx + 6u] = valid;
  segments[baseIdx + 7u] = 0.0;  // padding
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let cellX = globalId.x;
  let cellY = globalId.y;
  let level = globalId.z;

  // Cell grid is (gridWidth-1) x (gridHeight-1)
  let cellWidth = uniforms.gridWidth - 1u;
  let cellHeight = uniforms.gridHeight - 1u;

  if (cellX >= cellWidth || cellY >= cellHeight || level >= uniforms.numLevels) {
    return;
  }

  // Sample 4 corners of the cell
  let v00 = densityGrid[cellY * uniforms.gridWidth + cellX];
  let v10 = densityGrid[cellY * uniforms.gridWidth + cellX + 1u];
  let v01 = densityGrid[(cellY + 1u) * uniforms.gridWidth + cellX];
  let v11 = densityGrid[(cellY + 1u) * uniforms.gridWidth + cellX + 1u];

  let threshold = thresholds[level];

  // Build case index (4-bit binary)
  var caseIdx = 0u;
  if (v00 >= threshold) { caseIdx |= 1u; }
  if (v10 >= threshold) { caseIdx |= 2u; }
  if (v11 >= threshold) { caseIdx |= 4u; }
  if (v01 >= threshold) { caseIdx |= 8u; }

  // Get edges from lookup table
  let edges = EDGE_TABLE[caseIdx];

  // Calculate output slot indices
  // Fixed allocation: 2 slots per cell per level
  let cellIndex = (level * cellHeight + cellY) * cellWidth + cellX;
  let slot0 = cellIndex * 2u;
  let slot1 = slot0 + 1u;

  // Write first segment (if valid)
  if (edges.x >= 0) {
    let p0 = getEdgePoint(cellX, cellY, edges.x, threshold, v00, v10, v01, v11);
    let p1 = getEdgePoint(cellX, cellY, edges.y, threshold, v00, v10, v01, v11);
    writeSegment(slot0, p0, p1, threshold, level, 1.0);
  } else {
    // Mark as invalid
    segments[slot0 * 8u + 6u] = 0.0;
  }

  // Write second segment (saddle cases only)
  if (edges.z >= 0) {
    let p2 = getEdgePoint(cellX, cellY, edges.z, threshold, v00, v10, v01, v11);
    let p3 = getEdgePoint(cellX, cellY, edges.w, threshold, v00, v10, v01, v11);
    writeSegment(slot1, p2, p3, threshold, level, 1.0);
  } else {
    // Mark as invalid
    segments[slot1 * 8u + 6u] = 0.0;
  }
}
