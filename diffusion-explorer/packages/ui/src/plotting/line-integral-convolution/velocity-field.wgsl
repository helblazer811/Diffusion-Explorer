// Velocity field sampling and utility functions shared between LIC and DLIC shaders
// These functions depend on uniforms.width, uniforms.height, uniforms.velocityWidth,
// uniforms.velocityHeight, uniforms.nearestNeighborVelocity, and the vectorField/noise buffers

// Map output pixel coordinates to velocity grid coordinates
fn toVelocityCoords(px: f32, py: f32) -> vec2<f32> {
  let scaleX = f32(uniforms.velocityWidth) / f32(uniforms.width);
  let scaleY = f32(uniforms.velocityHeight) / f32(uniforms.height);
  return vec2<f32>(px * scaleX, py * scaleY);
}

// Nearest neighbor sampling for velocity field
fn sampleVelocityNearest(px: f32, py: f32) -> vec2<f32> {
  let vc = toVelocityCoords(px, py);
  let vw = f32(uniforms.velocityWidth);
  let vh = f32(uniforms.velocityHeight);

  let x = clamp(round(vc.x), 0.0, vw - 1.0);
  let y = clamp(round(vc.y), 0.0, vh - 1.0);

  return vectorField[u32(y) * uniforms.velocityWidth + u32(x)];
}

// Bilinear interpolation to sample from pre-computed vector field buffer
fn sampleVelocityBilinear(px: f32, py: f32) -> vec2<f32> {
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

  // Sample four corners
  let v00 = vectorField[y0 * uniforms.velocityWidth + x0];
  let v10 = vectorField[y0 * uniforms.velocityWidth + x1];
  let v01 = vectorField[y1 * uniforms.velocityWidth + x0];
  let v11 = vectorField[y1 * uniforms.velocityWidth + x1];

  // Bilinear interpolation
  let v0 = mix(v00, v10, fx);
  let v1 = mix(v01, v11, fx);
  return mix(v0, v1, fy);
}

// Sample velocity using configured interpolation method
fn sampleVelocity(px: f32, py: f32) -> vec2<f32> {
  if (uniforms.nearestNeighborVelocity != 0u) {
    return sampleVelocityNearest(px, py);
  }
  return sampleVelocityBilinear(px, py);
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
