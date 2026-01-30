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

/**
 * SDF for isoceles triangle (arrowhead) pointing in +X direction.
 * Base at x=0, tip at (arrowLen, 0).
 *
 * @param p - Point to measure from (in local coordinates)
 * @param arrowLen - Distance from base to tip
 * @param halfBase - Half the width of the base
 * @returns Signed distance (negative inside, positive outside)
 */
fn sdArrowhead(p: vec2<f32>, arrowLen: f32, halfBase: f32) -> f32 {
  // Reflect to upper half (use y-symmetry)
  let q = vec2<f32>(p.x, abs(p.y));

  // Triangle vertices:
  // Base-top: (0, halfBase)
  // Base-bottom: (0, -halfBase)
  // Tip: (arrowLen, 0)

  // Edge from base-top (0, halfBase) to tip (arrowLen, 0)
  let edgeVec = vec2<f32>(arrowLen, -halfBase);
  let edgeLen = length(edgeVec);
  let edgeDir = edgeVec / edgeLen;
  // Outward normal (rotate edge direction 90 CCW)
  let edgeNormal = vec2<f32>(-edgeDir.y, edgeDir.x);

  // Vector from base-top corner to query point
  let toQ = q - vec2<f32>(0.0, halfBase);

  // Signed distance to the sloped edge plane
  let distToSlope = dot(toQ, edgeNormal);

  // Distance along edge from base-top corner
  let alongEdge = dot(toQ, edgeDir);

  // Distance to back edge (x = 0, pointing inward is negative x)
  let distToBack = -p.x;

  // Determine which region we're in and compute appropriate distance
  if (distToSlope > 0.0) {
    // Outside the sloped edge
    if (alongEdge < 0.0) {
      // Near base-top corner
      return length(toQ);
    } else if (alongEdge > edgeLen) {
      // Near tip corner
      return length(q - vec2<f32>(arrowLen, 0.0));
    } else {
      // Along sloped edge
      return distToSlope;
    }
  } else if (distToBack > 0.0) {
    // Behind the base
    if (q.y > halfBase) {
      // Past base-top corner
      return length(toQ);
    } else {
      // Directly behind base
      return distToBack;
    }
  } else {
    // Inside triangle
    return max(distToSlope, distToBack);
  }
}
