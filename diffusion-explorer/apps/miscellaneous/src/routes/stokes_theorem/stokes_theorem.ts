/**
 * Helper functions for the Stokes' Theorem visualization.
 */

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------

export type CurveFn = (theta: number) => [number, number];
export type VectorFieldFn = (x: number, y: number) => [number, number];
export type ToPixelFn = (p: [number, number]) => [number, number];

export interface CurveParams {
  baseRadius: number;
  amplitudes: number[];
  phases: number[];
  frequencies: number[];
}

export interface TangentNormalResult {
  position: [number, number];
  tangent: [number, number];
  normal: [number, number];
}

export interface DrawCurveOptions {
  fillColor?: string;
  fillOpacity?: number;
  strokeColor?: string;
  strokeWidth?: number;
}

export interface BoundingBox {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

// ----------------------------------------------------------------
// Curve Functions
// ----------------------------------------------------------------

/**
 * Create a closed curve function using combined periodic functions.
 * Returns a function that maps theta (0 to 2π) to [x, y] coordinates.
 */
export function createClosedCurve(params: CurveParams): CurveFn {
  const { baseRadius, amplitudes, phases, frequencies } = params;

  return (theta: number): [number, number] => {
    // Combine multiple sinusoids for irregular shape
    let r = baseRadius;
    for (let i = 0; i < amplitudes.length; i++) {
      const amp = amplitudes[i];
      const phase = phases[i];
      const freq = frequencies[i];
      // Alternate between sin and cos for asymmetry
      if (i % 2 === 0) {
        r += amp * Math.sin(freq * theta + phase);
      } else {
        r += amp * Math.cos(freq * theta + phase);
      }
    }
    return [r * Math.cos(theta), r * Math.sin(theta)];
  };
}

// ----------------------------------------------------------------
// Vector Field Functions
// ----------------------------------------------------------------

export interface VectorFieldParams {
  amplitude: number;
  frequency: number;
}

/**
 * Create a wavy left-to-right vector field function.
 * F(x, y) = (1 + a*sin(k*y), a*cos(k*x))
 * This matches the divergence theorem visualization.
 */
export function createWavyVectorField(params: VectorFieldParams): VectorFieldFn {
  const { amplitude, frequency } = params;

  return (x: number, y: number): [number, number] => {
    return [
      1 + amplitude * Math.sin(frequency * y),
      amplitude * Math.cos(frequency * x),
    ];
  };
}

/**
 * Create a vector field with spatially varying curl.
 * F(x, y) = (sin(y), cos(x))
 * curl = ∂Fy/∂x - ∂Fx/∂y = -sin(x) - cos(y), ranges from -2 to +2
 */
export function createVaryingCurlField(): VectorFieldFn {
  return (x: number, y: number): [number, number] => {
    return [Math.sin(y), Math.cos(x)];
  };
}

/**
 * Compute the curl (z-component) at a point using numerical differentiation.
 * curl_z = ∂Fy/∂x - ∂Fx/∂y
 */
export function computeCurl(
  vectorFieldFn: VectorFieldFn,
  x: number,
  y: number,
  h: number = 0.001
): number {
  const dFy_dx =
    (vectorFieldFn(x + h, y)[1] - vectorFieldFn(x - h, y)[1]) / (2 * h);
  const dFx_dy =
    (vectorFieldFn(x, y + h)[0] - vectorFieldFn(x, y - h)[0]) / (2 * h);
  return dFy_dx - dFx_dy;
}

// ----------------------------------------------------------------
// Geometry Functions
// ----------------------------------------------------------------

/**
 * Compute tangent and outward normal vectors at a point on the curve.
 * Normal points outward (clockwise rotation of tangent).
 */
export function getTangentAndNormal(
  curveFn: CurveFn,
  theta: number,
  epsilon: number = 0.001
): TangentNormalResult {
  const position = curveFn(theta);

  // Compute tangent via finite difference
  const before = curveFn(theta - epsilon);
  const after = curveFn(theta + epsilon);
  const tx = (after[0] - before[0]) / (2 * epsilon);
  const ty = (after[1] - before[1]) / (2 * epsilon);

  // Normalize tangent
  const tLen = Math.sqrt(tx * tx + ty * ty);
  const tangent: [number, number] = tLen > 0 ? [tx / tLen, ty / tLen] : [1, 0];

  // Normal = rotate tangent 90° clockwise: [ty, -tx]
  // This points outward for counterclockwise-parameterized curves
  const normal: [number, number] = [tangent[1], -tangent[0]];

  return { position, tangent, normal };
}

/**
 * Check if a point is inside the closed curve using polar comparison.
 * Since the curve is defined in polar form r(θ), we compare radii.
 * @param margin - Optional margin in domain units to shrink the boundary
 */
export function isPointInside(
  curveFn: CurveFn,
  point: [number, number],
  margin: number = 0
): boolean {
  const [x, y] = point;
  const r_point = Math.sqrt(x * x + y * y);
  const theta = Math.atan2(y, x);
  const [rx, ry] = curveFn(theta);
  const r_curve = Math.sqrt(rx * rx + ry * ry);
  return r_point < r_curve - margin;
}

/**
 * Sample uniformly spaced interior points within the curve.
 * @param margin - Optional margin in domain units to keep points away from boundary
 */
export function sampleInteriorPoints(
  curveFn: CurveFn,
  boundingBox: BoundingBox,
  spacing: number,
  margin: number = 0
): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  const { xMin, xMax, yMin, yMax } = boundingBox;

  for (let x = xMin + spacing / 2; x < xMax; x += spacing) {
    for (let y = yMin + spacing / 2; y < yMax; y += spacing) {
      const point: [number, number] = [x, y];
      if (isPointInside(curveFn, point, margin)) {
        points.push(point);
      }
    }
  }

  return points;
}

/**
 * Compute bounding box from curve.
 */
export function computeBoundingBox(
  curveFn: CurveFn,
  numSamples: number = 360
): BoundingBox {
  let xMin = Infinity,
    xMax = -Infinity;
  let yMin = Infinity,
    yMax = -Infinity;
  const step = (2 * Math.PI) / numSamples;

  for (let i = 0; i < numSamples; i++) {
    const theta = i * step;
    const [x, y] = curveFn(theta);
    xMin = Math.min(xMin, x);
    xMax = Math.max(xMax, x);
    yMin = Math.min(yMin, y);
    yMax = Math.max(yMax, y);
  }

  return { xMin, xMax, yMin, yMax };
}

// ----------------------------------------------------------------
// Drawing Functions
// ----------------------------------------------------------------

/**
 * Draw the closed curve on a canvas context.
 */
export function drawClosedCurve(
  ctx: CanvasRenderingContext2D,
  curveFn: CurveFn,
  toPixel: ToPixelFn,
  options: DrawCurveOptions = {}
): void {
  const {
    fillColor = "#e0e0e0",
    fillOpacity = 0.15,
    strokeColor = "#999",
    strokeWidth = 2,
  } = options;

  const numSamples = 200;
  const step = (2 * Math.PI) / numSamples;

  ctx.beginPath();
  for (let i = 0; i <= numSamples; i++) {
    const theta = i * step;
    const point = curveFn(theta);
    const [px, py] = toPixel(point);

    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.closePath();

  // Fill with opacity
  if (fillColor) {
    ctx.globalAlpha = fillOpacity;
    ctx.fillStyle = fillColor;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Stroke
  if (strokeColor && strokeWidth > 0) {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    ctx.stroke();
  }
}
