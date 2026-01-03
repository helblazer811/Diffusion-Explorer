import * as d3 from 'd3';
import { drawLine, drawArrow } from './utils';

export interface VectorFieldStyleOptions {
  arrowScale: number;      // How much to scale normalized velocities
  strokeWidth: number;     // Line width
  color: string;           // Arrow color
  opacity: number;         // Arrow opacity
  headRadius?: number;     // Arrowhead radius (default: 5)
  normalizeVectors?: boolean; // If true, all arrows same length (unit vectors)
  showArrowHeads?: boolean;   // If false, draw lines without arrowheads (default: true)
  centerQuiver?: boolean;     // If true, center arrows on grid points (default: false)
}

export interface VectorFieldMagnitudeColoringOptions {
  arrowScale: number;      // How much to scale velocities
  strokeWidth: number;     // Line width
  opacity: number;         // Arrow opacity
  headRadius?: number;     // Arrowhead radius (default: 5)
  normalizeVectors?: boolean; // If true, all arrows same length but colored by magnitude (default: true)
  showArrowHeads?: boolean;   // If false, draw lines without arrowheads (default: true)
  centerQuiver?: boolean;     // If true, center arrows on grid points (default: false)
  colorScale?: (t: number) => string; // D3 color interpolator (default: d3.interpolateViridis)
  minMagnitude?: number;   // Override min magnitude for color scale normalization
  maxMagnitude?: number;   // Override max magnitude for color scale normalization
}

/**
 * Draws a vector field on canvas with arrows
 * @param ctx - Canvas 2D rendering context
 * @param gridPositions - Grid positions in pixel space: [point][x, y]
 * @param velocities - Velocity vectors: [point][vx, vy]
 * @param style - Styling options for arrows
 */
export function drawVectorField(
  ctx: CanvasRenderingContext2D,
  gridPositions: number[][],
  velocities: number[][],
  style: VectorFieldStyleOptions
): void {
  if (gridPositions.length === 0 || velocities.length === 0) return;

  const headRadius = style.headRadius ?? 5;
  const showArrowHeads = style.showArrowHeads ?? true;
  const centerQuiver = style.centerQuiver ?? false;

  // Calculate max velocity magnitude for normalization
  let maxMagnitude = 0;
  for (const [vx, vy] of velocities) {
    const magnitude = Math.sqrt(vx * vx + vy * vy);
    if (magnitude > maxMagnitude) maxMagnitude = magnitude;
  }
  if (maxMagnitude === 0) maxMagnitude = 1;

  ctx.save();
  ctx.strokeStyle = style.color;
  ctx.fillStyle = style.color;
  ctx.lineWidth = style.strokeWidth;
  ctx.globalAlpha = style.opacity;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;

  for (let i = 0; i < gridPositions.length; i++) {
    const [x, y] = gridPositions[i];
    const [vx, vy] = velocities[i];

    // Normalize and scale velocity
    let dx: number, dy: number;
    if (style.normalizeVectors) {
      // Unit vector normalization - all arrows same length
      const magnitude = Math.sqrt(vx * vx + vy * vy);
      if (magnitude > 0) {
        dx = (vx / magnitude) * style.arrowScale;
        dy = (vy / magnitude) * style.arrowScale;
      } else {
        dx = 0;
        dy = 0;
      }
    } else {
      // Max magnitude normalization - arrows proportional to velocity
      dx = (vx / maxMagnitude) * style.arrowScale;
      dy = (vy / maxMagnitude) * style.arrowScale;
    }

    // Calculate start and end points
    let fromX: number, fromY: number, toX: number, toY: number;
    if (centerQuiver) {
      // Center the arrow on the grid point
      fromX = x - dx / 2;
      fromY = y - dy / 2;
      toX = x + dx / 2;
      toY = y + dy / 2;
    } else {
      // Arrow starts at grid point
      fromX = x;
      fromY = y;
      toX = x + dx;
      toY = y + dy;
    }

    if (showArrowHeads) {
      drawArrow(ctx, fromX, fromY, toX, toY, headRadius);
    } else {
      drawLine(ctx, fromX, fromY, toX, toY);
    }
  }

  ctx.restore();
}

/**
 * Draws a vector field with arrows colored by magnitude using a color map
 * By default, arrows are normalized (same length) but colored according to their original magnitude
 * @param ctx - Canvas 2D rendering context
 * @param gridPositions - Grid positions in pixel space: [point][x, y]
 * @param velocities - Velocity vectors: [point][vx, vy]
 * @param options - Styling and coloring options
 */
export function drawVectorFieldMagnitudeColoring(
  ctx: CanvasRenderingContext2D,
  gridPositions: number[][],
  velocities: number[][],
  options: VectorFieldMagnitudeColoringOptions
): void {
  if (gridPositions.length === 0 || velocities.length === 0) return;

  const headRadius = options.headRadius ?? 5;
  const showArrowHeads = options.showArrowHeads ?? true;
  const centerQuiver = options.centerQuiver ?? false;
  const normalizeVectors = options.normalizeVectors ?? true;
  const colorScale = options.colorScale ?? d3.interpolateViridis;

  // Calculate magnitude for each vector
  const magnitudes: number[] = velocities.map(([vx, vy]) => Math.sqrt(vx * vx + vy * vy));

  // Determine min and max for color normalization
  let minMag = options.minMagnitude ?? Math.min(...magnitudes);
  let maxMag = options.maxMagnitude ?? Math.max(...magnitudes);

  // Handle edge case where all magnitudes are the same
  if (maxMag === minMag) {
    maxMag = minMag + 1;
  }

  ctx.save();
  ctx.lineWidth = options.strokeWidth;
  ctx.globalAlpha = options.opacity;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;

  for (let i = 0; i < gridPositions.length; i++) {
    const [x, y] = gridPositions[i];
    const [vx, vy] = velocities[i];
    const magnitude = magnitudes[i];

    // Calculate normalized color value (0 to 1)
    const normalizedMagnitude = (magnitude - minMag) / (maxMag - minMag);
    const color = colorScale(normalizedMagnitude);

    // Set color for this arrow
    ctx.strokeStyle = color;
    ctx.fillStyle = color;

    // Calculate arrow direction and length
    let dx: number, dy: number;
    if (normalizeVectors) {
      // Normalized: all arrows same length, colored by magnitude
      if (magnitude > 0) {
        dx = (vx / magnitude) * options.arrowScale;
        dy = (vy / magnitude) * options.arrowScale;
      } else {
        dx = 0;
        dy = 0;
      }
    } else {
      // Proportional: arrows scaled by magnitude relative to max
      dx = (vx / maxMag) * options.arrowScale;
      dy = (vy / maxMag) * options.arrowScale;
    }

    // Calculate start and end points
    let fromX: number, fromY: number, toX: number, toY: number;
    if (centerQuiver) {
      fromX = x - dx / 2;
      fromY = y - dy / 2;
      toX = x + dx / 2;
      toY = y + dy / 2;
    } else {
      fromX = x;
      fromY = y;
      toX = x + dx;
      toY = y + dy;
    }

    if (showArrowHeads) {
      drawArrow(ctx, fromX, fromY, toX, toY, headRadius);
    } else {
      drawLine(ctx, fromX, fromY, toX, toY);
    }
  }

  ctx.restore();
}
