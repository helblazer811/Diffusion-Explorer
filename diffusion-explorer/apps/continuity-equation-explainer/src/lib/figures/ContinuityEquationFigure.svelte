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
    TimeSlider,
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

  // Streamlines (right pane) — fewer pulses per second with longer pulses.
  export let streamlineColor = "#f97316"; // orange
  export let streamlineDensity: number | [number, number] = 1.0;
  export let streamlineMinPathLength = 1.0;
  export let streamlineWidth = 3;
  export let pulseWidthPixels = 48;
  export let pulsePauseWidthPixels = 16;
  export let streamlinePulseFrequency = 0.25;
  // Show converging streamlines only within this circular radius (px) around
  // the fixed point, so the visual emphasizes the local convergence.
  export let streamlineClipRadius = 90;

  // Translucent white mute between the density and the dot/streamlines.
  // Applied on BOTH panes so the foreground markers (dot, label, streamlines,
  // bar chart) remain legible against the density.
  export let densityMuteColor = "#ffffff";
  export let densityMuteOpacity = 0.4;

  // Fixed point styling
  export let pointColor = "#374151";
  export let pointRadius = 6;
  export let pointLabel = "x";
  export let pointLabelFontSize = 28;
  export let pointLabelOffset: [number, number] = [26, -16];

  // Bar chart styling (overlaid vertical bar on the right side of the left canvas)
  export let barColor = "#f97316";
  export let barThickness = 14; // bar width in px
  export let barMaxHeight = 200; // bar height in px at p(x) = max
  export let barRightMargin = 36; // distance from canvas right edge to bar in px
  export let barCalloutColor = "#9ca3af";
  export let barCalloutWidth = 1;
  export let barCalloutGap = 4; // gap between dot edge and start of callout in px
  export let barLabelGap = 6; // gap between baseline and label in px
  export let barGridColor = "#d1d5db";
  export let barGridWidth = 1;
  export let barBaselineColor = "#9ca3af";
  export let barBaselineWidth = 1.5;

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

  // Per-frame samples (so we can query density at an arbitrary point on hover)
  // and a global max density used for normalization so the bar scale is
  // consistent regardless of cursor position.
  let frameSamples: [number, number][][] = [];
  let globalMaxDensity = 1;
  let currentContourFrame = 0;

  // Cursor interactivity. When non-null, both panes hide the fixed x/dot and
  // a cursor dot is shown instead; the bar tracks density at this point.
  let cursorDomain: [number, number] | null = null;

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
      pulseFrequency: streamlinePulseFrequency,
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

    // Probe grid for the global density max (used to normalize the bar so
    // its scale stays consistent as the cursor moves around).
    const probePoints: [number, number][] = [];
    const probeSide = 16;
    for (let i = 0; i < probeSide; i++) {
      for (let j = 0; j < probeSide; j++) {
        probePoints.push([
          domain.xMin + ((i + 0.5) / probeSide) * (domain.xMax - domain.xMin),
          domain.yMin + ((j + 0.5) / probeSide) * (domain.yMax - domain.yMin),
        ]);
      }
    }

    contourFrames = [];
    frameSamples = [];
    const rawDensity: number[] = [];
    let runningMax = 0;
    for (let i = 0; i < contourAnimationSteps; i++) {
      contourFrames.push(
        computeContours(samples, {
          bandwidth: contourBandwidth,
          gridSize: contourGridSize,
          thresholds: contourThresholds,
          domain: contourDomain,
        })
      );
      // Stash a copy of samples so we can query density at the cursor later.
      frameSamples.push(samples.map(([x, y]) => [x, y]));
      rawDensity.push(densityAtPoint(samples, fixedPoint, densityRadius));
      for (const p of probePoints) {
        const d = densityAtPoint(samples, p, densityRadius);
        if (d > runningMax) runningMax = d;
      }
      samples = eulerIntegrate(samples, field, contourStepSize);
    }
    globalMaxDensity = Math.max(runningMax, 1e-12);
    densitySeries = rawDensity.map((d) => d / globalMaxDensity);
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
      currentContourFrame = state.contourFrame;
      drawLeft(state, cW, cH);
      drawRight(state, cW, cH);
      if (cursorDomain) {
        const d = densityAtPoint(
          frameSamples[state.contourFrame] ?? [],
          cursorDomain,
          domainHalfWidth * 0.08
        );
        currentBarValue = Math.min(1.5, d / globalMaxDensity);
      } else {
        currentBarValue = densitySeries[state.contourFrame] ?? 0;
      }
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

  function drawDot(
    ctx: CanvasRenderingContext2D,
    cW: number,
    cH: number,
    pos: [number, number] = fixedPoint
  ) {
    const [px, py] = toPixel(pos, cW, cH);
    // White halo
    ctx.fillStyle = "white";
    ctx.beginPath();
    ctx.arc(px, py, pointRadius + 2.5, 0, 2 * Math.PI);
    ctx.fill();
    // Dot
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
      { color: pointColor, stroke: "white", strokeWidth: 8, strokeOpacity: 0.95 }
    );
  }

  function drawLeft(state: AnimationState, cW: number, cH: number) {
    const ctx = leftCanvas2d.ctx;
    const cf = contourFrames[state.contourFrame];
    if (!ctx || !cf) return;
    ctx.clearRect(0, 0, cW, cH);
    drawDensityAndDot(ctx, cf, cW, cH, /* mute */ true);
    const pos = cursorDomain ?? fixedPoint;
    drawDot(ctx, cW, cH, pos);
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
      const pos = cursorDomain ?? fixedPoint;
      drawDot(tctx, cW, cH, pos);
    }
  }

  // ----------------------------------------------------------------
  // Bar chart (d3 scale, Svelte template)
  // ----------------------------------------------------------------

  // Bar geometry — vertical bar overlaid on the right side of the left canvas.
  // Bar's bottom sits at the bottom of the canvas. A thin L-shaped callout
  // connects the orange dot to the top of the bar.
  $: dotPixel = canvasWidth && canvasHeight
    ? toPixel(cursorDomain ?? fixedPoint, canvasWidth, canvasHeight)
    : [0, 0];
  $: barHeightScale = d3.scaleLinear().domain([0, 1]).range([0, barMaxHeight]);
  $: barCurrentHeight = Math.max(0, barHeightScale(currentBarValue));
  $: barX = canvasWidth ? canvasWidth - barRightMargin - barThickness : 0;
  $: barCenterX = barX + barThickness / 2;
  // Anchor the bar's y-axis so its midpoint is on the canvas vertical center.
  $: barBottomY = canvasHeight && barMaxHeight
    ? (canvasHeight + barMaxHeight) / 2
    : canvasHeight;
  $: barTopY = barBottomY - barCurrentHeight;
  // Fixed midpoint of the bar's column area — the straight callout from the
  // dot terminates here regardless of the bar's current height.
  $: barColumnMidY = barBottomY - barMaxHeight / 2;
  $: gridFractions = [0.25, 0.5, 0.75, 1.0];

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
  // Cursor interactivity
  // ----------------------------------------------------------------

  function eventToDomain(e: PointerEvent): [number, number] {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const xPx = ((e.clientX - rect.left) / rect.width) * canvasWidth;
    const yPx = ((e.clientY - rect.top) / rect.height) * canvasHeight;
    const { xMin, xMax, yMin, yMax } = getDomain();
    return [
      xMin + (xPx / canvasWidth) * (xMax - xMin),
      yMax - (yPx / canvasHeight) * (yMax - yMin),
    ];
  }

  function handlePointerMove(e: PointerEvent) {
    if (!isInitialized) return;
    cursorDomain = eventToDomain(e);
  }

  function handlePointerLeave() {
    cursorDomain = null;
  }

  // Recompute the bar value whenever the cursor moves between ticks, so the
  // bar updates smoothly even when the cursor is held still and only the
  // contour frame is advancing.
  $: if (cursorDomain && frameSamples.length > 0) {
    const d = densityAtPoint(
      frameSamples[currentContourFrame] ?? [],
      cursorDomain,
      domainHalfWidth * 0.08
    );
    currentBarValue = Math.min(1.5, d / globalMaxDensity);
  }

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

<div class="continuity-equation-equation">
  <div class="equation-grid">
    <div class="grid-label grid-label-left">
      The rate of change of <span style="color: #3b82f6;">probability density</span> at the
      point <Katex math={"x"} />.
    </div>
    <div class="grid-label-spacer"></div>
    <div class="grid-label grid-label-right">
      The divergence of the <span style="color: #f97316;">probability flux</span> at
      <Katex math={"x"} />.
    </div>

    <div class="grid-math">
      <Katex math={"\\frac{\\partial \\textcolor{#3b82f6}{p_t(x)}}{\\partial t}"} displayMode={true} />
    </div>
    <div class="grid-equals">
      <Katex math={"+"} displayMode={true} />
    </div>
    <div class="grid-math">
      <Katex math={"\\nabla \\cdot \\textcolor{#f97316}{p_t v_t} \\;=\\; 0"} displayMode={true} />
    </div>
  </div>
</div>

<DoubleFigure {gap} {backgroundVisible} bind:isActive={figureIsActive}>
  {#snippet left()}
    <div
      class="left-canvas-container"
      style="width: 100%; aspect-ratio: {canvasWidth}/{canvasHeight};"
      onpointermove={handlePointerMove}
      onpointerleave={handlePointerLeave}
    >
      <canvas
        bind:this={leftCanvas}
        use:leftCanvas2d.bindCanvas
        class="density-canvas"
      ></canvas>
      <!-- Bar-chart overlay: solid gridlines + baseline, a straight callout
           from the dot to the vertical center of the bar's column, and the
           bar itself. -->
      <svg
        class="bar-overlay"
        viewBox="0 0 {canvasWidth} {canvasHeight}"
        preserveAspectRatio="none"
      >
        {#each gridFractions as frac}
          <line
            x1={barX - 8}
            y1={barBottomY - frac * barMaxHeight}
            x2={barX + barThickness + 8}
            y2={barBottomY - frac * barMaxHeight}
            stroke={barGridColor}
            stroke-width={barGridWidth}
          />
        {/each}
        <line
          x1={barX - 12}
          y1={barBottomY}
          x2={barX + barThickness + 12}
          y2={barBottomY}
          stroke={barBaselineColor}
          stroke-width={barBaselineWidth}
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
          left: {(barCenterX / canvasWidth) * 100}%;
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
      onpointermove={handlePointerMove}
      onpointerleave={handlePointerLeave}
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

  {#snippet footer()}
    <TimeSlider
      timeline={timeline as import("@diffusion-explorer/ui").Timeline<unknown> | null}
      color="#9ca3af"
    />
  {/snippet}

  {#snippet caption()}
    {@render children?.()}
  {/snippet}
</DoubleFigure>

<style>
  .continuity-equation-equation {
    text-align: center;
    margin-bottom: 0;
    color: #374151;
  }

  .equation-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    grid-template-rows: auto auto;
    column-gap: 0.5rem;
    row-gap: 0.5rem;
    justify-items: center;
  }

  .grid-label {
    font-size: 1.5rem;
    color: #666;
    text-align: center;
    line-height: 1.4;
    max-width: 350px;
    align-self: end;
  }

  .grid-label-spacer {
    /* placeholder over the equals sign */
  }

  .grid-math,
  .grid-equals {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.4rem;
    align-self: center;
  }

  .continuity-equation-equation + :global(.double-figure) {
    margin-top: 0;
  }

  .left-canvas-container,
  .right-canvas-container {
    position: relative;
    cursor: crosshair;
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
