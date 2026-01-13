<script lang="ts">
  import { onDestroy } from "svelte";
  import { Figure, drawScatterPlot, drawArrow, drawMathjax, createSourceTargetScales, useCanvas2D, Timeline, createPauseClip, useVisibilityHandler } from "@diffusion-explorer/ui";
  import { settings } from "$lib/settings";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  // Caption
  export let children = undefined;

  // Data props
  export let sourceDistributionSamples = [];
  export let targetDistributionSamples = [];

  // Layout props
  export let width = 800;
  export let height = 450;
  export let marginWidth = 50;
  export let marginHeight = 20;
  export let sourceCenterX = 0.2;
  export let targetCenterX = 0.8;
  export let yShiftFactor = -0.2;

  // Scatter plot styling
  export let pointRadius = settings.stylingSettings.scatterPlot.radius;
  export let pointOpacity = settings.stylingSettings.scatterPlot.opacity;
  export let sourcePointColor = settings.stylingSettings.scatterPlot.color;
  export let targetPointColor = settings.stylingSettings.scatterPlot.color;

  // Path line styling
  export let pathLineColor = "#888";
  export let pathLineOpacity = 0.25;
  export let pathLineWidth = 3;
  export let numPathLines = 15;

  // Selected target point styling
  export let selectedTargetColor = "#888";
  export let selectedTargetRadius = 5;

  // Intermediate point styling
  export let intermediatePointColor = "#f17720";
  export let intermediatePointRadius = 6;

  // Conditional vector styling
  export let vectorColor = "#f17720";
  export let vectorOpacity = 1.0;
  export let vectorWidth = 4.5;
  export let vectorScale = 0.4; // Multiplier for vector magnitude

  // Animation timing (normalized 0-1, scaled by animationDuration)
  export let animationDuration = 8000;
  export let timing = {
    forwardEnd: 0.85,
    // pauseEnd: 1.0 implied
  };
  export let playingByDefault = true;

  // Background
  export let backgroundVisible = true;

  // LaTeX label styling
  export let latexLabelOffsetY = settings.stylingSettings.figureLatex.latexLabelOffsetY;
  export let latexFontSize = settings.stylingSettings.figureLatex.fontSize;

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  $: caption = children;

  // Canvas - need both bind:this (for reactivity) and action (for DPR setup)
  let canvas = null;
  const canvas2d = useCanvas2D(width, height);
  // Tie ctx reactivity to canvas variable so it updates when action runs
  $: ctx = canvas && canvas2d.ctx;

  // Animation state type
  type AnimationState = {
    t: number;  // Progress along trajectory (0→1)
  };

  let scales = null;
  let isInitialized = false;

  // Animation state - Timeline system
  let timeline: Timeline<AnimationState> | null = null;

  // Visibility-based animation control
  let figureIsActive;
  const { handleVisibilityChange } = useVisibilityHandler(() => timeline);

  // Pre-computed pixel coordinates
  let sourcePixelCoords = [];
  let targetPixelCoords = [];

  // Selected indices
  let selectedTargetIndex = 0;
  let selectedSourceIndices = [];
  let selectedPathIndex = 0;

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  function precomputeScatterCoords() {
    if (!scales) return;

    sourcePixelCoords = sourceDistributionSamples.map((p) => [
      scales.sourceCenterPixelX +
        (p[0] - scales.sourceMeanX) * scales.xScaleFactor,
      scales.yScale(p[1]),
    ]);

    targetPixelCoords = targetDistributionSamples.map((p) => [
      scales.targetCenterPixelX +
        (p[0] - scales.targetMeanX) * scales.xScaleFactor,
      scales.yScale(p[1]),
    ]);
  }

  function drawLine(x1, y1, x2, y2, color, lineW, opacity = 1) {
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

  function drawCircle(x, y, radius, color, opacity = 1) {
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
    for (let i = 0; i < numPathLines && i < sourceCount; i++) {
      let idx;
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

  function interpDataToPixel(dataX, dataY, tVal, scalesObj) {
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
    // Cycle to next source path, wrapping around
    selectedPathIndex = (selectedPathIndex + 1) % selectedSourceIndices.length;
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
  let prevTime = 0;

  function setupTimeline() {
    timeline = new Timeline<AnimationState>();
    timeline.initialState = { t: 0 };

    // Add clips using normalized timing
    timeline.add(forwardClip, { start: 0, end: timing.forwardEnd });
    timeline.add(createPauseClip(), { start: timing.forwardEnd, end: 1 });

    // Configure timeline
    timeline.duration = animationDuration / 1000;
    timeline.looping = true;

    // Register tick callback - detect loop by time jumping backwards
    timeline.onTick((time, state) => {
      const duration = timeline!.duration;
      // Detect loop: time jumped from near end back to start
      if (prevTime > duration * 0.9 && time < duration * 0.1) {
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
    selectedSourceIndices.forEach((sourceIdx) => {
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
        pathLineOpacity
      );
    });

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

    let vectorEndX, vectorEndY;
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
    const distributionLabelY = marginHeight;

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
