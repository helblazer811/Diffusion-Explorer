import { drawArrowHead } from '../../utils';
import type {
  TrajectoryStyleOptions,
  TrajectoryOutlineOptions,
  HeadStyle,
} from '../types';

// Re-export types for backwards compatibility
export type { TrajectoryStyleOptions, TrajectoryOutlineOptions, HeadStyle };

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

    // Skip empty or undefined trajectories
    if (!points || points.length === 0) continue;

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
      const subdivisions = style.gradientSubdivisions ?? 1;

      for (let j = startIdx; j < headIdx; j++) {
        const [x1, y1] = points[j];
        const [x2, y2] = points[j + 1];

        for (let k = 0; k < subdivisions; k++) {
          // Calculate overall progress through visible window
          const segmentStart = (j - startIdx) / (headIdx - startIdx);
          const segmentEnd = (j - startIdx + 1) / (headIdx - startIdx);
          const subProgress = (k + 0.5) / subdivisions;
          const overallProgress = segmentStart + (segmentEnd - segmentStart) * subProgress;

          ctx.globalAlpha = overallProgress * style.opacity;

          // Draw sub-segment
          const t0 = k / subdivisions;
          const t1 = (k + 1) / subdivisions;
          const sx1 = x1 + (x2 - x1) * t0;
          const sy1 = y1 + (y2 - y1) * t0;
          const sx2 = x1 + (x2 - x1) * t1;
          const sy2 = y1 + (y2 - y1) * t1;

          ctx.beginPath();
          ctx.moveTo(sx1, sy1);
          ctx.lineTo(sx2, sy2);
          ctx.stroke();
        }
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
      ctx.globalAlpha = style.headStyle?.opacity ?? style.opacity;

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
 * Draws trajectories with animated progress and optional low-opacity preview of full path.
 * Takes pre-transformed pixel coordinates.
 * @param ctx - Canvas 2D rendering context
 * @param trajectories - Array of trajectories in pixel coords: [trajectory][timestep][x,y]
 * @param segmentIndex - Current segment index for animation progress
 * @param style - Trajectory styling options (showPreview defaults to false)
 */
export function drawTrajectories(
  ctx: CanvasRenderingContext2D,
  trajectories: number[][][],
  segmentIndex: number,
  style: TrajectoryStyleOptions
): void {
  if (segmentIndex === undefined || segmentIndex === null || isNaN(segmentIndex)) {
    throw new Error(`drawTrajectories: segmentIndex is invalid (${segmentIndex})`);
  }

  const numTrajectories = trajectories.length;
  if (numTrajectories === 0) return;

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const outline = style.outline;
  const outlineStrokeWidth = outline?.strokeWidth ?? 2;
  const outlineWidth = style.strokeWidth + outlineStrokeWidth;
  const outlineColor = outline?.color ?? "#000000";
  const outlineOpacity = outline?.opacity ?? style.opacity;

  for (let i = 0; i < numTrajectories; i++) {
    const points = trajectories[i]; // [timestep][x,y] in pixel coords

    // Skip empty or undefined trajectories
    if (!points || points.length === 0) continue;

    // 1. Draw full trajectory preview (low opacity) - only if explicitly enabled
    if (style.showPreview) {
      // Draw outline for preview if specified
      if (outline) {
        ctx.lineWidth = outlineWidth;
        ctx.strokeStyle = outlineColor;
        ctx.globalAlpha = (style.previewOpacity ?? 0.15) * (outlineOpacity / style.opacity);
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
    const segmentAlphas = style.perSegmentAlphas?.[i];

    if (segmentAlphas) {
      // Per-segment alpha mode: draw each segment with interpolated alpha gradient
      const subdivisions = style.gradientSubdivisions ?? 1;

      for (let j = 0; j < points.length - 1; j++) {
        const alpha = segmentAlphas[j] ?? 0;
        const nextAlpha = segmentAlphas[j + 1] ?? 0;

        // Skip if both ends are invisible
        if (alpha <= 0 && nextAlpha <= 0) continue;

        const [x1, y1] = points[j];
        const [x2, y2] = points[j + 1];

        for (let k = 0; k < subdivisions; k++) {
          const t0 = k / subdivisions;
          const t1 = (k + 1) / subdivisions;
          // Interpolate alpha at midpoint of sub-segment
          const subAlpha = alpha + (nextAlpha - alpha) * ((k + 0.5) / subdivisions);

          if (subAlpha <= 0) continue;

          const sx1 = x1 + (x2 - x1) * t0;
          const sy1 = y1 + (y2 - y1) * t0;
          const sx2 = x1 + (x2 - x1) * t1;
          const sy2 = y1 + (y2 - y1) * t1;

          // Draw outline first if specified
          if (outline) {
            ctx.lineWidth = outlineWidth;
            ctx.strokeStyle = outlineColor;
            ctx.globalAlpha = subAlpha * (outlineOpacity / style.opacity);
            ctx.beginPath();
            ctx.moveTo(sx1, sy1);
            ctx.lineTo(sx2, sy2);
            ctx.stroke();
          }

          // Draw main stroke
          ctx.lineWidth = style.strokeWidth;
          ctx.strokeStyle = style.color;
          ctx.globalAlpha = subAlpha;
          ctx.beginPath();
          ctx.moveTo(sx1, sy1);
          ctx.lineTo(sx2, sy2);
          ctx.stroke();
        }
      }
    } else {
      // Default mode: draw path up to segmentIndex with uniform opacity
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
      ctx.globalAlpha = style.opacity;
      ctx.beginPath();
      for (let j = 0; j <= segmentIndex + 1 && j < points.length; j++) {
        const [x, y] = points[j];
        j === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

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
    ctx.globalAlpha = style.headStyle?.opacity ?? style.opacity;

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

