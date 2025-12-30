export interface TrajectoryStyleOptions {
  strokeWidth: number;
  color: string;
  progressOpacity: number;
  pointRadius: number;
  showPreview?: boolean;
  previewOpacity?: number;
  showHeadMarker?: boolean; // Whether to show dot at trajectory head (default: true)
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
      ctx.beginPath();
      ctx.arc(mx, my, style.pointRadius, 0, 2 * Math.PI);
      ctx.fillStyle = style.color;
      ctx.globalAlpha = style.progressOpacity;
      ctx.fill();
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

  ctx.lineWidth = style.strokeWidth;
  ctx.strokeStyle = style.color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (let i = 0; i < numTrajectories; i++) {
    const points = trajectories[i]; // [timestep][x,y] in pixel coords

    // 1. Draw full trajectory preview (low opacity)
    if (style.showPreview !== false) {
      ctx.globalAlpha = style.previewOpacity ?? 0.15;
      ctx.beginPath();
      for (let j = 0; j < points.length; j++) {
        const [x, y] = points[j];
        j === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // 2. Draw animated path up to the current segment
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
    ctx.beginPath();
    ctx.arc(mx, my, style.pointRadius, 0, 2 * Math.PI);
    ctx.fillStyle = style.color;
    ctx.globalAlpha = style.progressOpacity;
    ctx.fill();
  }

  // Reset alpha
  ctx.globalAlpha = 1;
}
