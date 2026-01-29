/**
 * Signed Distance Functions (SDF) Utilities
 *
 * Convention: sd* functions return signed distance (negative inside, positive outside)
 *
 * These functions are shared between streamlines, pulsing paths, and other renderers.
 */

/**
 * SDF for a circle centered at origin.
 * @param p - Point to measure from
 * @param r - Circle radius
 * @returns Signed distance (negative inside, positive outside)
 */
fn sdCircle(p: vec2<f32>, r: f32) -> f32 {
  return length(p) - r;
}

/**
 * SDF for horizontal line segment (infinite in x, bounded in y).
 * Used for rectangular pulse body.
 * @param perpDist - Perpendicular distance from centerline (absolute value)
 * @param halfWidth - Half the line width
 * @returns Signed distance (negative inside, positive outside)
 */
fn sdLine(perpDist: f32, halfWidth: f32) -> f32 {
  return perpDist - halfWidth;
}
