export interface TrajectoryOutlineOptions {
  color?: string;      // Outline color (default: black)
  width?: number;      // Outline width in pixels (default: strokeWidth + 2)
  opacity?: number;    // Outline opacity (default: same as stroke opacity)
}

export interface TrajectoryStyleOptions {
  strokeWidth: number;
  color: string;
  progressOpacity: number;
  pointRadius: number;
  showPreview?: boolean;
  previewOpacity?: number;
  showHeadMarker?: boolean; // Whether to show dot at trajectory head (default: true)
  outline?: TrajectoryOutlineOptions; // Optional outline around trajectory
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
    // Draw outline for marker if specified
    if (outline) {
      ctx.beginPath();
      ctx.arc(mx, my, style.pointRadius + (outlineWidth - style.strokeWidth) / 2, 0, 2 * Math.PI);
      ctx.fillStyle = outlineColor;
      ctx.globalAlpha = outlineOpacity;
      ctx.fill();
    }
    // Draw main marker
    ctx.beginPath();
    ctx.arc(mx, my, style.pointRadius, 0, 2 * Math.PI);
    ctx.fillStyle = style.color;
    ctx.globalAlpha = style.progressOpacity;
    ctx.fill();
  }

  // Reset alpha
  ctx.globalAlpha = 1;
}

// ========== SPATIAL HASH TRAJECTORY DRAWING ==========

function getCellsForSegment(
  x1: number, y1: number,
  x2: number, y2: number,
  cellSize: number
): string[] {
  const cells: string[] = [];
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.ceil(dist / (cellSize * 0.5));

  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;
    const x = x1 + t * (x2 - x1);
    const y = y1 + t * (y2 - y1);
    const cx = Math.floor(x / cellSize);
    const cy = Math.floor(y / cellSize);
    const key = `${cx},${cy}`;
    if (cells.length === 0 || cells[cells.length - 1] !== key) {
      cells.push(key);
    }
  }
  return cells;
}

interface SegmentEntry {
  trajIndex: number;
  time: number;
}

/**
 * Build spatial hash grid with temporal ordering.
 * Each cell contains a list of (trajIndex, time) entries in the order they were added,
 * which reflects temporal priority (earlier times first).
 */
export function buildSpatialHashGrid(
  trajectories: number[][][],
  cellSize: number = 10
): Map<string, SegmentEntry[]> {
  const grid = new Map<string, SegmentEntry[]>();

  const numTrajectories = trajectories.length;
  if (numTrajectories === 0) return grid;

  // Find max time across all trajectories
  let maxTime = 0;
  for (const traj of trajectories) {
    maxTime = Math.max(maxTime, traj.length - 1);
  }

  // Outer loop: time, Inner loop: trajectories
  // This gives us temporal ordering naturally
  for (let t = 1; t <= maxTime; t++) {
    for (let trajIndex = 0; trajIndex < numTrajectories; trajIndex++) {
      const traj = trajectories[trajIndex];
      if (t >= traj.length) continue;

      const [x1, y1] = traj[t - 1];
      const [x2, y2] = traj[t];

      for (const key of getCellsForSegment(x1, y1, x2, y2, cellSize)) {
        let list = grid.get(key);
        if (!list) {
          list = [];
          grid.set(key, list);
        }
        list.push({ trajIndex, time: t });
      }
    }
  }

  return grid;
}
export function drawTrajectoriesWithSpatialHash(
  ctx: CanvasRenderingContext2D,
  trajectories: number[][][],
  grid: Map<string, SegmentEntry[]>,
  segmentIndex: number,
  cellSize: number,
  style: TrajectoryStyleOptions
) {
  const outline = style.outline;
  const outlineWidth = outline?.width ?? style.strokeWidth + 2;
  const outlineColor = outline?.color ?? "#000";

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const currentTime = segmentIndex + 1;
  const numTrajectories = trajectories.length;

  const drawnSegments = new Set<string>();

  for (let t = 1; t <= currentTime; t++) {
    for (let trajIndex = 0; trajIndex < numTrajectories; trajIndex++) {
      const traj = trajectories[trajIndex];
      if (t >= traj.length) continue;

      const [x2, y2] = traj[t];
      const cx = Math.floor(x2 / cellSize);
      const cy = Math.floor(y2 / cellSize);
      const key = `${cx},${cy}`;

      const cellList = grid.get(key);
      if (!cellList) continue;

      for (const entry of cellList) {
        if (entry.time > currentTime) continue;
        const segKey = `${entry.trajIndex},${entry.time}`;
        if (drawnSegments.has(segKey)) continue;
        drawnSegments.add(segKey);

        const entryTraj = trajectories[entry.trajIndex];
        const x1 = entryTraj[entry.time - 1][0];
        const y1 = entryTraj[entry.time - 1][1];
        const x2 = entryTraj[entry.time][0];
        const y2 = entryTraj[entry.time][1];

        // Draw outline
        if (outline) {
          ctx.strokeStyle = outlineColor;
          ctx.lineWidth = outlineWidth;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }

        // Draw main line
        ctx.strokeStyle = style.color;
        ctx.lineWidth = style.strokeWidth;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    }
  }

  // Head markers
  if (style.showHeadMarker !== false) {
    ctx.globalAlpha = style.progressOpacity ?? 1;
    ctx.fillStyle = style.color;
    ctx.beginPath();
    for (let trajIndex = 0; trajIndex < numTrajectories; trajIndex++) {
      const traj = trajectories[trajIndex];
      const maxT = Math.min(currentTime, traj.length - 1);
      if (maxT < 1) continue;
      ctx.moveTo(traj[maxT][0] + style.pointRadius, traj[maxT][1]);
      ctx.arc(traj[maxT][0], traj[maxT][1], style.pointRadius, 0, 2 * Math.PI);
    }
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

// ========== PROGRESSIVE ANIMATION ==========

export interface ProgressiveAnimationOptions {
  // Timing
  segmentDuration: number;      // ms per segment animation
  segmentPauseDuration: number; // ms pause between segments
  endPauseDuration: number;     // ms pause at end before restart
  loop?: boolean;               // Whether to loop (default: true)

  // Styling
  strokeWidth: number;
  pointRadius: number;
  color: string;
  opacity: number;

  // Callbacks
  onEndPause?: () => void;      // Called each frame during end pause (for drawing overlays like error lines)
}

export interface AnimationController {
  start: () => void;
  stop: () => void;
  reset: () => void;
  isRunning: () => boolean;
}

/**
 * Draws trajectories with smooth interpolation within the current segment.
 * @param ctx - Canvas 2D rendering context
 * @param trajectories - Array of trajectories in pixel coords: [trajectory][timestep][x,y]
 * @param segmentIndex - Current segment index (0-based)
 * @param segmentProgress - Progress within current segment (0-1)
 * @param options - Styling options
 */
function drawPartialTrajectories(
  ctx: CanvasRenderingContext2D,
  trajectories: number[][][],
  segmentIndex: number,
  segmentProgress: number,
  options: ProgressiveAnimationOptions
): void {
  const { strokeWidth, pointRadius, color, opacity } = options;

  ctx.strokeStyle = color;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = opacity;

  for (const points of trajectories) {
    if (points.length < 2) continue;

    // Draw completed segments (points 0 through segmentIndex)
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i <= segmentIndex && i < points.length; i++) {
      ctx.lineTo(points[i][0], points[i][1]);
    }

    // Interpolate current segment if not yet at final point
    let endX: number, endY: number;
    if (segmentIndex < points.length - 1) {
      const [x1, y1] = points[segmentIndex];
      const [x2, y2] = points[segmentIndex + 1];
      endX = x1 + (x2 - x1) * segmentProgress;
      endY = y1 + (y2 - y1) * segmentProgress;
      ctx.lineTo(endX, endY);
    } else {
      // At or past final point
      [endX, endY] = points[points.length - 1];
    }
    ctx.stroke();

    // Draw endpoint marker at interpolated position
    ctx.beginPath();
    ctx.arc(endX, endY, pointRadius, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
  }

  ctx.globalAlpha = 1;
}

/**
 * Creates a self-contained progressive animation for trajectories.
 * Encapsulates all animation state internally and returns a controller.
 * @param ctx - Canvas 2D rendering context
 * @param trajectories - Array of trajectories in pixel coords: [trajectory][timestep][x,y]
 * @param options - Animation timing and styling options
 * @param drawBackground - Optional function called before each frame to clear/redraw background layers
 * @returns AnimationController with start(), stop(), reset(), isRunning()
 */
export function progressivelyAnimateTrajectories(
  ctx: CanvasRenderingContext2D,
  trajectories: number[][][],
  options: ProgressiveAnimationOptions,
  drawBackground?: () => void
): AnimationController {
  // Internal state (encapsulated in closure)
  let segmentIndex = 0;
  let animationFrameId: number | null = null;
  let lastAnimationTime: number | null = null;
  let isPaused = false;
  let pauseStartTime: number | null = null;

  // Calculate max segments across all trajectories
  const maxSegments = trajectories.length > 0
    ? Math.max(...trajectories.map(t => t.length - 1))
    : 0;

  const {
    segmentDuration,
    segmentPauseDuration,
    endPauseDuration,
    loop = true,
    onEndPause
  } = options;

  function drawFrame(progress: number) {
    // Clear and redraw background if provided
    if (drawBackground) {
      drawBackground();
    }

    // Draw partial trajectories with interpolation
    drawPartialTrajectories(ctx, trajectories, segmentIndex, progress, options);
  }

  function animate(timestamp: number) {
    if (lastAnimationTime === null) {
      lastAnimationTime = timestamp;
    }

    // Handle pause state
    if (isPaused) {
      const pauseElapsed = timestamp - (pauseStartTime ?? timestamp);
      // We're at the end if current segment is the last one (index maxSegments - 1)
      const isEndPause = segmentIndex >= maxSegments - 1;
      const pauseDuration = isEndPause ? endPauseDuration : segmentPauseDuration;

      if (pauseElapsed >= pauseDuration) {
        // Pause is ending - advance segment and continue to normal animation
        isPaused = false;
        pauseStartTime = null;
        lastAnimationTime = timestamp;

        if (isEndPause) {
          // Finished the last segment
          if (loop) {
            segmentIndex = 0;
          } else {
            animationFrameId = null;
            return;
          }
        } else {
          // Advance to next segment
          segmentIndex++;
        }
        // Fall through to normal animation below (don't draw at progress 1 with new segment)
      } else {
        // Still in pause - draw at full progress for current segment
        if (isEndPause && onEndPause) {
          drawFrame(1);
          onEndPause();
        } else {
          drawFrame(1);
        }
        animationFrameId = requestAnimationFrame(animate);
        return;
      }
    }

    const elapsed = timestamp - lastAnimationTime;

    // Calculate progress within current segment (0 to 1)
    const segmentProgress = Math.min(elapsed / segmentDuration, 1);

    // Draw current frame
    drawFrame(segmentProgress);

    // When segment completes, enter pause (don't advance segment yet)
    if (segmentProgress >= 1) {
      isPaused = true;
      pauseStartTime = timestamp;
    }

    animationFrameId = requestAnimationFrame(animate);
  }

  return {
    start: () => {
      if (animationFrameId === null) {
        animationFrameId = requestAnimationFrame(animate);
      }
    },
    stop: () => {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
    },
    reset: () => {
      segmentIndex = 0;
      lastAnimationTime = null;
      isPaused = false;
      pauseStartTime = null;
    },
    isRunning: () => animationFrameId !== null
  };
}