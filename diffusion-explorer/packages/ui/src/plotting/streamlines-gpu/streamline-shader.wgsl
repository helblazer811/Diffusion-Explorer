/**
 * GPU Streamline Shader
 *
 * Renders animated streamlines using:
 * - Instanced rendering (one instance per segment)
 * - Vertex shader expands segments into quads with rounded cap margins
 * - Fragment shader uses SDF for smooth edges and sawtooth pulse animation
 *
 * Each segment is defined by:
 * - p0, p1: Start and end points
 * - cumulativeLengthStart: Arc length at start of segment
 * - totalLength: Total streamline length
 * - phaseOffset: Per-streamline phase offset (0-1)
 */

// ============================================================================
// Uniforms
// ============================================================================

struct Uniforms {
  // Canvas dimensions (physical pixels)
  width: f32,
  height: f32,
  // Device pixel ratio (for scaling logical to physical coordinates)
  dpr: f32,
  // Animation
  phase: f32,
  // Appearance (in logical/CSS pixels, will be scaled by DPR)
  thickness: f32,
  pulseWidth: f32,
  pulseSpacing: f32,
  baseOpacity: f32,
  binaryPulse: f32,  // 0.0 = gradient, 1.0 = binary
  // Color (RGBA)
  colorR: f32,
  colorG: f32,
  colorB: f32,
  colorA: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

// ============================================================================
// Segment Data (Storage Buffer)
// ============================================================================

// Each segment: 8 floats (32 bytes)
// [x0, y0, x1, y1, cumulativeLengthStart, totalLength, phaseOffset, _padding]
@group(0) @binding(1) var<storage, read> segments: array<f32>;

// ============================================================================
// Vertex Shader
// ============================================================================

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) localPos: vec2<f32>,      // Position relative to segment (for SDF)
  @location(1) segmentDir: vec2<f32>,    // Normalized direction of segment
  @location(2) segmentLength: f32,       // Length of this segment
  @location(3) arcLengthStart: f32,      // Cumulative arc length at segment start
  @location(4) totalLength: f32,         // Total streamline length
  @location(5) phaseOffset: f32,         // Per-streamline phase offset
}

// Quad vertices: 6 vertices per instance (2 triangles)
// Arranged as: 0--1
//              | /|
//              |/ |
//              2--3
// Triangles: (0,2,1), (1,2,3)
const QUAD_POSITIONS = array<vec2<f32>, 6>(
  vec2<f32>(0.0, 1.0),   // 0: start, +perpendicular
  vec2<f32>(1.0, 1.0),   // 1: end, +perpendicular
  vec2<f32>(0.0, -1.0),  // 2: start, -perpendicular
  vec2<f32>(1.0, 1.0),   // 1: end, +perpendicular (repeated for second tri)
  vec2<f32>(0.0, -1.0),  // 2: start, -perpendicular (repeated)
  vec2<f32>(1.0, -1.0),  // 3: end, -perpendicular
);

@vertex
fn vs_main(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
  var output: VertexOutput;

  // Read segment data (8 floats per segment) - coordinates are in logical/CSS pixels
  let baseIdx = instanceIndex * 8u;
  let p0_logical = vec2<f32>(segments[baseIdx], segments[baseIdx + 1u]);
  let p1_logical = vec2<f32>(segments[baseIdx + 2u], segments[baseIdx + 3u]);
  let cumulativeLengthStart = segments[baseIdx + 4u];
  let totalLength = segments[baseIdx + 5u];
  let phaseOffset = segments[baseIdx + 6u];

  // Scale coordinates from logical pixels to physical pixels
  let dpr = uniforms.dpr;
  let p0 = p0_logical * dpr;
  let p1 = p1_logical * dpr;

  // Compute segment direction and length (in physical pixels)
  let delta = p1 - p0;
  let segmentLength = length(delta);
  let dir = select(vec2<f32>(1.0, 0.0), delta / segmentLength, segmentLength > 0.001);

  // Perpendicular (rotated 90 degrees CCW)
  let perp = vec2<f32>(-dir.y, dir.x);

  // Get quad position for this vertex
  let quadPos = QUAD_POSITIONS[vertexIndex % 6u];

  // Scale thickness by DPR for physical pixels
  let physicalThickness = uniforms.thickness * dpr;
  let halfThickness = physicalThickness * 0.5;
  let margin = halfThickness + 2.0 * dpr; // Extra margin for rounded caps and AA

  // Compute world position (in physical pixels)
  // quadPos.x: 0 = start, 1 = end (with extension for rounded caps)
  // quadPos.y: -1 to 1 perpendicular extent
  let along = mix(-margin, segmentLength + margin, quadPos.x);
  let across = quadPos.y * margin;

  let worldPos = p0 + dir * along + perp * across;

  // Convert to NDC (-1 to 1) using physical pixel dimensions
  let ndcX = (worldPos.x / uniforms.width) * 2.0 - 1.0;
  let ndcY = 1.0 - (worldPos.y / uniforms.height) * 2.0; // Flip Y for canvas coords

  output.position = vec4<f32>(ndcX, ndcY, 0.0, 1.0);

  // Pass data to fragment shader (in physical pixels for SDF calculations)
  // localPos: position relative to segment start, in segment-local coordinates
  output.localPos = vec2<f32>(along, across);
  output.segmentDir = dir;
  output.segmentLength = segmentLength;
  // Arc lengths remain in logical pixels for consistent pulse animation
  output.arcLengthStart = cumulativeLengthStart;
  output.totalLength = totalLength;
  output.phaseOffset = phaseOffset;

  return output;
}

// ============================================================================
// Fragment Shader
// ============================================================================

/**
 * Signed distance function for a line segment (capsule shape).
 * Returns distance from point p to the line segment from a to b.
 *
 * @param p - Point to measure from (in local coords where segment is along x-axis)
 * @param segmentLength - Length of the segment
 * @returns Signed distance (negative inside, positive outside)
 */
fn capsuleSDF(localPos: vec2<f32>, segmentLength: f32) -> f32 {
  // localPos.x is position along segment (0 = start, segmentLength = end)
  // localPos.y is perpendicular distance

  // Clamp to segment extent
  let t = clamp(localPos.x, 0.0, segmentLength);

  // Distance from clamped point
  let dx = localPos.x - t;
  let dy = localPos.y;

  return sqrt(dx * dx + dy * dy);
}

/**
 * Compute alpha for sawtooth pulse pattern.
 *
 * The pattern repeats every `pulseSpacing` pixels along the streamline.
 * Within each period:
 * - First `pulseWidth` pixels: alpha fades from 0 to baseOpacity (front to back)
 * - Remaining pixels: alpha = 0 (gap)
 *
 * @param arcLength - Position along the streamline (pixels)
 * @param phase - Animation phase (0-1)
 * @param phaseOffset - Per-streamline phase offset (0-1)
 * @returns Alpha value (0-1)
 */
fn computePulseAlpha(arcLength: f32, phase: f32, phaseOffset: f32) -> f32 {
  // Combine global phase and per-streamline offset
  let totalPhase = fract(phase + phaseOffset);

  // Convert phase to pixel offset
  let phasePixels = totalPhase * uniforms.pulseSpacing;

  // Position in pattern (shifted by phase)
  let posInPattern = fract((arcLength - phasePixels) / uniforms.pulseSpacing) * uniforms.pulseSpacing;

  // Check if we're in the pulse region
  if (posInPattern < uniforms.pulseWidth) {
    if (uniforms.binaryPulse > 0.5) {
      // Binary mode: full opacity
      return uniforms.baseOpacity;
    } else {
      // Gradient mode: fade from 0 at front to baseOpacity at back
      let u = posInPattern / uniforms.pulseWidth;
      return uniforms.baseOpacity * u;
    }
  }

  // In the gap region
  return 0.0;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  // Compute SDF distance (in physical pixels)
  let dist = capsuleSDF(input.localPos, input.segmentLength);

  // Thickness scaled to physical pixels
  let dpr = uniforms.dpr;
  let physicalThickness = uniforms.thickness * dpr;
  let halfThickness = physicalThickness * 0.5;

  // Signed distance (negative inside, positive outside)
  let signedDist = dist - halfThickness;

  // Anti-aliased alpha based on SDF
  // Smooth transition over ~1.5 physical pixels for good AA
  let aaWidth = 0.75 * dpr;
  let sdfAlpha = 1.0 - smoothstep(-aaWidth, aaWidth, signedDist);

  // Early discard for fully transparent pixels
  if (sdfAlpha < 0.001) {
    discard;
  }

  // Compute arc length at this fragment (convert from physical to logical pixels)
  // localPos.x is the position along the segment in physical pixels
  let clampedLocalX = clamp(input.localPos.x, 0.0, input.segmentLength);
  // Convert to logical pixels for consistent pulse animation
  let arcLengthPhysical = clampedLocalX;
  let arcLength = input.arcLengthStart + arcLengthPhysical / dpr;

  // Compute pulse alpha (pulse parameters are in logical pixels)
  let pulseAlpha = computePulseAlpha(arcLength, uniforms.phase, input.phaseOffset);

  // Combine SDF alpha and pulse alpha
  let finalAlpha = sdfAlpha * pulseAlpha;

  // Early discard for fully transparent pixels
  if (finalAlpha < 0.001) {
    discard;
  }

  // Output color with computed alpha
  return vec4<f32>(
    uniforms.colorR,
    uniforms.colorG,
    uniforms.colorB,
    finalAlpha * uniforms.colorA
  );
}
