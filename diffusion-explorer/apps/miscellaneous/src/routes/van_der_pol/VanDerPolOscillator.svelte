<!--
  Van der Pol Oscillator — Limit Cycle Visualization

  Shows the Van der Pol vector field as a static quiver, with a single
  trajectory animating from outside the cycle inward onto the stable orbit.

      dx/dt = y
      dy/dt = mu * (1 - x^2) * y - x
-->

<script lang="ts">
  import { onDestroy } from "svelte";
  import type { Writable } from "svelte/store";
  import {
    Figure,
    TimeSlider,
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
    canvasWidth = 800,
    canvasHeight = 400,
    margin = 20,
    dpiScale = 3,

    // ODE
    mu = 1.0,
    // Lead trajectory: one point starts the animation alone, then a moment
    // later the synchronized cluster appears (see clusterStartTime below).
    leadStartPoint = [3, 0] as [number, number],
    // Cluster — N points evenly spaced on an ellipse (in domain coords)
    // around the attractor. Placed outside the limit cycle so trajectories
    // spiral inward; angular ordering matches the dynamics' counter-clockwise
    // rotation (on screen, with y pointing down) so the points act like a
    // coherent rotating front with minimal mutual overlap.
    clusterEllipseRadiusX = 2.5,
    clusterEllipseRadiusY = 3.0,
    clusterEllipseCenterX = 0,
    clusterEllipseCenterY = 0,
    clusterEllipsePhaseOffset = 0,
    clusterCount = 10,
    // When the cluster appears relative to the timeline (0–1). Cluster points
    // launch at this offset plus a small per-point stagger (see below) so
    // they're nearly — but not exactly — synchronized.
    clusterStartTime = 0.05,
    // Per-cluster-point stagger. Sized so the cascade fills the rest of the
    // loop: last cluster offset + visibility = ~1.0, so the timeline restarts
    // right when the last point finishes fading.
    //   last_offset = clusterStartTime + (clusterCount - 1) * staggerFraction
    //   visibility = (pathlineLifetimeSegments + pathlineFadeOutSegments) / numSteps
    clusterStaggerFraction = 0.05,
    dt = 0.008,
    numSteps = 6000,

    // Domain — viewport is rotated: domain y becomes horizontal (canvas x), domain x becomes
    // vertical (canvas y). Sized so the limit cycle (~4 in x, ~5.6 in y) fills the 2:1 canvas
    // with some margin for surrounding field.
    domain = { xMin: -2.7, xMax: 2.7, yMin: -5.4, yMax: 5.4 } as VelocityGridDomain,

    // Quiver — uniform grid in canvas pixel space (axis-aligned, never rotated).
    // Arrows at each pixel sample the *transformed* field so they stay consistent
    // with the rotated/stretched trajectory.
    gridSpacingPixels = 45,
    arrowScale = 11,
    arrowStrokeWidth = 3.75,
    arrowHeadRadius = 3,
    arrowOpacity = 0.6,
    showArrowHeads = false,
    quiverInsetFraction = 0.04,

    // Pathline
    pathlineStrokeWidth = 9.4,
    pathlinePointRadius = 9.4,
    pathlineOpacity = 1.0,
    pathlineFadeFloor = 0.0,
    // Gamma on the head→tail alpha ramp. 1 = linear (default).
    //   > 1 — head-loaded comet: alpha drops off rapidly behind the head.
    //   < 1 — tail-loaded: alpha stays high deeper into the trail.
    pathlineFadeGamma = 2.5,
    // Thin white halo around the head dot (and faintly the trail) so the
    // moving point reads against the gray limit-cycle backdrop.
    pathlineOutlineColor = "#ffffff",
    pathlineOutlineOpacity = 1.0,
    pathlineOutlineStrokeWidth = 1.5,
    // Length of the visible trail behind the head, in integration segments.
    // Older segments are fully transparent — this prevents low-alpha laps from
    // accumulating to opaque under source-over compositing.
    pathlineTrailWindow = 150,
    // After the head propagates this many segments, the pathline enters its
    // fade-out phase. The head keeps moving during fade-out so the system
    // doesn't look frozen — only its opacity drops to zero.
    pathlineLifetimeSegments = 900,
    // Duration of the fade-out phase, in integration segments. During this
    // window the head continues to advance but all alphas scale linearly to 0.
    pathlineFadeOutSegments = 400,

    // Static limit-cycle backdrop (drawn under the animated trail)
    showLimitCycle = true,
    limitCycleColor = "#475569",
    limitCycleOpacity = 0.9,
    limitCycleStrokeWidth = 6.6,

    // Animation
    animationDurationMs = 50000,
    playingByDefault = true,
    // Seconds to wait after page load before the timeline starts — gives time
    // to start a screen recording. Set to 0 to start immediately.
    initialPlayDelaySeconds = 3,

    // Additional viewport rotation (degrees, clockwise on screen) applied AFTER the
    // 90° axes swap. Use to align the limit cycle's long axis with horizontal.
    rotationAngleDegrees = 45,

    // Anisotropic stretch of the new (rotated) frame's axes — applied AFTER
    // rotation, so stretchX stretches the new-frame horizontal, stretchY the
    // new-frame vertical. Both default to 1 (no stretch).
    stretchX = 1.4,
    stretchY = 1,

    // Time slider
    showTimeSliderTicks = false,

    // Colors
    vectorFieldColor = "#94a3b8",
    pathlineColor = "#ef4444",
  } = $props();

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  type AnimationState = PathlineAnimationState;

  const physicalWidth = $derived(canvasWidth * dpiScale);
  const physicalHeight = $derived(canvasHeight * dpiScale);

  let canvas: HTMLCanvasElement | null = $state(null);
  let ctx: CanvasRenderingContext2D | null = $state(null);

  let timeline: Timeline<AnimationState> | null = $state(null);
  let pathlineAnimations: PathlineAnimation<AnimationState>[] = [];
  let trailAlphasPerAnim: number[][] = []; // one per-point alpha buffer per animation
  let isInitialized = $state(false);

  let displayGridPositionsPixel: number[][] = [];
  let velocities: number[][] = [];
  let limitCyclePixel: number[][] = [];

  let figureIsActive: Writable<boolean> | undefined = $state(undefined);
  const { handleVisibilityChange } = useVisibilityHandler(() => timeline);

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

  // Transform pipeline mapping a *displacement* in domain (x_dev, y_dev) to a
  // *displacement* in canvas pixel space:
  //   1) 90° axes swap + Y flip + per-axis domain-to-canvas scaling   (matrix A)
  //   2) rotation by `rotationAngleDegrees`                            (matrix R)
  //   3) anisotropic stretch (stretchX, stretchY)                      (matrix S)
  // Composite: M = S · R · A. Linear, so M maps both positions (via the
  // displacement from canvas center) and velocity vectors.
  function computeM(): [[number, number], [number, number]] {
    const plotWidth = canvasWidth - 2 * margin;
    const plotHeight = canvasHeight - 2 * margin;
    const xRange = domain.xMax - domain.xMin;
    const yRange = domain.yMax - domain.yMin;
    const angle = (rotationAngleDegrees * Math.PI) / 180;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    // A = [[0, plotW/yRange], [-plotH/xRange, 0]]
    // R · A:
    //   [[ s · plotH/xRange,  c · plotW/yRange],
    //    [-c · plotH/xRange,  s · plotW/yRange]]
    // S · R · A:
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

  // Uniform axis-aligned grid in canvas pixel space (the "new frame").
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

    // Quiver: uniform axis-aligned grid in canvas pixels (drawn "straight").
    // At each grid point we invert the transform to recover the domain point,
    // evaluate the field there, and apply M to get the displayed direction
    // (so arrows are tangent to the rotated/stretched flow).
    const M = computeM();
    displayGridPositionsPixel = buildPixelGrid(gridSpacingPixels, quiverInsetFraction);
    velocities = displayGridPositionsPixel.map(([px, py]) => {
      const [x, y] = fromPixel(px, py);
      const [vx, vy] = vanDerPolField(x, y);
      return applyMatrix2(M, [vx, vy]);
    });

    // Build the full list of starting points: lead first, then a ring of
    // clusterCount points evenly spaced on an ellipse around the attractor.
    // Positive θ steps go counter-clockwise in math (x, y), which — under
    // the axes-swap + y-flip + rotation transform — reads as clockwise on
    // screen, the opposite direction from the Van der Pol flow. Consecutive
    // launches therefore start behind each other in the flow direction so
    // each new point follows the previous one's trail.
    const clusterDomainPoints: [number, number][] = [];
    for (let i = 0; i < clusterCount; i++) {
      const theta = clusterEllipsePhaseOffset + (2 * Math.PI * i) / clusterCount;
      const x = clusterEllipseCenterX + clusterEllipseRadiusX * Math.cos(theta);
      const y = clusterEllipseCenterY + clusterEllipseRadiusY * Math.sin(theta);
      clusterDomainPoints.push([x, y]);
    }
    const allStartPoints: [number, number][] = [leadStartPoint, ...clusterDomainPoints];

    // Trajectories: integrate one per start point, map each to pixel coords,
    // and create a PathlineAnimation per trajectory (all rendering to the same
    // canvas via CPU backend — they composite naturally in draw order).
    pathlineAnimations = [];
    trailAlphasPerAnim = [];

    let referenceTraj: number[][] | null = null;
    for (const sp of allStartPoints) {
      const traj = integrateTrajectory(sp, dt, numSteps);
      if (referenceTraj === null) referenceTraj = traj;
      const pixelPathline = traj.map(toPixel);
      const anim = PathlineAnimation.fromTrajectories<AnimationState>(
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
      await anim.init(canvas);
      pathlineAnimations.push(anim);
      trailAlphasPerAnim.push(new Array(pixelPathline.length).fill(0));
    }

    // Limit-cycle backdrop: take the tail of a converged trajectory. Sized
    // generously (~1.3 cycle periods at dt=0.003) so the loop fully closes
    // regardless of small dt changes; the extra wraparound just redraws the
    // same pixels harmlessly.
    if (referenceTraj) {
      const cycleSamples = Math.min(referenceTraj.length, 3000);
      limitCyclePixel = referenceTraj
        .slice(referenceTraj.length - cycleSamples)
        .map(toPixel);
    }
  }

  function updateTrailAlphasFor(
    alphas: number[],
    head: number,
    tailStart: number
  ): void {
    const floor = pathlineFadeFloor;
    const denom = head - tailStart;
    const gamma = pathlineFadeGamma;
    for (let i = 0; i < alphas.length; i++) {
      if (i > head || i <= tailStart || denom <= 0) {
        alphas[i] = 0;
      } else {
        const t = (i - tailStart) / denom;
        alphas[i] = floor + (1 - floor) * Math.pow(t, gamma);
      }
    }
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  function setupTimeline() {
    if (pathlineAnimations.length === 0) return;

    timeline = new Timeline<AnimationState>();
    timeline.initialState = { segmentIndex: 0 };
    timeline.duration = animationDurationMs / 1000;
    timeline.looping = true;

    // We compute per-animation segment indices manually in draw(); the
    // timeline just needs a clip so it keeps ticking. Use the first
    // animation's clip as the heartbeat.
    timeline.add(pathlineAnimations[0].clip, { start: 0, end: 1 });

    timeline.onTick((t: number) => draw(t));
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

  function draw(t: number) {
    if (!ctx || pathlineAnimations.length === 0) return;

    // --- Static Background ---
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    drawVectorField(ctx, displayGridPositionsPixel, velocities, vectorFieldStyle);
    drawLimitCycle();

    // --- Dynamic Foreground ---
    // Animation 0 (lead) starts at t=0; animations 1..N (cluster) at staggered
    // offsets starting at clusterStartTime. Each animation has two phases:
    //   • Propagation: segs ∈ [0, lifetime]. Head advances, trail of length
    //     `window` follows behind at full opacity.
    //   • Fade-out:   segs ∈ (lifetime, lifetime + fadeOut]. Head KEEPS moving
    //     so the dynamics stay visibly alive, but a fade factor scales every
    //     alpha (trail + head + outline) linearly to 0.
    //   • Beyond:     segs > lifetime + fadeOut — fully invisible until the
    //     timeline loops.
    const window = pathlineTrailWindow;
    const fadeOut = pathlineFadeOutSegments;
    for (let i = 0; i < pathlineAnimations.length; i++) {
      const anim = pathlineAnimations[i];
      const offset = i === 0 ? 0 : clusterStartTime + (i - 1) * clusterStaggerFraction;
      const localT = t - offset;
      if (localT < 0) continue;
      // Fractional segment index — drawTrajectories interpolates linearly
      // between adjacent points for the head marker, so slowing down the
      // timeline (larger animationDurationMs) yields smooth sub-segment
      // motion without needing more integration steps.
      const segs = localT * anim.data.numSegments;

      // Fade factor: 1 during propagation, linear 1→0 during fade-out.
      let fadeFactor = 1;
      if (segs > pathlineLifetimeSegments) {
        const into = segs - pathlineLifetimeSegments;
        fadeFactor = 1 - into / fadeOut;
        if (fadeFactor <= 0) continue;
      }

      // Head keeps moving (capped only by available trajectory length).
      const head = Math.min(segs, anim.data.numSegments - 1);
      const tailStart = segs - window;
      const visibleLen = head - tailStart;
      if (visibleLen <= 0) continue;

      updateTrailAlphasFor(trailAlphasPerAnim[i], head, tailStart);
      // Apply fade factor to every per-segment alpha during phase 2.
      if (fadeFactor < 1) {
        const alphas = trailAlphasPerAnim[i];
        for (let j = 0; j < alphas.length; j++) alphas[j] *= fadeFactor;
      }

      anim.draw(
        {
          segmentIndex: head,
          perSegmentAlphas: [trailAlphasPerAnim[i]],
        } as AnimationState,
        { opacity: pathlineOpacity * fadeFactor }
      );

      // Thin white outline around the head dot only — fades with the rest.
      // Use the interpolated head position so the outline tracks the smooth
      // head motion (not snapped to integer segment endpoints).
      const points = anim.data.pathlines[0];
      const floorH = Math.floor(head);
      const fracH = head - floorH;
      const baseIdx = Math.min(floorH, points.length - 1);
      const nextIdx = Math.min(baseIdx + 1, points.length - 1);
      const headX = points[baseIdx][0] + fracH * (points[nextIdx][0] - points[baseIdx][0]);
      const headY = points[baseIdx][1] + fracH * (points[nextIdx][1] - points[baseIdx][1]);
      ctx.save();
      ctx.strokeStyle = pathlineOutlineColor;
      ctx.globalAlpha = pathlineOutlineOpacity * fadeFactor;
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
    }
  }

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  onDestroy(() => {
    if (timeline) timeline.dispose();
    for (const anim of pathlineAnimations) anim.destroy();
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

        if (timeline) {
          draw(0);
          if (playingByDefault) {
            if (initialPlayDelaySeconds > 0) {
              setTimeout(() => timeline?.play(), initialPlayDelaySeconds * 1000);
            } else {
              timeline.play();
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
    <span class="vdp-caption">
      <strong>A stable limit cycle</strong> is an isolated closed orbit that
      nearby trajectories converge to over time.
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

  .vdp-caption {
    display: block;
    font-size: 1.7rem;
    line-height: 1.55;
    /* Match `quiverInsetFraction` (0.04) so the caption text starts flush with
       the leftmost column of arrows in the quiver. */
    padding-left: 4%;
    padding-right: 4%;
  }
</style>
