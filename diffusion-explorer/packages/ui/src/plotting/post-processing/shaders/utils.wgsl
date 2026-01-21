/**
 * Shared utilities for post-processing shaders.
 *
 * Provides:
 * - Fullscreen quad vertex shader
 * - Common utility functions (luminance, etc.)
 */

// ============================================================================
// Fullscreen Quad Vertex Shader
// ============================================================================

/**
 * Vertex output for fullscreen quad.
 * Maps position to clip space and provides UV coordinates.
 */
struct FullscreenVertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

/**
 * Fullscreen quad vertex positions.
 * Two triangles covering the entire viewport:
 *   0--2/3
 *   |  / |
 *   | /  |
 *  1/4--5
 */
const FULLSCREEN_QUAD_POSITIONS = array<vec2<f32>, 6>(
  vec2<f32>(-1.0,  1.0),  // 0: top-left
  vec2<f32>(-1.0, -1.0),  // 1: bottom-left
  vec2<f32>( 1.0,  1.0),  // 2: top-right
  vec2<f32>( 1.0,  1.0),  // 3: top-right (shared with 2)
  vec2<f32>(-1.0, -1.0),  // 4: bottom-left (shared with 1)
  vec2<f32>( 1.0, -1.0),  // 5: bottom-right
);

/**
 * Corresponding UV coordinates for fullscreen quad.
 * (0,0) at top-left, (1,1) at bottom-right (standard texture coordinates).
 */
const FULLSCREEN_QUAD_UVS = array<vec2<f32>, 6>(
  vec2<f32>(0.0, 0.0),  // 0: top-left
  vec2<f32>(0.0, 1.0),  // 1: bottom-left
  vec2<f32>(1.0, 0.0),  // 2: top-right
  vec2<f32>(1.0, 0.0),  // 3: top-right
  vec2<f32>(0.0, 1.0),  // 4: bottom-left
  vec2<f32>(1.0, 1.0),  // 5: bottom-right
);

/**
 * Fullscreen quad vertex shader.
 * Generates position and UV from vertex index alone.
 */
@vertex
fn vs_fullscreen(@builtin(vertex_index) vertexIndex: u32) -> FullscreenVertexOutput {
  var output: FullscreenVertexOutput;
  output.position = vec4<f32>(FULLSCREEN_QUAD_POSITIONS[vertexIndex], 0.0, 1.0);
  output.uv = FULLSCREEN_QUAD_UVS[vertexIndex];
  return output;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Calculate relative luminance of an RGB color.
 * Uses Rec. 709 coefficients (sRGB standard).
 * @param rgb - RGB color (0-1 range)
 * @returns Luminance value (0-1)
 */
fn luminance(rgb: vec3<f32>) -> f32 {
  return dot(rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
}

/**
 * Linear interpolation with clamped t.
 */
fn lerp(a: f32, b: f32, t: f32) -> f32 {
  return a + saturate(t) * (b - a);
}

/**
 * Smooth Hermite interpolation (same as GLSL smoothstep).
 */
fn smootherstep(edge0: f32, edge1: f32, x: f32) -> f32 {
  let t = saturate((x - edge0) / (edge1 - edge0));
  return t * t * (3.0 - 2.0 * t);
}
