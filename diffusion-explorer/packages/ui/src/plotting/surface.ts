/**
 * Shared Surface utilities for visualizations (Stokes' Theorem, Divergence Theorem, etc.)
 */

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------

/** Parametric curve function: theta (0 to 2π) -> [x, y] */
export type CurveFn = (theta: number) => [number, number];

/** Coordinate transform function */
export type ToPixelFn = (p: [number, number]) => [number, number];

/** Blob curve configuration using sinusoidal perturbations */
export interface CurveParams {
  baseRadius: number;
  amplitudes: number[];
  phases: number[];
  frequencies: number[];
}

/** Position, tangent, and normal vectors at a point on a curve */
export interface TangentNormalResult {
  position: [number, number];
  tangent: [number, number];
  normal: [number, number];
}

/** Options for drawing a closed curve */
export interface DrawCurveOptions {
  fillColor?: string;
  fillOpacity?: number;
  strokeColor?: string;
  strokeWidth?: number;
}

// ----------------------------------------------------------------
// Helper Function
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
// Surface Class
// ----------------------------------------------------------------

/**
 * Surface class encapsulating a parametric curve with utilities for
 * containment testing, tangent/normal computation, and drawing.
 */
export class Surface {
  readonly curve: CurveFn;

  constructor(curve: CurveFn) {
    this.curve = curve;
  }

  /**
   * Test if point is inside surface using polar comparison.
   * Works for any star-convex curve (where every point on the boundary
   * is visible from the origin).
   * @param point - Point to test [x, y]
   * @param margin - Optional margin in domain units to shrink the boundary
   */
  isInside(point: [number, number], margin: number = 0): boolean {
    const [x, y] = point;
    const r_point = Math.sqrt(x * x + y * y);
    const theta = Math.atan2(y, x);
    const [rx, ry] = this.curve(theta);
    const r_curve = Math.sqrt(rx * rx + ry * ry);
    return r_point < r_curve - margin;
  }

  /**
   * Compute tangent and outward normal vectors at a point on the curve.
   * Normal points outward (clockwise rotation of tangent).
   * @param theta - Angle parameter on the curve
   * @param epsilon - Step size for finite difference
   */
  getTangentAndNormal(theta: number, epsilon: number = 0.001): TangentNormalResult {
    const position = this.curve(theta);

    // Compute tangent via finite difference
    const before = this.curve(theta - epsilon);
    const after = this.curve(theta + epsilon);
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
   * Draw the closed curve on a canvas context.
   * @param ctx - Canvas 2D rendering context
   * @param toPixel - Function to convert domain coordinates to pixel coordinates
   * @param options - Fill and stroke styling options
   */
  draw(ctx: CanvasRenderingContext2D, toPixel: ToPixelFn, options: DrawCurveOptions = {}): void {
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
      const point = this.curve(theta);
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

  // ----------------------------------------------------------------
  // Static Factory Methods
  // ----------------------------------------------------------------

  /**
   * Create a blob surface using polar-form curve with sinusoidal perturbations.
   * Uses polar comparison for containment testing (efficient for star-convex shapes).
   */
  static fromBlob(params: CurveParams): Surface {
    const curve = createClosedCurve(params);
    return new Surface(curve);
  }

  /**
   * Create a square surface centered at origin.
   * @param sideLength - Length of each side of the square
   */
  static fromSquare(sideLength: number): Surface {
    const halfSide = sideLength / 2;

    // Parametric curve walking the perimeter counterclockwise
    // Each side spans π/2 of theta
    const curve: CurveFn = (theta: number): [number, number] => {
      // Normalize theta to [0, 2π)
      const t = ((theta % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const side = Math.floor((t / (2 * Math.PI)) * 4); // 0-3
      const tFrac = ((t / (2 * Math.PI)) * 4) % 1; // Position within side (0-1)

      switch (side) {
        case 0: // Right side: (halfSide, halfSide) to (halfSide, -halfSide)
          return [halfSide, halfSide - tFrac * sideLength];
        case 1: // Bottom side: (halfSide, -halfSide) to (-halfSide, -halfSide)
          return [halfSide - tFrac * sideLength, -halfSide];
        case 2: // Left side: (-halfSide, -halfSide) to (-halfSide, halfSide)
          return [-halfSide, -halfSide + tFrac * sideLength];
        case 3: // Top side: (-halfSide, halfSide) to (halfSide, halfSide)
          return [-halfSide + tFrac * sideLength, halfSide];
        default:
          return [halfSide, halfSide]; // Fallback
      }
    };

    // Square has specialized isInside check
    const surface = new Surface(curve);
    const originalIsInside = surface.isInside.bind(surface);
    surface.isInside = (point: [number, number], margin: number = 0): boolean => {
      const [x, y] = point;
      const boundary = halfSide - margin;
      return Math.abs(x) < boundary && Math.abs(y) < boundary;
    };

    return surface;
  }
}
