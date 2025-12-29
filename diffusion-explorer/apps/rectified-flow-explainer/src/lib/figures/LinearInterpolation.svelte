<!-- Visualizes linear interpolation between source and target distributions with an animated dot. -->

<script>
  import { onMount, onDestroy } from "svelte";
  import Figure from "$lib/components/Figure.svelte";
  import TimeSlider from "$lib/components/TimeSlider.svelte";
  import { settings } from "$lib/settings";
  import { createSourceTargetScales } from "$lib/d3_helpers";
  import { drawScatterPlot, drawText } from "$lib/plotting/plotting";
  import { latexToSvgElement, placeMathjaxSVG } from "$lib/plotting/mathjax";

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
  export let height = 275;
  export let marginWidth = 50;
  export let marginHeight = 20;
  export let sourceCenterX = settings.stylingSettings.layout.sourceCenterX;
  export let targetCenterX = settings.stylingSettings.layout.targetCenterX;
  export let pointRadius = settings.stylingSettings.scatterPlot.radius;
  export let pointOpacity = settings.stylingSettings.scatterPlot.opacity;
  export let yShiftFactor = settings.stylingSettings.scatterPlot.yShiftFactor;
  export let lineWidth = 3;
  export let animatedDotRadius = 6;
  export let labelFontSize = settings.stylingSettings.label.fontSize;
  export let labelColor = settings.stylingSettings.label.color;
  export let sourceLabelText = "Source Distribution";
  export let targetLabelText = "Target Distribution";

  // Background visibility
  export let backgroundVisible = true;

  // Canvas state
  let canvas;
  let ctx;
  let dpr = 1;
  let svgOverlay = null;

  // Scales and pre-computed coordinates
  let scales = null;
  let sourcePixelCoords = [];
  let targetPixelCoords = [];
  let sourcePointPixel = [0, 0];
  let targetPointPixel = [0, 0];

  // Pre-rendered MathJax labels
  let x0LabelSvg = null;
  let x1LabelSvg = null;
  let xtLabelSvg = null;
  let formulaLabelSvg = null;

  // Animation state
  let isPlaying = playingByDefault;
  let animationFrameId = null;
  let time = 0.5;
  let direction = 1; // 1 = forward, -1 = backward
  let isPaused = false;
  let pauseStartTime = null;
  let lastTimestamp = null;
  let isInitialized = false;

  // Visibility-based animation control
  let figureIsActive;
  let wasPlayingBeforeHidden = false;

  // Pause animation when figure goes off-screen, resume when back
  $: if (figureIsActive !== undefined && isInitialized) {
    handleVisibilityChange($figureIsActive);
  }

  function handleVisibilityChange(isActive) {
    if (!isActive && isPlaying) {
      wasPlayingBeforeHidden = true;
      isPlaying = false;
    } else if (isActive && wasPlayingBeforeHidden) {
      wasPlayingBeforeHidden = false;
      isPlaying = true;
    }
  }

  function toggleAnimation() {
    isPlaying = !isPlaying;
  }

  function handleSliderInput() {
    lastTimestamp = null;
    if (isPaused) {
      isPaused = false;
      pauseStartTime = null;
    }
  }

  // Canvas initialization
  function initializeCanvas() {
    if (!canvas) return;
    dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
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

  // Pre-render MathJax labels
  async function preRenderLabels() {
    const latexColor = settings.stylingSettings.figureLatex.color;
    try {
      [x0LabelSvg, x1LabelSvg, xtLabelSvg, formulaLabelSvg] = await Promise.all([
        latexToSvgElement("x_0", { color: latexColor }),
        latexToSvgElement("x_1", { color: latexColor }),
        latexToSvgElement("x_t", { color: lineColor }),
        latexToSvgElement("x_t \\sim X_t = (1-t)X_0 + tX_1", { color: latexColor }),
      ]);
    } catch (e) {
      console.warn("Failed to pre-render MathJax labels:", e);
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

  // Update SVG overlay labels
  function updateLabelPositions(dotX, dotY) {
    if (!svgOverlay || !scales) return;
    svgOverlay.innerHTML = "";

    const labelOffsetY = -10;
    const sizeMultiplier = 1.4;

    // x_0 above source point
    if (x0LabelSvg) {
      placeMathjaxSVG(
        x0LabelSvg.cloneNode(true),
        svgOverlay,
        sourcePointPixel[0],
        sourcePointPixel[1],
        0,
        labelOffsetY,
        50,
        sizeMultiplier
      );
    }

    // x_1 above target point
    if (x1LabelSvg) {
      placeMathjaxSVG(
        x1LabelSvg.cloneNode(true),
        svgOverlay,
        targetPointPixel[0],
        targetPointPixel[1],
        0,
        labelOffsetY,
        50,
        sizeMultiplier
      );
    }

    // x_t above animated dot (visible when not at endpoints)
    const labelVisible = time >= 0.07 && time <= 0.93;
    if (xtLabelSvg && labelVisible) {
      placeMathjaxSVG(
        xtLabelSvg.cloneNode(true),
        svgOverlay,
        dotX,
        dotY,
        0,
        labelOffsetY,
        50,
        sizeMultiplier
      );
    }

    // Formula at bottom center
    if (formulaLabelSvg) {
      placeMathjaxSVG(
        formulaLabelSvg.cloneNode(true),
        svgOverlay,
        width / 2,
        height - marginHeight,
        0,
        0,
        50,
        sizeMultiplier
      );
    }
  }

  // Main draw function
  function draw() {
    if (!ctx || !isInitialized) return;
    ctx.clearRect(0, 0, width, height);

    // Draw text labels
    const textY = marginHeight / 2;
    drawText(ctx, sourceLabelText, scales.sourceCenterPixelX, textY, {
      font: `${labelFontSize}px Helvetica, Arial, sans-serif`,
      color: labelColor,
      align: "center",
      baseline: "top",
    });
    drawText(ctx, targetLabelText, scales.targetCenterPixelX, textY, {
      font: `${labelFontSize}px Helvetica, Arial, sans-serif`,
      color: labelColor,
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

    // Update SVG overlay labels
    updateLabelPositions(currentX, currentY);
  }

  // Animation
  function animate(timestamp) {
    if (!isPlaying) {
      animationFrameId = null;
      return;
    }

    if (lastTimestamp === null) {
      lastTimestamp = timestamp;
    }

    const elapsed = timestamp - lastTimestamp;

    // Handle pause at endpoints
    if (isPaused && pauseStartTime !== null) {
      const pauseElapsed = timestamp - pauseStartTime;
      if (pauseElapsed >= pauseDuration) {
        isPaused = false;
        pauseStartTime = null;
        lastTimestamp = timestamp;
        direction = -direction;
      }
      animationFrameId = requestAnimationFrame(animate);
      return;
    }

    // Update time based on direction
    const deltaTime = elapsed / animationDuration;
    time += direction * deltaTime;

    // Clamp and handle endpoint pause
    if (time >= 1.0) {
      time = 1.0;
      isPaused = true;
      pauseStartTime = timestamp;
    } else if (time <= 0.0) {
      time = 0.0;
      isPaused = true;
      pauseStartTime = timestamp;
    }

    draw();
    lastTimestamp = timestamp;
    animationFrameId = requestAnimationFrame(animate);
  }

  function startAnimation() {
    if (animationFrameId !== null) return;
    lastTimestamp = null;
    animationFrameId = requestAnimationFrame(animate);
  }

  function stopAnimation() {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
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

    // Initialize canvas
    initializeCanvas();

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
    preRenderLabels().then(() => {
      isInitialized = true;
      draw();
      if (isPlaying) startAnimation();
    });
  }

  // Handle play/pause changes
  $: if (isPlaying && !animationFrameId && isInitialized) {
    startAnimation();
  }

  $: if (!isPlaying && animationFrameId) {
    stopAnimation();
  }

  // Update drawing when time changes (e.g., from slider drag)
  $: if (isInitialized && time !== undefined) {
    draw();
  }

  onDestroy(() => {
    stopAnimation();
  });
</script>

<Figure {caption} {backgroundVisible} bind:isActive={figureIsActive}>
  {#snippet children()}
    <div style="display: flex; flex-direction: column; align-items: center; width: 100%;">
      <div class="canvas-container" style="max-width: {width}px;">
        <canvas
          bind:this={canvas}
          style="width: 100%; height: auto; aspect-ratio: {width}/{height};"
        ></canvas>
        <svg
          bind:this={svgOverlay}
          style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;"
          viewBox="0 0 {width} {height}"
        ></svg>
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

<style>
  .canvas-container {
    position: relative;
    width: 100%;
  }
</style>
