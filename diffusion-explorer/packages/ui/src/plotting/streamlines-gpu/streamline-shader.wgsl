/**
 * GPU Streamline Shader
 *
 * Renders animated streamlines using:
 * - Instanced rendering (one instance per segment)
 * - Vertex shader expands segments into quads
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
  let margin = halfThickness + 2.0 * dpr; // Cap radius + AA margin

  // Compute world position (in physical pixels)
  // quadPos.x: 0 = start, 1 = end
  // quadPos.y: -1 to 1 perpendicular extent
  // Extend quad beyond segment end by margin for capsule cap rendering (includes AA)
  let along = mix(0.0, segmentLength + margin, quadPos.x);
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

// ----------------------------------------------------------------------------
// Signed Distance Functions (SDF)
// Convention: sd* functions return signed distance (negative inside, positive outside)
// ----------------------------------------------------------------------------

/**
 * SDF for a circle centered at origin.
 * @param p - Point to measure from
 * @param r - Circle radius
 * @returns Signed distance (negative inside, positive outside)
 */
fn sdCircle(p: vec2<f32>, r: f32) -> f32 {
  return length(p) - r;
}

/**
 * SDF for horizontal line segment (infinite in x, bounded in y).
 * Used for rectangular pulse body.
 * @param perpDist - Perpendicular distance from centerline
 * @param halfWidth - Half the line width
 * @returns Signed distance (negative inside, positive outside)
 */
fn sdLine(perpDist: f32, halfWidth: f32) -> f32 {
  return perpDist - halfWidth;
}

// ----------------------------------------------------------------------------
// Pulse Pattern
// ----------------------------------------------------------------------------

/**
 * Information about which region of a pulse the fragment is in.
 */
struct PulseInfo {
  inPulse: bool,      // Whether fragment is in pulse (body or cap)
  inCap: bool,        // Whether fragment is in capsule cap region
  overshoot: f32,     // Distance past pulseWidth (for cap SDF), in logical pixels
  posInPattern: f32,  // Position within pulse pattern (for alpha interpolation)
}

/**
 * Determine which region of a pulse the fragment is in.
 *
 * The pattern repeats every `pulseSpacing` pixels along the streamline.
 * Within each period:
 * - Body region (posInPattern < pulseWidth): Rectangular pulse body
 * - Cap region (posInPattern in [pulseWidth, pulseWidth + halfThickness]): Semicircular cap
 * - Gap region: No rendering
 *
 * @param arcLength - Position along the streamline (logical pixels)
 * @param phase - Animation phase (0-1)
 * @param phaseOffset - Per-streamline phase offset (0-1)
 * @returns PulseInfo struct with region information
 */
fn computePulseInfo(arcLength: f32, phase: f32, phaseOffset: f32) -> PulseInfo {
  var info: PulseInfo;

  // Combine global phase and per-streamline offset
  let totalPhase = fract(phase + phaseOffset);

  // Convert phase to pixel offset
  let phasePixels = totalPhase * uniforms.pulseSpacing;

  // Position in pattern (shifted by phase)
  let posInPattern = fract((arcLength - phasePixels) / uniforms.pulseSpacing) * uniforms.pulseSpacing;

  let halfThicknessLogical = uniforms.thickness * 0.5;
  let aaMarginLogical = 1.0; // Extra margin for AA blur (matches ~0.75 * dpr / dpr)

  // Inside rectangular body
  if (posInPattern < uniforms.pulseWidth) {
    info.inPulse = true;
    info.inCap = false;
    info.overshoot = 0.0;
    info.posInPattern = posInPattern;
    return info;
  }

  // Check capsule cap region (includes AA margin for smooth edges)
  let overshoot = posInPattern - uniforms.pulseWidth;
  if (overshoot < halfThicknessLogical + aaMarginLogical) {
    info.inPulse = true;  // Potentially in cap (SDF will determine final visibility)
    info.inCap = true;
    info.overshoot = overshoot;
    info.posInPattern = posInPattern;
    return info;
  }

  // In gap
  info.inPulse = false;
  info.inCap = false;
  info.overshoot = 0.0;
  info.posInPattern = posInPattern;
  return info;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  let dpr = uniforms.dpr;
  let physicalThickness = uniforms.thickness * dpr;
  let halfThickness = physicalThickness * 0.5;

  // Perpendicular distance (physical pixels)
  let perpDist = abs(input.localPos.y);

  // Arc length at this fragment (logical pixels)
  let arcLength = input.arcLengthStart + input.localPos.x / dpr;

  // Determine pulse region
  let pulseInfo = computePulseInfo(arcLength, uniforms.phase, input.phaseOffset);

  // Early discard if in gap
  if (!pulseInfo.inPulse) {
    discard;
  }

  // Segment ownership check to prevent double-rendering of caps at segment boundaries
  // Each segment "owns" arc lengths from arcLengthStart to arcLengthStart + segmentLength/dpr
  let segmentLengthLogical = input.segmentLength / dpr;
  let segmentArcEnd = input.arcLengthStart + segmentLengthLogical;
  let inExtendedRegion = input.localPos.x > input.segmentLength;

  if (pulseInfo.inCap) {
    // Cap's anchor point (where body ends) in arc length
    let anchorArcLength = arcLength - pulseInfo.overshoot;

    // Discard caps whose anchor is before this segment's range (let previous segment render)
    if (anchorArcLength < input.arcLengthStart - 0.001) {
      discard;
    }

    // In extended region, also check if anchor is past this segment's range
    if (inExtendedRegion && anchorArcLength > segmentArcEnd + 0.001) {
      discard;
    }
  } else if (inExtendedRegion) {
    // Non-cap fragments shouldn't render in extended region
    discard;
  }

  // Compute signed distance based on region
  var sd: f32;

  if (pulseInfo.inCap) {
    // Capsule cap: use circular SDF centered at pulse edge
    let overshootPhysical = pulseInfo.overshoot * dpr;
    let capPos = vec2<f32>(overshootPhysical, perpDist);
    sd = sdCircle(capPos, halfThickness);
  } else {
    // Rectangular body: use line SDF
    sd = sdLine(perpDist, halfThickness);
  }

  // Anti-aliased alpha from signed distance
  let aaWidth = 0.75 * dpr;
  let alpha = 1.0 - smoothstep(-aaWidth, aaWidth, sd);

  // Linear alpha interpolation along pulse (0.0 at tail, 1.0 at head/cap)
  let pulseAlpha = saturate(pulseInfo.posInPattern / uniforms.pulseWidth);

  // Combine SDF alpha, pulse alpha, and base opacity
  let finalAlpha = alpha * pulseAlpha * uniforms.baseOpacity;

  // Early discard for fully transparent pixels
  if (finalAlpha < 0.001) {
    discard;
  }

  return vec4<f32>(
    uniforms.colorR,
    uniforms.colorG,
    uniforms.colorB,
    finalAlpha * uniforms.colorA
  );
}
