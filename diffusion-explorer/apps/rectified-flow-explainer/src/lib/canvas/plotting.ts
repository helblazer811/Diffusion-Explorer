export interface VectorFieldStyleOptions {
  arrowScale: number;      // How much to scale normalized velocities
  strokeWidth: number;     // Line width
  color: string;           // Arrow color
  opacity: number;         // Arrow opacity
  headLength?: number;     // Arrowhead length (default: 8)
  headAngle?: number;      // Arrowhead angle in radians (default: Math.PI / 6)
  normalizeVectors?: boolean; // If true, all arrows same length (unit vectors)
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

  const headLength = style.headLength ?? 8;
  const headAngle = style.headAngle ?? Math.PI / 6;

  // Calculate max velocity magnitude for normalization
  let maxMagnitude = 0;
  for (const [vx, vy] of velocities) {
    const magnitude = Math.sqrt(vx * vx + vy * vy);
    if (magnitude > maxMagnitude) maxMagnitude = magnitude;
  }
  if (maxMagnitude === 0) maxMagnitude = 1;

  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.strokeWidth;
  ctx.globalAlpha = style.opacity;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

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

    const endX = x + dx;
    const endY = y + dy;
    const angle = Math.atan2(dy, dx);

    // Calculate arrowhead base position (where line should stop)
    const baseX = endX - headLength * Math.cos(angle);
    const baseY = endY - headLength * Math.sin(angle);

    // Draw arrow line (stops at arrowhead base)
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(baseX, baseY);
    ctx.stroke();

    // Draw filled triangle arrowhead
    ctx.fillStyle = style.color;
    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(
      endX - headLength * Math.cos(angle - headAngle),
      endY - headLength * Math.sin(angle - headAngle)
    );
    ctx.lineTo(
      endX - headLength * Math.cos(angle + headAngle),
      endY - headLength * Math.sin(angle + headAngle)
    );
    ctx.closePath();
    ctx.fill();
  }

  // Reset alpha
  ctx.globalAlpha = 1;
}

/**
 * Draws a scatter plot from pixel coordinates
 * @param ctx - Canvas 2D rendering context
 * @param pixelCoords - Array of [x, y] coordinates in pixel space
 * @param radius - Point radius in pixels
 * @param fill - Fill color
 * @param opacity - Point opacity (0-1)
 */
export function drawScatterPlot(
  ctx: CanvasRenderingContext2D,
  pixelCoords: number[][],
  radius: number,
  fill: string,
  opacity: number
): void {
  ctx.fillStyle = fill;
  ctx.globalAlpha = opacity;

  for (const [x, y] of pixelCoords) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.fill();
  }

  // Reset alpha
  ctx.globalAlpha = 1;
}
