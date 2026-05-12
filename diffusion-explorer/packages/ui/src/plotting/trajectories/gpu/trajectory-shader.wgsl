/**
 * GPU Trajectory Shader
 *
 * Renders trajectories with:
 * - Time-based z-ordering (more recent segments on top via depth buffer)
 * - Optional outline support (two-pass rendering)
 * - Per-segment alpha interpolation for opacity gradients
 * - SDF-based anti-aliased capsule rendering
 *
 * Each segment is defined by:
 * - p0, p1: Start and end points (logical pixels)
 * - alphaStart, alphaEnd: Alpha values at segment endpoints
 * - zValue: Depth value for z-ordering (higher = closer = on top)
 */

// ============================================================================
// Uniforms
// ============================================================================

struct Uniforms {
  // Canvas dimensions (physical pixels)
  width: f32,
  height: f32,
  // Device pixel ratio
  dpr: f32,
  // Padding for alignment
  _pad0: f32,

  // Main stroke style
  thickness: f32,
  colorR: f32,
  colorG: f32,
  colorB: f32,
  baseOpacity: f32,

  // Outline style
  outlineThickness: f32,
  outlineColorR: f32,
  outlineColorG: f32,
  outlineColorB: f32,
  outlineOpacity: f32,

  // Pass control: 0.0 = main stroke, 1.0 = outline
  isOutlinePass: f32,
  // Padding
  _pad1: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

// ============================================================================
// Segment Data (Storage Buffer)
// ============================================================================

// Each segment: 8 floats (32 bytes)
// [x0, y0, x1, y1, alphaStart, alphaEnd, zValue, _padding]
@group(0) @binding(1) var<storage, read> segments: array<f32>;

// ============================================================================
// Vertex Shader
// ============================================================================

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) localPos: vec2<f32>,      // Position relative to segment (for SDF)
  @location(1) segmentLength: f32,       // Length of this segment (physical pixels)
  @location(2) alphaStart: f32,          // Alpha at segment start
  @location(3) alphaEnd: f32,            // Alpha at segment end
}

// Quad vertices: 6 vertices per instance (2 triangles)
const QUAD_POSITIONS = array<vec2<f32>, 6>(
  vec2<f32>(0.0, 1.0),   // 0: start, +perpendicular
  vec2<f32>(1.0, 1.0),   // 1: end, +perpendicular
  vec2<f32>(0.0, -1.0),  // 2: start, -perpendicular
  vec2<f32>(1.0, 1.0),   // 1: end, +perpendicular (repeated)
  vec2<f32>(0.0, -1.0),  // 2: start, -perpendicular (repeated)
  vec2<f32>(1.0, -1.0),  // 3: end, -perpendicular
);

@vertex
fn vs_main(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
  var output: VertexOutput;

  // Read segment data (8 floats per segment)
  let baseIdx = instanceIndex * 8u;
  let p0_logical = vec2<f32>(segments[baseIdx], segments[baseIdx + 1u]);
  let p1_logical = vec2<f32>(segments[baseIdx + 2u], segments[baseIdx + 3u]);
  let alphaStart = segments[baseIdx + 4u];
  let alphaEnd = segments[baseIdx + 5u];
  let zValue = segments[baseIdx + 6u];

  // Scale to physical pixels
  let dpr = uniforms.dpr;
  let p0 = p0_logical * dpr;
  let p1 = p1_logical * dpr;

  // Compute segment direction and length
  let delta = p1 - p0;
  let segmentLength = length(delta);
  let dir = select(vec2<f32>(1.0, 0.0), delta / segmentLength, segmentLength > 0.001);
  let perp = vec2<f32>(-dir.y, dir.x);

  // Get quad position
  let quadPos = QUAD_POSITIONS[vertexIndex % 6u];

  // Select thickness based on pass
  let thickness = select(uniforms.thickness, uniforms.outlineThickness, uniforms.isOutlinePass > 0.5);
  let physicalThickness = thickness * dpr;
  let halfThickness = physicalThickness * 0.5;
  let margin = halfThickness + 2.0 * dpr; // Extra for AA

  // Expand quad along and perpendicular to segment
  let along = mix(-margin, segmentLength + margin, quadPos.x);
  let across = quadPos.y * margin;
  let worldPos = p0 + dir * along + perp * across;

  // Convert to NDC
  let ndcX = (worldPos.x / uniforms.width) * 2.0 - 1.0;
  let ndcY = 1.0 - (worldPos.y / uniforms.height) * 2.0;

  // Z-value: map [0, 1] to NDC z [1, 0] (1 = far, 0 = near)
  // Higher zValue = more recent = closer = smaller NDC z
  // Add small offset for outline pass to push it behind main stroke
  let outlineOffset = select(0.0, 0.001, uniforms.isOutlinePass > 0.5);
  let ndcZ = 1.0 - zValue + outlineOffset;

  output.position = vec4<f32>(ndcX, ndcY, ndcZ, 1.0);
  output.localPos = vec2<f32>(along, across);
  output.segmentLength = segmentLength;
  output.alphaStart = alphaStart;
  output.alphaEnd = alphaEnd;

  return output;
}

// ============================================================================
// Fragment Shader
// ============================================================================

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  let dpr = uniforms.dpr;

  // Select style based on pass
  let thickness = select(uniforms.thickness, uniforms.outlineThickness, uniforms.isOutlinePass > 0.5);
  let physicalThickness = thickness * dpr;
  let halfThickness = physicalThickness * 0.5;

  let colorR = select(uniforms.colorR, uniforms.outlineColorR, uniforms.isOutlinePass > 0.5);
  let colorG = select(uniforms.colorG, uniforms.outlineColorG, uniforms.isOutlinePass > 0.5);
  let colorB = select(uniforms.colorB, uniforms.outlineColorB, uniforms.isOutlinePass > 0.5);
  let baseOpacity = select(uniforms.baseOpacity, uniforms.outlineOpacity, uniforms.isOutlinePass > 0.5);

  // Compute SDF for capsule (line with rounded ends)
  let perpDist = abs(input.localPos.y);
  let alongPos = input.localPos.x;

  var sd: f32;
  if (alongPos < 0.0) {
    // Start cap (semicircle)
    sd = length(vec2<f32>(-alongPos, perpDist)) - halfThickness;
  } else if (alongPos > input.segmentLength) {
    // End cap (semicircle)
    sd = length(vec2<f32>(alongPos - input.segmentLength, perpDist)) - halfThickness;
  } else {
    // Body (rectangular)
    sd = perpDist - halfThickness;
  }

  // Anti-aliased alpha from signed distance.
  // aaWidth is half the smoothstep band, in physical pixels. Keep it small
  // (~0.5 physical px each side) so the soft edge doesn't dominate the
  // visual weight of thin strokes — Canvas2D's native AA spans roughly
  // 1 physical pixel total transition, and we want to match that.
  let aaWidth = 0.5;
  let shapeAlpha = 1.0 - smoothstep(-aaWidth, aaWidth, sd);

  // Interpolate segment alpha based on position along segment
  let t = saturate(alongPos / max(input.segmentLength, 0.001));
  let segmentAlpha = mix(input.alphaStart, input.alphaEnd, t);

  // Final alpha
  let finalAlpha = shapeAlpha * segmentAlpha * baseOpacity;

  // Early discard for transparent pixels
  if (finalAlpha < 0.001) {
    discard;
  }

  // Output premultiplied alpha — the canvas context is configured with
  // `alphaMode: 'premultiplied'`, so straight RGBA would be interpreted as
  // already-multiplied and the compositor would divide RGB by alpha when
  // displaying, brightening the color (e.g. orange #f17720 at 0.85 alpha
  // would display as #ff8c26 instead of staying #f17720).
  return vec4<f32>(colorR * finalAlpha, colorG * finalAlpha, colorB * finalAlpha, finalAlpha);
}

// ============================================================================
// Head Marker Vertex Shader
// ============================================================================

// Head data: [x, y, zValue, alpha] per marker
@group(0) @binding(2) var<storage, read> heads: array<f32>;

struct HeadVertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) localPos: vec2<f32>,  // Position relative to center (for SDF)
  @location(1) alpha: f32,           // Alpha value
}

@vertex
fn vs_head(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> HeadVertexOutput {
  var output: HeadVertexOutput;

  // Read head data (4 floats per head)
  let baseIdx = instanceIndex * 4u;
  let center_logical = vec2<f32>(heads[baseIdx], heads[baseIdx + 1u]);
  let zValue = heads[baseIdx + 2u];
  let alpha = heads[baseIdx + 3u];

  // Scale to physical pixels
  let dpr = uniforms.dpr;
  let center = center_logical * dpr;

  // Get quad position
  let quadPos = QUAD_POSITIONS[vertexIndex % 6u];

  // Select radius based on pass (use thickness as radius for head markers)
  let thickness = select(uniforms.thickness, uniforms.outlineThickness, uniforms.isOutlinePass > 0.5);
  let radius = thickness * dpr * 0.5; // Half thickness = radius
  let margin = radius + 2.0 * dpr; // Extra for AA

  // Expand quad around center
  let worldPos = center + vec2<f32>(quadPos.x * 2.0 - 1.0, quadPos.y) * margin;

  // Convert to NDC
  let ndcX = (worldPos.x / uniforms.width) * 2.0 - 1.0;
  let ndcY = 1.0 - (worldPos.y / uniforms.height) * 2.0;
  let ndcZ = 1.0 - zValue;

  output.position = vec4<f32>(ndcX, ndcY, ndcZ, 1.0);
  output.localPos = vec2<f32>(quadPos.x * 2.0 - 1.0, quadPos.y) * margin;
  output.alpha = alpha;

  return output;
}

@fragment
fn fs_head(input: HeadVertexOutput) -> @location(0) vec4<f32> {
  let dpr = uniforms.dpr;

  // Select style based on pass
  let thickness = select(uniforms.thickness, uniforms.outlineThickness, uniforms.isOutlinePass > 0.5);
  let radius = thickness * dpr * 0.5;

  let colorR = select(uniforms.colorR, uniforms.outlineColorR, uniforms.isOutlinePass > 0.5);
  let colorG = select(uniforms.colorG, uniforms.outlineColorG, uniforms.isOutlinePass > 0.5);
  let colorB = select(uniforms.colorB, uniforms.outlineColorB, uniforms.isOutlinePass > 0.5);
  let baseOpacity = select(uniforms.baseOpacity, uniforms.outlineOpacity, uniforms.isOutlinePass > 0.5);

  // SDF for circle
  let dist = length(input.localPos);
  let sd = dist - radius;

  // Anti-aliased alpha. Match the stroke shader's aaWidth so head dots and
  // strokes share the same edge softness instead of looking smudged.
  let aaWidth = 0.5;
  let shapeAlpha = 1.0 - smoothstep(-aaWidth, aaWidth, sd);

  let finalAlpha = shapeAlpha * input.alpha * baseOpacity;

  if (finalAlpha < 0.001) {
    discard;
  }

  // Premultiplied output — see the stroke fragment shader for why.
  return vec4<f32>(colorR * finalAlpha, colorG * finalAlpha, colorB * finalAlpha, finalAlpha);
}
