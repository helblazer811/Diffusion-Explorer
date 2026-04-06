<!-- Visualizes linear interpolation between source and target distributions with an animated dot. -->

<script lang="ts">
  import { onDestroy } from "svelte";
  import type { Snippet } from "svelte";
  import type { Writable } from "svelte/store";
  import { Figure, TimeSlider, drawScatterPlot, drawText, drawMathjax, createSourceTargetScales, Timeline, createPauseClip, useCanvas2D, useVisibilityHandler } from "@diffusion-explorer/ui";
  import { settings } from "$lib/settings";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  // Caption slot (passed as default children)
  export let children: Snippet | undefined = undefined;

  // Data props
  export let sourceDistributionSamples: [number, number][] = [];
  export let targetDistributionSamples: [number, number][] = [];

  // Point selection for the line
  export let sourcePointIndex = 0;
  export let targetPointIndex = 0;

  // Colors
  export let sourcePointColor = settings.stylingSettings.scatterPlot.color;
  export let targetPointColor = settings.stylingSettings.scatterPlot.color;
  export let lineColor = "#f17720";
  export let animatedDotColor = "#f17720";

  // Animation
  export let animationDuration = 4000;
  export let pauseDuration = 500;
  export let playingByDefault = true;

  // Layout/Styling
  export let width = 800;
  export let height = 450;
  export let marginWidth = 50;
  export let marginHeight = 20;
  export let sourceCenterX = settings.stylingSettings.layout.sourceCenterX;
  export let targetCenterX = settings.stylingSettings.layout.targetCenterX;
  export let pointRadius = settings.stylingSettings.scatterPlot.radius;
  export let pointOpacity = settings.stylingSettings.scatterPlot.opacity;
  export let yShiftFactor = settings.stylingSettings.scatterPlot.yShiftFactor;
  export let lineWidth = 5;
  export let animatedDotRadius = 6;
  export let labelFontSize = settings.stylingSettings.label.fontSize;
  export let labelFontWeight = settings.stylingSettings.label.fontWeight;
  export let labelFontFamily = "Helvetica, Arial, sans-serif";
  export let labelColor = settings.stylingSettings.label.color;
  export let labelOpacity = settings.stylingSettings.label.opacity;
  export let sourceLabelText = "Source Distribution";
  export let targetLabelText = "Target Distribution";

  // Background visibility
  export let backgroundVisible = true;

  // Show/hide equation at bottom
  export let showEquation = true;

  // LaTeX label styling
  export let latexLabelOffsetY = settings.stylingSettings.figureLatex.latexLabelOffsetY;
  export let latexFontSize = settings.stylingSettings.figureLatex.fontSize;
  export let sliderLabelSize = '1.1em';

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
    time: number;  // WARNING: Using time in draw() is an antipattern. Prefer derived state.
  };

  // Scales and pre-computed coordinates
  let scales: ReturnType<typeof createSourceTargetScales> | null = null;
  let sourcePixelCoords: number[][] = [];
  let targetPixelCoords: number[][] = [];
  let sourcePointPixel: number[] = [0, 0];
  let targetPointPixel: number[] = [0, 0];

  // Animation state - Timeline system
  let isInitialized = false;
  let timeline: Timeline<AnimationState> | null = null;
  let displayTime: number = 0;  // Semantic time for slider display (tracks state.time)

  // Visibility-based animation control
  let figureIsActive: Writable<boolean>;
  const { handleVisibilityChange } = useVisibilityHandler(() => timeline);

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  // Pre-compute scatter coordinates
  function precomputeScatterCoords() {
    if (!scales) return;

    sourcePixelCoords = sourceDistributionSamples.map((p: [number, number]) => [
      scales.sourceCenterPixelX + (p[0] - scales.sourceMeanX) * scales.xScaleFactor,
      scales.yScale(p[1]),
    ]);

    targetPixelCoords = targetDistributionSamples.map((p: [number, number]) => [
      scales.targetCenterPixelX + (p[0] - scales.targetMeanX) * scales.xScaleFactor,
      scales.yScale(p[1]),
    ]);

    // Selected points for the line
    const sp = sourceDistributionSamples[sourcePointIndex];
    const tp = targetDistributionSamples[targetPointIndex];
    if (sp && tp) {
      sourcePointPixel = [
        scales.sourceCenterPixelX + (sp[0] - scales.sourceMeanX) * scales.xScaleFactor,
        scales.yScale(sp[1]),
      ];
      targetPointPixel = [
        scales.targetCenterPixelX + (tp[0] - scales.targetMeanX) * scales.xScaleFactor,
        scales.yScale(tp[1]),
      ];
    }
  }

  // Canvas drawing helpers
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

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function runInitialComputation() {
    if (!canvas) return;
    if (sourceDistributionSamples.length === 0 || targetDistributionSamples.length === 0) return;

    // Create scales
    scales = createSourceTargetScales(sourceDistributionSamples, targetDistributionSamples, {
      width,
      height,
      marginWidth,
      marginHeight,
      sourceCenterX,
      targetCenterX,
      yShiftFactor,
    });

    // Pre-compute scatter coordinates
    precomputeScatterCoords();
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  // Forward clip (0→1) - reducer pattern
  const forwardClip = {
    name: "Forward",
    reduce(t: number) {
      return { time: t };
    }
  };

  // Backward clip (1→0) - reducer pattern
  const backwardClip = {
    name: "Backward",
    reduce(t: number) {
      return { time: 1 - t };
    }
  };

  function setupTimeline() {
    timeline = new Timeline<AnimationState>();
    timeline.initialState = { time: 0 };

    // Total cycle: forward + pause + backward + pause
    const totalCycleDuration = 2 * animationDuration + 2 * pauseDuration;
    const forwardDuration = animationDuration / totalCycleDuration;
    const pauseNormalized = pauseDuration / totalCycleDuration;

    // Add clips in sequence with proper timing objects
    const t1 = forwardDuration;
    const t2 = forwardDuration + pauseNormalized;
    const t3 = 2 * forwardDuration + pauseNormalized;

    timeline.add(forwardClip, { start: 0, end: t1 });
    timeline.add(createPauseClip(), { start: t1, end: t2 });
    timeline.add(backwardClip, { start: t2, end: t3 });
    timeline.add(createPauseClip(), { start: t3, end: 1 });

    // Set duration in seconds
    timeline.duration = totalCycleDuration / 1000;
    timeline.looping = true;

    // Register tick callback
    timeline.onTick((_t, state) => {
      displayTime = state.time;  // Track semantic time for slider
      draw(state);
    });
  }

  // Handle seeking by display time - map to forward clip's timeline range
  function handleSeekByDisplayTime(t: number) {
    if (!timeline) return;
    const totalCycleDuration = 2 * animationDuration + 2 * pauseDuration;
    const forwardEnd = animationDuration / totalCycleDuration;
    timeline.seek(t * forwardEnd);
  }

  function startAnimation() {
    if (!timeline) return;
    timeline.play();
  }

  function stopAnimation() {
    if (timeline) timeline.pause();
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function draw(state: AnimationState) {
    if (!ctx || !isInitialized) return;
    ctx.clearRect(0, 0, width, height);

    // --- Static Background ---
    // Draw text labels
    const textY = marginHeight / 2;
    drawText(ctx, sourceLabelText, scales.sourceCenterPixelX, textY, {
      font: `${labelFontWeight} ${labelFontSize}px ${labelFontFamily}`,
      color: labelColor,
      opacity: labelOpacity,
      align: "center",
      baseline: "top",
    });
    drawText(ctx, targetLabelText, scales.targetCenterPixelX, textY, {
      font: `${labelFontWeight} ${labelFontSize}px ${labelFontFamily}`,
      color: labelColor,
      opacity: labelOpacity,
      align: "center",
      baseline: "top",
    });

    // Draw scatter plots
    drawScatterPlot(ctx, sourcePixelCoords, pointRadius, sourcePointColor, pointOpacity);
    drawScatterPlot(ctx, targetPixelCoords, pointRadius, targetPointColor, pointOpacity);

    // Draw connection line
    drawLine(
      sourcePointPixel[0],
      sourcePointPixel[1],
      targetPointPixel[0],
      targetPointPixel[1],
      lineColor,
      lineWidth,
      0.8
    );

    // Draw line endpoints
    drawCircle(sourcePointPixel[0], sourcePointPixel[1], pointRadius, animatedDotColor);
    drawCircle(targetPointPixel[0], targetPointPixel[1], pointRadius, animatedDotColor);

    // --- Dynamic Foreground ---
    const t = state.time;

    // Draw animated dot at current time position (trivial lerps use t directly)
    const currentX = sourcePointPixel[0] + t * (targetPointPixel[0] - sourcePointPixel[0]);
    const currentY = sourcePointPixel[1] + t * (targetPointPixel[1] - sourcePointPixel[1]);
    drawCircle(currentX, currentY, animatedDotRadius, animatedDotColor);

    // Draw LaTeX labels directly on canvas
    const latexColor = settings.stylingSettings.figureLatex.color;

    // x_0 above source point
    drawMathjax(
      ctx, "x_0", sourcePointPixel[0], sourcePointPixel[1],
      latexFontSize, 0, latexLabelOffsetY, { color: latexColor }
    );

    // x_1 above target point
    drawMathjax(
      ctx, "x_1", targetPointPixel[0], targetPointPixel[1],
      latexFontSize, 0, latexLabelOffsetY, { color: latexColor }
    );

    // x_t above animated dot (visible when not at endpoints)
    if (t >= 0.07 && t <= 0.93) {
      drawMathjax(
        ctx, "x_t", currentX, currentY,
        latexFontSize, 0, latexLabelOffsetY, { color: lineColor }
      );
    }

    // Formula at bottom center
    if (showEquation) {
      drawMathjax(
        ctx, "x_t \\sim X_t = (1-t)X_0 + tX_1", width / 2, height - marginHeight,
        latexFontSize, 0, 15, { color: latexColor }
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
    if (playingByDefault) startAnimation();
  }

  // Handle visibility changes (pause when off-screen, resume when back)
  $: if (figureIsActive !== undefined && isInitialized) {
    handleVisibilityChange($figureIsActive);
  }
</script>

<Figure {caption} {backgroundVisible} bind:isActive={figureIsActive}>
  {#snippet children()}
    <div style="display: flex; flex-direction: column; align-items: center; width: 100%;">
      <div style="width: 100%; max-width: {width}px;">
        <canvas
          bind:this={canvas}
          use:canvas2d.bindCanvas
          style="width: 100%; height: auto; aspect-ratio: {width}/{height};"
        ></canvas>
      </div>
      <TimeSlider {timeline} {displayTime} onSeekByDisplayTime={handleSeekByDisplayTime} color="#f17720" labelSize={sliderLabelSize} />
    </div>
  {/snippet}
</Figure>
