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
  // - First segment: extend backward for streamline start cap
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
 * Information about the pulse region the fragment is in.
 */
struct PulseInfo {
  inPulseRegion: bool,  // Whether fragment is potentially in pulse render area
  bodyStart: f32,       // Arc length where body starts (logical pixels)
  bodyEnd: f32,         // Arc length where body ends (logical pixels)
  posInPattern: f32,    // Position within pulse pattern (for alpha)
}

/**
 * Compute pulse body bounds for the fragment's position.
 *
 * The pattern repeats every `pulseSpacing` pixels along the streamline.
 * This function finds the arc length positions of the nearest pulse's
 * body start (tail) and body end (head).
 *
 * @param arcLength - Position along the streamline (logical pixels)
 * @param phase - Animation phase (0-1)
 * @param phaseOffset - Per-streamline phase offset (0-1)
 * @returns PulseInfo struct with body bounds and region info
 */
fn computePulseInfo(arcLength: f32, phase: f32, phaseOffset: f32) -> PulseInfo {
  var info: PulseInfo;

  // Combine global phase and per-streamline offset
  let totalPhase = fract(phase + phaseOffset);
  let phasePixels = totalPhase * uniforms.pulseSpacing;

  // Position in pattern (0 to pulseSpacing)
  let posInPattern = fract((arcLength - phasePixels) / uniforms.pulseSpacing) * uniforms.pulseSpacing;

  // The pulse body spans [0, pulseWidth] in pattern space
  // Convert to arc length of the pulse that contains/nearest this fragment
  let patternStart = arcLength - posInPattern;  // Start of this pattern period

  info.bodyStart = patternStart;
  info.bodyEnd = patternStart + uniforms.pulseWidth;
  info.posInPattern = posInPattern;

  // Check if in potential render area (body + caps + AA margin)
  let halfThickness = uniforms.thickness * 0.5;
  let aaMargin = 1.0;
  let capExtent = halfThickness + aaMargin;

  info.inPulseRegion = (arcLength >= info.bodyStart - capExtent) &&
                        (arcLength <= info.bodyEnd + capExtent);

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

  // Compute extents for early discard and SDF calculations
  let halfThicknessLogical = uniforms.thickness * 0.5;
  let perpDistLogical = perpDist / dpr;
  let aaMarginLogical = 1.0;
  let capExtent = halfThicknessLogical + aaMarginLogical;

  // Streamline cap regions
  let inStreamlineStartCap = arcLength < capExtent;
  let inStreamlineEndCap = arcLength > input.totalLength - capExtent;

  // Early discard if not in pulse region AND not in streamline cap region
  if (!pulseInfo.inPulseRegion && !inStreamlineStartCap && !inStreamlineEndCap) {
    discard;
  }

  // Segment ownership check to prevent double-rendering of caps at segment boundaries
  let segmentLengthLogical = input.segmentLength / dpr;
  let segmentArcEnd = input.arcLengthStart + segmentLengthLogical;
  let inExtendedRegion = input.localPos.x > input.segmentLength;

  // Decode segment flags (1=first, 2=last, 3=both)
  let isFirstSegment = (input.segmentFlags == 1.0) || (input.segmentFlags == 3.0);
  let isLastSegment = (input.segmentFlags >= 2.0);

  // Clamp bodyStart to 0 for first segment (prevents flat edge at streamline start)
  let effectiveBodyStart = select(pulseInfo.bodyStart, max(pulseInfo.bodyStart, 0.0), isFirstSegment);

  // Clamp bodyEnd to totalLength for last segment (for ownership and SDF)
  let effectiveBodyEnd = select(pulseInfo.bodyEnd, min(pulseInfo.bodyEnd, input.totalLength), isLastSegment);

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

  // Compute pulse SDF (body + head cap + tail cap via union)
  var sdPulse: f32 = 1e6;  // Start outside all pulses

  // Body: rectangle between bodyStart and bodyEnd
  let inBody = (arcLength >= effectiveBodyStart) && (arcLength <= effectiveBodyEnd);
  if (inBody) {
    sdPulse = sdLine(perpDistLogical, halfThicknessLogical);
  }

  // Tail cap (at bodyStart): semicircle
  let tailDist = effectiveBodyStart - arcLength;
  if (tailDist > 0.0 && tailDist < capExtent) {
    let tailSd = length(vec2<f32>(tailDist, perpDistLogical)) - halfThicknessLogical;
    sdPulse = min(sdPulse, tailSd);
  }

  // Head cap (at effectiveBodyEnd)
  let headDist = arcLength - effectiveBodyEnd;
  if (headDist > 0.0 && headDist < capExtent) {
    let headSd = length(vec2<f32>(headDist, perpDistLogical)) - halfThicknessLogical;
    sdPulse = min(sdPulse, headSd);
  }

  // Convert pulse SDF to physical pixels
  sdPulse = sdPulse * dpr;

  // Streamline capsule SDF: clips pulses to [0, totalLength] with rounded ends
  var streamlineSd: f32;
  if (arcLength < 0.0) {
    // Before start: circular cap at arcLength=0
    streamlineSd = length(vec2<f32>(-arcLength, perpDistLogical)) - halfThicknessLogical;
  } else if (arcLength > input.totalLength) {
    // Past end: circular cap at arcLength=totalLength
    streamlineSd = length(vec2<f32>(arcLength - input.totalLength, perpDistLogical)) - halfThicknessLogical;
  } else {
    // On streamline: perpendicular distance only
    streamlineSd = perpDistLogical - halfThicknessLogical;
  }
  streamlineSd = streamlineSd * dpr; // Convert to physical pixels

  // Intersect pulse SDF with streamline capsule
  let sd = max(sdPulse, streamlineSd);

  // Anti-aliased alpha from signed distance
  let aaWidth = 0.75 * dpr;
  let alpha = 1.0 - smoothstep(-aaWidth, aaWidth, sd);

  // Linear alpha interpolation along pulse (0.0 at tail/bodyStart, 1.0 at head/bodyEnd)
  // When binaryPulse=1.0, use solid pulses instead of gradient
  let normalizedPos = saturate((arcLength - pulseInfo.bodyStart) / uniforms.pulseWidth);
  let pulseAlpha = mix(normalizedPos, 1.0, uniforms.binaryPulse);

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
