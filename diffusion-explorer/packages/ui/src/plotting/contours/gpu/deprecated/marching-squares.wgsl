/**
 * Marching squares compute shader - Filled Triangle Output.
 *
 * Extracts filled triangles from a density grid for multiple threshold levels.
 * Instead of outputting edge segments, this outputs the triangulated "inside"
 * regions that can be directly rasterized with alpha blending.
 *
 * Each grid cell can produce 0-4 triangles depending on the marching squares
 * case (16 possible cases). The triangles represent the area where density
 * exceeds the threshold.
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
@group(0) @binding(2) var<storage, read_write> triangles: array<f32>;
@group(0) @binding(3) var<storage, read> thresholds: array<f32>;

// Triangle output format per triangle:
// [x0, y0, x1, y1, x2, y2, levelIdx, valid]
// Total: 8 floats per triangle
// Max 4 triangles per cell = 32 floats per cell per level

// Vertex indices for cell corners and edges:
// Corners: 0=bottom-left (0,0), 1=bottom-right (1,0), 2=top-right (1,1), 3=top-left (0,1)
// Edges: 4=bottom (e0), 5=right (e1), 6=top (e2), 7=left (e3)

// Triangle table: for each of the 16 cases, lists vertex indices for triangles.
// Each case can have 0-4 triangles. Triangles are wound counter-clockwise.
// Format: array of arrays where each inner group of 3 is a triangle.
// Using -1 as terminator.

// Vertex positions (local cell coords 0-1):
// 0: (0,0) - bottom-left corner
// 1: (1,0) - bottom-right corner
// 2: (1,1) - top-right corner
// 3: (0,1) - top-left corner
// 4: (t,0) - bottom edge interpolated
// 5: (1,t) - right edge interpolated
// 6: (t,1) - top edge interpolated
// 7: (0,t) - left edge interpolated

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
 * Get vertex position in normalized coordinates [0, 1] relative to full grid.
 */
fn getVertexPos(
  cellX: u32,
  cellY: u32,
  vertexIdx: i32,
  threshold: f32,
  v00: f32, v10: f32, v01: f32, v11: f32
) -> vec2<f32> {
  let fx = f32(cellX);
  let fy = f32(cellY);
  let cellW = f32(uniforms.gridWidth - 1u);
  let cellH = f32(uniforms.gridHeight - 1u);

  switch (vertexIdx) {
    // Corners
    case 0: { return vec2<f32>(fx / cellW, fy / cellH); }               // bottom-left
    case 1: { return vec2<f32>((fx + 1.0) / cellW, fy / cellH); }       // bottom-right
    case 2: { return vec2<f32>((fx + 1.0) / cellW, (fy + 1.0) / cellH); } // top-right
    case 3: { return vec2<f32>(fx / cellW, (fy + 1.0) / cellH); }       // top-left

    // Edge interpolated points
    case 4: { // bottom edge (between v00 and v10)
      let t = lerp(v00, v10, threshold);
      return vec2<f32>((fx + t) / cellW, fy / cellH);
    }
    case 5: { // right edge (between v10 and v11)
      let t = lerp(v10, v11, threshold);
      return vec2<f32>((fx + 1.0) / cellW, (fy + t) / cellH);
    }
    case 6: { // top edge (between v01 and v11)
      let t = lerp(v01, v11, threshold);
      return vec2<f32>((fx + t) / cellW, (fy + 1.0) / cellH);
    }
    case 7: { // left edge (between v00 and v01)
      let t = lerp(v00, v01, threshold);
      return vec2<f32>(fx / cellW, (fy + t) / cellH);
    }
    default: { return vec2<f32>(0.0, 0.0); }
  }
}

/**
 * Write a triangle to the output buffer.
 */
fn writeTriangle(
  slotIdx: u32,
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  levelIdx: u32,
  valid: f32
) {
  let baseIdx = slotIdx * 8u;
  triangles[baseIdx + 0u] = p0.x;
  triangles[baseIdx + 1u] = p0.y;
  triangles[baseIdx + 2u] = p1.x;
  triangles[baseIdx + 3u] = p1.y;
  triangles[baseIdx + 4u] = p2.x;
  triangles[baseIdx + 5u] = p2.y;
  triangles[baseIdx + 6u] = f32(levelIdx);
  triangles[baseIdx + 7u] = valid;
}

/**
 * Mark a triangle slot as invalid.
 */
fn invalidateTriangle(slotIdx: u32) {
  triangles[slotIdx * 8u + 7u] = 0.0;
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
  // Bit 0: bottom-left (v00) is inside
  // Bit 1: bottom-right (v10) is inside
  // Bit 2: top-right (v11) is inside
  // Bit 3: top-left (v01) is inside
  var caseIdx = 0u;
  if (v00 >= threshold) { caseIdx |= 1u; }
  if (v10 >= threshold) { caseIdx |= 2u; }
  if (v11 >= threshold) { caseIdx |= 4u; }
  if (v01 >= threshold) { caseIdx |= 8u; }

  // Calculate output slot indices
  // Fixed allocation: 4 triangles per cell per level
  let cellIndex = (level * cellHeight + cellY) * cellWidth + cellX;
  let slot0 = cellIndex * 4u;
  let slot1 = slot0 + 1u;
  let slot2 = slot0 + 2u;
  let slot3 = slot0 + 3u;

  // Initialize all slots as invalid
  invalidateTriangle(slot0);
  invalidateTriangle(slot1);
  invalidateTriangle(slot2);
  invalidateTriangle(slot3);

  // Get vertex positions (we'll compute only what we need, but declare all)
  let c0 = getVertexPos(cellX, cellY, 0, threshold, v00, v10, v01, v11); // bottom-left
  let c1 = getVertexPos(cellX, cellY, 1, threshold, v00, v10, v01, v11); // bottom-right
  let c2 = getVertexPos(cellX, cellY, 2, threshold, v00, v10, v01, v11); // top-right
  let c3 = getVertexPos(cellX, cellY, 3, threshold, v00, v10, v01, v11); // top-left
  let e0 = getVertexPos(cellX, cellY, 4, threshold, v00, v10, v01, v11); // bottom edge
  let e1 = getVertexPos(cellX, cellY, 5, threshold, v00, v10, v01, v11); // right edge
  let e2 = getVertexPos(cellX, cellY, 6, threshold, v00, v10, v01, v11); // top edge
  let e3 = getVertexPos(cellX, cellY, 7, threshold, v00, v10, v01, v11); // left edge

  // Generate triangles based on case
  // Each case fills the region where density >= threshold
  switch (caseIdx) {
    case 0u: {
      // 0000: No corners inside - no fill
    }
    case 1u: {
      // 0001: Only bottom-left inside - small triangle at corner
      writeTriangle(slot0, c0, e0, e3, level, 1.0);
    }
    case 2u: {
      // 0010: Only bottom-right inside - small triangle at corner
      writeTriangle(slot0, e0, c1, e1, level, 1.0);
    }
    case 3u: {
      // 0011: Bottom-left and bottom-right inside - bottom band (quad = 2 triangles)
      writeTriangle(slot0, c0, c1, e1, level, 1.0);
      writeTriangle(slot1, c0, e1, e3, level, 1.0);
    }
    case 4u: {
      // 0100: Only top-right inside - small triangle at corner
      writeTriangle(slot0, e1, c2, e2, level, 1.0);
    }
    case 5u: {
      // 0101: Bottom-left and top-right inside (saddle case)
      // Two separate triangles (diagonal)
      // Use center value to disambiguate - for simplicity, use average
      let centerVal = (v00 + v10 + v01 + v11) * 0.25;
      if (centerVal >= threshold) {
        // Connect the two regions (hexagon = 4 triangles)
        writeTriangle(slot0, c0, e0, e3, level, 1.0);
        writeTriangle(slot1, e0, e1, e3, level, 1.0);
        writeTriangle(slot2, e1, e2, e3, level, 1.0);
        writeTriangle(slot3, e1, c2, e2, level, 1.0);
      } else {
        // Keep regions separate (2 triangles)
        writeTriangle(slot0, c0, e0, e3, level, 1.0);
        writeTriangle(slot1, e1, c2, e2, level, 1.0);
      }
    }
    case 6u: {
      // 0110: Bottom-right and top-right inside - right band (quad = 2 triangles)
      writeTriangle(slot0, e0, c1, c2, level, 1.0);
      writeTriangle(slot1, e0, c2, e2, level, 1.0);
    }
    case 7u: {
      // 0111: All except top-left inside - pentagon (3 triangles)
      // Fan from bottom-left corner
      writeTriangle(slot0, c0, c1, c2, level, 1.0);
      writeTriangle(slot1, c0, c2, e2, level, 1.0);
      writeTriangle(slot2, c0, e2, e3, level, 1.0);
    }
    case 8u: {
      // 1000: Only top-left inside - small triangle at corner
      writeTriangle(slot0, e3, e2, c3, level, 1.0);
    }
    case 9u: {
      // 1001: Bottom-left and top-left inside - left band (quad = 2 triangles)
      writeTriangle(slot0, c0, e0, e2, level, 1.0);
      writeTriangle(slot1, c0, e2, c3, level, 1.0);
    }
    case 10u: {
      // 1010: Bottom-right and top-left inside (saddle case)
      // Two separate triangles (other diagonal)
      let centerVal = (v00 + v10 + v01 + v11) * 0.25;
      if (centerVal >= threshold) {
        // Connect the two regions (hexagon = 4 triangles)
        writeTriangle(slot0, e0, c1, e1, level, 1.0);
        writeTriangle(slot1, e0, e1, e2, level, 1.0);
        writeTriangle(slot2, e0, e2, e3, level, 1.0);
        writeTriangle(slot3, e3, e2, c3, level, 1.0);
      } else {
        // Keep regions separate (2 triangles)
        writeTriangle(slot0, e0, c1, e1, level, 1.0);
        writeTriangle(slot1, e3, e2, c3, level, 1.0);
      }
    }
    case 11u: {
      // 1011: All except top-right inside - pentagon (3 triangles)
      // Fan from bottom-left corner
      writeTriangle(slot0, c0, c1, e1, level, 1.0);
      writeTriangle(slot1, c0, e1, e2, level, 1.0);
      writeTriangle(slot2, c0, e2, c3, level, 1.0);
    }
    case 12u: {
      // 1100: Top-left and top-right inside - top band (quad = 2 triangles)
      writeTriangle(slot0, e3, e1, c2, level, 1.0);
      writeTriangle(slot1, e3, c2, c3, level, 1.0);
    }
    case 13u: {
      // 1101: All except bottom-right inside - pentagon (3 triangles)
      // Fan from bottom-left corner
      writeTriangle(slot0, c0, e0, e1, level, 1.0);
      writeTriangle(slot1, c0, e1, c2, level, 1.0);
      writeTriangle(slot2, c0, c2, c3, level, 1.0);
    }
    case 14u: {
      // 1110: All except bottom-left inside - pentagon (3 triangles)
      // Fan from bottom-right corner
      writeTriangle(slot0, e0, c1, c2, level, 1.0);
      writeTriangle(slot1, e0, c2, c3, level, 1.0);
      writeTriangle(slot2, e0, c3, e3, level, 1.0);
    }
    case 15u: {
      // 1111: All corners inside - full quad (2 triangles)
      writeTriangle(slot0, c0, c1, c2, level, 1.0);
      writeTriangle(slot1, c0, c2, c3, level, 1.0);
    }
    default: {}
  }
}
