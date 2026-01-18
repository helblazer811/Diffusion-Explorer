// Integration methods for streamline computation
// Requires: uniforms.stepSize, uniforms.useEuler, getDirection(px, py)

// Euler integration step (1st order)
fn eulerStep(pos: vec2<f32>, direction: f32) -> vec2<f32> {
  let h = uniforms.stepSize * direction;
  let dir = getDirection(pos.x, pos.y);
  return pos + h * dir;
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

// Dispatcher: select integration method based on uniform flag
fn integrationStep(pos: vec2<f32>, direction: f32) -> vec2<f32> {
  if (uniforms.useEuler != 0u) {
    return eulerStep(pos, direction);
  }
  return rk4Step(pos, direction);
}
