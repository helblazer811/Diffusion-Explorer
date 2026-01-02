export interface TrajectoryOutlineOptions {
  color?: string;      // Outline color (default: black)
  width?: number;      // Outline width in pixels (default: strokeWidth + 2)
  opacity?: number;    // Outline opacity (default: same as stroke opacity)
}

export interface HeadStyle {
  type: 'circle' | 'arrow';  // Shape of head marker (default: 'circle')
  radius?: number;           // Radius for circle, or size for arrow (default: pointRadius)
  color?: string;            // Head color (default: same as trajectory color)
  opacity?: number;          // Head opacity (default: same as trajectory opacity)
  arrowAngle?: number;       // Arrow head angle in radians (default: Math.PI / 6)
}

export interface TrajectoryStyleOptions {
  strokeWidth: number;
  color: string;
  progressOpacity: number;
  pointRadius: number;
  showPreview?: boolean;
  previewOpacity?: number;
  showHeadMarker?: boolean; // Whether to show marker at trajectory head (default: true)
  outline?: TrajectoryOutlineOptions; // Optional outline around trajectory
  headStyle?: HeadStyle;    // Head marker styling (default: circle)
}

/**
 * Draws a head marker at the specified position.
 * @param ctx - Canvas 2D rendering context
 * @param x - X position
 * @param y - Y position
 * @param prevX - Previous X position (for arrow direction)
 * @param prevY - Previous Y position (for arrow direction)
 * @param style - Head style options
 * @param defaultRadius - Default radius if not specified in style
 * @param defaultColor - Default color if not specified in style
 * @param defaultOpacity - Default opacity if not specified in style
 */
function drawHeadMarker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  prevX: number,
  prevY: number,
  style: HeadStyle | undefined,
  defaultRadius: number,
  defaultColor: string,
  defaultOpacity: number
): void {
  const headType = style?.type ?? 'circle';
  const radius = style?.radius ?? defaultRadius;
  const color = style?.color ?? defaultColor;
  const opacity = style?.opacity ?? defaultOpacity;

  ctx.fillStyle = color;
  ctx.globalAlpha = opacity;

  if (headType === 'arrow') {
    // Calculate direction from previous point
    const angle = Math.atan2(y - prevY, x - prevX);
    const arrowAngle = style?.arrowAngle ?? Math.PI / 6;

    // Draw arrow head as a triangle
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(
      x - radius * Math.cos(angle - arrowAngle),
      y - radius * Math.sin(angle - arrowAngle)
    );
    ctx.lineTo(
      x - radius * Math.cos(angle + arrowAngle),
      y - radius * Math.sin(angle + arrowAngle)
    );
    ctx.closePath();
    ctx.fill();
  } else {
    // Default: circle
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.fill();
  }
}

/**
 * Draws trajectories with fading opacity gradient showing only recent segments.
 * Takes pre-transformed pixel coordinates.
 * @param ctx - Canvas 2D rendering context
 * @param trajectories - Array of trajectories in pixel coords: [trajectory][timestep][x,y]
 * @param segmentIndex - Current segment index for animation progress
 * @param style - Trajectory styling options
 * @param alphaTimeWindow - Fraction (0-1) of trajectory to show with fading opacity
 */
export function drawTrajectoriesWithOpacityGradient(
  ctx: CanvasRenderingContext2D,
  trajectories: number[][][],
  segmentIndex: number,
  style: TrajectoryStyleOptions,
  alphaTimeWindow: number
): void {
  const numTrajectories = trajectories.length;
  if (numTrajectories === 0) return;

  ctx.lineWidth = style.strokeWidth;
  ctx.strokeStyle = style.color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (let i = 0; i < numTrajectories; i++) {
    const points = trajectories[i]; // [timestep][x,y] in pixel coords

    // Draw full trajectory preview (lighter) - only if enabled
    if (style.showPreview && style.previewOpacity !== undefined) {
      ctx.globalAlpha = style.previewOpacity;
      ctx.beginPath();
      for (let j = 0; j < points.length; j++) {
        const [x, y] = points[j];
        j === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Calculate visible window
    const headIdx = Math.min(segmentIndex + 1, points.length - 1);
    const windowSize = Math.max(1, Math.floor(alphaTimeWindow * points.length));
    const startIdx = Math.max(0, headIdx - windowSize);

    // Draw each segment with fading opacity
    if (headIdx > startIdx) {
      for (let j = startIdx; j < headIdx; j++) {
        // Calculate opacity: 0 at startIdx, progressOpacity at headIdx
        const progress = (j - startIdx + 1) / (headIdx - startIdx);
        ctx.globalAlpha = progress * style.progressOpacity;

        // Draw single segment from j to j+1
        const [x1, y1] = points[j];
        const [x2, y2] = points[j + 1];

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    }

    // Draw marker at head position (unless disabled)
    if (style.showHeadMarker !== false) {
      const [mx, my] = points[headIdx];
      const prevIdx = Math.max(0, headIdx - 1);
      const [px, py] = points[prevIdx];
      drawHeadMarker(
        ctx, mx, my, px, py,
        style.headStyle,
        style.pointRadius,
        style.color,
        style.progressOpacity
      );
    }
  }

  // Reset alpha
  ctx.globalAlpha = 1;
}

/**
 * Draws trajectories with a low-opacity preview of the full path and animated progress.
 * Takes pre-transformed pixel coordinates.
 * @param ctx - Canvas 2D rendering context
 * @param trajectories - Array of trajectories in pixel coords: [trajectory][timestep][x,y]
 * @param segmentIndex - Current segment index for animation progress
 * @param style - Trajectory styling options
 */
export function drawTrajectoriesWithPreview(
  ctx: CanvasRenderingContext2D,
  trajectories: number[][][],
  segmentIndex: number,
  style: TrajectoryStyleOptions
): void {
  const numTrajectories = trajectories.length;
  if (numTrajectories === 0) return;

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const outline = style.outline;
  const outlineWidth = outline?.width ?? style.strokeWidth + 2;
  const outlineColor = outline?.color ?? "#000000";
  const outlineOpacity = outline?.opacity ?? style.progressOpacity;

  for (let i = 0; i < numTrajectories; i++) {
    const points = trajectories[i]; // [timestep][x,y] in pixel coords

    // 1. Draw full trajectory preview (low opacity)
    if (style.showPreview !== false) {
      // Draw outline for preview if specified
      if (outline) {
        ctx.lineWidth = outlineWidth;
        ctx.strokeStyle = outlineColor;
        ctx.globalAlpha = (style.previewOpacity ?? 0.15) * (outlineOpacity / style.progressOpacity);
        ctx.beginPath();
        for (let j = 0; j < points.length; j++) {
          const [x, y] = points[j];
          j === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      // Draw main preview stroke
      ctx.lineWidth = style.strokeWidth;
      ctx.strokeStyle = style.color;
      ctx.globalAlpha = style.previewOpacity ?? 0.15;
      ctx.beginPath();
      for (let j = 0; j < points.length; j++) {
        const [x, y] = points[j];
        j === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // 2. Draw animated path up to the current segment
    // Draw outline first if specified
    if (outline) {
      ctx.lineWidth = outlineWidth;
      ctx.strokeStyle = outlineColor;
      ctx.globalAlpha = outlineOpacity;
      ctx.beginPath();
      for (let j = 0; j <= segmentIndex + 1 && j < points.length; j++) {
        const [x, y] = points[j];
        j === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // Draw main stroke on top
    ctx.lineWidth = style.strokeWidth;
    ctx.strokeStyle = style.color;
    ctx.globalAlpha = style.progressOpacity;
    ctx.beginPath();
    for (let j = 0; j <= segmentIndex + 1 && j < points.length; j++) {
      const [x, y] = points[j];
      j === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // 3. Draw marker at head position
    const markerIdx = Math.min(segmentIndex + 1, points.length - 1);
    const [mx, my] = points[markerIdx];
    const prevIdx = Math.max(0, markerIdx - 1);
    const [px, py] = points[prevIdx];

    // Draw outline for marker if specified (only for circle type)
    if (outline && (!style.headStyle || style.headStyle.type === 'circle')) {
      ctx.beginPath();
      ctx.arc(mx, my, style.pointRadius + (outlineWidth - style.strokeWidth) / 2, 0, 2 * Math.PI);
      ctx.fillStyle = outlineColor;
      ctx.globalAlpha = outlineOpacity;
      ctx.fill();
    }

    // Draw main marker using head style
    drawHeadMarker(
      ctx, mx, my, px, py,
      style.headStyle,
      style.pointRadius,
      style.color,
      style.progressOpacity
    );
  }

  // Reset alpha
  ctx.globalAlpha = 1;
}

