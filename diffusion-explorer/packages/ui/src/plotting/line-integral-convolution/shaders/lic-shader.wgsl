// Line Integral Convolution (LIC) Compute Shader
// Implements streamline-based texture convolution for vector field visualization

struct Uniforms {
  width: u32,
  height: u32,
  maxIterations: u32,            // Safety limit (was integrationSteps)
  stepSize: f32,
  xMin: f32,
  xMax: f32,
  yMin: f32,
  yMax: f32,
  contrast: f32,
  nearestNeighborVelocity: u32,  // 0 = bilinear, 1 = nearest neighbor
  maxArcLength: f32,             // Fixed window in pixels
  useEuler: u32,                 // 0 = RK4, 1 = Euler
  velocityWidth: u32,            // Velocity grid width (may differ from output)
  velocityHeight: u32,           // Velocity grid height
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> vectorField: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> noise: array<f32>;
@group(0) @binding(3) var<storage, read_write> output: array<f32>;
@group(0) @binding(4) var<storage, read_write> magnitudeOut: array<f32>;

// Velocity field functions are defined in velocity-field.wgsl and concatenated at build time

// Integration functions are defined in integration.wgsl and concatenated at build time

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let x = globalId.x;
  let y = globalId.y;

  // Early exit if outside image bounds
  if (x >= uniforms.width || y >= uniforms.height) {
    return;
  }

  let pixelIndex = y * uniforms.width + x;
  let startPos = vec2<f32>(f32(x) + 0.5, f32(y) + 0.5);

  var sum = 0.0;
  var weightSum = 0.0;

  // Gaussian decay parameter (controls sharpness, higher = tighter)
  let alpha = 9.0;

  // Forward integration with arc-length parameterization
  var pos = startPos;
  var arcLength = 0.0;
  var i = 0u;

  while (arcLength < uniforms.maxArcLength && i < uniforms.maxIterations) {
    if (!isInBounds(pos.x, pos.y)) {
      break;
    }

    // Gaussian weight: peaks at center, decays with arc length
    let t = arcLength / uniforms.maxArcLength;
    let w = exp(-alpha * t * t);
    sum += w * sampleNoise(pos.x, pos.y);
    weightSum += w;

    let prevPos = pos;
    pos = integrationStep(pos, 1.0);  // Forward direction
    arcLength += length(pos - prevPos);
    i += 1u;
  }

  // Backward integration with arc-length parameterization
  pos = startPos;
  arcLength = 0.0;
  i = 0u;

  while (arcLength < uniforms.maxArcLength && i < uniforms.maxIterations) {
    if (!isInBounds(pos.x, pos.y)) {
      break;
    }

    // Skip center pixel (already counted in forward pass at i=0)
    if (i > 0u) {
      // Gaussian weight: peaks at center, decays with arc length
      let t = arcLength / uniforms.maxArcLength;
      let w = exp(-alpha * t * t);
      sum += w * sampleNoise(pos.x, pos.y);
      weightSum += w;
    }

    let prevPos = pos;
    pos = integrationStep(pos, -1.0);  // Backward direction
    arcLength += length(pos - prevPos);
    i += 1u;
  }

  // Normalize and apply contrast
  var result = 0.5;
  if (weightSum > 0.0) {
    result = sum / weightSum;
    // Apply contrast enhancement around 0.5
    result = 0.5 + (result - 0.5) * uniforms.contrast;
    result = clamp(result, 0.0, 1.0);
  }

  output[pixelIndex] = result;

  // Store magnitude at this pixel (in pixel-space units)
  let velocity = sampleVelocity(startPos.x, startPos.y);
  magnitudeOut[pixelIndex] = length(velocity);
}
