// Time-varying velocity field sampling for time-dependent DLIC
// Extends velocity-field.wgsl with temporal interpolation between time slices
//
// The vectorField buffer is organized as a 3D array flattened to 1D:
// vectorField[t * velocityWidth * velocityHeight + y * velocityWidth + x]
//
// When timeSlices == 1, this behaves identically to the original velocity-field.wgsl

// Map output pixel coordinates to velocity grid coordinates
fn toVelocityCoords(px: f32, py: f32) -> vec2<f32> {
  let scaleX = f32(uniforms.velocityWidth) / f32(uniforms.width);
  let scaleY = f32(uniforms.velocityHeight) / f32(uniforms.height);
  return vec2<f32>(px * scaleX, py * scaleY);
}

// Get the flat index for a given (x, y, t) position in the 3D velocity buffer
fn getVelocityIndex(x: u32, y: u32, t: u32) -> u32 {
  let sliceSize = uniforms.velocityWidth * uniforms.velocityHeight;
  return t * sliceSize + y * uniforms.velocityWidth + x;
}

// Sample velocity at a specific time slice using nearest neighbor
fn sampleVelocityNearestAtTime(px: f32, py: f32, timeSlice: u32) -> vec2<f32> {
  let vc = toVelocityCoords(px, py);
  let vw = f32(uniforms.velocityWidth);
  let vh = f32(uniforms.velocityHeight);

  let x = u32(clamp(round(vc.x), 0.0, vw - 1.0));
  let y = u32(clamp(round(vc.y), 0.0, vh - 1.0));

  return vectorField[getVelocityIndex(x, y, timeSlice)];
}

// Sample velocity at a specific time slice using bilinear interpolation
fn sampleVelocityBilinearAtTime(px: f32, py: f32, timeSlice: u32) -> vec2<f32> {
  let vc = toVelocityCoords(px, py);
  let vw = f32(uniforms.velocityWidth);
  let vh = f32(uniforms.velocityHeight);

  // Clamp to valid velocity grid coordinates
  let x = clamp(vc.x, 0.0, vw - 1.001);
  let y = clamp(vc.y, 0.0, vh - 1.001);

  // Get integer coordinates and fractional parts
  let x0 = u32(floor(x));
  let y0 = u32(floor(y));
  let x1 = min(x0 + 1u, uniforms.velocityWidth - 1u);
  let y1 = min(y0 + 1u, uniforms.velocityHeight - 1u);

  let fx = x - floor(x);
  let fy = y - floor(y);

  // Sample four corners at the given time slice
  let v00 = vectorField[getVelocityIndex(x0, y0, timeSlice)];
  let v10 = vectorField[getVelocityIndex(x1, y0, timeSlice)];
  let v01 = vectorField[getVelocityIndex(x0, y1, timeSlice)];
  let v11 = vectorField[getVelocityIndex(x1, y1, timeSlice)];

  // Bilinear interpolation
  let v0 = mix(v00, v10, fx);
  let v1 = mix(v01, v11, fx);
  return mix(v0, v1, fy);
}

// Sample velocity with temporal interpolation between time slices
fn sampleVelocity(px: f32, py: f32) -> vec2<f32> {
  // Handle single time slice (legacy behavior)
  if (uniforms.timeSlices <= 1u) {
    if (uniforms.nearestNeighborVelocity != 0u) {
      return sampleVelocityNearestAtTime(px, py, 0u);
    }
    return sampleVelocityBilinearAtTime(px, py, 0u);
  }

  // Map time [0, 1] to time slice indices
  let maxSlice = f32(uniforms.timeSlices - 1u);
  let t = clamp(uniforms.time, 0.0, 1.0) * maxSlice;

  let t0 = u32(floor(t));
  let t1 = min(t0 + 1u, uniforms.timeSlices - 1u);
  let ft = t - floor(t);  // Fractional part for interpolation

  // Sample at both time slices
  var v0: vec2<f32>;
  var v1: vec2<f32>;

  if (uniforms.nearestNeighborVelocity != 0u) {
    v0 = sampleVelocityNearestAtTime(px, py, t0);
    v1 = sampleVelocityNearestAtTime(px, py, t1);
  } else {
    v0 = sampleVelocityBilinearAtTime(px, py, t0);
    v1 = sampleVelocityBilinearAtTime(px, py, t1);
  }

  // Linear interpolation between time slices
  return mix(v0, v1, ft);
}

// Nearest-neighbor sampling for noise (truly discrete)
fn sampleNoise(px: f32, py: f32) -> f32 {
  let x = u32(clamp(floor(px), 0.0, f32(uniforms.width) - 1.0));
  let y = u32(clamp(floor(py), 0.0, f32(uniforms.height) - 1.0));
  return noise[y * uniforms.width + x];
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
