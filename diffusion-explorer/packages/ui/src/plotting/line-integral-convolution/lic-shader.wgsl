// Line Integral Convolution (LIC) Compute Shader
// Implements streamline-based texture convolution for vector field visualization

struct Uniforms {
  width: u32,
  height: u32,
  integrationSteps: u32,
  stepSize: f32,
  xMin: f32,
  xMax: f32,
  yMin: f32,
  yMax: f32,
  contrast: f32,
  _padding1: f32,  // Padding for 16-byte alignment
  _padding2: f32,
  _padding3: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> vectorField: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> noise: array<f32>;
@group(0) @binding(3) var<storage, read_write> output: array<f32>;
@group(0) @binding(4) var<storage, read_write> magnitudeOut: array<f32>;

// Bilinear interpolation to sample from pre-computed vector field buffer
fn sampleVelocity(px: f32, py: f32) -> vec2<f32> {
  let w = f32(uniforms.width);
  let h = f32(uniforms.height);

  // Clamp to valid pixel coordinates
  let x = clamp(px, 0.0, w - 1.001);
  let y = clamp(py, 0.0, h - 1.001);

  // Get integer coordinates and fractional parts
  let x0 = u32(floor(x));
  let y0 = u32(floor(y));
  let x1 = min(x0 + 1u, uniforms.width - 1u);
  let y1 = min(y0 + 1u, uniforms.height - 1u);

  let fx = x - floor(x);
  let fy = y - floor(y);

  // Sample four corners
  let v00 = vectorField[y0 * uniforms.width + x0];
  let v10 = vectorField[y0 * uniforms.width + x1];
  let v01 = vectorField[y1 * uniforms.width + x0];
  let v11 = vectorField[y1 * uniforms.width + x1];

  // Bilinear interpolation
  let v0 = mix(v00, v10, fx);
  let v1 = mix(v01, v11, fx);
  return mix(v0, v1, fy);
}

// Nearest-neighbor sampling for noise (preserves sharp edges)
fn sampleNoise(px: f32, py: f32) -> f32 {
  let w = f32(uniforms.width);
  let h = f32(uniforms.height);

  let x = clamp(round(px), 0.0, w - 1.0);
  let y = clamp(round(py), 0.0, h - 1.0);

  return noise[u32(y) * uniforms.width + u32(x)];
}

// Check if position is within bounds (with small margin)
fn isInBounds(px: f32, py: f32) -> bool {
  let margin = 0.5;
  return px >= margin && px < f32(uniforms.width) - margin &&
         py >= margin && py < f32(uniforms.height) - margin;
}

// Get normalized velocity direction at pixel position
fn getDirection(px: f32, py: f32) -> vec2<f32> {
  let v = sampleVelocity(px, py);
  let mag = length(v);
  if (mag < 1e-8) {
    return vec2<f32>(0.0, 0.0);
  }
  return v / mag;
}

// 4th-order Runge-Kutta integration step
fn rk4Step(pos: vec2<f32>, direction: f32) -> vec2<f32> {
  let h = uniforms.stepSize * direction;

  // RK4 stages
  let k1 = getDirection(pos.x, pos.y);
  let k2 = getDirection(pos.x + 0.5 * h * k1.x, pos.y + 0.5 * h * k1.y);
  let k3 = getDirection(pos.x + 0.5 * h * k2.x, pos.y + 0.5 * h * k2.y);
  let k4 = getDirection(pos.x + h * k3.x, pos.y + h * k3.y);

  // Weighted sum
  return pos + (h / 6.0) * (k1 + 2.0 * k2 + 2.0 * k3 + k4);
}

// Hann window function for smooth kernel weighting
fn hannWindow(t: f32) -> f32 {
  // t should be in [0, 1], representing position along the streamline
  return 0.5 * (1.0 - cos(3.14159265359 * 2.0 * t));
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
  let startPos = vec2<f32>(f32(x) + 0.5, f32(y) + 0.5);

  var sum = 0.0;
  var weightSum = 0.0;
  let totalSteps = f32(uniforms.integrationSteps * 2u);

  // Integrate forward along streamline
  var pos = startPos;
  for (var i = 0u; i < uniforms.integrationSteps; i++) {
    if (!isInBounds(pos.x, pos.y)) {
      break;
    }

    // Hann window weight based on position along streamline
    let t = (f32(i) + f32(uniforms.integrationSteps)) / totalSteps;
    let weight = hannWindow(t);

    sum += sampleNoise(pos.x, pos.y) * weight;
    weightSum += weight;

    pos = rk4Step(pos, 1.0); // Forward direction
  }

  // Integrate backward along streamline
  pos = startPos;
  for (var i = 0u; i < uniforms.integrationSteps; i++) {
    if (!isInBounds(pos.x, pos.y)) {
      break;
    }

    // Hann window weight based on position along streamline
    let t = (f32(uniforms.integrationSteps) - f32(i) - 1.0) / totalSteps;
    let weight = hannWindow(t);

    // Skip center pixel (already counted in forward pass at i=0)
    if (i > 0u) {
      sum += sampleNoise(pos.x, pos.y) * weight;
      weightSum += weight;
    }

    pos = rk4Step(pos, -1.0); // Backward direction
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
