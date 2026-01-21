/**
 * CPU-based streamline drawing utilities using Canvas 2D.
 *
 * Provides functions for rendering static and animated streamlines
 * with optional chevron direction indicators.
 */

/**
 * Chevron style options for direction indicators on streamlines.
 */
export interface ChevronStyle {
  /** Distance between chevrons in pixels (default: 40) */
  spacingPixels?: number;
  /** Length of each chevron leg in pixels (default: 6) */
  size?: number;
  /** Angle from perpendicular in radians (default: Math.PI/6 = 30 degrees) */
  angle?: number;
  /** Stroke width ratio relative to streamline width (default: 0.6) */
  strokeWidthRatio?: number;
}

/**
 * Options for drawing streamlines.
 */
export interface DrawStreamlinesOptions {
  /** Stroke color */
  color: string;
  /** Stroke width in pixels */
  strokeWidth: number;
  /** Opacity (0-1, default: 1) */
  opacity?: number;
  /** Optional chevron direction indicators */
  chevron?: ChevronStyle;
}

/**
 * Private helper to draw chevron direction indicators on streamlines.
 * Batches all chevrons into a single path for efficient rendering.
 */
function _drawChevrons(
  ctx: CanvasRenderingContext2D,
  streamlines: number[][][],
  options: DrawStreamlinesOptions
): void {
  const chevron = options.chevron!;
  const spacingPixels = chevron.spacingPixels ?? 40;
  const size = chevron.size ?? 6;
  const angle = chevron.angle ?? Math.PI / 6; // 30 degrees from perpendicular
  const strokeWidthRatio = chevron.strokeWidthRatio ?? 0.6;

  // Precompute trig values
  const cosAngle = Math.cos(angle);
  const sinAngle = Math.sin(angle);

  ctx.strokeStyle = options.color;
  ctx.lineWidth = options.strokeWidth * strokeWidthRatio;
  ctx.lineCap = 'round';
  ctx.globalAlpha = options.opacity ?? 1;

  // Batch all chevrons into a single path
  ctx.beginPath();

  for (const streamline of streamlines) {
    if (streamline.length < 2) continue;

    // Compute cumulative arc length and place chevrons at fixed intervals
    let cumulativeLength = 0;
    let nextChevronPos = spacingPixels / 2; // Start at half spacing for centering

    for (let i = 1; i < streamline.length; i++) {
      const [x0, y0] = streamline[i - 1];
      const [x1, y1] = streamline[i];
      const dx = x1 - x0;
      const dy = y1 - y0;
      const segmentLength = Math.sqrt(dx * dx + dy * dy);

      if (segmentLength === 0) continue;

      const startLength = cumulativeLength;
      const endLength = cumulativeLength + segmentLength;

      // Place chevrons within this segment
      while (nextChevronPos <= endLength) {
        // Interpolate position along segment
        const t = (nextChevronPos - startLength) / segmentLength;
        const cx = x0 + t * dx;
        const cy = y0 + t * dy;

        // Compute tangent direction (normalized)
        const tx = dx / segmentLength;
        const ty = dy / segmentLength;

        // Perpendicular to tangent
        const perpX = -ty;
        const perpY = tx;

        // Left leg: backward + angled left
        const leftX = -tx * cosAngle + perpX * sinAngle;
        const leftY = -ty * cosAngle + perpY * sinAngle;

        // Right leg: backward + angled right
        const rightX = -tx * cosAngle - perpX * sinAngle;
        const rightY = -ty * cosAngle - perpY * sinAngle;

        // Add chevron to path (moveTo breaks the subpath so each chevron is separate)
        ctx.moveTo(cx + leftX * size, cy + leftY * size);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx + rightX * size, cy + rightY * size);

        nextChevronPos += spacingPixels;
      }

      cumulativeLength = endLength;
    }
  }

  // Single stroke call for all chevrons
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/**
 * Draw streamlines on a canvas context.
 *
 * @param ctx - Canvas 2D rendering context
 * @param streamlines - Array of streamlines in pixel coords: [streamline][point][x,y]
 * @param options - Styling options including optional chevron markers
 */
export function drawStreamlines(
  ctx: CanvasRenderingContext2D,
  streamlines: number[][][],
  options: DrawStreamlinesOptions
): void {
  const startTime = performance.now();
  const { color, strokeWidth, opacity = 1 } = options;

  // Count total points for logging
  let totalPoints = 0;
  for (const s of streamlines) totalPoints += s.length;

  ctx.strokeStyle = color;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = opacity;

  // Draw streamline curves - batched into single path
  const curvesStart = performance.now();
  ctx.beginPath();
  for (const streamline of streamlines) {
    if (streamline.length < 2) continue;

    ctx.moveTo(streamline[0][0], streamline[0][1]);
    for (let i = 1; i < streamline.length; i++) {
      ctx.lineTo(streamline[i][0], streamline[i][1]);
    }
  }
  ctx.stroke();
  const curvesTime = performance.now() - curvesStart;

  // Draw chevrons if specified
  let chevronsTime = 0;
  if (options.chevron) {
    const chevronsStart = performance.now();
    _drawChevrons(ctx, streamlines, options);
    chevronsTime = performance.now() - chevronsStart;
  }

  ctx.globalAlpha = 1;

  const totalTime = performance.now() - startTime;
  console.log(
    `[drawStreamlines] ${streamlines.length} streamlines, ${totalPoints} points | ` +
    `curves: ${curvesTime.toFixed(2)}ms, chevrons: ${chevronsTime.toFixed(2)}ms, total: ${totalTime.toFixed(2)}ms`
  );
}

/**
 * Create a Path2D from streamlines for efficient repeated drawing.
 *
 * Pre-computing Path2D objects allows the browser to cache the path geometry,
 * making repeated draws much faster than rebuilding paths with moveTo/lineTo.
 *
 * @param streamlines - Array of streamlines in pixel coordinates: [streamline][point][x,y]
 * @returns A Path2D containing all streamlines
 */
export function generateStreamlinePath2D(streamlines: number[][][]): Path2D {
  const path = new Path2D();
  for (const streamline of streamlines) {
    if (streamline.length < 2) continue;
    path.moveTo(streamline[0][0], streamline[0][1]);
    for (let i = 1; i < streamline.length; i++) {
      path.lineTo(streamline[i][0], streamline[i][1]);
    }
  }
  return path;
}

/**
 * Options for drawing a pre-computed streamline Path2D.
 */
export interface DrawStreamlinePathOptions {
  /** Stroke color */
  color: string;
  /** Stroke width in pixels */
  strokeWidth: number;
  /** Opacity (0-1, default: 1) */
  opacity?: number;
}

/**
 * Draw a pre-computed streamline Path2D.
 *
 * This is the fast path for rendering streamlines when geometry doesn't change.
 * Use generateStreamlinePath2D() to create the path once, then call this repeatedly.
 *
 * @param ctx - Canvas 2D rendering context
 * @param path - Pre-computed Path2D from generateStreamlinePath2D()
 * @param options - Styling options
 */
export function drawStreamlinePath(
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  options: DrawStreamlinePathOptions
): void {
  const { color, strokeWidth, opacity = 1 } = options;

  ctx.strokeStyle = color;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = opacity;
  ctx.stroke(path);
  ctx.globalAlpha = 1;
}
