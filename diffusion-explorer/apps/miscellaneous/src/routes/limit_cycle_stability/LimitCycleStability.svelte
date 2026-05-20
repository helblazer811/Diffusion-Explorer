<!--
  Limit Cycles Resist Perturbations — Van der Pol Oscillator

  One long-running trajectory orbits the cycle. At periodic intervals the
  point gets "kicked" — a brief linear translation in a random direction
  (shown as a blue arrow) — and the dynamics then pull it back onto the
  limit cycle. Reveals the cycle's local stability.

      dx/dt = y
      dy/dt = mu * (1 - x^2) * y - x
-->

<script lang="ts">
  import { onDestroy } from "svelte";
  import type { Writable } from "svelte/store";
  import { Player,
    Figure,
    Timeline,
    PathlineAnimation,
    useVisibilityHandler,
    drawVectorField,
    type PathlineAnimationState,
    type VectorFieldStyleOptions,
    type VelocityGridDomain,
  } from "@diffusion-explorer/ui";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  let {
    // Layout
    canvasWidth = 960,
    canvasHeight = 400,
    margin = 20,
    dpiScale = 3,

    // ODE
    mu = 1.0,
    trajectoryStartPoint = [2, 0] as [number, number],
    dt = 0.008,
    numSteps = 6000,

    // Kicks — single linear perturbations applied at intervals during the
    // trajectory. The first kick lands soon after the animation starts; the
    // rest are spaced by `kickIntervalSegments`. Direction is biased to be
    // (roughly) perpendicular to the local velocity so the kick visibly
    // pushes the dot off the orbit rather than along it.
    firstKickAtSegments = 250,
    // 350 dynamics-only segments + 130 kick-duration segments = ~4 s between
    // successive kick starts at the current 6000 segs / 50 s animation rate.
    kickIntervalSegments = 350,
    kickDurationSegments = 130,
    kicksPerEvent = 1,
    kickMagnitudeMin = 0.5,
    kickMagnitudeMax = 1.0,
    // Spread around the ±perpendicular direction, in radians.
    // 0 = exactly perpendicular; π/2 = no preference.
    kickAngleSpread = 0.5,
    kickSeed = 1,
    // Keep the kick endpoint at least this many pixels inside the canvas
    // edge; magnitudes shrink iteratively if a random kick would land outside.
    kickEdgePaddingPixels = 50,
    // Arrow drawn from the kick origin to the kick endpoint while active.
    kickArrowColor = "#60a5fa",
    kickArrowOpacity = 1.0,
    kickArrowStrokeWidth = 9.4,
    kickArrowHeadRadius = 22,

    domain = { xMin: -2.7, xMax: 2.7, yMin: -6.48, yMax: 6.48 } as VelocityGridDomain,

    // Quiver
    gridSpacingPixels = 45,
    arrowScale = 11,
    arrowStrokeWidth = 3.75,
    arrowHeadRadius = 3,
    arrowOpacity = 0.6,
    showArrowHeads = false,
    quiverInsetFraction = 0.04,

    // Pathline (single trajectory, comet trail)
    pathlineStrokeWidth = 9.4,
    pathlinePointRadius = 9.4,
    pathlineOpacity = 1.0,
    pathlineFadeFloor = 0.0,
    pathlineFadeGamma = 2.5,
    pathlineOutlineColor = "#ffffff",
    pathlineOutlineOpacity = 1.0,
    pathlineOutlineStrokeWidth = 1.5,
    pathlineTrailWindow = 150,

    showLimitCycle = true,
    limitCycleColor = "#475569",
    limitCycleOpacity = 0.9,
    limitCycleStrokeWidth = 6.6,

    animationDurationMs = 50000,
    playingByDefault = true,
    initialPlayDelaySeconds = 3,

    rotationAngleDegrees = 45,
    stretchX = 1.75,
    stretchY = 1,

    vectorFieldColor = "#94a3b8",
    pathlineColor = "#ef4444",
  } = $props();

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  type AnimationState = PathlineAnimationState;

  type Kick = {
    startSegment: number;
    endSegment: number; // exclusive
    fromPixel: [number, number];
    toPixel: [number, number];
  };

  const physicalWidth = $derived(canvasWidth * dpiScale);
  const physicalHeight = $derived(canvasHeight * dpiScale);

  let canvas: HTMLCanvasElement | null = $state(null);
  let ctx: CanvasRenderingContext2D | null = $state(null);

  let player: Player<AnimationState> | null = $state(null);
  let pathlineAnimation: PathlineAnimation<AnimationState> | null = null;
  let trailAlphas: number[] = [];
  let kicks: Kick[] = [];
  let isInitialized = $state(false);

  let displayGridPositionsPixel: number[][] = [];
  let velocities: number[][] = [];
  let limitCyclePixel: number[][] = [];

  let figureIsActive: Writable<boolean> | undefined = $state(undefined);
  const { handleVisibilityChange } = useVisibilityHandler(() => player);

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  function vanDerPolField(x: number, y: number): [number, number] {
    return [y, mu * (1 - x * x) * y - x];
  }

  function rk4Step(x: number, y: number, h: number): [number, number] {
    const [k1x, k1y] = vanDerPolField(x, y);
    const [k2x, k2y] = vanDerPolField(x + (h / 2) * k1x, y + (h / 2) * k1y);
    const [k3x, k3y] = vanDerPolField(x + (h / 2) * k2x, y + (h / 2) * k2y);
    const [k4x, k4y] = vanDerPolField(x + h * k3x, y + h * k3y);
    return [
      x + (h / 6) * (k1x + 2 * k2x + 2 * k3x + k4x),
      y + (h / 6) * (k1y + 2 * k2y + 2 * k3y + k4y),
    ];
  }

  function integrateTrajectory(
    start: [number, number],
    h: number,
    n: number
  ): number[][] {
    const out: number[][] = new Array(n + 1);
    let x = start[0];
    let y = start[1];
    out[0] = [x, y];
    for (let i = 1; i <= n; i++) {
      [x, y] = rk4Step(x, y, h);
      out[i] = [x, y];
    }
    return out;
  }

  function makeRng(seed: number): () => number {
    let s = seed | 0;
    return () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Integrate the trajectory but insert periodic linear "kicks" — random-
  // direction perturbations that override the dynamics for a short stretch.
  function integrateWithKicks(
    start: [number, number],
    h: number,
    n: number
  ): { points: number[][]; kicksDomain: { startSegment: number; endSegment: number; from: [number, number]; to: [number, number] }[] } {
    const points: number[][] = new Array(n + 1);
    const kicksOut: { startSegment: number; endSegment: number; from: [number, number]; to: [number, number] }[] = [];
    const rng = makeRng(kickSeed);
    let x = start[0];
    let y = start[1];
    points[0] = [x, y];

    let nextEventAt = firstKickAtSegments;
    let i = 1;
    while (i <= n) {
      if (i === nextEventAt) {
        // Apply a burst of `kicksPerEvent` consecutive kicks. Direction is
        // ±perpendicular to the local flow with a small random spread.
        for (let kIdx = 0; kIdx < kicksPerEvent; kIdx++) {
          if (i + kickDurationSegments > n) break;
          const [vx, vy] = vanDerPolField(x, y);
          const velAngle = Math.atan2(vy, vx);
          const sign = rng() < 0.5 ? 1 : -1;
          const spread = (rng() - 0.5) * 2 * kickAngleSpread;
          const angle = velAngle + sign * (Math.PI / 2) + spread;
          let mag = kickMagnitudeMin + rng() * (kickMagnitudeMax - kickMagnitudeMin);
          const fromX = x, fromY = y;
          const cosA = Math.cos(angle);
          const sinA = Math.sin(angle);
          // Shrink magnitude if the endpoint would land off-canvas so the
          // dot stays clearly visible during the perturbation.
          let toX = fromX + mag * cosA;
          let toY = fromY + mag * sinA;
          for (let attempt = 0; attempt < 12; attempt++) {
            const [px, py] = toPixel([toX, toY]);
            const inX = px >= kickEdgePaddingPixels && px <= canvasWidth - kickEdgePaddingPixels;
            const inY = py >= kickEdgePaddingPixels && py <= canvasHeight - kickEdgePaddingPixels;
            if (inX && inY) break;
            mag *= 0.7;
            toX = fromX + mag * cosA;
            toY = fromY + mag * sinA;
          }
          for (let k = 0; k < kickDurationSegments; k++) {
            const tt = (k + 1) / kickDurationSegments;
            points[i + k] = [fromX + tt * (toX - fromX), fromY + tt * (toY - fromY)];
          }
          kicksOut.push({
            startSegment: i,
            endSegment: i + kickDurationSegments,
            from: [fromX, fromY],
            to: [toX, toY],
          });
          x = toX;
          y = toY;
          i += kickDurationSegments;
        }
        nextEventAt = i + kickIntervalSegments;
      } else {
        [x, y] = rk4Step(x, y, h);
        points[i] = [x, y];
        i++;
      }
    }
    return { points, kicksDomain: kicksOut };
  }

  // Transform pipeline (same as the convergence figure).
  function computeM(): [[number, number], [number, number]] {
    const plotWidth = canvasWidth - 2 * margin;
    const plotHeight = canvasHeight - 2 * margin;
    const xRange = domain.xMax - domain.xMin;
    const yRange = domain.yMax - domain.yMin;
    const angle = (rotationAngleDegrees * Math.PI) / 180;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return [
      [(stretchX * s * plotHeight) / xRange, (stretchX * c * plotWidth) / yRange],
      [(-stretchY * c * plotHeight) / xRange, (stretchY * s * plotWidth) / yRange],
    ];
  }

  function invertMatrix2(
    m: [[number, number], [number, number]]
  ): [[number, number], [number, number]] {
    const [[a, b], [c, d]] = m;
    const det = a * d - b * c;
    return [
      [d / det, -b / det],
      [-c / det, a / det],
    ];
  }

  function applyMatrix2(
    m: [[number, number], [number, number]],
    v: [number, number]
  ): [number, number] {
    return [m[0][0] * v[0] + m[0][1] * v[1], m[1][0] * v[0] + m[1][1] * v[1]];
  }

  function toPixel(point: number[]): number[] {
    const xMid = (domain.xMin + domain.xMax) / 2;
    const yMid = (domain.yMin + domain.yMax) / 2;
    const M = computeM();
    const [dx, dy] = applyMatrix2(M, [point[0] - xMid, point[1] - yMid]);
    return [canvasWidth / 2 + dx, canvasHeight / 2 + dy];
  }

  function fromPixel(px: number, py: number): [number, number] {
    const xMid = (domain.xMin + domain.xMax) / 2;
    const yMid = (domain.yMin + domain.yMax) / 2;
    const Minv = invertMatrix2(computeM());
    const [dx, dy] = applyMatrix2(Minv, [px - canvasWidth / 2, py - canvasHeight / 2]);
    return [xMid + dx, yMid + dy];
  }

  function buildPixelGrid(spacing: number, insetFraction: number): number[][] {
    const insetX = canvasWidth * insetFraction;
    const insetY = canvasHeight * insetFraction;
    const xMin = insetX;
    const xMax = canvasWidth - insetX;
    const yMin = insetY;
    const yMax = canvasHeight - insetY;
    const nx = Math.max(2, Math.round((xMax - xMin) / spacing) + 1);
    const ny = Math.max(2, Math.round((yMax - yMin) / spacing) + 1);
    const points: number[][] = [];
    for (let j = 0; j < ny; j++) {
      const t = j / (ny - 1);
      const py = yMin + t * (yMax - yMin);
      for (let i = 0; i < nx; i++) {
        const u = i / (nx - 1);
        const px = xMin + u * (xMax - xMin);
        points.push([px, py]);
      }
    }
    return points;
  }

  function setupCanvas(c: HTMLCanvasElement): CanvasRenderingContext2D | null {
    c.width = physicalWidth;
    c.height = physicalHeight;
    const context = c.getContext("2d");
    if (context) {
      context.scale(dpiScale, dpiScale);
    }
    return context;
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  async function runInitialComputation() {
    if (!canvas) return;

    const M = computeM();
    displayGridPositionsPixel = buildPixelGrid(gridSpacingPixels, quiverInsetFraction);
    velocities = displayGridPositionsPixel.map(([px, py]) => {
      const [x, y] = fromPixel(px, py);
      const [vx, vy] = vanDerPolField(x, y);
      return applyMatrix2(M, [vx, vy]);
    });

    // Trajectory with kicks
    const { points, kicksDomain } = integrateWithKicks(trajectoryStartPoint, dt, numSteps);
    const pixelPathline = points.map(toPixel);
    kicks = kicksDomain.map((k) => ({
      startSegment: k.startSegment,
      endSegment: k.endSegment,
      fromPixel: toPixel(k.from) as [number, number],
      toPixel: toPixel(k.to) as [number, number],
    }));

    pathlineAnimation = PathlineAnimation.fromTrajectories<AnimationState>(
      [pixelPathline],
      {
        style: {
          strokeWidth: pathlineStrokeWidth,
          color: pathlineColor,
          opacity: pathlineOpacity,
          pointRadius: pathlinePointRadius,
          showPreview: false,
        },
      }
    );
    await pathlineAnimation.init(canvas);
    trailAlphas = new Array(pixelPathline.length).fill(0);

    // Limit-cycle backdrop — computed from a separate kick-free integration
    // so the gray reference orbit is always clean.
    const cycleTraj = integrateTrajectory([2, 0], dt, 4000);
    const cycleSamples = Math.min(cycleTraj.length, 3000);
    limitCyclePixel = cycleTraj
      .slice(cycleTraj.length - cycleSamples)
      .map(toPixel);
  }

  function updateTrailAlphas(head: number, tailStart: number): void {
    const floor = pathlineFadeFloor;
    const denom = head - tailStart;
    const gamma = pathlineFadeGamma;
    for (let i = 0; i < trailAlphas.length; i++) {
      if (i > head || i <= tailStart || denom <= 0) {
        trailAlphas[i] = 0;
      } else {
        const t = (i - tailStart) / denom;
        trailAlphas[i] = floor + (1 - floor) * Math.pow(t, gamma);
      }
    }
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  function setupTimeline() {
    if (!pathlineAnimation) return;
    const tl = Timeline.from<AnimationState>({
      duration: animationDurationMs / 1000,
      initialState: { segmentIndex: 0 },
      clips: [
        { clip: pathlineAnimation.clip, ...{ start: 0, end: 1 } },
      ],
    });
    player = new Player(tl, { looping: true });
    player.onTick((t: number) => draw(t));
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  const vectorFieldStyle: VectorFieldStyleOptions = $derived({
    arrowScale,
    strokeWidth: arrowStrokeWidth,
    color: vectorFieldColor,
    opacity: arrowOpacity,
    headRadius: arrowHeadRadius,
    normalizeVectors: true,
    centerQuiver: true,
    showArrowHeads,
  });

  function drawLimitCycle(): void {
    if (!ctx || !showLimitCycle || limitCyclePixel.length < 2) return;
    ctx.save();
    ctx.strokeStyle = limitCycleColor;
    ctx.globalAlpha = limitCycleOpacity;
    ctx.lineWidth = limitCycleStrokeWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(limitCyclePixel[0][0], limitCyclePixel[0][1]);
    for (let i = 1; i < limitCyclePixel.length; i++) {
      ctx.lineTo(limitCyclePixel[i][0], limitCyclePixel[i][1]);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawKickArrow(fromX: number, fromY: number, toX: number, toY: number): void {
    if (!ctx) return;
    ctx.save();
    ctx.strokeStyle = kickArrowColor;
    ctx.fillStyle = kickArrowColor;
    ctx.globalAlpha = kickArrowOpacity;
    ctx.lineWidth = kickArrowStrokeWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Stop the line short of the arrowhead's center so they meet cleanly.
    const dx = toX - fromX;
    const dy = toY - fromY;
    const dist = Math.hypot(dx, dy);
    const stop = Math.min(kickArrowHeadRadius * 0.5, dist);
    const lineEndX = toX - (stop / dist) * dx;
    const lineEndY = toY - (stop / dist) * dy;

    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(lineEndX, lineEndY);
    ctx.stroke();

    // Equilateral arrowhead pointing along (dx, dy).
    const angle = Math.atan2(dy, dx);
    const r = kickArrowHeadRadius;
    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(
      toX - r * Math.cos(angle - Math.PI / 6),
      toY - r * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      toX - r * Math.cos(angle + Math.PI / 6),
      toY - r * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function draw(t: number) {
    if (!ctx || !pathlineAnimation) return;

    // --- Static Background ---
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    drawVectorField(ctx, displayGridPositionsPixel, velocities, vectorFieldStyle);
    drawLimitCycle();

    // --- Dynamic Foreground ---
    // Fractional segment index for smooth sub-segment head motion.
    const segs = t * pathlineAnimation.data.numSegments;
    const head = Math.min(segs, pathlineAnimation.data.numSegments - 1);
    const tailStart = segs - pathlineTrailWindow;
    if (head - tailStart <= 0) return;

    updateTrailAlphas(head, tailStart);
    pathlineAnimation.draw({
      segmentIndex: head,
      perSegmentAlphas: [trailAlphas],
    } as AnimationState);

    // Head outline (interpolated position).
    const points = pathlineAnimation.data.pathlines[0];
    const floorH = Math.floor(head);
    const fracH = head - floorH;
    const baseIdx = Math.min(floorH, points.length - 1);
    const nextIdx = Math.min(baseIdx + 1, points.length - 1);
    const headX = points[baseIdx][0] + fracH * (points[nextIdx][0] - points[baseIdx][0]);
    const headY = points[baseIdx][1] + fracH * (points[nextIdx][1] - points[baseIdx][1]);
    ctx.save();
    ctx.strokeStyle = pathlineOutlineColor;
    ctx.globalAlpha = pathlineOutlineOpacity;
    ctx.lineWidth = pathlineOutlineStrokeWidth;
    ctx.beginPath();
    ctx.arc(
      headX,
      headY,
      pathlinePointRadius + pathlineOutlineStrokeWidth / 2,
      0,
      2 * Math.PI
    );
    ctx.stroke();
    ctx.restore();

    // Active kick (if any): draw the perturbation arrow *behind* the head
    // (tip touching the ball's trailing edge, tail extending back) so it
    // reads as a force pushing the ball forward, not the ball trailing it.
    for (const kick of kicks) {
      if (segs >= kick.startSegment && segs < kick.endSegment) {
        const kdx = kick.toPixel[0] - kick.fromPixel[0];
        const kdy = kick.toPixel[1] - kick.fromPixel[1];
        const dist = Math.hypot(kdx, kdy);
        if (dist > 0) {
          const ux = kdx / dist;
          const uy = kdy / dist;
          const tipX = headX - pathlinePointRadius * ux;
          const tipY = headY - pathlinePointRadius * uy;
          const tailX = tipX - dist * ux;
          const tailY = tipY - dist * uy;
          drawKickArrow(tailX, tailY, tipX, tipY);
        }
        break;
      }
    }
  }

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  onDestroy(() => {
    if (player) player?.dispose();
    if (pathlineAnimation) pathlineAnimation.destroy();
  });

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  $effect(() => {
    if (canvas && !ctx) {
      ctx = setupCanvas(canvas);
    }
  });

  $effect(() => {
    if (!isInitialized && ctx && canvas) {
      runInitialComputation().then(() => {
        setupTimeline();
        isInitialized = true;

        if (player) {
          draw(0);
          if (playingByDefault) {
            if (initialPlayDelaySeconds > 0) {
              setTimeout(() => player?.play(), initialPlayDelaySeconds * 1000);
            } else {
              player.play();
            }
          }
        }
      });
    }
  });

  $effect(() => {
    if (figureIsActive !== undefined && isInitialized && $figureIsActive !== undefined) {
      handleVisibilityChange($figureIsActive);
    }
  });
</script>

<Figure bind:isActive={figureIsActive} backgroundVisible={false}>
  <div class="canvas-container">
    <canvas
      bind:this={canvas}
      width={physicalWidth}
      height={physicalHeight}
      style="width: 100%; max-width: {canvasWidth}px; height: auto; aspect-ratio: {canvasWidth} / {canvasHeight};"
    ></canvas>
  </div>

  {#snippet caption()}
    <span class="lcs-caption">
      <strong>Stable limit cycles resist small perturbations.</strong>
      Random kicks can push the orbiting state away from its path, but the
      dynamics tend to draw it back toward the same closed orbit.
    </span>
  {/snippet}
</Figure>

<style>
  .canvas-container {
    display: flex;
    justify-content: center;
    align-items: center;
    width: 100%;
  }

  .lcs-caption {
    display: block;
    font-size: 1.45rem;
    line-height: 1.55;
    padding-left: 4%;
    padding-right: 4%;
  }
</style>
