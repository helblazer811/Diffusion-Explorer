<!--
  The Lorenz Attractor

      dx/dt = sigma * (y - x)
      dy/dt = x * (rho - z) - y
      dz/dt = x * y - beta * z

  One canonical Lorenz trajectory is integrated in 3D, then projected each
  frame through a camera that smoothly rotates from a tilted overhead-style
  view into the iconic side-on butterfly silhouette. A red comet traces
  the path while a gray backdrop shows the full attractor under the
  current projection, and a 3D axis indicator in the corner rotates in
  lockstep with the view.
-->

<script lang="ts">
  import { onDestroy } from "svelte";
  import type { Writable } from "svelte/store";
  import {
    Figure,
    Timeline,
    useVisibilityHandler,
  } from "@diffusion-explorer/ui";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  let {
    // Layout
    canvasWidth = 1280,
    canvasHeight = 480,
    margin = 20,
    dpiScale = 3,

    // Lorenz parameters (canonical butterfly).
    sigma = 10,
    beta = 8 / 3,
    rho = 28,
    startPoint = [1, 1, 1] as [number, number, number],
    warmup = 1200,
    dt = 0.003,
    numSamples = 13000,
    // Extra padding (in projected world units) added around the auto-fit
    // bounding box so the attractor never sits right against the edge.
    fitPaddingFraction = 0.1,
    // 0 = uniform fit (preserves aspect, leaves whitespace on the wider
    // side). 1 = the x dimension is independently stretched to also fill
    // horizontally, so the attractor fills wide aspect-ratio canvases.
    xStretchAmount = 1.0,

    // Camera Euler angles in radians. yaw rotates around the world z-axis,
    // pitch around the camera-local x-axis. (0, 0) = canonical side view
    // looking down the -y axis; the screen shows x horizontal and z up.
    yawA = 0.35,
    pitchA = 1.05, // ~60 degrees from horizontal: a tilted overhead view.
    yawB = 0,
    pitchB = 0,

    // Phase boundaries in normalized timeline time [0, 1].
    phaseAEnd = 0.05,
    morphEnd = 0.45,

    // Gray attractor backdrop showing the full active projection.
    backdropColor = "#475569",
    backdropOpacity = 0.55,
    backdropStrokeWidth = 1.6,

    // Bottom-left rotating axis indicator.
    axesOriginX = 60,
    axesOriginYFromBottom = 60,
    axesLength = 55,
    axesColor = "#475569",
    axesStrokeWidth = 1.5,
    axesLabelFontPx = 16,
    axesLabelGap = 10,

    // Red comet trail.
    trailColor = "#ef4444",
    trailStrokeWidth = 3.2,
    trailWindow = 2000,
    trailFadeFloor = 0.0,
    trailFadeGamma = 1.6,
    headPointRadius = 7.5,
    headOutlineColor = "#ffffff",
    headOutlineStrokeWidth = 1.2,

    animationDurationMs = 32000,
    playingByDefault = true,
    initialPlayDelaySeconds = 0.8,
  } = $props();

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  type AnimationState = { time: number };

  const physicalWidth = $derived(canvasWidth * dpiScale);
  const physicalHeight = $derived(canvasHeight * dpiScale);

  let canvas: HTMLCanvasElement | null = $state(null);
  let ctx: CanvasRenderingContext2D | null = $state(null);

  let timeline: Timeline<AnimationState> | null = $state(null);
  let isInitialized = $state(false);

  // 3D trajectory in centered world coordinates.
  let path3D: number[][] = [];

  let figureIsActive: Writable<boolean> | undefined = $state(undefined);
  const { handleVisibilityChange } = useVisibilityHandler(() => timeline);

  // ----------------------------------------------------------------
  // ODE
  // ----------------------------------------------------------------

  function lorenzField(
    x: number,
    y: number,
    z: number
  ): [number, number, number] {
    return [sigma * (y - x), x * (rho - z) - y, x * y - beta * z];
  }

  function rk4Step(
    x: number,
    y: number,
    z: number,
    h: number
  ): [number, number, number] {
    const [k1x, k1y, k1z] = lorenzField(x, y, z);
    const [k2x, k2y, k2z] = lorenzField(
      x + (h / 2) * k1x,
      y + (h / 2) * k1y,
      z + (h / 2) * k1z
    );
    const [k3x, k3y, k3z] = lorenzField(
      x + (h / 2) * k2x,
      y + (h / 2) * k2y,
      z + (h / 2) * k2z
    );
    const [k4x, k4y, k4z] = lorenzField(
      x + h * k3x,
      y + h * k3y,
      z + h * k3z
    );
    return [
      x + (h / 6) * (k1x + 2 * k2x + 2 * k3x + k4x),
      y + (h / 6) * (k1y + 2 * k2y + 2 * k3y + k4y),
      z + (h / 6) * (k1z + 2 * k2z + 2 * k3z + k4z),
    ];
  }

  function integrate(
    start: [number, number, number],
    h: number,
    warmupSteps: number,
    n: number
  ): number[][] {
    let x = start[0];
    let y = start[1];
    let z = start[2];
    for (let i = 0; i < warmupSteps; i++) {
      [x, y, z] = rk4Step(x, y, z, h);
    }
    const out: number[][] = new Array(n + 1);
    out[0] = [x, y, z];
    for (let i = 1; i <= n; i++) {
      [x, y, z] = rk4Step(x, y, z, h);
      out[i] = [x, y, z];
    }
    return out;
  }

  // ----------------------------------------------------------------
  // Camera projection
  // ----------------------------------------------------------------

  // Apply yaw (around world z) then pitch (around camera-local x), and
  // project onto the camera's (x, z) screen plane. y is discarded (the
  // axis the camera looks along).
  function project3D(
    p: number[],
    yaw: number,
    pitch: number
  ): [number, number] {
    const cY = Math.cos(yaw);
    const sY = Math.sin(yaw);
    const x1 = cY * p[0] - sY * p[1];
    const y1 = sY * p[0] + cY * p[1];
    const z1 = p[2];

    const cP = Math.cos(pitch);
    const sP = Math.sin(pitch);
    // const y2 = cP * y1 - sP * z1; // unused (camera-look axis)
    const z2 = sP * y1 + cP * z1;
    return [x1, z2];
  }

  // Project the full 3D trajectory through the current camera and uniformly
  // scale the result so the whole attractor fits inside the canvas (minus
  // the configured margin and a small extra padding). This way the
  // attractor stays the same visual size as the camera rotates and never
  // gets clipped.
  function projectPath(yaw: number, pitch: number): number[][] {
    const projected: [number, number][] = new Array(path3D.length);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < path3D.length; i++) {
      const p = project3D(path3D[i], yaw, pitch);
      projected[i] = p;
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
    const padX = (maxX - minX) * fitPaddingFraction;
    const padY = (maxY - minY) * fitPaddingFraction;
    const dw = maxX - minX + 2 * padX || 1;
    const dh = maxY - minY + 2 * padY || 1;
    const plotWidth = canvasWidth - 2 * margin;
    const plotHeight = canvasHeight - 2 * margin;
    const uniformScale = Math.min(plotWidth / dw, plotHeight / dh);
    const fillX = plotWidth / dw;
    const fillY = plotHeight / dh;
    const scaleX = uniformScale + xStretchAmount * (fillX - uniformScale);
    const scaleY = uniformScale + xStretchAmount * (fillY - uniformScale);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const ccx = canvasWidth / 2;
    const ccy = canvasHeight / 2;

    const out: number[][] = new Array(path3D.length);
    for (let i = 0; i < path3D.length; i++) {
      const [px, py] = projected[i];
      out[i] = [ccx + (px - cx) * scaleX, ccy - (py - cy) * scaleY];
    }
    return out;
  }

  function setupCanvas(c: HTMLCanvasElement): CanvasRenderingContext2D | null {
    c.width = physicalWidth;
    c.height = physicalHeight;
    const context = c.getContext("2d");
    if (context) context.scale(dpiScale, dpiScale);
    return context;
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function runInitialComputation() {
    if (!canvas) return;
    const traj = integrate(startPoint, dt, warmup, numSamples);
    // Center on the attractor's vertical centroid so the rotation feels
    // natural rather than swinging the whole shape off-screen.
    const cz = rho - 1;
    path3D = traj.map((p) => [p[0], p[1], p[2] - cz]);
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function smoothstep(t: number): number {
    return t * t * (3 - 2 * t);
  }

  function cameraAt(t: number): { yaw: number; pitch: number } {
    let u: number;
    if (t <= phaseAEnd) u = 0;
    else if (t >= morphEnd) u = 1;
    else u = smoothstep((t - phaseAEnd) / (morphEnd - phaseAEnd));
    return {
      yaw: yawA + u * (yawB - yawA),
      pitch: pitchA + u * (pitchB - pitchA),
    };
  }

  function drawBackdrop(path: number[][]): void {
    if (!ctx || path.length < 2) return;
    ctx.save();
    ctx.strokeStyle = backdropColor;
    ctx.globalAlpha = backdropOpacity;
    ctx.lineWidth = backdropStrokeWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(path[0][0], path[0][1]);
    for (let i = 1; i < path.length; i++) {
      ctx.lineTo(path[i][0], path[i][1]);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawTrail(path: number[][], headFractional: number): void {
    if (!ctx || path.length < 2) return;
    const lastIdx = path.length - 1;
    const head = Math.max(0, Math.min(headFractional, lastIdx));
    const tailStart = Math.max(0, head - trailWindow);
    const denom = head - tailStart;
    if (denom <= 0) return;

    ctx.save();
    ctx.strokeStyle = trailColor;
    ctx.lineWidth = trailStrokeWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const startIdx = Math.max(1, Math.floor(tailStart) + 1);
    const endIdx = Math.floor(head);
    for (let i = startIdx; i <= endIdx; i++) {
      const u = (i - tailStart) / denom;
      ctx.globalAlpha =
        trailFadeFloor + (1 - trailFadeFloor) * Math.pow(u, trailFadeGamma);
      ctx.beginPath();
      ctx.moveTo(path[i - 1][0], path[i - 1][1]);
      ctx.lineTo(path[i][0], path[i][1]);
      ctx.stroke();
    }

    const floorH = Math.floor(head);
    const fracH = head - floorH;
    const baseIdx = Math.min(floorH, lastIdx);
    const nextIdx = Math.min(baseIdx + 1, lastIdx);
    const headX =
      path[baseIdx][0] + fracH * (path[nextIdx][0] - path[baseIdx][0]);
    const headY =
      path[baseIdx][1] + fracH * (path[nextIdx][1] - path[baseIdx][1]);

    ctx.globalAlpha = 1;
    ctx.fillStyle = trailColor;
    ctx.beginPath();
    ctx.arc(headX, headY, headPointRadius, 0, 2 * Math.PI);
    ctx.fill();

    ctx.strokeStyle = headOutlineColor;
    ctx.lineWidth = headOutlineStrokeWidth;
    ctx.beginPath();
    ctx.arc(
      headX,
      headY,
      headPointRadius + headOutlineStrokeWidth / 2,
      0,
      2 * Math.PI
    );
    ctx.stroke();
    ctx.restore();
  }

  function drawAxes(yaw: number, pitch: number): void {
    if (!ctx) return;
    const ox = axesOriginX;
    const oy = canvasHeight - axesOriginYFromBottom;

    // Compute screen-projected direction AND camera-space depth (the
    // discarded look axis) for each basis vector. Depth ~ +1 = far, ~ -1
    // = near.
    const cY = Math.cos(yaw);
    const sY = Math.sin(yaw);
    const cP = Math.cos(pitch);
    const sP = Math.sin(pitch);

    type AxisDraw = { e: [number, number]; depth: number; label: string };
    const make = (v: [number, number, number], label: string): AxisDraw => {
      const x1 = cY * v[0] - sY * v[1];
      const y1 = sY * v[0] + cY * v[1];
      const z1 = v[2];
      const z2 = sP * y1 + cP * z1;
      const y2 = cP * y1 - sP * z1; // camera-look axis: depth cue.
      return { e: [x1, z2], depth: y2, label };
    };
    const axes: AxisDraw[] = [
      make([1, 0, 0], "x"),
      make([0, 1, 0], "y"),
      make([0, 0, 1], "z"),
    ];
    // Draw the far ones first so near axes paint over them.
    axes.sort((a, b) => b.depth - a.depth);

    // Screen-space tips for each axis (canvas y is flipped).
    const tips: [number, number][] = axes.map((a) => [
      ox + a.e[0] * axesLength,
      oy - a.e[1] * axesLength,
    ]);

    // For each axis, choose a label position that maximizes the minimum
    // distance to every other axis line, so labels never land on top of
    // an axis. We sample a few candidate offsets around the tip (radial
    // outward, perpendicular both ways, and 45-degree combinations) and
    // pick the best.
    const pickLabelPos = (i: number): [number, number] => {
      const a = axes[i];
      // Screen-space axis direction.
      const dx = a.e[0];
      const dy = -a.e[1];
      const len = Math.hypot(dx, dy);
      // Fallback direction if this axis is collapsed (looking along it).
      const ux = len > 1e-3 ? dx / len : 0.7071;
      const uy = len > 1e-3 ? dy / len : 0.7071;
      const px = -uy;
      const py = ux;
      const gap = axesLabelGap;
      const candidates: [number, number][] = [
        // Radial-outward variants
        [tips[i][0] + ux * gap, tips[i][1] + uy * gap],
        [tips[i][0] + ux * gap + px * gap, tips[i][1] + uy * gap + py * gap],
        [tips[i][0] + ux * gap - px * gap, tips[i][1] + uy * gap - py * gap],
        // Pure perpendicular
        [tips[i][0] + px * gap, tips[i][1] + py * gap],
        [tips[i][0] - px * gap, tips[i][1] - py * gap],
      ];
      const labelRadius = axesLabelFontPx * 0.55;
      let best: [number, number] = candidates[0];
      let bestScore = -Infinity;
      for (const c of candidates) {
        // Score = min distance from candidate to each *other* axis line
        // segment, minus a small penalty for any other tip too close.
        let minDist = Infinity;
        for (let j = 0; j < axes.length; j++) {
          if (j === i) continue;
          const d = distToSegment(c, [ox, oy], tips[j]);
          if (d < minDist) minDist = d;
        }
        const score = minDist - labelRadius;
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      }
      return best;
    };

    ctx.save();
    ctx.strokeStyle = axesColor;
    ctx.fillStyle = axesColor;
    ctx.lineWidth = axesStrokeWidth;
    ctx.lineCap = "round";
    ctx.font = `italic ${axesLabelFontPx}px serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.globalAlpha = 1;
    for (let i = 0; i < axes.length; i++) {
      const a = axes[i];
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(tips[i][0], tips[i][1]);
      ctx.stroke();
      // x and z sit straight off their tips along their own axis direction;
      // y gets the collision-avoiding placement (it collapses toward the
      // origin under the canonical view and needs a perpendicular offset).
      let lx: number, ly: number;
      if (a.label === "y") {
        [lx, ly] = pickLabelPos(i);
      } else {
        const dx = a.e[0];
        const dy = -a.e[1];
        const len = Math.hypot(dx, dy);
        const ux = len > 1e-3 ? dx / len : 0;
        const uy = len > 1e-3 ? dy / len : 0;
        lx = tips[i][0] + ux * axesLabelGap;
        ly = tips[i][1] + uy * axesLabelGap;
      }
      ctx.fillText(a.label, lx, ly);
    }
    ctx.restore();
  }

  function distToSegment(
    p: [number, number],
    a: [number, number],
    b: [number, number]
  ): number {
    const ax = a[0];
    const ay = a[1];
    const bx = b[0];
    const by = b[1];
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-6) return Math.hypot(p[0] - ax, p[1] - ay);
    let t = ((p[0] - ax) * dx + (p[1] - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const qx = ax + t * dx;
    const qy = ay + t * dy;
    return Math.hypot(p[0] - qx, p[1] - qy);
  }

  function draw(t: number) {
    if (!ctx) return;

    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    const cam = cameraAt(t);
    const path = projectPath(cam.yaw, cam.pitch);
    drawBackdrop(path);
    drawTrail(path, t * numSamples);
    drawAxes(cam.yaw, cam.pitch);
  }

  // ----------------------------------------------------------------
  // Timeline
  // ----------------------------------------------------------------

  function setupTimeline() {
    timeline = new Timeline<AnimationState>();
    timeline.initialState = { time: 0 };
    timeline.duration = animationDurationMs / 1000;
    timeline.looping = true;
    timeline.onTick((t: number) => draw(t));
  }

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  onDestroy(() => {
    if (timeline) timeline.dispose();
  });

  $effect(() => {
    if (canvas && !ctx) ctx = setupCanvas(canvas);
  });

  $effect(() => {
    if (!isInitialized && ctx && canvas) {
      runInitialComputation();
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
    }
  });

  $effect(() => {
    if (
      figureIsActive !== undefined &&
      isInitialized &&
      $figureIsActive !== undefined
    ) {
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
    <span class="lorenz-caption">
      <strong>The Lorenz attractor.</strong>
      A single deterministic trajectory winds endlessly around two unstable
      fixed points, never repeating yet always settling onto the same
      butterfly-shaped set in state space.
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

  .lorenz-caption {
    display: block;
    font-size: 1rem;
    line-height: 1.45;
    padding-left: 4%;
    padding-right: 4%;
  }
</style>
