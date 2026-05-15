// Source - https://stackoverflow.com/a/12646864
// Posted by ChristopheD, modified by community. See post 'Timeline' for change history
// Retrieved 2026-01-27, License - CC BY-SA 4.0
/**
 * Shuffles array in place using Fisher-Yates algorithm
 */
export function shuffleArray<T>(array: T[]): void {
  let currentIndex = array.length;

  // While there remain elements to shuffle...
  while (currentIndex != 0) {
    // Pick a remaining element...
    let randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;

    // And swap it with the current element.
    [array[currentIndex], array[randomIndex]] = [
      array[randomIndex],
      array[currentIndex],
    ];
  }
}

/**
 * Draws a line segment. If color/lineW/opacity are provided, applies them
 * inside a save/restore pair. Otherwise inherits whatever style is set on ctx
 * (preserving the original lightweight call shape used by vector_field).
 */
export function drawLine(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  color?: string,
  lineW?: number,
  opacity: number = 1
): void {
  const styled = color !== undefined || lineW !== undefined || opacity !== 1;
  if (styled) {
    ctx.save();
    ctx.globalAlpha = opacity;
    if (color !== undefined) ctx.strokeStyle = color;
    if (lineW !== undefined) ctx.lineWidth = lineW;
  }
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();
  if (styled) ctx.restore();
}

/**
 * Draws a filled circle with save/restore semantics.
 */
export function drawCircle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  opacity: number = 1
): void {
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Draws just the arrowhead (equilateral triangle) without the line
 * @param ctx - Canvas 2D rendering context
 * @param fromX - Previous point x (for direction calculation)
 * @param fromY - Previous point y (for direction calculation)
 * @param toX - Tip x coordinate
 * @param toY - Tip y coordinate
 * @param headRadius - Radius of the arrowhead triangle
 */
export function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  headRadius: number
): void {
  const angle = Math.atan2(toY - fromY, toX - fromX);

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
