// Dynamic Line Integral Convolution (DLIC) Compute Shader
// Extends LIC with phase-based noise advection for animated visualization

struct Uniforms {
  width: u32,
  height: u32,
  maxIterations: u32,            // Safety limit
  stepSize: f32,
  xMin: f32,
  xMax: f32,
  yMin: f32,
  yMax: f32,
  contrast: f32,
  nearestNeighborVelocity: u32,  // 0 = bilinear, 1 = nearest neighbor
  maxArcLength: f32,             // Fixed window in pixels
  useEuler: u32,                 // 0 = RK4, 1 = Euler
  velocityWidth: u32,            // Velocity grid width
  velocityHeight: u32,           // Velocity grid height
  phase: f32,                    // Animation phase (0-1)
  wavelength: f32,               // Pixels to advect per cycle
  numTimeSlices: u32,            // Number of time slices (1 for static fields)
  currentTimeSlice: u32,         // Current time slice index for this frame
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> vectorField: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> noise: array<f32>;
@group(0) @binding(3) var<storage, read_write> output: array<f32>;
@group(0) @binding(4) var<storage, read_write> magnitudeOut: array<f32>;

// Velocity field functions are defined in velocity-field.wgsl and concatenated at build time

// Integration functions are defined in integration.wgsl and concatenated at build time

// ============================================================================
// DLIC-specific time-aware functions (use currentTimeSlice from uniforms)
// These override the shared functions for time-varying vector field support
// ============================================================================

// Get normalized velocity direction at pixel position using current time slice
fn getDirectionAtCurrentTime(px: f32, py: f32) -> vec2<f32> {
  let v = sampleVelocityAtTime(px, py, uniforms.currentTimeSlice);
  let mag = length(v);
  if (mag < 1e-8) {
    return vec2<f32>(0.0, 0.0);
  }
  return v / mag;
}

// Euler integration step using current time slice
fn eulerStepAtCurrentTime(pos: vec2<f32>, direction: f32) -> vec2<f32> {
  let h = uniforms.stepSize * direction;
  let dir = getDirectionAtCurrentTime(pos.x, pos.y);
  return pos + h * dir;
}

// 4th-order Runge-Kutta integration step using current time slice
fn rk4StepAtCurrentTime(pos: vec2<f32>, direction: f32) -> vec2<f32> {
  let h = uniforms.stepSize * direction;

  // RK4 stages
  let k1 = getDirectionAtCurrentTime(pos.x, pos.y);
  let k2 = getDirectionAtCurrentTime(pos.x + 0.5 * h * k1.x, pos.y + 0.5 * h * k1.y);
  let k3 = getDirectionAtCurrentTime(pos.x + 0.5 * h * k2.x, pos.y + 0.5 * h * k2.y);
  let k4 = getDirectionAtCurrentTime(pos.x + h * k3.x, pos.y + h * k3.y);

  // Weighted sum
  return pos + (h / 6.0) * (k1 + 2.0 * k2 + 2.0 * k3 + k4);
}

// Integration step dispatcher using current time slice
fn integrationStepAtCurrentTime(pos: vec2<f32>, direction: f32) -> vec2<f32> {
  if (uniforms.useEuler != 0u) {
    return eulerStepAtCurrentTime(pos, direction);
  }
  return rk4StepAtCurrentTime(pos, direction);
}

// ============================================================================

// Advect position backward to find where noise should be sampled from
// This creates the flowing effect by shifting the noise origin
// Uses current time slice for time-varying vector field support
fn advectNoisePosition(startPos: vec2<f32>) -> vec2<f32> {
  let advectDist = uniforms.phase * uniforms.wavelength;
  var pos = startPos;
  var distTraveled = 0.0;
  var i = 0u;

  // Backward integration to find where noise "came from"
  while (distTraveled < advectDist && i < uniforms.maxIterations && isInBounds(pos.x, pos.y)) {
    let prevPos = pos;
    pos = integrationStepAtCurrentTime(pos, -1.0);  // Backward direction, current time slice
    distTraveled += length(pos - prevPos);
    i += 1u;
  }

  return pos;
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

  // DLIC: Advect starting position for noise sampling based on phase
  let advectedPos = advectNoisePosition(startPos);

  var sum = 0.0;
  var weightSum = 0.0;

  // Gaussian decay parameter (controls sharpness, higher = tighter)
  let alpha = 9.0;

  // Forward integration from advected position
  var pos = advectedPos;
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
    pos = integrationStepAtCurrentTime(pos, 1.0);  // Forward direction, current time slice
    arcLength += length(pos - prevPos);
    i += 1u;
  }

  // Backward integration from advected position
  pos = advectedPos;
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
    pos = integrationStepAtCurrentTime(pos, -1.0);  // Backward direction, current time slice
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

  // Store magnitude at original pixel position (not advected), using current time slice
  let velocity = sampleVelocityAtTime(startPos.x, startPos.y, uniforms.currentTimeSlice);
  magnitudeOut[pixelIndex] = length(velocity);
}
