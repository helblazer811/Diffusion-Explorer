<!--
  ContinuityEquationFigure

  Pointwise visualization of ∂p/∂t + ∇·(p v) = 0 at a single fixed point x.

  Both panes share a convergent vector field v = -k(x - p), so the density
  evolution and the local flow picture are internally consistent.

  LEFT pane (∂p/∂t at x):
    - A multi-modal Gaussian density contracts onto the fixed point. An SVG
      overlay shows a thin callout from the dot to a vertical bar on the
      right side of the canvas; the bar grows as p(x) grows.

  RIGHT pane (-∇·(p v) at x):
    - Same density (muted by a translucent white overlay) with GPU
      streamlines of the same convergent field flowing into the fixed point,
      clipped to a circular region around it.
-->

<script lang="ts">
  import { tick, onDestroy } from "svelte";
  import type { Writable } from "svelte/store";
  import {
    DoubleFigure,
    useCanvas2D,
    useVisibilityHandler,
    Timeline,
    StreamlineAnimation,
    computeContours,
    plotContours,
    drawMathjax,
    Katex,
    type VectorFieldFn,
    type StreamlineAnimationState,
    type ComputedContours,
  } from "@diffusion-explorer/ui";
  import * as d3 from "d3";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  export let children: import("svelte").Snippet | undefined = undefined;

  // Layout
  export let width = 800;
  export let height = 380;
  export let gap = 20;
  export let backgroundVisible = false;

  // Fixed point + convergent field. The same field drives both the density
  // evolution (samples contract onto the point) and the streamline animation
  // on the right pane — so the visualization is internally consistent.
  export let fixedPoint: [number, number] = [0, 0];
  export let fieldStrength = 1.0;
  export let domainHalfWidth = 1.5;

  // Density samples — Gaussian mixture positioned so the fixed point sits
  // inside the initial support (non-zero p(x) at t=0). Density then
  // contracts onto x under the convergent field.
  export let densityModes: Array<{
    mean: [number, number];
    cov: [[number, number], [number, number]];
    weight: number;
  }> = [
    { mean: [-0.35, 0.4], cov: [[0.08, 0.02], [0.02, 0.05]], weight: 0.4 },
    { mean: [-0.15, -0.4], cov: [[0.07, 0], [0, 0.06]], weight: 0.35 },
    { mean: [0.15, 0.05], cov: [[0.05, -0.01], [-0.01, 0.06]], weight: 0.25 },
  ];
  export let numSamples = 3000;
  export let contourBandwidth = 10;
  export let contourGridSize = 400;
  export let contourThresholds = 5;
  export let contourOpacity = 0.4;
  export let contourColor = "#3b82f6"; // blue

  // Animation discretization — many frames over a short integration window,
  // so the contraction is gentle and the visual is smooth.
  export let contourAnimationSteps = 180;
  export let contourStepSize = 0.004;
  export let animationDuration = 6;

  // Streamlines (right pane)
  export let streamlineColor = "#f97316"; // orange
  export let streamlineDensity: number | [number, number] = 1.0;
  export let streamlineMinPathLength = 1.0;
  export let streamlineWidth = 3;
  export let pulseWidthPixels = 22;
  export let pulsePauseWidthPixels = 6;
  // Show converging streamlines only within this circular radius (px) around
  // the fixed point, so the visual emphasizes the local convergence.
  export let streamlineClipRadius = 90;

  // Right-pane density mute
  export let densityMuteColor = "#ffffff";
  export let densityMuteOpacity = 0.6;

  // Fixed point styling
  export let pointColor = "#f97316";
  export let pointRadius = 6;
  export let pointLabel = "x";
  export let pointLabelFontSize = 18;
  export let pointLabelOffset: [number, number] = [14, -10];

  // Bar chart styling (overlaid vertical bar on the right side of the left canvas)
  export let barColor = "#f97316";
  export let barThickness = 14; // bar width in px
  export let barMaxHeight = 120; // bar height in px at p(x) = max
  export let barRightMargin = 36; // distance from canvas right edge to bar in px
  export let barCalloutColor = "#9ca3af";
  export let barCalloutWidth = 1;
  export let barCalloutGap = 4; // gap between dot edge and start of callout in px
  export let barLabelGap = 8; // gap between bottom of callout and label in px

  export let playingByDefault = true;

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  let figureIsActive: Writable<boolean>;

  let leftCanvas: HTMLCanvasElement | null = null;
  let densityCanvas: HTMLCanvasElement | null = null; // 2D, behind streamlines
  let gpuCanvas: HTMLCanvasElement | null = null; // WebGPU, orange streamlines
  let dotCanvas: HTMLCanvasElement | null = null; // 2D, in front of streamlines (orange dot)

  const leftCanvas2d = useCanvas2D(width, height);
  const densityCanvas2d = useCanvas2D(width, height);
  const dotCanvas2d = useCanvas2D(width, height);

  let isInitialized = false;

  type AnimationState = StreamlineAnimationState & {
    contourFrame: number;
  };

  let timeline: Timeline<AnimationState> | null = null;
  let streamlineAnim: StreamlineAnimation<AnimationState> | null = null;
  let contourFrames: ComputedContours[] = [];
  let densitySeries: number[] = []; // per-frame, normalized to [0, 1]
  let currentBarValue = 0; // reactive, drives the SVG bar width

  const { handleVisibilityChange } = useVisibilityHandler(() => timeline);

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  function getDomain() {
    const xMin = fixedPoint[0] - domainHalfWidth;
    const xMax = fixedPoint[0] + domainHalfWidth;
    const yMin = fixedPoint[1] - domainHalfWidth;
    const yMax = fixedPoint[1] + domainHalfWidth;
    return { xMin, xMax, yMin, yMax };
  }

  function toPixel(p: [number, number], cW: number, cH: number): [number, number] {
    const { xMin, xMax, yMin, yMax } = getDomain();
    return [
      ((p[0] - xMin) / (xMax - xMin)) * cW,
      ((yMax - p[1]) / (yMax - yMin)) * cH,
    ];
  }

  function boxMullerTransform(): [number, number] {
    const u1 = Math.random();
    const u2 = Math.random();
    const r = Math.sqrt(-2 * Math.log(u1));
    const theta = 2 * Math.PI * u2;
    return [r * Math.cos(theta), r * Math.sin(theta)];
  }

  function sampleGaussianMixture(
    n: number,
    modes: typeof densityModes
  ): [number, number][] {
    const samples: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const r = Math.random();
      let cumWeight = 0;
      let selected = modes[0];
      for (const g of modes) {
        cumWeight += g.weight;
        if (r <= cumWeight) {
          selected = g;
          break;
        }
      }
      const { mean, cov } = selected;
      const [z1, z2] = boxMullerTransform();
      // Cholesky decomposition of 2x2 covariance.
      const a = Math.sqrt(cov[0][0]);
      const b = cov[1][0] / a;
      const c = Math.sqrt(Math.max(0, cov[1][1] - b * b));
      samples.push([mean[0] + a * z1, mean[1] + b * z1 + c * z2]);
    }
    return samples;
  }

  function eulerIntegrate(
    samples: [number, number][],
    vectorField: VectorFieldFn,
    dt: number
  ): [number, number][] {
    return samples.map(([x, y]) => {
      const [vx, vy] = vectorField(x, y);
      return [x + vx * dt, y + vy * dt];
    });
  }

  function createConvergentField(p: [number, number], k: number): VectorFieldFn {
    return (x, y) => [-k * (x - p[0]), -k * (y - p[1])];
  }

  function densityAtPoint(
    samples: [number, number][],
    p: [number, number],
    radius: number
  ): number {
    const r2 = radius * radius;
    let count = 0;
    for (const [x, y] of samples) {
      const dx = x - p[0];
      const dy = y - p[1];
      if (dx * dx + dy * dy <= r2) count++;
    }
    return count / (samples.length * Math.PI * r2);
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function runInitialComputation(cW: number, cH: number) {
    const field = createConvergentField(fixedPoint, fieldStrength);
    const toPixelBound = (p: [number, number]) => toPixel(p, cW, cH);
    const domain = getDomain();

    streamlineAnim = StreamlineAnimation.create<AnimationState>({
      backend: "gpu",
      vectorFieldFn: field,
      domain,
      toPixel: toPixelBound,
      density: streamlineDensity,
      minPathLength: streamlineMinPathLength,
      color: streamlineColor,
      strokeWidth: streamlineWidth,
      pulseWidthPixels,
      pulsePauseWidthPixels,
      offsets: "synchronized",
      duration: animationDuration,
      pulseFrequency: 0.5,
    });

    // Density: same convergent field driving the contours.
    let samples = sampleGaussianMixture(numSamples, densityModes);
    const contourDomain: [number, number, number, number] = [
      domain.xMin,
      domain.xMax,
      domain.yMin,
      domain.yMax,
    ];
    const densityRadius = domainHalfWidth * 0.08;

    contourFrames = [];
    const rawDensity: number[] = [];
    for (let i = 0; i < contourAnimationSteps; i++) {
      contourFrames.push(
        computeContours(samples, {
          bandwidth: contourBandwidth,
          gridSize: contourGridSize,
          thresholds: contourThresholds,
          domain: contourDomain,
        })
      );
      rawDensity.push(densityAtPoint(samples, fixedPoint, densityRadius));
      samples = eulerIntegrate(samples, field, contourStepSize);
    }
    const maxDensity = Math.max(...rawDensity, 1e-12);
    densitySeries = rawDensity.map((d) => d / maxDensity);
  }

  function setupTimeline(cW: number, cH: number) {
    if (!streamlineAnim) return;

    timeline = new Timeline<AnimationState>();
    timeline.initialState = { streamlinePhase: 0, contourFrame: 0 };
    timeline.duration = animationDuration;
    timeline.looping = true;

    timeline.add(streamlineAnim.clip, { start: 0, end: 1 });

    timeline.add(
      {
        name: "ContourFrame",
        reduce(t: number) {
          const idx = Math.min(
            Math.floor(t * contourAnimationSteps),
            contourAnimationSteps - 1
          );
          return { contourFrame: idx };
        },
      },
      { start: 0, end: 1 }
    );

    timeline.onTick((_t, state) => {
      drawLeft(state, cW, cH);
      drawRight(state, cW, cH);
      currentBarValue = densitySeries[state.contourFrame] ?? 0;
    });
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function drawDensityAndDot(
    ctx: CanvasRenderingContext2D,
    cf: ComputedContours,
    cW: number,
    cH: number,
    mute: boolean
  ) {
    const toPixelBound = (p: [number, number]) => toPixel(p, cW, cH);

    plotContours(ctx, cf, {
      xScale: (x) => toPixelBound([x, 0])[0],
      yScale: (y) => toPixelBound([0, y])[1],
      fillColor: contourColor,
      opacity: contourOpacity,
      fill: true,
      stroke: false,
    });

    if (mute) {
      ctx.save();
      ctx.globalAlpha = densityMuteOpacity;
      ctx.fillStyle = densityMuteColor;
      ctx.fillRect(0, 0, cW, cH);
      ctx.restore();
    }
  }

  function drawDot(ctx: CanvasRenderingContext2D, cW: number, cH: number) {
    const [px, py] = toPixel(fixedPoint, cW, cH);

    // Translucent white rounded rectangle behind the dot and label so they
    // stay legible against the contour density and streamlines.
    const padX = 6;
    const padY = 4;
    const labelW = pointLabelFontSize * 0.7; // approx width of "x" glyph
    const rectLeft = px - pointRadius - padX;
    const rectRight =
      px + pointLabelOffset[0] + labelW + padX;
    const labelMidY = py + pointLabelOffset[1];
    const rectTop =
      Math.min(py - pointRadius, labelMidY - pointLabelFontSize / 2) - padY;
    const rectBottom =
      Math.max(py + pointRadius, labelMidY + pointLabelFontSize / 2) + padY;
    const rectW = rectRight - rectLeft;
    const rectH = rectBottom - rectTop;
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.roundRect(rectLeft, rectTop, rectW, rectH, 6);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = pointColor;
    ctx.beginPath();
    ctx.arc(px, py, pointRadius, 0, 2 * Math.PI);
    ctx.fill();
    drawMathjax(
      ctx,
      pointLabel,
      px + pointLabelOffset[0],
      py + pointLabelOffset[1] + pointLabelFontSize / 2,
      pointLabelFontSize,
      0,
      0,
      { color: pointColor }
    );
  }

  function drawLeft(state: AnimationState, cW: number, cH: number) {
    const ctx = leftCanvas2d.ctx;
    const cf = contourFrames[state.contourFrame];
    if (!ctx || !cf) return;
    ctx.clearRect(0, 0, cW, cH);
    drawDensityAndDot(ctx, cf, cW, cH, /* mute */ false);
    drawDot(ctx, cW, cH);
  }

  function drawRight(state: AnimationState, cW: number, cH: number) {
    // GPU streamlines (middle z-layer)
    if (streamlineAnim?.initialized) {
      streamlineAnim.draw(state, [0, 0, 0, 0]);
    }

    // Density + mute on the back canvas
    const dctx = densityCanvas2d.ctx;
    const cf = contourFrames[state.contourFrame];
    if (dctx && cf) {
      dctx.clearRect(0, 0, cW, cH);
      drawDensityAndDot(dctx, cf, cW, cH, /* mute */ true);
    }

    // Orange dot on the topmost canvas so it sits above the streamlines
    const tctx = dotCanvas2d.ctx;
    if (tctx) {
      tctx.clearRect(0, 0, cW, cH);
      drawDot(tctx, cW, cH);
    }
  }

  // ----------------------------------------------------------------
  // Bar chart (d3 scale, Svelte template)
  // ----------------------------------------------------------------

  // Bar geometry — vertical bar overlaid on the right side of the left canvas.
  // Bar's bottom sits at the same y as the orange dot, so a horizontal callout
  // connects the dot to the bar. Bar grows upward as p(x) grows.
  $: dotPixel = canvasWidth && canvasHeight
    ? toPixel(fixedPoint, canvasWidth, canvasHeight)
    : [0, 0];
  $: barHeightScale = d3.scaleLinear().domain([0, 1]).range([0, barMaxHeight]);
  $: barCurrentHeight = Math.max(0, barHeightScale(currentBarValue));
  $: barX = canvasWidth ? canvasWidth - barRightMargin - barThickness : 0;
  $: barBottomY = dotPixel[1];
  $: barTopY = barBottomY - barCurrentHeight;
  $: calloutX1 = dotPixel[0] + pointRadius + barCalloutGap;
  $: calloutX2 = barX;

  // Center of the streamline clip circle, in percentages of the GPU canvas.
  $: streamlineClipCenterPct = canvasWidth && canvasHeight
    ? (() => {
        const [px, py] = toPixel(fixedPoint, canvasWidth, canvasHeight);
        return [(px / canvasWidth) * 100, (py / canvasHeight) * 100];
      })()
    : [50, 50];

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  onDestroy(() => {
    if (timeline) timeline.pause();
    if (streamlineAnim) streamlineAnim.destroy();
  });

  // ----------------------------------------------------------------
  // Reactive blocks
  // ----------------------------------------------------------------

  $: canvasWidth = Math.floor((width - gap) / 2);
  $: canvasHeight = height;

  $: if (
    !isInitialized &&
    leftCanvas &&
    densityCanvas &&
    dotCanvas &&
    gpuCanvas
  ) {
    runInitialComputation(canvasWidth, canvasHeight);
    setupTimeline(canvasWidth, canvasHeight);
    isInitialized = true;
    tick().then(async () => {
      leftCanvas2d.resize(canvasWidth, canvasHeight);
      densityCanvas2d.resize(canvasWidth, canvasHeight);
      dotCanvas2d.resize(canvasWidth, canvasHeight);

      if (streamlineAnim && gpuCanvas) {
        const dpr = window.devicePixelRatio || 1;
        gpuCanvas.width = canvasWidth * dpr;
        gpuCanvas.height = canvasHeight * dpr;
        await streamlineAnim.init(gpuCanvas);
      }

      if (timeline) {
        drawLeft(timeline.initialState, canvasWidth, canvasHeight);
        drawRight(timeline.initialState, canvasWidth, canvasHeight);
        currentBarValue = densitySeries[0] ?? 0;
        if (playingByDefault) timeline.play();
      }
    });
  }

  $: if (figureIsActive !== undefined && isInitialized) {
    handleVisibilityChange($figureIsActive);
  }
</script>

<DoubleFigure {gap} {backgroundVisible} bind:isActive={figureIsActive}>
  {#snippet left()}
    <div
      class="left-canvas-container"
      style="width: 100%; aspect-ratio: {canvasWidth}/{canvasHeight};"
    >
      <canvas
        bind:this={leftCanvas}
        use:leftCanvas2d.bindCanvas
        class="density-canvas"
      ></canvas>
      <!-- Bar-chart overlay: thin callout from the dot to a vertical bar on
           the right edge of the canvas, with "p(x)" labeled below the bar. -->
      <svg
        class="bar-overlay"
        viewBox="0 0 {canvasWidth} {canvasHeight}"
        preserveAspectRatio="none"
      >
        <line
          x1={calloutX1}
          y1={barBottomY}
          x2={calloutX2}
          y2={barBottomY}
          stroke={barCalloutColor}
          stroke-width={barCalloutWidth}
        />
        <rect
          x={barX}
          y={barTopY}
          width={barThickness}
          height={barCurrentHeight}
          fill={barColor}
          rx="2"
        />
      </svg>
      <div
        class="bar-label"
        style="
          left: {((barX + barThickness / 2) / canvasWidth) * 100}%;
          top: {((barBottomY + barLabelGap) / canvasHeight) * 100}%;
        "
      >
        <Katex math={`\\color{${barColor}} p(x)`} />
      </div>
    </div>
  {/snippet}

  {#snippet right()}
    <div
      class="right-canvas-container"
      style="width: 100%; aspect-ratio: {canvasWidth}/{canvasHeight};"
    >
      <!-- Back: density + mute -->
      <canvas
        bind:this={densityCanvas}
        use:densityCanvas2d.bindCanvas
        class="back-canvas"
      ></canvas>
      <!-- Middle: GPU streamlines, clipped to a circular region around the
           fixed point so the visual emphasizes the local convergence. -->
      <canvas
        bind:this={gpuCanvas}
        class="gpu-canvas"
        style="clip-path: circle({streamlineClipRadius}px at {streamlineClipCenterPct[0]}% {streamlineClipCenterPct[1]}%);"
      ></canvas>
      <!-- Front: orange dot label -->
      <canvas
        bind:this={dotCanvas}
        use:dotCanvas2d.bindCanvas
        class="front-canvas"
      ></canvas>
    </div>
  {/snippet}

  {#snippet caption()}
    {@render children?.()}
  {/snippet}
</DoubleFigure>

<style>
  .left-canvas-container,
  .right-canvas-container {
    position: relative;
  }

  .density-canvas {
    width: 100%;
    height: 100%;
    display: block;
  }

  .bar-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    overflow: visible;
  }

  .bar-label {
    position: absolute;
    transform: translate(-50%, 0);
    color: #374151;
    font-size: 0.95rem;
    line-height: 1;
    pointer-events: none;
    white-space: nowrap;
  }

  .back-canvas,
  .gpu-canvas,
  .front-canvas {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
  }

  .back-canvas {
    z-index: 0;
  }

  .gpu-canvas {
    z-index: 1;
  }

  .front-canvas {
    z-index: 2;
  }
</style>
