/**
 * GPU Pulsing Paths Shader
 *
 * Renders animated pulses along arbitrary paths using:
 * - Instanced rendering (one instance per segment)
 * - Vertex shader expands segments into quads
 * - Fragment shader uses SDF for smooth edges and sawtooth pulse animation
 *
 * Each segment is defined by:
 * - p0, p1: Start and end points
 * - cumulativeLengthStart: Arc length at start of segment
 * - totalLength: Total path length
 * - phaseOffset: Per-path phase offset (0-1)
 * - segmentFlags: 1=first, 2=last, 3=both
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
// [x0, y0, x1, y1, cumulativeLengthStart, totalLength, phaseOffset, segmentFlags]
@group(0) @binding(1) var<storage, read> segments: array<f32>;

// ============================================================================
// Shared SDF Functions (injected at build time)
// ============================================================================

// SDF_UTILS_PLACEHOLDER

// ============================================================================
// Shared Pulse Functions (injected at build time)
// ============================================================================

// PULSE_PATTERN_PLACEHOLDER

// ============================================================================
// Vertex Shader
// ============================================================================

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) localPos: vec2<f32>,      // Position relative to segment (for SDF)
  @location(1) segmentDir: vec2<f32>,    // Normalized direction of segment
  @location(2) segmentLength: f32,       // Length of this segment
  @location(3) arcLengthStart: f32,      // Cumulative arc length at segment start
  @location(4) totalLength: f32,         // Total path length
  @location(5) phaseOffset: f32,         // Per-path phase offset
  @location(6) segmentFlags: f32,        // Segment flags: 1=first, 2=last, 3=both
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
  let segmentFlags = segments[baseIdx + 7u];

  // Decode segment flags (1=first, 2=last, 3=both)
  let isFirstSegment = (segmentFlags == 1.0) || (segmentFlags == 3.0);
  let isLastSegment = (segmentFlags >= 2.0);

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
  // Extend quad for capsule cap rendering:
  // - First segment: extend backward for path start cap
  // - All segments: extend forward for pulse caps at segment boundaries
  let startExtend = select(0.0, margin, isFirstSegment);
  let along = mix(-startExtend, segmentLength + margin, quadPos.x);
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
  output.segmentFlags = segmentFlags;

  return output;
}

// ============================================================================
// Fragment Shader
// ============================================================================

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
  let halfThicknessLogical = uniforms.thickness * 0.5;
  let perpDistLogical = perpDist / dpr;
  let pulseInfo = computePulseInfo(
    arcLength,
    uniforms.phase,
    input.phaseOffset,
    uniforms.pulseSpacing,
    uniforms.pulseWidth,
    halfThicknessLogical
  );

  // Compute extents for early discard and SDF calculations
  let aaMarginLogical = 1.0;
  let capExtent = halfThicknessLogical + aaMarginLogical;

  // Path cap regions
  let inPathStartCap = arcLength < capExtent;
  let inPathEndCap = arcLength > input.totalLength - capExtent;

  // Early discard if not in pulse region AND not in path cap region
  if (!pulseInfo.inPulseRegion && !inPathStartCap && !inPathEndCap) {
    discard;
  }

  // Segment ownership check to prevent double-rendering of caps at segment boundaries
  let segmentLengthLogical = input.segmentLength / dpr;
  let segmentArcEnd = input.arcLengthStart + segmentLengthLogical;
  let inExtendedRegion = input.localPos.x > input.segmentLength;

  // Decode segment flags (1=first, 2=last, 3=both)
  let isFirstSegment = (input.segmentFlags == 1.0) || (input.segmentFlags == 3.0);
  let isLastSegment = (input.segmentFlags >= 2.0);

  // Allow pulse body to extend past path boundaries; capsule SDF handles rounding
  let effectiveBodyStart = pulseInfo.bodyStart;
  let effectiveBodyEnd = pulseInfo.bodyEnd;

  // Segment owns caps whose center (bodyStart or bodyEnd) falls within its arc length range
  let ownsTailCap = (effectiveBodyStart >= input.arcLengthStart - 0.001) &&
                     (effectiveBodyStart <= segmentArcEnd + 0.001);
  let ownsHeadCap = (effectiveBodyEnd >= input.arcLengthStart - 0.001) &&
                     (effectiveBodyEnd <= segmentArcEnd + 0.001);

  // Check if fragment is in a cap region
  let inTailCapRegion = arcLength < effectiveBodyStart;
  let inHeadCapRegion = arcLength > effectiveBodyEnd;

  // Discard caps we don't own (prevents double-rendering at segment boundaries)
  if (inTailCapRegion && !ownsTailCap) {
    discard;
  }
  if (inHeadCapRegion && !ownsHeadCap) {
    discard;
  }

  // In extended region, only render if we own a cap that extends there
  if (inExtendedRegion) {
    let inOwnedTailCap = ownsTailCap && inTailCapRegion;
    let inOwnedHeadCap = ownsHeadCap && inHeadCapRegion;
    if (!inOwnedTailCap && !inOwnedHeadCap) {
      discard;
    }
  }

  // Compute pulse SDF using shared function
  var sdPulse = computePulseSDF(arcLength, perpDistLogical, pulseInfo, halfThicknessLogical);

  // Convert pulse SDF to physical pixels
  sdPulse = sdPulse * dpr;

  // Path capsule SDF: clips pulses to [0, totalLength] with rounded ends
  var pathCapsuleSd = computePathCapsuleSDF(
    arcLength,
    perpDistLogical,
    input.totalLength,
    halfThicknessLogical
  );
  pathCapsuleSd = pathCapsuleSd * dpr; // Convert to physical pixels

  // Intersect pulse SDF with path capsule
  let sd = max(sdPulse, pathCapsuleSd);

  // Anti-aliased alpha from signed distance
  let aaWidth = 0.75 * dpr;
  let alpha = 1.0 - smoothstep(-aaWidth, aaWidth, sd);

  // Linear alpha interpolation along pulse (0.0 at tail/bodyStart, 1.0 at head/bodyEnd)
  // When binaryPulse=1.0, use solid pulses instead of gradient
  let pulseAlpha = computePulseAlpha(
    arcLength,
    pulseInfo.bodyStart,
    uniforms.pulseWidth,
    uniforms.binaryPulse
  );

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
