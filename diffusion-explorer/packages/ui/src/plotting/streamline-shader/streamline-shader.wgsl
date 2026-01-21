// Streamline Rendering Compute Shader
// Uses spatial hashing for O(1) segment lookup per pixel.
// For each pixel, finds the closest streamline segment and computes
// animated pulse alpha based on arc length position.

struct Uniforms {
  width: u32,
  height: u32,
  cellSize: f32,
  gridWidth: u32,
  gridHeight: u32,
  strokeWidth: f32,
  pulseWidth: f32,
  pulseSpacing: f32,   // pulseWidth + pulsePauseWidth
  baseOpacity: f32,
  binaryPulse: u32,    // 0 = gradient, 1 = binary
  phase: f32,          // Animation phase [0, 1)
  colorR: f32,
  colorG: f32,
  colorB: f32,
  _padding: f32,       // Align to 16 bytes
}

// Segment data layout: 8 floats per segment
// [x0, y0, x1, y1, arcLengthStart, arcLengthEnd, totalLength, offset]
struct Segment {
  p0: vec2<f32>,
  p1: vec2<f32>,
  arcLengthStart: f32,
  arcLengthEnd: f32,
  totalLength: f32,
  offset: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> cellOffsets: array<u32>;
@group(0) @binding(2) var<storage, read> segmentIndices: array<u32>;
@group(0) @binding(3) var<storage, read> segmentData: array<f32>;
@group(0) @binding(4) var<storage, read_write> output: array<u32>;  // RGBA8 packed

// Load a segment from the packed data
fn loadSegment(index: u32) -> Segment {
  let base = index * 8u;
  var seg: Segment;
  seg.p0 = vec2<f32>(segmentData[base + 0u], segmentData[base + 1u]);
  seg.p1 = vec2<f32>(segmentData[base + 2u], segmentData[base + 3u]);
  seg.arcLengthStart = segmentData[base + 4u];
  seg.arcLengthEnd = segmentData[base + 5u];
  seg.totalLength = segmentData[base + 6u];
  seg.offset = segmentData[base + 7u];
  return seg;
}

// Compute distance from point to line segment and the parameter t along the segment
// Returns vec2(distance, t) where t is in [0, 1]
fn pointToSegment(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  let ab = b - a;
  let ap = p - a;
  let lenSq = dot(ab, ab);

  // Handle degenerate segment (point)
  if (lenSq < 1e-10) {
    return vec2<f32>(length(ap), 0.0);
  }

  // Project p onto line, clamp to segment
  var t = dot(ap, ab) / lenSq;
  t = clamp(t, 0.0, 1.0);

  // Closest point on segment
  let closest = a + t * ab;
  let dist = length(p - closest);

  return vec2<f32>(dist, t);
}

// Compute alpha for a given arc length position along a streamline
fn computePulseAlpha(arcLength: f32, offset: f32) -> f32 {
  let spacing = uniforms.pulseSpacing;
  let pulseWidth = uniforms.pulseWidth;

  // Shift position based on phase and offset
  let shiftedPos = arcLength - (uniforms.phase + offset) * spacing;

  // Wrap to positive and find position within pattern period
  var posInPattern = shiftedPos - floor(shiftedPos / spacing) * spacing;
  if (posInPattern < 0.0) {
    posInPattern += spacing;
  }

  // Check if within pulse region
  if (posInPattern >= pulseWidth) {
    return 0.0;  // In gap region
  }

  // Compute alpha based on position within pulse
  if (uniforms.binaryPulse != 0u) {
    return uniforms.baseOpacity;
  } else {
    // Gradient: 0 at front, baseOpacity at back
    let u = posInPattern / pulseWidth;
    return uniforms.baseOpacity * u;
  }
}

// Smooth edge falloff using smoothstep
fn edgeFalloff(dist: f32, halfWidth: f32) -> f32 {
  // Anti-aliasing: smooth transition over ~1 pixel at edge
  let edgeWidth = 1.0;
  return 1.0 - smoothstep(halfWidth - edgeWidth, halfWidth, dist);
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let x = globalId.x;
  let y = globalId.y;

  // Early exit if outside image bounds
  if (x >= uniforms.width || y >= uniforms.height) {
    return;
  }

  let pixelIndex = y * uniforms.width + x;
  let pixelPos = vec2<f32>(f32(x) + 0.5, f32(y) + 0.5);

  // Compute cell coordinates
  let cellX = u32(floor(pixelPos.x / uniforms.cellSize));
  let cellY = u32(floor(pixelPos.y / uniforms.cellSize));

  // Clamp to grid bounds
  let clampedCellX = min(cellX, uniforms.gridWidth - 1u);
  let clampedCellY = min(cellY, uniforms.gridHeight - 1u);

  let halfWidth = uniforms.strokeWidth * 0.5;

  // Track closest segment
  var minDist = halfWidth + 2.0;  // Beyond stroke width + AA margin
  var bestArcLength = 0.0;
  var bestOffset = 0.0;
  var found = false;

  // Check current cell and neighboring cells (3x3 neighborhood)
  // This handles segments that cross cell boundaries
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let ncx = i32(clampedCellX) + dx;
      let ncy = i32(clampedCellY) + dy;

      // Skip out-of-bounds cells
      if (ncx < 0 || ncy < 0 || u32(ncx) >= uniforms.gridWidth || u32(ncy) >= uniforms.gridHeight) {
        continue;
      }

      let cellIdx = u32(ncy) * uniforms.gridWidth + u32(ncx);
      let startIdx = cellOffsets[cellIdx];
      let endIdx = cellOffsets[cellIdx + 1u];

      // Check all segments in this cell
      for (var i = startIdx; i < endIdx; i++) {
        let segIdx = segmentIndices[i];
        let seg = loadSegment(segIdx);

        let result = pointToSegment(pixelPos, seg.p0, seg.p1);
        let dist = result.x;
        let t = result.y;

        if (dist < minDist) {
          minDist = dist;
          // Interpolate arc length based on t
          bestArcLength = mix(seg.arcLengthStart, seg.arcLengthEnd, t);
          bestOffset = seg.offset;
          found = true;
        }
      }
    }
  }

  // Compute final color
  var finalColor = vec4<f32>(0.0, 0.0, 0.0, 0.0);

  if (found && minDist <= halfWidth + 1.0) {
    // Compute pulse alpha
    let pulseAlpha = computePulseAlpha(bestArcLength, bestOffset);

    // Apply edge falloff for anti-aliasing
    let edgeAlpha = edgeFalloff(minDist, halfWidth);

    let alpha = pulseAlpha * edgeAlpha;

    if (alpha > 0.001) {
      finalColor = vec4<f32>(
        uniforms.colorR,
        uniforms.colorG,
        uniforms.colorB,
        alpha
      );
    }
  }

  // Pack RGBA into u32 (little endian: R is lowest byte)
  let r = u32(clamp(finalColor.r * 255.0, 0.0, 255.0));
  let g = u32(clamp(finalColor.g * 255.0, 0.0, 255.0));
  let b = u32(clamp(finalColor.b * 255.0, 0.0, 255.0));
  let a = u32(clamp(finalColor.a * 255.0, 0.0, 255.0));

  output[pixelIndex] = r | (g << 8u) | (b << 16u) | (a << 24u);
}
