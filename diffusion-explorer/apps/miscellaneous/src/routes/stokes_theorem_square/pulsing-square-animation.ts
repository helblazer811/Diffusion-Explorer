/**
 * Pulsing square animation for Stokes' Theorem visualization.
 *
 * Creates a traveling pulse animation around the perimeter of a square,
 * similar to the streamline animation approach.
 */

import type { Animation, Clip } from "@diffusion-explorer/ui";

// ===== Types =====

/**
 * Base animation state type for pulsing square animations.
 */
export type PulsingSquareState = {
  phase: number; // 0-1, position in pulse cycle
};

/**
 * Options for creating a pulsing square animation.
 */
export type PulsingSquareOptions = {
  x: number; // Center x
  y: number; // Center y
  width: number; // Square width in pixels
  pulseWidth?: number; // Pulse width in pixels (default: 40)
  pulsePauseWidth?: number; // Gap between pulses (default: 60)
  clockwise?: boolean; // Direction (default: true)
  color?: string; // Stroke color
  strokeWidth?: number; // Line width (default: 2)
  baseOpacity?: number; // Max opacity (default: 0.8)
  loopPulseFrequency?: number; // Pulses per cycle (default: 1)
  subdivisions?: number; // Subdivisions per edge (default: 20)
};

/**
 * Internal data for pulsing square animation.
 */
type PulsingSquareData = {
  pathPoints: [number, number][];
  cumulativeLengths: number[];
  patternIndices: Uint16Array;
  totalLength: number;
};

// ===== Helper Functions =====

/**
 * Generate path points around a square perimeter.
 *
 * Points are ordered for traversal in the specified direction.
 * Each edge is subdivided for smooth pulse animation.
 */
function generateSquarePath(
  x: number,
  y: number,
  width: number,
  clockwise: boolean,
  subdivisions: number
): [number, number][] {
  const hw = width / 2;
  const points: [number, number][] = [];

  // Define corners in traversal order
  const corners: [number, number][] = clockwise
    ? [
        [x - hw, y - hw], // TL
        [x + hw, y - hw], // TR
        [x + hw, y + hw], // BR
        [x - hw, y + hw], // BL
      ]
    : [
        [x - hw, y - hw], // TL
        [x - hw, y + hw], // BL
        [x + hw, y + hw], // BR
        [x + hw, y - hw], // TR
      ];

  // Subdivide each edge for smooth animation
  for (let i = 0; i < 4; i++) {
    const [x1, y1] = corners[i];
    const [x2, y2] = corners[(i + 1) % 4];

    for (let j = 0; j < subdivisions; j++) {
      const t = j / subdivisions;
      points.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]);
    }
  }

  // Close the path
  points.push(corners[0]);

  return points;
}

/**
 * Compute cumulative lengths along a path.
 */
function computePathLengths(points: [number, number][]): {
  cumulativeLengths: number[];
  totalLength: number;
} {
  const cumulativeLengths: number[] = [0];
  let totalLength = 0;

  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0];
    const dy = points[i][1] - points[i - 1][1];
    const len = Math.sqrt(dx * dx + dy * dy);
    totalLength += len;
    cumulativeLengths.push(totalLength);
  }

  return { cumulativeLengths, totalLength };
}

/**
 * Create a lookup table for alpha values across one pulse period.
 */
function createAlphaLUT(
  pulseWidth: number,
  spacing: number,
  baseOpacity: number,
  resolution: number = 256
): Float32Array {
  const lut = new Float32Array(resolution);
  const invPulseWidth = 1 / pulseWidth;

  for (let i = 0; i < resolution; i++) {
    const posInPattern = (i / resolution) * spacing;
    if (posInPattern < pulseWidth) {
      // Gradient mode: fade from 0 at front to baseOpacity at back
      const u = posInPattern * invPulseWidth;
      lut[i] = baseOpacity * u;
    }
    // else lut[i] stays 0 (gap region)
  }

  return lut;
}

/**
 * Precompute pattern positions for the path.
 */
function precomputePatternIndices(
  cumulativeLengths: number[],
  spacing: number,
  lutResolution: number = 256
): Uint16Array {
  const numPoints = cumulativeLengths.length;
  const indices = new Uint16Array(numPoints);
  const scale = lutResolution / spacing;

  for (let i = 0; i < numPoints; i++) {
    const pos = cumulativeLengths[i];
    const posInPattern = pos % spacing;
    indices[i] = Math.floor(posInPattern * scale) % lutResolution;
  }

  return indices;
}

/**
 * Compute alpha values for animated pulses along the path.
 */
function computeAlphas(
  patternIndices: Uint16Array,
  alphaLUT: Float32Array,
  phase: number,
  outAlphas: Float32Array
): void {
  const numPoints = patternIndices.length;
  const lutResolution = alphaLUT.length;

  // Phase shift in LUT indices
  const shiftAmount = Math.floor((phase % 1) * lutResolution);

  for (let i = 0; i < numPoints; i++) {
    let idx = patternIndices[i] - shiftAmount;
    if (idx < 0) idx += lutResolution;
    outAlphas[i] = alphaLUT[idx];
  }
}

// ===== Class Implementation =====

/**
 * Animated pulsing square for visualizing circulation.
 *
 * Creates a traveling pulse effect around a square perimeter.
 *
 * @example
 * const anim = PulsingSquareAnimation.create({
 *   x: 200,
 *   y: 200,
 *   width: 100,
 *   clockwise: true,
 *   color: '#3b82f6',
 * });
 *
 * await anim.init(canvas);
 * timeline.add(anim.clip, { start: 0, end: 1 });
 *
 * // In draw function:
 * anim.draw(state);
 */
export class PulsingSquareAnimation<TState extends PulsingSquareState>
  implements Animation<TState> {
  readonly clip: Clip<TState>;

  // Style options
  private readonly color: string;
  private readonly strokeWidth: number;
  private readonly baseOpacity: number;
  private readonly loopPulseFrequency: number;

  // Animation data
  private readonly data: PulsingSquareData;
  private readonly alphaLUT: Float32Array;
  private readonly alphaBuffer: Float32Array;

  // Context storage
  private ctx: CanvasRenderingContext2D | null = null;
  private _initialized = false;

  private constructor(options: PulsingSquareOptions) {
    const {
      x,
      y,
      width,
      pulseWidth = 80,
      pulsePauseWidth = 60,
      clockwise = true,
      color = "#3b82f6",
      strokeWidth = 2,
      baseOpacity = 0.8,
      loopPulseFrequency = 1,
      subdivisions = 80,
    } = options;

    // Store style options
    this.color = color;
    this.strokeWidth = strokeWidth;
    this.baseOpacity = baseOpacity;
    this.loopPulseFrequency = loopPulseFrequency;

    // Generate path points
    const pathPoints = generateSquarePath(x, y, width, clockwise, subdivisions);

    // Compute lengths
    const { cumulativeLengths, totalLength } = computePathLengths(pathPoints);

    // Create alpha LUT
    const spacing = pulseWidth + pulsePauseWidth;
    this.alphaLUT = createAlphaLUT(pulseWidth, spacing, baseOpacity);

    // Precompute pattern indices
    const patternIndices = precomputePatternIndices(cumulativeLengths, spacing);

    // Allocate reusable alpha buffer
    this.alphaBuffer = new Float32Array(pathPoints.length);

    // Store data
    this.data = {
      pathPoints,
      cumulativeLengths,
      patternIndices,
      totalLength,
    };

    // Create the clip
    this.clip = {
      name: "PulsingSquarePhase",
      reduce(t: number) {
        return { phase: (t * loopPulseFrequency) % 1 } as Partial<TState>;
      },
    };
  }

  /**
   * Initialize the animation with a canvas element.
   */
  async init(canvas: HTMLCanvasElement): Promise<void> {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D rendering context');
    }
    this.ctx = ctx;
    this._initialized = true;
  }

  /**
   * Check if the animation has been initialized.
   */
  get initialized(): boolean {
    return this._initialized;
  }

  /**
   * Draw the pulsing square at the current animation state.
   */
  draw(state: TState): void {
    if (!this.ctx) {
      console.warn('PulsingSquareAnimation.draw() called before init()');
      return;
    }

    const { pathPoints, patternIndices } = this.data;
    if (pathPoints.length < 2) return;

    // Apply frequency multiplier to phase
    const phase = (state.phase * this.loopPulseFrequency) % 1;

    // Compute per-segment alphas
    computeAlphas(patternIndices, this.alphaLUT, phase, this.alphaBuffer);

    // Draw path segments with varying alpha
    this.ctx.lineCap = "round";
    this.ctx.lineJoin = "round";
    this.ctx.lineWidth = this.strokeWidth;

    for (let i = 0; i < pathPoints.length - 1; i++) {
      const alpha = this.alphaBuffer[i];
      if (alpha < 0.01) continue; // Skip nearly invisible segments

      const [x1, y1] = pathPoints[i];
      const [x2, y2] = pathPoints[i + 1];

      this.ctx.strokeStyle = this.color;
      this.ctx.globalAlpha = alpha;
      this.ctx.beginPath();
      this.ctx.moveTo(x1, y1);
      this.ctx.lineTo(x2, y2);
      this.ctx.stroke();
    }

    this.ctx.globalAlpha = 1;
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    this.ctx = null;
    this._initialized = false;
  }

  /**
   * Create a new PulsingSquareAnimation instance.
   */
  static create<TState extends PulsingSquareState>(
    options: PulsingSquareOptions
  ): PulsingSquareAnimation<TState> {
    return new PulsingSquareAnimation<TState>(options);
  }
}
