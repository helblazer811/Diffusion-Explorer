export interface TextStyleOptions {
  font?: string;           // Default: '22px Helvetica, Arial, sans-serif'
  color?: string;          // Default: '#666'
  opacity?: number;        // Default: 1
  align?: 'left' | 'center' | 'right';  // Default: 'center'
  baseline?: 'top' | 'middle' | 'bottom';  // Default: 'top'
  offsetX?: number;        // Default: 0
  offsetY?: number;        // Default: 0
}

/**
 * Draws text on the canvas at a given position
 * @param ctx - Canvas 2D rendering context
 * @param text - The text to draw
 * @param x - X coordinate (before offset)
 * @param y - Y coordinate (before offset)
 * @param options - Styling options
 */
export function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  options?: TextStyleOptions
): void {
  const {
    font = '22px Helvetica, Arial, sans-serif',
    color = '#666',
    opacity = 1,
    align = 'center',
    baseline = 'top',
    offsetX = 0,
    offsetY = 0
  } = options ?? {};

  ctx.save();
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.globalAlpha = opacity;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(text, x + offsetX, y + offsetY);
  ctx.restore();
}

export interface ScatterPlotOutlineOptions {
  color?: string;      // Outline color (default: same as fill)
  width?: number;      // Outline width in pixels (default: 1)
  opacity?: number;    // Outline opacity (default: same as fill opacity)
}

/**
 * Draws a scatter plot from pixel coordinates
 * @param ctx - Canvas 2D rendering context
 * @param pixelCoords - Array of [x, y] coordinates in pixel space
 * @param radius - Point radius in pixels
 * @param fill - Fill color
 * @param opacity - Point opacity (0-1)
 * @param outline - Optional outline/stroke options
 */
export function drawScatterPlot(
  ctx: CanvasRenderingContext2D,
  pixelCoords: number[][],
  radius: number,
  fill: string,
  opacity: number,
  outline?: ScatterPlotOutlineOptions
): void {
  ctx.fillStyle = fill;

  for (const [x, y] of pixelCoords) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);

    // Fill
    ctx.globalAlpha = opacity;
    ctx.fill();

    // Stroke outline if specified
    if (outline) {
      ctx.strokeStyle = outline.color ?? fill;
      ctx.lineWidth = outline.width ?? 1;
      ctx.globalAlpha = outline.opacity ?? opacity;
      ctx.stroke();
    }
  }

  // Reset alpha
  ctx.globalAlpha = 1;
}
