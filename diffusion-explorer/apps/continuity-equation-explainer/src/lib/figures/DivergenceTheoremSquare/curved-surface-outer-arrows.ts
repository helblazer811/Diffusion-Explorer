/**
 * Surface normal arrow animation for the curved surface boundary.
 *
 * Draws arrows pointing outward (perpendicular to boundary) around the curved surface.
 * Arrows grow from zero to full length as the animation progresses.
 */

import type { Clip, Animation } from '@diffusion-explorer/ui';
import { drawArrow } from '@diffusion-explorer/ui';
import type { CurveFn, ToPixelFn } from '../DivergenceTheorem/divergence_theorem';
import { getTangentAndNormal } from '../DivergenceTheorem/divergence_theorem';

// ===== Types =====

export type OuterArrowState = {
  leftOuterArrowProgress: number; // 0-1 for arrow growth
};

type ArrowData = {
  position: [number, number]; // Point on curve (domain coords)
  normal: [number, number]; // Outward normal direction (unit vector)
  theta: number; // Parameter value on curve
};

export type CurvedSurfaceOuterArrowOptions = {
  // Surface function (parametric curve, theta: 0 to 2π)
  curveFn: CurveFn;

  // Number of arrows to place around the boundary
  numArrows?: number;

  // Coordinate transforms
  toPixel: ToPixelFn;
  scaleLength: (domainLen: number) => number;

  // Arrow styling
  color?: string;
  strokeWidth?: number;
  headRadius?: number;

  // Arrow length in domain units
  maxLength?: number;
};

// ===== Class Implementation =====

export class CurvedSurfaceOuterArrowAnimation<TState extends OuterArrowState>
  implements Animation<TState>
{
  readonly clip: Clip<TState>;

  // Pre-computed arrow positions and normals
  private readonly arrows: ArrowData[];
  private readonly toPixel: ToPixelFn;
  private readonly scaleLength: (domainLen: number) => number;

  // Style options
  private readonly color: string;
  private readonly strokeWidth: number;
  private readonly headRadius: number;
  private readonly maxLength: number;

  private constructor(options: CurvedSurfaceOuterArrowOptions) {
    const {
      curveFn,
      numArrows = 16,
      toPixel,
      scaleLength,
      color = '#f97316',
      strokeWidth = 2,
      headRadius = 4,
      maxLength = 0.15,
    } = options;

    this.toPixel = toPixel;
    this.scaleLength = scaleLength;
    this.color = color;
    this.strokeWidth = strokeWidth;
    this.headRadius = headRadius;
    this.maxLength = maxLength;

    // Sample arrow positions evenly around the curve
    this.arrows = this.computeArrows(curveFn, numArrows);

    // Create the clip
    this.clip = {
      name: 'LeftOuterArrowProgress',
      reduce(t: number) {
        return { leftOuterArrowProgress: t } as Partial<TState>;
      },
    };
  }

  /**
   * Compute arrow positions and normals evenly spaced around the curve.
   */
  private computeArrows(curveFn: CurveFn, numArrows: number): ArrowData[] {
    const arrows: ArrowData[] = [];
    const step = (2 * Math.PI) / numArrows;

    for (let i = 0; i < numArrows; i++) {
      const theta = i * step;
      const { position, normal } = getTangentAndNormal(curveFn, theta);

      arrows.push({
        position,
        normal,
        theta,
      });
    }

    return arrows;
  }

  /**
   * Draw surface normal arrows at the current animation state.
   */
  draw(ctx: CanvasRenderingContext2D, state: TState): void {
    const progress = state.leftOuterArrowProgress;
    if (progress <= 0) return;

    const arrowLength = this.maxLength * progress;
    const scaledLen = this.scaleLength(arrowLength);

    ctx.save();
    ctx.strokeStyle = this.color;
    ctx.fillStyle = this.color;
    ctx.lineWidth = this.strokeWidth;
    ctx.lineCap = 'round';

    for (const arrow of this.arrows) {
      const [px, py] = this.toPixel(arrow.position);

      // Normal points outward; in canvas coords, y is flipped
      const endX = px + arrow.normal[0] * scaledLen;
      const endY = py - arrow.normal[1] * scaledLen; // Flip y for canvas

      drawArrow(ctx, px, py, endX, endY, this.headRadius);
    }

    ctx.restore();
  }

  /**
   * Create a new CurvedSurfaceOuterArrowAnimation instance.
   */
  static create<TState extends OuterArrowState>(
    options: CurvedSurfaceOuterArrowOptions
  ): CurvedSurfaceOuterArrowAnimation<TState> {
    return new CurvedSurfaceOuterArrowAnimation<TState>(options);
  }
}
