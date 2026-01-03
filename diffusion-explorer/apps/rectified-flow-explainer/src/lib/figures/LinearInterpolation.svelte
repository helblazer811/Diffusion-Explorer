<!-- Visualizes linear interpolation between source and target distributions with an animated dot. -->

<script>
  import { onDestroy } from "svelte";
  import { Figure, TimeSlider, drawScatterPlot, drawText, drawMathjaxOnCanvas, createSourceTargetScales, Clock, Track, createPauseClip, useCanvas2D } from "@diffusion-explorer/ui";
  import { settings } from "$lib/settings";

  // Caption slot (passed as default children)
  export let children = undefined;
  $: caption = children;

  // Data props
  export let sourceDistributionSamples = [];
  export let targetDistributionSamples = [];

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
  export let labelColor = settings.stylingSettings.label.color;
  export let labelOpacity = settings.stylingSettings.label.opacity;
  export let sourceLabelText = "Source Distribution";
  export let targetLabelText = "Target Distribution";

  // Background visibility
  export let backgroundVisible = true;

  // LaTeX label styling
  export let latexLabelOffsetY = settings.stylingSettings.figureLatex.latexLabelOffsetY;
  export let latexFontSize = settings.stylingSettings.figureLatex.fontSize;

  // Canvas state - need both bind:this (for reactivity) and action (for DPR setup)
  let canvas = null;
  const canvas2d = useCanvas2D(width, height);
  // Tie ctx reactivity to canvas variable so it updates when action runs
  $: ctx = canvas && canvas2d.ctx;

  // Scales and pre-computed coordinates
  let scales = null;
  let sourcePixelCoords = [];
  let targetPixelCoords = [];
  let sourcePointPixel = [0, 0];
  let targetPointPixel = [0, 0];

  // Animation state - Clock/Track system
  let isPlaying = playingByDefault;
  let time = 0;
  let isInitialized = false;
  let clock = null;
  let track = null;

  // State object mutated by clips
  let animState = { time: 0 };

  // Forward clip (0→1)
  const forwardClip = {
    name: "Forward",
    duration: 1,
    apply(t, params, state) {
      state.time = t;
    }
  };

  // Backward clip (1→0)
  const backwardClip = {
    name: "Backward",
    duration: 1,
    apply(t, params, state) {
      state.time = 1 - t;
    }
  };

  // Visibility-based animation control
  let figureIsActive;
  let wasPlayingBeforeHidden = false;

  function handleVisibilityChange(isActive) {
    if (!isActive && isPlaying) {
      wasPlayingBeforeHidden = true;
      isPlaying = false;
      stopAnimation();
    } else if (isActive && wasPlayingBeforeHidden) {
      wasPlayingBeforeHidden = false;
      isPlaying = true;
      startAnimation();
    }
  }

  function toggleAnimation() {
    isPlaying = !isPlaying;
    if (isPlaying) {
      startAnimation();
    } else {
      stopAnimation();
    }
  }

  function handleSliderInput() {
    if (isPlaying) {
      isPlaying = false;
      stopAnimation();
    }
    animState.time = time;
    draw();
  }

  // Pre-compute scatter coordinates
  function precomputeScatterCoords() {
    if (!scales) return;

    sourcePixelCoords = sourceDistributionSamples.map((p) => [
      scales.sourceCenterPixelX + (p[0] - scales.sourceMeanX) * scales.xScaleFactor,
      scales.yScale(p[1]),
    ]);

    targetPixelCoords = targetDistributionSamples.map((p) => [
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

  // Main draw function
  async function draw() {
    if (!ctx || !isInitialized) return;
    ctx.clearRect(0, 0, width, height);

    // Draw text labels
    const textY = marginHeight / 2;
    drawText(ctx, sourceLabelText, scales.sourceCenterPixelX, textY, {
      font: `${labelFontWeight} ${labelFontSize}px Helvetica, Arial, sans-serif`,
      color: labelColor,
      opacity: labelOpacity,
      align: "center",
      baseline: "top",
    });
    drawText(ctx, targetLabelText, scales.targetCenterPixelX, textY, {
      font: `${labelFontWeight} ${labelFontSize}px Helvetica, Arial, sans-serif`,
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

    // Draw animated dot at current time position
    const currentX = sourcePointPixel[0] + time * (targetPointPixel[0] - sourcePointPixel[0]);
    const currentY = sourcePointPixel[1] + time * (targetPointPixel[1] - sourcePointPixel[1]);
    drawCircle(currentX, currentY, animatedDotRadius, animatedDotColor);

    // Draw LaTeX labels directly on canvas
    const latexColor = settings.stylingSettings.figureLatex.color;

    // x_0 above source point
    await drawMathjaxOnCanvas(
      ctx, "x_0", sourcePointPixel[0], sourcePointPixel[1],
      latexFontSize, 0, latexLabelOffsetY, { color: latexColor }
    );

    // x_1 above target point
    await drawMathjaxOnCanvas(
      ctx, "x_1", targetPointPixel[0], targetPointPixel[1],
      latexFontSize, 0, latexLabelOffsetY, { color: latexColor }
    );

    // x_t above animated dot (visible when not at endpoints)
    if (time >= 0.07 && time <= 0.93) {
      await drawMathjaxOnCanvas(
        ctx, "x_t", currentX, currentY,
        latexFontSize, 0, latexLabelOffsetY, { color: lineColor }
      );
    }

    // Formula at bottom center
    await drawMathjaxOnCanvas(
      ctx, "x_t \\sim X_t = (1-t)X_0 + tX_1", width / 2, height - marginHeight,
      latexFontSize, 0, 15, { color: latexColor }
    );
  }

  // Initialize animation track with bidirectional clips and pauses
  function initializeAnimation() {
    track = new Track();

    // Total cycle: forward + pause + backward + pause
    const totalCycleDuration = 2 * animationDuration + 2 * pauseDuration;
    const forwardDuration = animationDuration / totalCycleDuration;
    const pauseNormalized = pauseDuration / totalCycleDuration;

    // Add clips in sequence
    track.add({ ...forwardClip, duration: forwardDuration }, 0);
    track.add(createPauseClip(pauseNormalized), forwardDuration);
    track.add({ ...backwardClip, duration: forwardDuration }, forwardDuration + pauseNormalized);
    track.add(createPauseClip(pauseNormalized), 2 * forwardDuration + pauseNormalized);

    clock = new Clock();
  }

  function startAnimation() {
    if (!clock || !track) return;

    clock.start((dt) => {
      // Convert real time delta to normalized track time
      const totalCycleDuration = (2 * animationDuration + 2 * pauseDuration) / 1000;
      const normalizedDt = dt / totalCycleDuration;

      track.update(normalizedDt, {}, animState);
      time = animState.time;

      // Loop when track completes
      if (track.time >= 1) {
        track.reset();
        animState.time = 0;
        time = 0;
      }

      draw();
    });
  }

  function stopAnimation() {
    if (clock) clock.stop();
  }

  function initializeVisualization() {
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

  // Reactive initialization
  $: if (
    !isInitialized &&
    sourceDistributionSamples.length > 0 &&
    targetDistributionSamples.length > 0 &&
    canvas
  ) {
    initializeVisualization();
    initializeAnimation();
    isInitialized = true;
    draw();
    if (isPlaying) startAnimation();
  }

  // Handle visibility changes (pause when off-screen, resume when back)
  $: if (figureIsActive !== undefined && isInitialized) {
    handleVisibilityChange($figureIsActive);
  }

  // Update drawing when time changes (e.g., from slider drag)
  $: if (isInitialized && time !== undefined) {
    draw();
  }

  onDestroy(() => {
    if (clock) clock.stop();
  });
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
      <TimeSlider
        bind:value={time}
        bind:isPlaying
        min={0}
        max={1}
        onTogglePlay={toggleAnimation}
        onInput={handleSliderInput}
        color="#f17720"
      />
    </div>
  {/snippet}
</Figure>
