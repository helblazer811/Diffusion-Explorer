import { drawArrowHead } from './utils';

export interface PartialTrajectoryOptions {
  color: string;
  strokeWidth: number;
  pointRadius: number;
  opacity?: number;           // Default: 1.0
  headType?: 'circle' | 'arrow';  // Default: 'circle'
  arrowRadius?: number;       // Override arrow head size (default: pointRadius * 3.5)
  xScale: (x: number) => number;  // Domain to pixel scale
  yScale: (y: number) => number;  // Domain to pixel scale
}

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
 * Draws a partial trajectory up to the current segment with interpolation.
 * Takes domain coordinates and scale functions.
 * @param ctx - Canvas 2D rendering context
 * @param trajectory - Single trajectory in domain coords: [timestep][x,y]
 * @param segmentIndex - Current segment index (0-based)
 * @param segmentProgress - Progress within current segment (0-1)
 * @param options - Styling and scale options
 */
export function drawPartialTrajectory(
  ctx: CanvasRenderingContext2D,
  trajectory: number[][],
  segmentIndex: number,
  segmentProgress: number,
  options: PartialTrajectoryOptions
): void {
  if (!trajectory || trajectory.length < 2) return;

  const { color, strokeWidth, pointRadius, xScale, yScale } = options;
  const opacity = options.opacity ?? 1.0;
  const headType = options.headType ?? 'circle';
  const arrowRadius = options.arrowRadius ?? pointRadius * 3.5;

  // Determine if we're interpolating within a segment
  const isInterpolating = segmentIndex < trajectory.length - 1 && segmentProgress > 0;

  // Calculate endpoint and previous point for direction
  let endX: number, endY: number, prevX: number, prevY: number;

  if (isInterpolating) {
    const fromPt = trajectory[segmentIndex];
    const toPt = trajectory[segmentIndex + 1];
    const interpX = fromPt[0] + (toPt[0] - fromPt[0]) * segmentProgress;
    const interpY = fromPt[1] + (toPt[1] - fromPt[1]) * segmentProgress;

    endX = xScale(interpX);
    endY = yScale(interpY);
    prevX = xScale(fromPt[0]);
    prevY = yScale(fromPt[1]);
  } else {
    const idx = Math.min(segmentIndex, trajectory.length - 1);
    const pt = trajectory[idx];
    const prevPt = trajectory[Math.max(0, idx - 1)];
    endX = xScale(pt[0]);
    endY = yScale(pt[1]);
    prevX = xScale(prevPt[0]);
    prevY = yScale(prevPt[1]);
  }

  // For arrows, calculate where line should stop (behind arrow base so line end is hidden)
  let lineEndX = endX, lineEndY = endY;
  if (headType === 'arrow') {
    const dist = Math.hypot(endX - prevX, endY - prevY);
    // Stop line a bit further back than arrow base to hide rectangular line end behind arrow
    const lineStopDistance = arrowRadius + strokeWidth * 0.5;
    if (dist > lineStopDistance) {
      const angle = Math.atan2(endY - prevY, endX - prevX);
      lineEndX = endX - lineStopDistance * Math.cos(angle);
      lineEndY = endY - lineStopDistance * Math.sin(angle);
    }
  }

  ctx.globalAlpha = opacity;
  ctx.strokeStyle = color;
  ctx.lineWidth = strokeWidth;

  // Use appropriate line styling based on head type
  if (headType === 'arrow') {
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";
  } else {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }

  ctx.beginPath();
  ctx.moveTo(xScale(trajectory[0][0]), yScale(trajectory[0][1]));

  if (isInterpolating) {
    // Draw completed segments up to (not including) current segment
    for (let i = 1; i <= segmentIndex && i < trajectory.length; i++) {
      ctx.lineTo(xScale(trajectory[i][0]), yScale(trajectory[i][1]));
    }
    // Draw partial segment to shortened line end
    ctx.lineTo(lineEndX, lineEndY);
  } else {
    // Draw all segments up to (not including) the last point
    const lastIdx = Math.min(segmentIndex, trajectory.length - 1);
    for (let i = 1; i < lastIdx; i++) {
      ctx.lineTo(xScale(trajectory[i][0]), yScale(trajectory[i][1]));
    }
    // Draw final segment to shortened line end
    if (lastIdx > 0) {
      ctx.lineTo(prevX, prevY);
    }
    ctx.lineTo(lineEndX, lineEndY);
  }

  ctx.stroke();

  // Draw head marker
  ctx.fillStyle = color;
  if (headType === 'arrow') {
    drawArrowHead(ctx, prevX, prevY, endX, endY, arrowRadius);
  } else {
    ctx.beginPath();
    ctx.arc(endX, endY, pointRadius, 0, 2 * Math.PI);
    ctx.fill();
  }

  ctx.globalAlpha = 1.0;
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
      const headType = style.headStyle?.type ?? 'circle';
      const radius = style.headStyle?.radius ?? style.pointRadius;

      ctx.fillStyle = style.headStyle?.color ?? style.color;
      ctx.globalAlpha = style.headStyle?.opacity ?? style.progressOpacity;

      if (headType === 'arrow') {
        drawArrowHead(ctx, px, py, mx, my, radius);
      } else {
        ctx.beginPath();
        ctx.arc(mx, my, radius, 0, 2 * Math.PI);
        ctx.fill();
      }
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

    // Draw marker
    const headType = style.headStyle?.type ?? 'circle';
    const radius = style.headStyle?.radius ?? style.pointRadius;

    // Draw outline for marker if specified (only for circle type)
    if (outline && headType === 'circle') {
      ctx.beginPath();
      ctx.arc(mx, my, style.pointRadius + (outlineWidth - style.strokeWidth) / 2, 0, 2 * Math.PI);
      ctx.fillStyle = outlineColor;
      ctx.globalAlpha = outlineOpacity;
      ctx.fill();
    }

    // Draw main marker
    ctx.fillStyle = style.headStyle?.color ?? style.color;
    ctx.globalAlpha = style.headStyle?.opacity ?? style.progressOpacity;

    if (headType === 'arrow') {
      drawArrowHead(ctx, px, py, mx, my, radius);
    } else {
      ctx.beginPath();
      ctx.arc(mx, my, radius, 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  // Reset alpha
  ctx.globalAlpha = 1;
}

