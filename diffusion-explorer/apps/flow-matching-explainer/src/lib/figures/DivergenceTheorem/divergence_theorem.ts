/**
 * Helper functions for the Divergence Theorem visualization.
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

export interface VectorFieldParams {
  amplitude: number;
  frequency: number;
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

/**
 * Create a wavy left-to-right vector field function.
 * F(x, y) = (1 + a*sin(k*y), a*cos(k*x))
 */
export function createWavyVectorField(params: VectorFieldParams): VectorFieldFn {
  const { amplitude, frequency } = params;

  return (x: number, y: number): [number, number] => {
    return [
      1 + amplitude * Math.sin(frequency * y),
      amplitude * Math.cos(frequency * x)
    ];
  };
}

/**
 * Create a uniform rightward vector field.
 * F(x, y) = (1, 0) - constant horizontal flow to the right.
 */
export function createUniformRightField(): VectorFieldFn {
  return (_x: number, _y: number): [number, number] => {
    return [1, 0];
  };
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
    strokeWidth = 2
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

