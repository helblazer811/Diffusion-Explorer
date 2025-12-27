/**
 * Utility functions for visualizing Euler's method on a circular vector field
 */

/**
 * Circular vector field: velocity perpendicular to position (tangent to circle)
 * v(x, y) = (-y, x) - this creates counter-clockwise rotation
 */
export function circularVectorField(x: number, y: number): [number, number] {
  return [-y, x];
}

/**
 * Elliptical vector field: velocity tangent to ellipse
 * For ellipse x²/a² + y²/b² = 1, the tangent direction is (-y*a/b, x*b/a)
 * @param a - Semi-major axis (horizontal)
 * @param b - Semi-minor axis (vertical)
 */
export function createEllipticalVectorField(a: number, b: number): (x: number, y: number) => [number, number] {
  return (x: number, y: number): [number, number] => {
    return [-y * a / b, x * b / a];
  };
}

/**
 * Generate trajectory using Euler's method
 * @param startPoint - Starting position [x, y]
 * @param stepSize - Euler step size (dt)
 * @param numSteps - Number of steps to take
 * @param vectorField - Function that returns velocity at a point
 * @returns Array of points along the trajectory
 */
export function generateEulerTrajectory(
  startPoint: [number, number],
  stepSize: number,
  numSteps: number,
  vectorField: (x: number, y: number) => [number, number] = circularVectorField
): number[][] {
  const trajectory: number[][] = [[...startPoint]];
  let [x, y] = startPoint;

  for (let i = 0; i < numSteps; i++) {
    const [vx, vy] = vectorField(x, y);
    x = x + stepSize * vx;
    y = y + stepSize * vy;
    trajectory.push([x, y]);
  }

  return trajectory;
}

/**
 * Generate grid points and velocities for vector field visualization
 * @param xResolution - Number of points along x axis
 * @param yResolution - Number of points along y axis
 * @param domainRange - Bounds of the domain
 * @param vectorField - Function that returns velocity at a point
 * @returns Object with gridPoints and velocities arrays
 */
export function generateVectorFieldGrid(
  xResolution: number,
  yResolution: number,
  domainRange: { xMin: number; xMax: number; yMin: number; yMax: number },
  vectorField: (x: number, y: number) => [number, number] = circularVectorField
): { gridPoints: number[][]; velocities: number[][] } {
  const gridPoints: number[][] = [];
  const velocities: number[][] = [];

  const xStep = (domainRange.xMax - domainRange.xMin) / (xResolution - 1);
  const yStep = (domainRange.yMax - domainRange.yMin) / (yResolution - 1);

  for (let j = 0; j < yResolution; j++) {
    for (let i = 0; i < xResolution; i++) {
      const x = domainRange.xMin + i * xStep;
      const y = domainRange.yMin + j * yStep;
      gridPoints.push([x, y]);
      velocities.push(vectorField(x, y));
    }
  }

  return { gridPoints, velocities };
}

/**
 * Compute the maximum velocity magnitude for normalization
 */
export function computeMaxVelocity(velocities: number[][]): number {
  let maxMag = 0;
  for (const [vx, vy] of velocities) {
    const mag = Math.sqrt(vx * vx + vy * vy);
    if (mag > maxMag) maxMag = mag;
  }
  return maxMag;
}
