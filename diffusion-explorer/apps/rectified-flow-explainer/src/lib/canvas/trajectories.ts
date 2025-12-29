import type { ScaleLinear } from 'd3';

export interface TrajectoryStyleOptions {
  strokeWidth: number;
  color: string;
  progressOpacity: number;
  pointRadius: number;
  showPreview?: boolean;
  previewOpacity?: number;
}

/**
 * Draws animated trajectories on canvas up to the current segment index
 * @param ctx - Canvas 2D rendering context
 * @param trajectories - Array of trajectories: [timestep][sample][dim]
 * @param segmentIndex - Current segment index for animation progress
 * @param xScale - D3 scale for x-axis
 * @param yScale - D3 scale for y-axis
 * @param style - Trajectory styling options
 */
export function drawTrajectories(
  ctx: CanvasRenderingContext2D,
  trajectories: number[][][],
  segmentIndex: number,
  xScale: ScaleLinear<number, number>,
  yScale: ScaleLinear<number, number>,
  style: TrajectoryStyleOptions
): void {
  const numTrajectories = trajectories[0]?.length || 0;
  if (numTrajectories === 0) return;

  ctx.lineWidth = style.strokeWidth;
  ctx.strokeStyle = style.color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (let i = 0; i < numTrajectories; i++) {
    const points = trajectories.map((ts) => ts[i]);

    // Draw full trajectory preview (lighter) - only if enabled
    if (style.showPreview && style.previewOpacity !== undefined) {
      ctx.globalAlpha = style.previewOpacity;
      ctx.beginPath();
      for (let j = 0; j < points.length; j++) {
        const x = xScale(points[j][0]);
        const y = yScale(points[j][1]);
        j === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Draw path up to the current segment
    ctx.globalAlpha = style.progressOpacity;
    ctx.beginPath();
    for (let j = 0; j <= segmentIndex + 1 && j < points.length; j++) {
      const x = xScale(points[j][0]);
      const y = yScale(points[j][1]);
      j === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Draw marker at head position
    const markerIdx = Math.min(segmentIndex + 1, points.length - 1);
    const mx = xScale(points[markerIdx][0]);
    const my = yScale(points[markerIdx][1]);
    ctx.beginPath();
    ctx.arc(mx, my, style.pointRadius, 0, 2 * Math.PI);
    ctx.fillStyle = style.color;
    ctx.globalAlpha = style.progressOpacity;
    ctx.fill();
  }

  // Reset alpha
  ctx.globalAlpha = 1;
}

/**
 * Draws trajectories with fading opacity gradient showing only recent segments
 * @param ctx - Canvas 2D rendering context
 * @param trajectories - Array of trajectories: [timestep][sample][dim]
 * @param segmentIndex - Current segment index for animation progress
 * @param xScale - D3 scale for x-axis
 * @param yScale - D3 scale for y-axis
 * @param style - Trajectory styling options
 * @param alphaTimeWindow - Fraction (0-1) of trajectory to show with fading opacity
 */
export function drawTrajectoriesWithOpacityGradient(
  ctx: CanvasRenderingContext2D,
  trajectories: number[][][],
  segmentIndex: number,
  xScale: ScaleLinear<number, number>,
  yScale: ScaleLinear<number, number>,
  style: TrajectoryStyleOptions,
  alphaTimeWindow: number
): void {
  const numTrajectories = trajectories[0]?.length || 0;
  if (numTrajectories === 0) return;

  ctx.lineWidth = style.strokeWidth;
  ctx.strokeStyle = style.color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (let i = 0; i < numTrajectories; i++) {
    const points = trajectories.map((ts) => ts[i]);

    // Draw full trajectory preview (lighter) - only if enabled
    if (style.showPreview && style.previewOpacity !== undefined) {
      ctx.globalAlpha = style.previewOpacity;
      ctx.beginPath();
      for (let j = 0; j < points.length; j++) {
        const x = xScale(points[j][0]);
        const y = yScale(points[j][1]);
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
        const x1 = xScale(points[j][0]);
        const y1 = yScale(points[j][1]);
        const x2 = xScale(points[j + 1][0]);
        const y2 = yScale(points[j + 1][1]);

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    }

    // Draw marker at head position
    const mx = xScale(points[headIdx][0]);
    const my = yScale(points[headIdx][1]);
    ctx.beginPath();
    ctx.arc(mx, my, style.pointRadius, 0, 2 * Math.PI);
    ctx.fillStyle = style.color;
    ctx.globalAlpha = style.progressOpacity;
    ctx.fill();
  }

  // Reset alpha
  ctx.globalAlpha = 1;
}
