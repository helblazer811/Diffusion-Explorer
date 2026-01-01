/**
 * Mesh grid plotting utilities for visualizing coordinate transformations.
 */

export interface MeshGridStyleOptions {
  color?: string;
  opacity?: number;
  strokeWidth?: number;
}

/**
 * Plots a mesh grid on a canvas context.
 *
 * @param ctx - The canvas 2D rendering context
 * @param grid - A 3D array of shape [width][height][2] where each cell contains [x, y] pixel coordinates
 * @param style - Optional styling options for the grid lines
 */
export function plotMeshGrid(
  ctx: CanvasRenderingContext2D,
  grid: number[][][],
  style?: MeshGridStyleOptions
): void {
  const { color = '#666', opacity = 1, strokeWidth = 1 } = style ?? {};

  const width = grid.length;
  if (width === 0) return;
  const height = grid[0].length;
  if (height === 0) return;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = strokeWidth;
  ctx.globalAlpha = opacity;

  ctx.beginPath();

  // Draw horizontal lines (connect across columns for each row)
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width - 1; i++) {
      const [x1, y1] = grid[i][j];
      const [x2, y2] = grid[i + 1][j];
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    }
  }

  // Draw vertical lines (connect across rows for each column)
  for (let i = 0; i < width; i++) {
    for (let j = 0; j < height - 1; j++) {
      const [x1, y1] = grid[i][j];
      const [x2, y2] = grid[i][j + 1];
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    }
  }

  ctx.stroke();
  ctx.restore();
  ctx.globalAlpha = 1;
}
