<!--
  ContinuityEquationFigure

  Pointwise visualization of ∂p/∂t + ∇·(p v) = 0 at a single fixed point x.

  LEFT pane (∂p/∂t at x):
    - A broad Gaussian density contracts onto the fixed point under a linear
      sink field v = -k(x - p). Below the canvas, an SVG bar shows p_t(x)
      growing as density piles up at the point.

  RIGHT pane (-∇·(p v) at x):
    - Same density (muted by a translucent white overlay) with GPU streamlines
      of the same convergent field flowing into the fixed point. The orange
      dot marks x on both panes.
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
  export let barPanelHeight = 56;
  export let backgroundVisible = false;

  // Fixed point + field
  export let fixedPoint: [number, number] = [0, 0];
  export let fieldStrength = 1.0;
  export let domainHalfWidth = 1.5;

  // Density samples — Gaussian mixture starting LEFT of the fixed point so
  // the density visibly drifts left→right while contracting onto it.
  export let densityModes: Array<{
    mean: [number, number];
    cov: [[number, number], [number, number]];
    weight: number;
  }> = [
    { mean: [-0.8, 0.4], cov: [[0.06, 0.01], [0.01, 0.04]], weight: 0.4 },
    { mean: [-0.6, -0.35], cov: [[0.05, 0], [0, 0.06]], weight: 0.35 },
    { mean: [-1.0, 0.05], cov: [[0.04, -0.01], [-0.01, 0.05]], weight: 0.25 },
  ];
  export let numSamples = 3000;
  export let contourBandwidth = 12;
  export let contourGridSize = 400;
  export let contourThresholds = 8;
  export let contourOpacity = 0.4;
  export let contourColor = "#3b82f6"; // blue

  // Animation discretization — shorter contraction span.
  export let contourAnimationSteps = 60;
  export let contourStepSize = 0.03;
  export let animationDuration = 3;

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

  // Bar chart styling
  export let barColor = "#f97316";
  export let barHeight = 16;

  export let playingByDefault = true;

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  let figureIsActive: Writable<boolean>;

  let leftCanvas: HTMLCanvasElement | null = null;
  let densityCanvas: HTMLCanvasElement | null = null; // 2D, behind streamlines
  let gpuCanvas: HTMLCanvasElement | null = null; // GPU, in front, for orange streamlines
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
    const vectorField = createConvergentField(fixedPoint, fieldStrength);
    const toPixelBound = (p: [number, number]) => toPixel(p, cW, cH);
    const domain = getDomain();

    streamlineAnim = StreamlineAnimation.create<AnimationState>({
      backend: "gpu",
      vectorFieldFn: vectorField,
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

    let samples = sampleGaussianMixture(numSamples, densityModes);
    const contourDomain: [number, number, number, number] = [
      domain.xMin,
      domain.xMax,
      domain.yMin,
      domain.yMax,
    ];
    // Radius for the point-density estimator — small enough to be local,
    // large enough that the count is stable across frames.
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
      samples = eulerIntegrate(samples, vectorField, contourStepSize);
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
      { color: pointColor, stroke: "white", strokeWidth: 6, strokeOpacity: 0.9 }
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
    // GPU streamlines (front canvas, middle z-layer)
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

  $: barColumnWidth = Math.max(0, canvasWidth);
  $: barScale = d3.scaleLinear().domain([0, 1]).range([0, barColumnWidth]);
  $: barWidth = Math.max(0, barScale(currentBarValue));

  // Center of the streamline clip circle, in percentages of the GPU canvas.
  // Domain is centered on fixedPoint, so this is always (50, 50) — but compute
  // it from toPixel so the clip stays correct if the domain logic changes.
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
  $: canvasHeight = height - barPanelHeight;

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
    <div class="left-stack" style="width: 100%;">
      <canvas
        bind:this={leftCanvas}
        use:leftCanvas2d.bindCanvas
        style="width: 100%; height: auto; aspect-ratio: {canvasWidth}/{canvasHeight};"
      ></canvas>
      <div class="bar-column" style="height: {barPanelHeight}px;">
        <span class="bar-label-above">
          <Katex math={"p(x)"} />
        </span>
        <svg
          class="bar-svg"
          viewBox="0 0 {barColumnWidth} {barHeight}"
          width={barColumnWidth}
          height={barHeight}
          preserveAspectRatio="none"
        >
          <rect
            x="0"
            y="0"
            width={barWidth}
            height={barHeight}
            fill={barColor}
            rx="2"
          />
        </svg>
      </div>
    </div>
  {/snippet}

  {#snippet right()}
    <div class="right-stack" style="width: 100%;">
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
      <div class="bar-row-spacer" style="height: {barPanelHeight}px;"></div>
    </div>
  {/snippet}

  {#snippet caption()}
    {@render children?.()}
  {/snippet}
</DoubleFigure>

<style>
  .left-stack,
  .right-stack {
    display: flex;
    flex-direction: column;
  }

  .bar-column {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 4px;
    padding-top: 8px;
  }

  .bar-label-above {
    text-align: center;
    color: #374151;
    font-size: 1rem;
    line-height: 1;
  }

  .bar-svg {
    width: 100%;
    overflow: visible;
  }

  .bar-row-spacer {
    /* keeps the right column the same vertical extent as the left so captions
       sit at the same baseline below both panes. */
  }

  .right-canvas-container {
    position: relative;
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
