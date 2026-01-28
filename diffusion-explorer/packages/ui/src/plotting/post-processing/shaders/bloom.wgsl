/**
 * Bloom Post-Processing Shader
 *
 * Contains all passes for bloom effect:
 * - fs_threshold: Extract bright pixels above luminance threshold
 * - fs_blur: Separable Gaussian blur (direction via uniform)
 * - fs_composite: Additive blend of original + blurred glow
 *
 * All passes use the shared fullscreen quad vertex shader from utils.wgsl.
 */

// ============================================================================
// Shared Structures and Bindings
// ============================================================================

/**
 * Vertex output from fullscreen quad.
 */
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

/**
 * Fullscreen quad vertex positions and UVs.
 */
const QUAD_POSITIONS = array<vec2<f32>, 6>(
  vec2<f32>(-1.0,  1.0),
  vec2<f32>(-1.0, -1.0),
  vec2<f32>( 1.0,  1.0),
  vec2<f32>( 1.0,  1.0),
  vec2<f32>(-1.0, -1.0),
  vec2<f32>( 1.0, -1.0),
);

const QUAD_UVS = array<vec2<f32>, 6>(
  vec2<f32>(0.0, 0.0),
  vec2<f32>(0.0, 1.0),
  vec2<f32>(1.0, 0.0),
  vec2<f32>(1.0, 0.0),
  vec2<f32>(0.0, 1.0),
  vec2<f32>(1.0, 1.0),
);

@vertex
fn vs_fullscreen(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var output: VertexOutput;
  output.position = vec4<f32>(QUAD_POSITIONS[vertexIndex], 0.0, 1.0);
  output.uv = QUAD_UVS[vertexIndex];
  return output;
}

/**
 * Calculate relative luminance of an RGB color.
 */
fn luminance(rgb: vec3<f32>) -> f32 {
  return dot(rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
}

// ============================================================================
// Threshold Pass
// ============================================================================

/**
 * Uniforms for threshold pass.
 */
struct ThresholdUniforms {
  threshold: f32,     // Luminance threshold (0-1)
  softKnee: f32,      // Soft threshold transition (0-1)
  _padding0: f32,
  _padding1: f32,
}

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var<uniform> thresholdUniforms: ThresholdUniforms;

/**
 * Extract pixels above brightness threshold with soft knee.
 * Outputs only the bright portions that will contribute to bloom.
 */
@fragment
fn fs_threshold(input: VertexOutput) -> @location(0) vec4<f32> {
  let color = textureSample(sourceTexture, sourceSampler, input.uv);

  // Factor in alpha - only opaque bright pixels should bloom
  // This prevents semi-transparent pixels from creating gray halos
  let lum = luminance(color.rgb) * color.a;

  // Soft threshold with knee
  let threshold = thresholdUniforms.threshold;
  let knee = thresholdUniforms.softKnee * threshold;
  let soft = lum - threshold + knee;
  let contribution = clamp(soft / (2.0 * knee + 0.00001), 0.0, 1.0);

  // Use contribution as a mask - preserve original color saturation
  // This keeps the bloom the same hue as the source
  return vec4<f32>(color.rgb * contribution, color.a * contribution);
}

// ============================================================================
// Blur Pass
// ============================================================================

/**
 * Uniforms for blur pass.
 */
struct BlurUniforms {
  direction: vec2<f32>,  // Blur direction (1,0) for horizontal, (0,1) for vertical
  texelSize: vec2<f32>,  // 1.0 / textureSize
  radius: f32,           // Blur radius in pixels
  _padding0: f32,
  _padding1: f32,
  _padding2: f32,
}

@group(0) @binding(3) var<uniform> blurUniforms: BlurUniforms;

/**
 * 9-tap Gaussian blur weights.
 * Pre-computed for sigma = 3.0
 */
const BLUR_WEIGHTS = array<f32, 5>(
  0.227027027,  // Center
  0.194594595,  // +/- 1
  0.121621622,  // +/- 2
  0.054054054,  // +/- 3
  0.016216216,  // +/- 4
);

/**
 * Separable Gaussian blur.
 * Apply twice (horizontal then vertical) for full 2D blur.
 */
@fragment
fn fs_blur(input: VertexOutput) -> @location(0) vec4<f32> {
  // Divide radius by 4 to get proper sample spacing for smooth blur
  // Without this, samples are too far apart causing banding artifacts
  let baseOffset = blurUniforms.texelSize * blurUniforms.direction * (blurUniforms.radius / 4.0);

  // Center sample
  var result = textureSample(sourceTexture, sourceSampler, input.uv) * BLUR_WEIGHTS[0];

  // Symmetric samples
  for (var i = 1u; i < 5u; i++) {
    let offset = baseOffset * f32(i);
    let weight = BLUR_WEIGHTS[i];

    result += textureSample(sourceTexture, sourceSampler, input.uv + offset) * weight;
    result += textureSample(sourceTexture, sourceSampler, input.uv - offset) * weight;
  }

  return result;
}

// ============================================================================
// Composite Pass
// ============================================================================

/**
 * Uniforms for composite pass.
 */
struct CompositeUniforms {
  intensity: f32,   // Bloom intensity multiplier
  _padding0: f32,
  _padding1: f32,
  _padding2: f32,
}

@group(0) @binding(4) var bloomTexture: texture_2d<f32>;
@group(0) @binding(5) var bloomSampler: sampler;
@group(0) @binding(6) var<uniform> compositeUniforms: CompositeUniforms;

/**
 * Composite original image with bloom.
 * Additive blending of original + (bloom * intensity).
 */
@fragment
fn fs_composite(input: VertexOutput) -> @location(0) vec4<f32> {
  let original = textureSample(sourceTexture, sourceSampler, input.uv);
  let bloom = textureSample(bloomTexture, bloomSampler, input.uv);

  // Additive blend with intensity control
  let intensity = compositeUniforms.intensity;
  var result = original.rgb + bloom.rgb * intensity;

  // Preserve original alpha, add bloom alpha contribution
  let alpha = max(original.a, bloom.a * intensity);

  return vec4<f32>(result, alpha);
}
