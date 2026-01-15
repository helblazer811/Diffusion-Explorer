<!-- Visualizes path independence for a conservative vector field with two paths between points A and B. -->

<script lang="ts">
  import { onDestroy } from "svelte";
  import {
    Figure,
    Katex,
    Timeline,
    TimeSlider,
    StreamlineAnimation,
    useCanvas2D,
    useVisibilityHandler,
    drawMathjax,
    drawArrow,
    type VectorFieldFn,
    type StreamlineAnimationState,
  } from "@diffusion-explorer/ui";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  // Layout - 2:1 aspect ratio
  export let width = 800;
  export let height = 400;
  export let backgroundVisible = false;

  // Domain
  export let domainRange = { xMin: -2, xMax: 2, yMin: -1.5, yMax: 1.5 };

  // Endpoints
  export let pointA: [number, number] = [-1.5, -0.8];
  export let pointB: [number, number] = [1.5, 0.5];

  // Spline path control points (first and last should match pointA and pointB)
  export let curvedPathControlPoints: [number, number][] = [
    [-1.5, -0.8],  // pointA
    [-0.8, 0.5],   // intermediate
    [0.0, -0.3],   // intermediate
    [0.8, 0.8],    // intermediate
    [1.5, 0.5]     // pointB
  ];

  // Path styling
  export let straightPathColor = "#f97316"; // Orange
  export let curvedPathColor = "#22c55e"; // Green
  export let pathWidth = 4;
  export let endpointColor = "#374151";
  export let endpointRadius = 5;
  export let intermediatePointRadius = 4;
  export let curvedPathIntermediatePositions = [0.233, 0.5, 0.767]; // Fractions matching control points
  export let arrowHeadSize = 10;

  // Streamline settings
  export let streamlineColor = "#3b82f6";
  export let streamlineWidth = 2.5;
  export let streamlineDensity = 0.6;
  export let pulseWidthPixels = 30;
  export let pulsePauseWidthPixels = 5;
  export let binaryPulse = false; // Alpha gradient enabled

  // Label settings
  export let labelFontSize = 22;
  export let pathLabelFontSize = 20;

  // Animation timing
  export let animationDuration = 22; // seconds
  export let timing = {
    straightPathEnd: 0.40,
    pause1End: 0.405,
    curvedPathEnd: 0.82,
    pause2End: 1.0,
  };
  export let playingByDefault = true;

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  let canvas: HTMLCanvasElement | null = null;
  const canvas2d = useCanvas2D(width, height);
  $: ctx = canvas && canvas2d.ctx;

  let isInitialized = false;

  // Animation state
  type AnimationState = StreamlineAnimationState & {
    straightPathProgress: number; // 0-1
    curvedPathProgress: number; // 0-1
  };

  let timeline: Timeline<AnimationState> | null = null;
  let streamlineAnim: StreamlineAnimation<AnimationState> | null = null;

  // Pre-computed paths (in domain coordinates)
  let straightPath: [number, number][] = [];
  let curvedPath: [number, number][] = [];

  // Visibility handling
  let figureIsActive: import("svelte/store").Writable<boolean> | undefined;
  const { handleVisibilityChange } = useVisibilityHandler(() => timeline);

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  function toPixel(p: [number, number]): [number, number] {
    return [
      ((p[0] - domainRange.xMin) / (domainRange.xMax - domainRange.xMin)) * width,
      ((domainRange.yMax - p[1]) / (domainRange.yMax - domainRange.yMin)) * height,
    ];
  }

  // Conservative vector field: gradient of φ(x,y) = x² - y²
  // F = ∇φ = (2x, -2y)
  function conservativeField(x: number, y: number): [number, number] {
    return [2 * x, -2 * y];
  }

  // Generate straight path between two points
  function generateStraightPath(
    start: [number, number],
    end: [number, number],
    numSegments: number
  ): [number, number][] {
    const path: [number, number][] = [];
    for (let i = 0; i <= numSegments; i++) {
      const t = i / numSegments;
      path.push([
        start[0] + t * (end[0] - start[0]),
        start[1] + t * (end[1] - start[1]),
      ]);
    }
    return path;
  }

  // Create a cubic spline interpolation function from control points
  function createCubicSpline(points: [number, number][]): (x: number) => number {
    const xs = points.map(p => p[0]);
    const ys = points.map(p => p[1]);
    const n = xs.length;

    const a = ys.slice();
    const b = new Array(n - 1);
    const d = new Array(n - 1);
    const h = new Array(n - 1);
    const alpha = new Array(n - 1);
    const c = new Array(n);
    const l = new Array(n);
    const mu = new Array(n);
    const z = new Array(n);

    for (let i = 0; i < n - 1; i++) h[i] = xs[i + 1] - xs[i];
    for (let i = 1; i < n - 1; i++)
      alpha[i] = (3 / h[i]) * (a[i + 1] - a[i]) - (3 / h[i - 1]) * (a[i] - a[i - 1]);

    l[0] = 1; mu[0] = 0; z[0] = 0;
    for (let i = 1; i < n - 1; i++) {
      l[i] = 2 * (xs[i + 1] - xs[i - 1]) - h[i - 1] * mu[i - 1];
      mu[i] = h[i] / l[i];
      z[i] = (alpha[i] - h[i - 1] * z[i - 1]) / l[i];
    }

    l[n - 1] = 1; z[n - 1] = 0; c[n - 1] = 0;
    for (let j = n - 2; j >= 0; j--) {
      c[j] = z[j] - mu[j] * c[j + 1];
      b[j] = (a[j + 1] - a[j]) / h[j] - (h[j] * (c[j + 1] + 2 * c[j])) / 3;
      d[j] = (c[j + 1] - c[j]) / (3 * h[j]);
    }

    return function(x: number): number {
      if (x <= xs[0]) return ys[0];
      if (x >= xs[n - 1]) return ys[n - 1];

      let i = n - 2;
      for (let j = 0; j < n - 1; j++) {
        if (x >= xs[j] && x <= xs[j + 1]) {
          i = j;
          break;
        }
      }
      const dx = x - xs[i];
      return a[i] + b[i] * dx + c[i] * dx ** 2 + d[i] * dx ** 3;
    };
  }

  // Generate a path from a cubic spline through control points
  function generateSplinePath(
    controlPoints: [number, number][],
    numSegments: number
  ): [number, number][] {
    const spline = createCubicSpline(controlPoints);
    const path: [number, number][] = [];
    const xMin = controlPoints[0][0];
    const xMax = controlPoints[controlPoints.length - 1][0];

    for (let i = 0; i <= numSegments; i++) {
      const t = i / numSegments;
      const x = xMin + t * (xMax - xMin);
      const y = spline(x);
      path.push([x, y]);
    }
    return path;
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function runInitialComputation() {
    if (!canvas) return;

    const numSegments = 300;

    // Generate straight path
    straightPath = generateStraightPath(pointA, pointB, numSegments);

    // Generate sinusoidal curved path
    curvedPath = generateSplinePath(curvedPathControlPoints, numSegments);

    // Create streamline animation
    streamlineAnim = StreamlineAnimation.create<AnimationState>({
      vectorFieldFn: conservativeField as VectorFieldFn,
      domain: domainRange,
      toPixel,
      density: streamlineDensity,
      minPathLength: 1.0,
      segmentLength: 0.02,
      subdivisionFactor: 8,
      color: streamlineColor,
      strokeWidth: streamlineWidth,
      pulseWidthPixels,
      pulsePauseWidthPixels,
      binaryPulse,
      offsets: "random",
      loopMultiplier: 2,
    });
  }

  function setupTimeline() {
    if (!streamlineAnim) return;

    timeline = new Timeline<AnimationState>();
    timeline.initialState = {
      streamlinePhase: 0,
      straightPathProgress: 0,
      curvedPathProgress: 0,
    };
    timeline.duration = animationDuration;
    timeline.looping = true;

    // Streamline clip (runs continuously)
    timeline.add(streamlineAnim.clip, { start: 0, end: 1 });

    // Straight path progress clip
    timeline.add(
      {
        name: "StraightPathProgress",
        reduce(t: number) {
          // t is already 0-1 within the clip's range
          return { straightPathProgress: t };
        },
      },
      { start: 0, end: timing.straightPathEnd }
    );

    // Curved path progress clip
    timeline.add(
      {
        name: "CurvedPathProgress",
        reduce(t: number) {
          // t is already 0-1 within the clip's range
          return { curvedPathProgress: t };
        },
      },
      { start: timing.pause1End, end: timing.curvedPathEnd }
    );

    timeline.onTick((_t, state) => {
      draw(state);
    });
  }

  function startAnimation() {
    if (timeline) timeline.play();
  }

  function stopAnimation() {
    if (timeline) timeline.pause();
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function drawPath(
    path: [number, number][],
    progress: number,
    color: string,
    lineWidth: number,
    showArrowHead: boolean = true
  ) {
    if (!ctx || path.length === 0) return;

    const numToDraw = Math.floor(progress * (path.length - 1)) + 1;
    if (numToDraw < 2) return;

    ctx.beginPath();
    const [startX, startY] = toPixel(path[0]);
    ctx.moveTo(startX, startY);

    for (let i = 1; i < numToDraw; i++) {
      const [x, y] = toPixel(path[i]);
      ctx.lineTo(x, y);
    }

    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();

    // Draw arrow head at the tip if animation is in progress (not complete)
    if (showArrowHead && progress > 0 && progress < 1 && numToDraw >= 2) {
      const tipIdx = numToDraw - 1;
      const prevIdx = Math.max(0, tipIdx - 3); // Look back a few points for direction
      const [tipX, tipY] = toPixel(path[tipIdx]);
      const [prevX, prevY] = toPixel(path[prevIdx]);

      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = lineWidth;
      drawArrow(ctx, prevX, prevY, tipX, tipY, arrowHeadSize);
    }
  }

  function drawEndpoint(point: [number, number], label: string, labelOffsetX: number, labelOffsetY: number) {
    if (!ctx) return;

    const [px, py] = toPixel(point);

    // Draw filled circle
    ctx.beginPath();
    ctx.arc(px, py, endpointRadius, 0, 2 * Math.PI);
    ctx.fillStyle = endpointColor;
    ctx.fill();

    // Draw label
    drawMathjax(
      ctx,
      label,
      px + labelOffsetX,
      py + labelOffsetY,
      labelFontSize,
      0,
      labelFontSize / 2,
      {
        color: endpointColor,
        stroke: "white",
        strokeWidth: 8,
        strokeOpacity: 0.9,
      }
    );
  }

  function drawPathLabel(
    path: [number, number][],
    progress: number,
    label: string,
    color: string,
    offsetX: number,
    offsetY: number
  ) {
    if (!ctx || path.length === 0 || progress < 0.5) return;

    // Draw label at midpoint of path
    const midIndex = Math.floor(path.length / 2);
    const [mx, my] = toPixel(path[midIndex]);

    drawMathjax(
      ctx,
      label,
      mx + offsetX,
      my + offsetY,
      pathLabelFontSize,
      0,
      pathLabelFontSize / 2,
      {
        color,
        stroke: "white",
        strokeWidth: 8,
        strokeOpacity: 0.9,
      }
    );
  }

  function draw(state: AnimationState) {
    if (!ctx || !isInitialized || !streamlineAnim) return;

    const { straightPathProgress, curvedPathProgress } = state;

    ctx.clearRect(0, 0, width, height);

    // --- Static Background ---

    // Draw streamlines (pulsing vector field)
    streamlineAnim.draw(ctx, state);

    // Lighten the streamlines a bit
    ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
    ctx.fillRect(0, 0, width, height);

    // --- Dynamic Foreground ---

    // Draw straight path (orange) - only if we've started animating it
    if (straightPathProgress > 0) {
      drawPath(straightPath, straightPathProgress, straightPathColor, pathWidth);
      drawPathLabel(straightPath, straightPathProgress, "p_1", straightPathColor, -15, -30);
    }

    // Draw curved path (green) - only if we've started animating it
    if (curvedPathProgress > 0) {
      drawPath(curvedPath, curvedPathProgress, curvedPathColor, pathWidth);
      drawPathLabel(curvedPath, curvedPathProgress, "p_2", curvedPathColor, 15, 25);
    }

    // Draw endpoints (always visible)
    drawEndpoint(pointA, "", 0, 0);
    drawEndpoint(pointB, "", 0, 0);
  }

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  onDestroy(() => {
    if (timeline) timeline.pause();
  });

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  // Initialize when canvas is ready
  $: if (!isInitialized && canvas) {
    runInitialComputation();
    setupTimeline();
    isInitialized = true;
    draw(timeline!.initialState);
    if (playingByDefault) startAnimation();
  }

  // Handle visibility changes
  $: if (figureIsActive !== undefined && isInitialized && $figureIsActive !== undefined) {
    handleVisibilityChange($figureIsActive);
  }
</script>

<h2 class="path-independence-title">Path Independence of a Conservative Vector Field</h2>

<div class="path-independence-equation">
  <span class="equation-text">If <Katex math={"{\\color{#3b82f6}\\mathbf{F}}"} /> is conservative, then</span>
  <Katex
    math={"\\int_{\\color{#f97316}p_1} {\\color{#3b82f6}\\mathbf{F}} \\cdot d\\mathbf{r} \\;=\\; \\int_{\\color{#22c55e}p_2} {\\color{#3b82f6}\\mathbf{F}} \\cdot d\\mathbf{r}\\,."}
  />
</div>

<Figure {backgroundVisible} bind:isActive={figureIsActive}>
  {#snippet children()}
    <div class="figure-content">
      <div class="canvas-container">
        <canvas
          bind:this={canvas}
          use:canvas2d.bindCanvas
          style="width: 100%; height: auto; aspect-ratio: {width}/{height};"
        ></canvas>
      </div>
      <!-- <TimeSlider {timeline} showTicks={false} showTimeLabel={false} /> -->
    </div>
  {/snippet}
</Figure>

<style>
  .path-independence-title {
    text-align: center;
    margin-bottom: 0.5em;
    color: #4b5563;
    font-weight: 600;
    font-size: 2.1rem;
  }

  .path-independence-equation {
    text-align: center;
    margin-bottom: 0.75em;
    color: #4b5563;
    font-size: 1.95rem;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5em;
  }

  .equation-text {
    display: inline;
  }

  .figure-content {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  .canvas-container {
    width: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
  }
</style>
