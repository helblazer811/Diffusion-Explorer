<script lang="ts">
  import { onDestroy, type Snippet } from "svelte";
  import type { Writable } from "svelte/store";
  import { Figure, drawScatterPlot, drawArrow, drawMathjax, createSourceTargetScales, useCanvas2D, Timeline, createPauseClip, useVisibilityHandler } from "@diffusion-explorer/ui";
  import { settings } from "$lib/settings";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  // Caption
  export let children: Snippet | undefined = undefined;

  // Data props
  export let sourceDistributionSamples: [number, number][] = [];
  export let targetDistributionSamples: [number, number][] = [];

  // Layout props
  export let width: number = 800;
  export let height: number = 450;
  export let marginWidth: number = 50;
  export let marginHeight: number = 20;
  export let sourceCenterX: number = 0.2;
  export let targetCenterX: number = 0.8;
  export let yShiftFactor: number = -0.2;

  // Scatter plot styling
  export let pointRadius: number = settings.stylingSettings.scatterPlot.radius;
  export let pointOpacity: number = settings.stylingSettings.scatterPlot.opacity;
  export let sourcePointColor: string = settings.stylingSettings.scatterPlot.color;
  export let targetPointColor: string = settings.stylingSettings.scatterPlot.color;

  // Path line styling
  export let pathLineColor: string = "#888";
  export let pathLineOpacity: number = 0.25;
  export let pathLineWidth: number = 3;
  export let numPathLines: number = 15;

  // Selected target point styling
  export let selectedTargetColor: string = "#888";
  export let selectedTargetRadius: number = 5;

  // Intermediate point styling
  export let intermediatePointColor: string = "#f17720";
  export let intermediatePointRadius: number = 6;

  // Conditional vector styling
  export let vectorColor: string = "#f17720";
  export let vectorOpacity: number = 1.0;
  export let vectorWidth: number = 4.5;
  export let vectorScale: number = 0.4; // Multiplier for vector magnitude

  // Animation timing (normalized 0-1, scaled by animationDuration)
  export let animationDuration: number = 8000;
  export let timing: { forwardEnd: number } = {
    forwardEnd: 0.85,
    // pauseEnd: 1.0 implied
  };
  export let playingByDefault: boolean = true;

  // Distribution scale factor
  export let distributionScaleFactor: number = 0.8;

  // Single path mode: show only one random pair at a time, pick new pair each loop
  export let singlePathMode: boolean = false;

  // Background
  export let backgroundVisible: boolean = true;

  // LaTeX label styling
  export let latexLabelOffsetY: number = settings.stylingSettings.figureLatex.latexLabelOffsetY;
  export let latexFontSize: number = settings.stylingSettings.figureLatex.fontSize;
  export let distributionLabelOffsetY: number = 0;

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  $: caption = children;

  // Canvas - need both bind:this (for reactivity) and action (for DPR setup)
  let canvas: HTMLCanvasElement | null = null;
  const canvas2d = useCanvas2D(width, height);
  // Tie ctx reactivity to canvas variable so it updates when action runs
  $: ctx = canvas && canvas2d.ctx;

  // Animation state type
  type AnimationState = {
    t: number;  // Progress along trajectory (0→1)
  };

  type Scales = ReturnType<typeof createSourceTargetScales>;

  let scales: Scales | null = null;
  let isInitialized: boolean = false;

  // Animation state - Timeline system
  let timeline: Timeline<AnimationState> | null = null;

  // Visibility-based animation control
  let figureIsActive: Writable<boolean>;
  const { handleVisibilityChange } = useVisibilityHandler(() => timeline);

  // Pre-computed pixel coordinates
  let sourcePixelCoords: number[][] = [];
  let targetPixelCoords: number[][] = [];

  // Selected indices
  let selectedTargetIndex: number = 0;
  let selectedSourceIndices: number[] = [];
  let selectedPathIndex: number = 0;

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  function precomputeScatterCoords() {
    if (!scales) return;

    sourcePixelCoords = sourceDistributionSamples.map((p: [number, number]) => [
      scales.sourceCenterPixelX +
        (p[0] - scales.sourceMeanX) * scales.xScaleFactor,
      scales.yScale(p[1]),
    ]);

    targetPixelCoords = targetDistributionSamples.map((p: [number, number]) => [
      scales.targetCenterPixelX +
        (p[0] - scales.targetMeanX) * scales.xScaleFactor,
      scales.yScale(p[1]),
    ]);
  }

  function drawLine(x1: number, y1: number, x2: number, y2: number, color: string, lineW: number, opacity: number = 1) {
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineW;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  function drawCircle(x: number, y: number, radius: number, color: string, opacity: number = 1) {
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function selectRandomIndices() {
    selectedTargetIndex = Math.floor(
      Math.random() * targetDistributionSamples.length
    );

    selectedSourceIndices = [];
    const sourceCount = sourceDistributionSamples.length;
    const count = singlePathMode ? 1 : numPathLines;
    for (let i = 0; i < count && i < sourceCount; i++) {
      let idx: number;
      do {
        idx = Math.floor(Math.random() * sourceCount);
      } while (selectedSourceIndices.includes(idx));
      selectedSourceIndices.push(idx);
    }
  }

  function selectPathByAngle() {
    if (!scales || selectedSourceIndices.length === 0) return;

    const targetPoint = targetDistributionSamples[selectedTargetIndex];
    const targetPixelX =
      scales.targetCenterPixelX +
      (targetPoint[0] - scales.targetMeanX) * scales.xScaleFactor;
    const targetPixelY = scales.yScale(targetPoint[1]);

    let maxAngle = -Infinity;
    selectedPathIndex = 0;

    for (let i = 0; i < selectedSourceIndices.length; i++) {
      const sourcePoint = sourceDistributionSamples[selectedSourceIndices[i]];
      const sourcePixelX =
        scales.sourceCenterPixelX +
        (sourcePoint[0] - scales.sourceMeanX) * scales.xScaleFactor;
      const sourcePixelY = scales.yScale(sourcePoint[1]);

      const dx = sourcePixelX - targetPixelX;
      const dy = sourcePixelY - targetPixelY;
      let angle = Math.atan2(dy, dx);

      if (angle < 0) {
        angle += 2 * Math.PI;
      }

      if (angle > maxAngle) {
        maxAngle = angle;
        selectedPathIndex = i;
      }
    }
  }

  function interpDataToPixel(dataX: number, dataY: number, tVal: number, scalesObj: Scales) {
    const sourcePixelX =
      scalesObj.sourceCenterPixelX +
      (dataX - scalesObj.sourceMeanX) * scalesObj.xScaleFactor;
    const targetPixelX =
      scalesObj.targetCenterPixelX +
      (dataX - scalesObj.targetMeanX) * scalesObj.xScaleFactor;
    const pixelX = (1 - tVal) * sourcePixelX + tVal * targetPixelX;
    const pixelY = scalesObj.yScale(dataY);
    return { x: pixelX, y: pixelY };
  }

  function selectNextSourcePath() {
    if (singlePathMode) {
      // Pick a completely new random source and target pair
      selectedTargetIndex = Math.floor(Math.random() * targetDistributionSamples.length);
      const sourceIdx = Math.floor(Math.random() * sourceDistributionSamples.length);
      selectedSourceIndices = [sourceIdx];
      selectedPathIndex = 0;
    } else {
      // Cycle to next source path, wrapping around
      selectedPathIndex = (selectedPathIndex + 1) % selectedSourceIndices.length;
    }
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function runInitialComputation() {
    if (!canvas) return;
    if (
      sourceDistributionSamples.length === 0 ||
      targetDistributionSamples.length === 0
    )
      return;

    selectRandomIndices();

    scales = createSourceTargetScales(
      sourceDistributionSamples,
      targetDistributionSamples,
      {
        width,
        height,
        marginWidth,
        marginHeight,
        sourceCenterX,
        targetCenterX,
        yShiftFactor,
        distributionScaleFactor,
      }
    );

    selectPathByAngle();
    precomputeScatterCoords();
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  // Forward clip (0→1) - reducer pattern
  const forwardClip = {
    name: "Forward",
    reduce(t: number) {
      return { t };
    }
  };

  // Track previous time to detect loop
  let prevTime: number = 0;

  function setupTimeline() {
    timeline = new Timeline<AnimationState>();
    timeline.initialState = { t: 0 };

    // Add clips using normalized timing
    timeline.add(forwardClip, { start: 0, end: timing.forwardEnd });
    timeline.add(createPauseClip(), { start: timing.forwardEnd, end: 1 });

    // Configure timeline
    timeline.duration = animationDuration / 1000;
    timeline.looping = true;

    // Register tick callback - detect loop by normalized time (0-1) jumping backwards
    timeline.onTick((time, state) => {
      // Detect loop: normalized time jumped from near end back to start
      if (prevTime > 0.9 && time < 0.1) {
        selectNextSourcePath();
      }
      prevTime = time;
      draw(state);
    });
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function draw(state: AnimationState) {
    if (!ctx || !scales || !isInitialized) return;
    if (selectedSourceIndices.length === 0) return;
    ctx.clearRect(0, 0, width, height);

    // Draw scatter plots (with lower opacity)
    drawScatterPlot(
      ctx,
      sourcePixelCoords,
      pointRadius,
      sourcePointColor,
      pointOpacity * 0.5
    );
    drawScatterPlot(
      ctx,
      targetPixelCoords,
      pointRadius,
      targetPointColor,
      pointOpacity * 0.5
    );

    // Get target point pixel coords
    const targetPoint = targetDistributionSamples[selectedTargetIndex];
    const targetX =
      scales.targetCenterPixelX +
      (targetPoint[0] - scales.targetMeanX) * scales.xScaleFactor;
    const targetY = scales.yScale(targetPoint[1]);

    // Draw path lines
    const pathIndicesToDraw = singlePathMode ? [selectedPathIndex] : selectedSourceIndices.map((_, i) => i);
    for (const i of pathIndicesToDraw) {
      const sourceIdx = selectedSourceIndices[i];
      if (sourceIdx === undefined) continue;
      const sourcePoint = sourceDistributionSamples[sourceIdx];
      const sourceX =
        scales.sourceCenterPixelX +
        (sourcePoint[0] - scales.sourceMeanX) * scales.xScaleFactor;
      const sourceY = scales.yScale(sourcePoint[1]);
      drawLine(
        sourceX,
        sourceY,
        targetX,
        targetY,
        pathLineColor,
        pathLineWidth,
        singlePathMode ? 0.5 : pathLineOpacity
      );
    }

    // Draw selected target point
    drawCircle(targetX, targetY, selectedTargetRadius, selectedTargetColor);

    // Draw intermediate point and vector
    const sourceIdx = selectedSourceIndices[selectedPathIndex];
    const sourcePoint = sourceDistributionSamples[sourceIdx];
    const t = state.t;
    const interpDataX = (1 - t) * sourcePoint[0] + t * targetPoint[0];
    const interpDataY = (1 - t) * sourcePoint[1] + t * targetPoint[1];
    const interpPixel = interpDataToPixel(interpDataX, interpDataY, t, scales);

    drawCircle(
      interpPixel.x,
      interpPixel.y,
      intermediatePointRadius,
      intermediatePointColor
    );

    // Draw velocity vector (magnitude scales with distance to target)
    const pixelDx = targetX - interpPixel.x;
    const pixelDy = targetY - interpPixel.y;
    const pixelMag = Math.sqrt(pixelDx * pixelDx + pixelDy * pixelDy);

    let vectorEndX: number | undefined, vectorEndY: number | undefined;
    if (pixelMag > 0.01) {
      // Scale by magnitude (not normalized) with additional scale factor
      vectorEndX = interpPixel.x + pixelDx * vectorScale;
      vectorEndY = interpPixel.y + pixelDy * vectorScale;
      ctx.save();
      ctx.strokeStyle = vectorColor;
      ctx.fillStyle = vectorColor;
      ctx.lineWidth = vectorWidth;
      ctx.globalAlpha = vectorOpacity;
      drawArrow(ctx, interpPixel.x, interpPixel.y, vectorEndX, vectorEndY, 8);
      ctx.restore();
    }

    // Draw LaTeX labels directly on canvas
    const latexColor = settings.stylingSettings.figureLatex.color;

    // p_0 and p_1 above distributions (anchor is bottom-center, so offset down to keep visible)
    const distributionLabelY = marginHeight + distributionLabelOffsetY;

    drawMathjax(
      ctx, "p_0", scales.sourceCenterPixelX, distributionLabelY,
      latexFontSize, 0, 10, { color: latexColor }
    );

    drawMathjax(
      ctx, "p_1", scales.targetCenterPixelX, distributionLabelY,
      latexFontSize, 0, 10, { color: latexColor }
    );

    // x_1 above selected target point
    drawMathjax(
      ctx, "x_1", targetX, targetY,
      latexFontSize, 0, latexLabelOffsetY, { color: latexColor }
    );

    // x above intermediate point
    drawMathjax(
      ctx, "x", interpPixel.x, interpPixel.y,
      latexFontSize, 0, latexLabelOffsetY, { color: latexColor }
    );

    // v_t(x|x_1) at vector head
    if (vectorEndX !== undefined && vectorEndY !== undefined) {
      drawMathjax(
        ctx, "v_t(x|x_1)", vectorEndX, vectorEndY,
        latexFontSize, -5, -35, { color: vectorColor }
      );
    }
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

  // Reactive initialization
  $: if (
    !isInitialized &&
    sourceDistributionSamples.length > 0 &&
    targetDistributionSamples.length > 0 &&
    canvas
  ) {
    runInitialComputation();
    setupTimeline();
    isInitialized = true;
    draw(timeline!.initialState);
    if (playingByDefault) timeline?.play();
  }

  // Handle visibility changes (pause when off-screen, resume when back)
  $: if (figureIsActive !== undefined && isInitialized) {
    handleVisibilityChange($figureIsActive);
  }
</script>

<Figure {caption} {backgroundVisible} bind:isActive={figureIsActive}>
  {#snippet children()}
    <div style="width: 100%; max-width: {width}px;">
      <canvas
        bind:this={canvas}
        use:canvas2d.bindCanvas
        style="width: 100%; height: auto; aspect-ratio: {width}/{height};"
      ></canvas>
    </div>
  {/snippet}
</Figure>
