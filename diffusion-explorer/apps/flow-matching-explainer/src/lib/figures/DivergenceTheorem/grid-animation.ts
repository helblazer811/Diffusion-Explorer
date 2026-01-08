/**
 * Surface-aware grid animations that progressively draw grid lines clipped to a closed curve.
 *
 * Provides two composable animations:
 * - CreateGridAnimation: Creates initial grid at resolution N
 * - SubdivideGridAnimation: Subdivides existing grid (draws base statically, animates new lines)
 */

import type { Clip, Animation } from '@diffusion-explorer/ui';
import type { CurveFn, ToPixelFn } from './divergence_theorem';

// ===== Exported Types =====

export type SurfaceSamples = {
  points: [number, number][];
  thetas: number[];
};

export type BoundingBox = {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
};

export type GridSegment = {
  start: [number, number];
  end: [number, number];
};

// ===== State Types =====

export type CreateGridAnimationState = {
  createGridProgress: number; // 0-1, progress for initial grid creation
};

export type SubdivideGridAnimationState = {
  subdivideProgress: number; // 0-1, progress for subdivision animation
};

// ===== Options Types =====

export type CreateGridAnimationOptions = {
  curveFn: CurveFn;
  gridResolution: number;
  gridTolerance?: number;
  toPixel: ToPixelFn;
  color?: string;
  strokeWidth?: number;
  lineCap?: CanvasLineCap;
  clipDuration?: number;
};

export type SubdivideGridAnimationOptions = {
  curveFn: CurveFn;
  baseResolution: number; // Resolution to assume as complete (will double to 2*baseResolution)
  gridTolerance?: number;
  toPixel: ToPixelFn;
  color?: string;
  strokeWidth?: number;
  lineCap?: CanvasLineCap;
  clipDuration?: number;
};

// ===== Exported Utility Functions =====

export function sampleSurfacePoints(
  curveFn: CurveFn,
  numSamples: number = 360
): SurfaceSamples {
  const points: [number, number][] = [];
  const thetas: number[] = [];
  const step = (2 * Math.PI) / numSamples;

  for (let i = 0; i < numSamples; i++) {
    const theta = i * step;
    points.push(curveFn(theta));
    thetas.push(theta);
  }

  return { points, thetas };
}

export function computeBoundingBox(points: [number, number][]): BoundingBox {
  let xMin = Infinity,
    xMax = -Infinity;
  let yMin = Infinity,
    yMax = -Infinity;

  for (const [x, y] of points) {
    xMin = Math.min(xMin, x);
    xMax = Math.max(xMax, x);
    yMin = Math.min(yMin, y);
    yMax = Math.max(yMax, y);
  }

  return { xMin, xMax, yMin, yMax };
}

export function isPointInside(
  point: [number, number],
  surfaceSamples: SurfaceSamples
): boolean {
  const { points } = surfaceSamples;
  const [px, py] = point;
  let windingNumber = 0;

  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    const [x1, y1] = points[i];
    const [x2, y2] = points[j];

    if (y1 <= py) {
      if (y2 > py) {
        const isLeft = (x2 - x1) * (py - y1) - (px - x1) * (y2 - y1);
        if (isLeft > 0) windingNumber++;
      }
    } else {
      if (y2 <= py) {
        const isLeft = (x2 - x1) * (py - y1) - (px - x1) * (y2 - y1);
        if (isLeft < 0) windingNumber--;
      }
    }
  }

  return windingNumber !== 0;
}

// ===== Exported Internal Utility (for SubdivideGridAnimation) =====

export function findIntersections(
  lineValue: number,
  isHorizontal: boolean,
  curveFn: CurveFn,
  surfaceSamples: SurfaceSamples,
  tolerance: number
): number[] {
  const { points, thetas } = surfaceSamples;
  const coordIndex = isHorizontal ? 1 : 0;
  const intersections: number[] = [];

  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    const val1 = points[i][coordIndex];
    const val2 = points[j][coordIndex];

    if (
      (val1 <= lineValue && lineValue < val2) ||
      (val2 <= lineValue && lineValue < val1)
    ) {
      const intersection = binarySearchIntersection(
        curveFn,
        thetas[i],
        thetas[j],
        lineValue,
        isHorizontal,
        tolerance
      );
      intersections.push(intersection);
    }
  }

  intersections.sort((a, b) => a - b);
  return intersections;
}

// ===== Internal Utility Functions =====

function binarySearchIntersection(
  curveFn: CurveFn,
  thetaLow: number,
  thetaHigh: number,
  targetValue: number,
  isHorizontal: boolean,
  tolerance: number
): number {
  const coordIndex = isHorizontal ? 1 : 0;
  const resultIndex = isHorizontal ? 0 : 1;

  let low = thetaLow;
  let high = thetaHigh;
  const valLow = curveFn(low)[coordIndex];

  while (high - low > tolerance) {
    const mid = (low + high) / 2;
    const valMid = curveFn(mid)[coordIndex];

    if (
      (valLow <= targetValue && targetValue <= valMid) ||
      (valMid <= targetValue && targetValue <= valLow)
    ) {
      high = mid;
    } else {
      low = mid;
    }
  }

  const midTheta = (low + high) / 2;
  return curveFn(midTheta)[resultIndex];
}

/**
 * Compute grid segments at specific resolution.
 */
function computeGridSegments(
  curveFn: CurveFn,
  surfaceSamples: SurfaceSamples,
  boundingBox: BoundingBox,
  gridResolution: number,
  tolerance: number
): GridSegment[] {
  const { xMin, xMax, yMin, yMax } = boundingBox;
  const segments: GridSegment[] = [];

  const maxDim = Math.max(xMax - xMin, yMax - yMin);
  const step = maxDim / gridResolution;

  const horizontalLines: GridSegment[][] = [];
  const verticalLines: GridSegment[][] = [];

  // Horizontal lines (constant y)
  for (let i = 1; i < gridResolution; i++) {
    const y = yMin + i * step;
    const xIntersections = findIntersections(y, true, curveFn, surfaceSamples, tolerance);

    const lineSegments: GridSegment[] = [];
    for (let j = 0; j < xIntersections.length - 1; j += 2) {
      lineSegments.push({
        start: [xIntersections[j], y],
        end: [xIntersections[j + 1], y],
      });
    }
    if (lineSegments.length > 0) {
      horizontalLines.push(lineSegments);
    }
  }

  // Vertical lines (constant x)
  for (let i = 1; i < gridResolution; i++) {
    const x = xMin + i * step;
    const yIntersections = findIntersections(x, false, curveFn, surfaceSamples, tolerance);

    const lineSegments: GridSegment[] = [];
    for (let j = 0; j < yIntersections.length - 1; j += 2) {
      lineSegments.push({
        start: [x, yIntersections[j]],
        end: [x, yIntersections[j + 1]],
      });
    }
    if (lineSegments.length > 0) {
      verticalLines.push(lineSegments);
    }
  }

  // Interleave: H0, V0, H1, V1, ...
  const maxLines = Math.max(horizontalLines.length, verticalLines.length);
  for (let i = 0; i < maxLines; i++) {
    if (i < horizontalLines.length) {
      segments.push(...horizontalLines[i]);
    }
    if (i < verticalLines.length) {
      segments.push(...verticalLines[i]);
    }
  }

  return segments;
}

/**
 * Compute ONLY the NEW subdivision segments (midpoint lines).
 * These are the lines that appear when doubling resolution from N to 2N.
 */
function computeSubdivisionSegments(
  curveFn: CurveFn,
  surfaceSamples: SurfaceSamples,
  boundingBox: BoundingBox,
  baseResolution: number,
  tolerance: number
): GridSegment[] {
  const { xMin, xMax, yMin, yMax } = boundingBox;
  const segments: GridSegment[] = [];

  const newResolution = baseResolution * 2;
  const maxDim = Math.max(xMax - xMin, yMax - yMin);
  const step = maxDim / newResolution;

  const horizontalLines: GridSegment[][] = [];
  const verticalLines: GridSegment[][] = [];

  // Horizontal subdivision lines: y = yMin + (2k-1)*step for k = 1..baseResolution
  // These are the ODD indices in the new resolution (the midpoints)
  for (let k = 1; k <= baseResolution; k++) {
    const y = yMin + (2 * k - 1) * step;
    const xIntersections = findIntersections(y, true, curveFn, surfaceSamples, tolerance);

    const lineSegments: GridSegment[] = [];
    for (let j = 0; j < xIntersections.length - 1; j += 2) {
      lineSegments.push({
        start: [xIntersections[j], y],
        end: [xIntersections[j + 1], y],
      });
    }
    if (lineSegments.length > 0) {
      horizontalLines.push(lineSegments);
    }
  }

  // Vertical subdivision lines: x = xMin + (2k-1)*step for k = 1..baseResolution
  for (let k = 1; k <= baseResolution; k++) {
    const x = xMin + (2 * k - 1) * step;
    const yIntersections = findIntersections(x, false, curveFn, surfaceSamples, tolerance);

    const lineSegments: GridSegment[] = [];
    for (let j = 0; j < yIntersections.length - 1; j += 2) {
      lineSegments.push({
        start: [x, yIntersections[j]],
        end: [x, yIntersections[j + 1]],
      });
    }
    if (lineSegments.length > 0) {
      verticalLines.push(lineSegments);
    }
  }

  // Interleave: H0, V0, H1, V1, ...
  const maxLines = Math.max(horizontalLines.length, verticalLines.length);
  for (let i = 0; i < maxLines; i++) {
    if (i < horizontalLines.length) {
      segments.push(...horizontalLines[i]);
    }
    if (i < verticalLines.length) {
      segments.push(...verticalLines[i]);
    }
  }

  return segments;
}

// ===== CreateGridAnimation Class =====

export class CreateGridAnimation<TState extends CreateGridAnimationState>
  implements Animation<TState>
{
  readonly clip: Clip<TState>;

  private readonly segments: GridSegment[];
  private readonly toPixel: ToPixelFn;
  private readonly color: string;
  private readonly strokeWidth: number;
  private readonly lineCap: CanvasLineCap;

  private constructor(options: CreateGridAnimationOptions) {
    const {
      curveFn,
      gridResolution,
      gridTolerance = 0.001,
      toPixel,
      color = '#000000',
      strokeWidth = 2,
      lineCap = 'round',
      clipDuration = 1,
    } = options;

    this.toPixel = toPixel;
    this.color = color;
    this.strokeWidth = strokeWidth;
    this.lineCap = lineCap;

    const surfaceSamples = sampleSurfacePoints(curveFn);
    const boundingBox = computeBoundingBox(surfaceSamples.points);

    this.segments = computeGridSegments(
      curveFn,
      surfaceSamples,
      boundingBox,
      gridResolution,
      gridTolerance
    );

    this.clip = {
      name: 'CreateGridProgress',
      duration: clipDuration,
      reduce(t: number) {
        return { createGridProgress: t } as Partial<TState>;
      },
    };
  }

  draw(ctx: CanvasRenderingContext2D, state: TState): void {
    const totalSegments = this.segments.length;
    if (totalSegments === 0) return;

    const progress = state.createGridProgress;
    const segmentsToDraw = progress * totalSegments;
    const fullSegments = Math.floor(segmentsToDraw);
    const partialProgress = segmentsToDraw - fullSegments;

    ctx.strokeStyle = this.color;
    ctx.lineWidth = this.strokeWidth;
    ctx.lineCap = this.lineCap;

    for (let i = 0; i < fullSegments && i < totalSegments; i++) {
      this.drawSegment(ctx, this.segments[i], 1.0);
    }

    if (fullSegments < totalSegments && partialProgress > 0) {
      this.drawSegment(ctx, this.segments[fullSegments], partialProgress);
    }
  }

  private drawSegment(
    ctx: CanvasRenderingContext2D,
    segment: GridSegment,
    progress: number
  ): void {
    const [x1, y1] = this.toPixel(segment.start);
    const [x2, y2] = this.toPixel(segment.end);

    const endX = x1 + (x2 - x1) * progress;
    const endY = y1 + (y2 - y1) * progress;

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(endX, endY);
    ctx.stroke();
  }

  static create<TState extends CreateGridAnimationState>(
    options: CreateGridAnimationOptions
  ): CreateGridAnimation<TState> {
    return new CreateGridAnimation<TState>(options);
  }
}

// ===== SubdivideGridAnimation Class =====

export class SubdivideGridAnimation<TState extends SubdivideGridAnimationState>
  implements Animation<TState>
{
  readonly clip: Clip<TState>;

  private readonly baseSegments: GridSegment[]; // Drawn statically
  private readonly subdivisionSegments: GridSegment[]; // Animated
  private readonly toPixel: ToPixelFn;
  private readonly color: string;
  private readonly strokeWidth: number;
  private readonly lineCap: CanvasLineCap;

  private constructor(options: SubdivideGridAnimationOptions) {
    const {
      curveFn,
      baseResolution,
      gridTolerance = 0.001,
      toPixel,
      color = '#000000',
      strokeWidth = 2,
      lineCap = 'round',
      clipDuration = 1,
    } = options;

    this.toPixel = toPixel;
    this.color = color;
    this.strokeWidth = strokeWidth;
    this.lineCap = lineCap;

    const surfaceSamples = sampleSurfacePoints(curveFn);
    const boundingBox = computeBoundingBox(surfaceSamples.points);

    // Compute base segments (drawn statically)
    this.baseSegments = computeGridSegments(
      curveFn,
      surfaceSamples,
      boundingBox,
      baseResolution,
      gridTolerance
    );

    // Compute NEW subdivision segments (animated)
    this.subdivisionSegments = computeSubdivisionSegments(
      curveFn,
      surfaceSamples,
      boundingBox,
      baseResolution,
      gridTolerance
    );

    this.clip = {
      name: 'SubdivideProgress',
      duration: clipDuration,
      reduce(t: number) {
        return { subdivideProgress: t } as Partial<TState>;
      },
    };
  }

  draw(ctx: CanvasRenderingContext2D, state: TState): void {
    ctx.strokeStyle = this.color;
    ctx.lineWidth = this.strokeWidth;
    ctx.lineCap = this.lineCap;

    // 1. Draw ALL base segments at full length (static, assumed complete)
    for (const segment of this.baseSegments) {
      this.drawSegment(ctx, segment, 1.0);
    }

    // 2. Draw subdivision segments progressively
    const totalSegments = this.subdivisionSegments.length;
    if (totalSegments === 0) return;

    const progress = state.subdivideProgress;
    const segmentsToDraw = progress * totalSegments;
    const fullSegments = Math.floor(segmentsToDraw);
    const partialProgress = segmentsToDraw - fullSegments;

    for (let i = 0; i < fullSegments && i < totalSegments; i++) {
      this.drawSegment(ctx, this.subdivisionSegments[i], 1.0);
    }

    if (fullSegments < totalSegments && partialProgress > 0) {
      this.drawSegment(ctx, this.subdivisionSegments[fullSegments], partialProgress);
    }
  }

  private drawSegment(
    ctx: CanvasRenderingContext2D,
    segment: GridSegment,
    progress: number
  ): void {
    const [x1, y1] = this.toPixel(segment.start);
    const [x2, y2] = this.toPixel(segment.end);

    const endX = x1 + (x2 - x1) * progress;
    const endY = y1 + (y2 - y1) * progress;

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(endX, endY);
    ctx.stroke();
  }

  static create<TState extends SubdivideGridAnimationState>(
    options: SubdivideGridAnimationOptions
  ): SubdivideGridAnimation<TState> {
    return new SubdivideGridAnimation<TState>(options);
  }
}
