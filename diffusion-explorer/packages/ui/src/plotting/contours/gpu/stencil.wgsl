/**
 * Stencil-based contour fill rendering shader.
 *
 * Renders filled contours using a scanline approach:
 * - Each segment forms a quad from the segment down to y=0
 * - Quads are rendered to a stencil buffer with XOR mode
 * - The XOR creates correct inside/outside regions for any contour shape
 * - A full-screen quad then fills the stencil region with color
 *
 * This shader has three passes:
 * 1. vs_stencil/fs_stencil: Render quads to stencil buffer (XOR mode)
 * 2. vs_fill/fs_fill: Render full-screen quad with color (stencil test)
 * 3. vs_blit/fs_blit: Copy cached texture to canvas
 */

struct RenderUniforms {
  width: f32,
  height: f32,
  dpr: f32,
  numLevels: f32,
  currentLevel: f32,
  xMin: f32,
  xMax: f32,
  yMin: f32,
  yMax: f32,
  opacity: f32,
  colorR: f32,
  colorG: f32,
  colorB: f32,
  colorA: f32,
  centerX: f32,
  centerY: f32,
}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: RenderUniforms;
@group(0) @binding(1) var<storage, read> segments: array<f32>;

/**
 * Convert normalized coordinates [0,1] to clip space [-1,1].
 * Y is flipped for correct canvas orientation.
 */
fn toClipSpace(pos: vec2<f32>) -> vec4<f32> {
  let x = pos.x * 2.0 - 1.0;
  let y = 1.0 - pos.y * 2.0;  // Flip Y
  return vec4<f32>(x, y, 0.0, 1.0);
}

// ============================================================================
// Stencil Pass: Render quads from each segment down to y=0
// ============================================================================

/**
 * Vertex shader for stencil pass.
 * Creates a quad from each segment extending down to y=0.
 * This implements the scanline fill algorithm on GPU.
 *
 * Each instance is a segment. Each instance has 6 vertices (2 triangles):
 * Triangle 1: p0, p1, p0_bottom
 * Triangle 2: p1, p1_bottom, p0_bottom
 *
 * Where p0_bottom = (p0.x, 0) and p1_bottom = (p1.x, 0)
 */
@vertex
fn vs_stencil(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
  var output: VertexOutput;

  // Read segment data
  let baseIdx = instanceIndex * 8u;
  let valid = segments[baseIdx + 6u];

  // If invalid, place vertex off-screen
  if (valid < 0.5) {
    output.position = vec4<f32>(-10.0, -10.0, 0.0, 1.0);
    return output;
  }

  // Check if this segment belongs to the current level
  let segmentLevel = segments[baseIdx + 5u];
  if (abs(segmentLevel - uniforms.currentLevel) > 0.5) {
    output.position = vec4<f32>(-10.0, -10.0, 0.0, 1.0);
    return output;
  }

  let p0 = vec2<f32>(segments[baseIdx + 0u], segments[baseIdx + 1u]);
  let p1 = vec2<f32>(segments[baseIdx + 2u], segments[baseIdx + 3u]);

  // Bottom points (extend down to y=0)
  let p0_bottom = vec2<f32>(p0.x, 0.0);
  let p1_bottom = vec2<f32>(p1.x, 0.0);

  // Select vertex based on index (two triangles forming a quad)
  var pos: vec2<f32>;
  switch (vertexIndex % 6u) {
    // Triangle 1: p0 -> p1 -> p0_bottom
    case 0u: { pos = p0; }
    case 1u: { pos = p1; }
    case 2u: { pos = p0_bottom; }
    // Triangle 2: p1 -> p1_bottom -> p0_bottom
    case 3u: { pos = p1; }
    case 4u: { pos = p1_bottom; }
    case 5u: { pos = p0_bottom; }
    default: { pos = p0; }
  }

  output.position = toClipSpace(pos);
  return output;
}

/**
 * Fragment shader for stencil pass.
 * Simply outputs a constant value - the stencil op does the work.
 */
@fragment
fn fs_stencil() -> @location(0) vec4<f32> {
  // The stencil operation (XOR/invert) handles the filling
  // We just need to output something to trigger the stencil write
  return vec4<f32>(1.0, 1.0, 1.0, 1.0);
}

// ============================================================================
// Fill Pass: Render full-screen quad with color, masked by stencil
// ============================================================================

/**
 * Vertex shader for fill pass.
 * Renders a full-screen triangle (using vertex_index trick).
 */
@vertex
fn vs_fill(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var output: VertexOutput;

  // Full-screen triangle covering entire viewport
  // Uses the oversized triangle technique
  var pos: vec2<f32>;
  switch (vertexIndex) {
    case 0u: { pos = vec2<f32>(-1.0, -1.0); }
    case 1u: { pos = vec2<f32>(3.0, -1.0); }
    case 2u: { pos = vec2<f32>(-1.0, 3.0); }
    default: { pos = vec2<f32>(0.0, 0.0); }
  }

  output.position = vec4<f32>(pos, 0.0, 1.0);
  return output;
}

/**
 * Fragment shader for fill pass.
 * Outputs the contour color (stencil test determines which pixels pass).
 */
@fragment
fn fs_fill() -> @location(0) vec4<f32> {
  let color = vec4<f32>(
    uniforms.colorR,
    uniforms.colorG,
    uniforms.colorB,
    uniforms.colorA * uniforms.opacity
  );
  return color;
}

// ============================================================================
// Blit Pass: Copy cached texture to canvas
// ============================================================================

struct BlitVertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn vs_blit(@builtin(vertex_index) vertexIndex: u32) -> BlitVertexOutput {
  var output: BlitVertexOutput;

  // Full-screen triangle
  var pos: vec2<f32>;
  var uv: vec2<f32>;
  switch (vertexIndex) {
    case 0u: {
      pos = vec2<f32>(-1.0, -1.0);
      uv = vec2<f32>(0.0, 1.0);
    }
    case 1u: {
      pos = vec2<f32>(3.0, -1.0);
      uv = vec2<f32>(2.0, 1.0);
    }
    case 2u: {
      pos = vec2<f32>(-1.0, 3.0);
      uv = vec2<f32>(0.0, -1.0);
    }
    default: {
      pos = vec2<f32>(0.0, 0.0);
      uv = vec2<f32>(0.0, 0.0);
    }
  }

  output.position = vec4<f32>(pos, 0.0, 1.0);
  output.uv = uv;
  return output;
}

@group(0) @binding(0) var blitTexture: texture_2d<f32>;
@group(0) @binding(1) var blitSampler: sampler;

@fragment
fn fs_blit(input: BlitVertexOutput) -> @location(0) vec4<f32> {
  return textureSample(blitTexture, blitSampler, input.uv);
}
