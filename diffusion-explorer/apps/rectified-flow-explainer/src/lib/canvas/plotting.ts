import type { ScaleLinear } from 'd3';

/**
 * Draws a scatter plot on canvas
 */
export function drawScatterPlot(
  ctx: CanvasRenderingContext2D,
  data: number[][],
  xScale: ScaleLinear<number, number>,
  yScale: ScaleLinear<number, number>,
  radius: number,
  fill: string,
  opacity: number
): void {
  ctx.fillStyle = fill;
  ctx.globalAlpha = opacity;

  for (const point of data) {
    const x = xScale(point[0]);
    const y = yScale(point[1]);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.fill();
  }

  // Reset alpha
  ctx.globalAlpha = 1;
}
