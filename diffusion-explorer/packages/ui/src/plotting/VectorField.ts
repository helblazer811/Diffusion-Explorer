export interface VectorFieldStyleOptions {
  arrowScale: number;      // How much to scale normalized velocities
  strokeWidth: number;     // Line width
  color: string;           // Arrow color
  opacity: number;         // Arrow opacity
  headRadius?: number;     // Arrowhead radius (default: 8)
  normalizeVectors?: boolean; // If true, all arrows same length (unit vectors)
}

/**
 * Draws a single arrow with an equilateral triangle head
 * @param ctx - Canvas 2D rendering context
 * @param fromX - Start x coordinate
 * @param fromY - Start y coordinate
 * @param toX - End x coordinate (tip of arrow)
 * @param toY - End y coordinate (tip of arrow)
 * @param headRadius - Radius of the arrowhead triangle
 */
export function drawArrow(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  headRadius: number
): void {
  const angle = Math.atan2(toY - fromY, toX - fromX);

  // Draw arrow line
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();

  // Draw equilateral triangle arrowhead centered at tip
  let headAngle = angle;
  ctx.beginPath();
  ctx.moveTo(
    toX + headRadius * Math.cos(headAngle),
    toY + headRadius * Math.sin(headAngle)
  );

  headAngle += (2 * Math.PI) / 3;
  ctx.lineTo(
    toX + headRadius * Math.cos(headAngle),
    toY + headRadius * Math.sin(headAngle)
  );

  headAngle += (2 * Math.PI) / 3;
  ctx.lineTo(
    toX + headRadius * Math.cos(headAngle),
    toY + headRadius * Math.sin(headAngle)
  );

  ctx.closePath();
  ctx.fill();
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
  ctx.globalAlpha = 1;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
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

    drawArrow(ctx, x, y, x + dx, y + dy, headRadius);
  }

  ctx.restore();
}
