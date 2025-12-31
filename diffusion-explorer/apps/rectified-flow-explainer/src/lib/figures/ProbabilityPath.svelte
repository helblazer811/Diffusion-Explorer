<!-- This figure shows a source distribution mapped to a target distribution with animated intermediate samples. -->

<script>
  import { onMount, onDestroy } from "svelte";
  import * as d3 from "d3";
  import { Figure, TimeSlider } from "@diffusion-explorer/ui";
  import { settings } from "$lib/settings";
  import { createSourceTargetScales } from "$lib/d3_helpers";
  import { drawScatterPlot, drawText } from "$lib/plotting/plotting";
  import { drawMathjaxOnCanvas } from "$lib/plotting/mathjax";
  import { computeContours, plotContours } from "$lib/plotting/contours";

  // Caption slot (passed as default children)
  export let children = undefined;
  $: caption = children;

  // Data props (from parent +page.svelte)
  export let sourceDistributionSamples = [];
  export let targetDistributionSamples = [];
  export let allTimeSamples;
  export let isTraining;

  // Props/Configuration
  export let width = 800;
  export let height = 450;

  // Styling props for visualization
  export let sourcePointColor = settings.stylingSettings.scatterPlot.color;
  export let targetPointColor = settings.stylingSettings.scatterPlot.color;
  export let marginWidth = 50;
  export let marginHeight = 20;
  export let sourceLabelText = "Source Distribution";
  export let targetLabelText = "Target Distribution";
  export let labelFontSize = settings.stylingSettings.label.fontSize;
  export let labelFontWeight = settings.stylingSettings.label.fontWeight;
  export let labelColor = settings.stylingSettings.label.color;
  export let pointRadius = settings.stylingSettings.scatterPlot.radius;
  export let pointOpacity = settings.stylingSettings.scatterPlot.opacity;
  export let sourceCenterX = settings.stylingSettings.layout.sourceCenterX;
  export let targetCenterX = settings.stylingSettings.layout.targetCenterX;
  export let yShiftFactor = -1.0;
  export let distributionScaleFactor = 0.6;

  // Animation settings
  export let animationDuration = 8000;
  export let playingByDefault = true;
  export let animationPauseTime = 1000;

  // Intermediate point styling
  export let intermediatePointColor = "#f17720";
  export let intermediatePointOpacity = 0.7;

  // Background visibility
  export let backgroundVisible = true;

  // Visibility controls for scatter plots
  export let showSourceScatter = true;
  export let showTargetScatter = true;
  export let showIntermediateScatter = true;

  // Contour plot options for P_t
  export let showContours = false;
  export let contourBandwidth = settings.stylingSettings.contour.bandwidth;
  export let contourThresholds = settings.stylingSettings.contour.thresholds;
  export let contourOpacity = settings.stylingSettings.contour.opacity;
  export let contourFillColor = settings.stylingSettings.contour.fillColor;
  export let contourBlendMode = settings.stylingSettings.contour.blendMode;

  // LaTeX label styling
  export let latexLabelOffsetY = 20;
  export let latexFontSize = settings.stylingSettings.figureLatex.fontSize;

  // Canvas state
  let canvas;
  let ctx;
  let dpr = 1;

  // Scales and pre-computed coordinates
  let scales = null;
  let sourcePixelCoords = [];
  let targetPixelCoords = [];

  // Animation state
  let time = 0;
  let animationFrameId = null;
  let animationStartTime = null;
  let pausedElapsedTime = 0;
  let isPlaying = playingByDefault;
  let isPausedByFigure = false;

  // Visibility-based animation control
  let figureIsActive;
  let wasPlayingBeforeHidden = false;
  let isInitialized = false;

  // Derived
  $: numSteps = $allTimeSamples?.length || 1;

  // Update isPausedByFigure when isPlaying changes
  $: isPausedByFigure = !isPlaying;

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
    const now = performance.now();
    animationStartTime = now - time * animationDuration;
    pausedElapsedTime = 0;
  }

  /**
   * Compute pixel x position for a point at a given time
   * At t=0, centered at source; at t=1, centered at target
   */
  function getPixelX(dataX, dataMeanX, t) {
    if (!scales) return 0;
    const centerPixelX =
      scales.sourceCenterPixelX +
      t * (scales.targetCenterPixelX - scales.sourceCenterPixelX);
    return centerPixelX + (dataX - dataMeanX) * scales.xScaleFactor;
  }

  function initializeCanvas() {
    if (!canvas) return;
    dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
  }

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

  async function draw() {
    if (!ctx || !isInitialized) return;
    ctx.clearRect(0, 0, width, height);

    // Draw text labels
    const textY = marginHeight / 2;
    drawText(ctx, sourceLabelText, scales.sourceCenterPixelX, textY, {
      font: `${labelFontWeight} ${labelFontSize}px Helvetica, Arial, sans-serif`,
      color: labelColor,
      align: "center",
      baseline: "top",
    });
    drawText(ctx, targetLabelText, scales.targetCenterPixelX, textY, {
      font: `${labelFontWeight} ${labelFontSize}px Helvetica, Arial, sans-serif`,
      color: labelColor,
      align: "center",
      baseline: "top",
    });

    // Draw source scatter
    if (showSourceScatter) {
      drawScatterPlot(
        ctx,
        sourcePixelCoords,
        pointRadius,
        sourcePointColor,
        pointOpacity
      );
    }

    // Draw target scatter
    if (showTargetScatter) {
      drawScatterPlot(
        ctx,
        targetPixelCoords,
        pointRadius,
        targetPointColor,
        pointOpacity
      );
    }

    // Draw intermediate distribution (contours and/or scatter)
    const allSamples = $allTimeSamples;
    if (allSamples && allSamples.length > 0) {
      const currentStep = Math.round(time * (allSamples.length - 1));
      const samples = allSamples[currentStep];
      if (samples && samples.length > 0) {
        const meanX = samples.reduce((s, p) => s + p[0], 0) / samples.length;

        // Draw contours for P_t (behind scatter points)
        if (showContours) {
          // Create scale functions for contour plotting
          const xScaleForContour = (dataX) => getPixelX(dataX, meanX, time);
          const yScaleForContour = (dataY) => scales.yScale(dataY);

          // Compute and plot contours
          const contourData = computeContours(samples, {
            bandwidth: contourBandwidth,
            thresholds: contourThresholds,
          });

          plotContours(ctx, contourData, {
            xScale: xScaleForContour,
            yScale: yScaleForContour,
            fillColor: contourFillColor,
            opacity: contourOpacity,
            blendMode: contourBlendMode,
            fill: true,
            stroke: false,
          });
        }

        // Draw intermediate scatter
        if (showIntermediateScatter) {
          const coords = samples.map((p) => [
            getPixelX(p[0], meanX, time),
            scales.yScale(p[1]),
          ]);
          drawScatterPlot(
            ctx,
            coords,
            pointRadius,
            intermediatePointColor,
            intermediatePointOpacity
          );
        }
      }
    }

    // Draw LaTeX labels directly on canvas
    const latexColor = settings.stylingSettings.figureLatex.color;

    // Compute y position for math labels (below text labels)
    const yDomain = scales.yScale.domain();
    const yTop = yDomain[0];
    const textLabelY = scales.yScale(yTop) + 0.5 * labelFontSize;
    const mathLabelY = textLabelY + labelFontSize;

    // p_0 label
    await drawMathjaxOnCanvas(
      ctx, "p_0", scales.sourceCenterPixelX, mathLabelY,
      latexFontSize, 0, latexLabelOffsetY, { color: latexColor }
    );

    // p_1 label
    await drawMathjaxOnCanvas(
      ctx, "p_1", scales.targetCenterPixelX, mathLabelY,
      latexFontSize, 0, latexLabelOffsetY, { color: latexColor }
    );

    // p_t label (visible when not at endpoints)
    if (time >= 0.1 && time <= 0.9) {
      const centerX =
        scales.sourceCenterPixelX +
        time * (scales.targetCenterPixelX - scales.sourceCenterPixelX);
      await drawMathjaxOnCanvas(
        ctx, "p_t", centerX, mathLabelY,
        latexFontSize, 0, latexLabelOffsetY, { color: intermediatePointColor }
      );
    }
  }

  function initializeVisualization() {
    if (!canvas) return;
    if (
      sourceDistributionSamples.length === 0 ||
      targetDistributionSamples.length === 0
    )
      return;

    // Create scales
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

    // Initialize canvas
    initializeCanvas();

    // Pre-compute static scatter coordinates
    precomputeScatterCoords();
  }

  function startAnimation() {
    let isPaused = false;
    let pauseStartTime = null;

    function animate(currentTime) {
      if (isPausedByFigure) {
        if (animationStartTime !== null && pausedElapsedTime === 0) {
          pausedElapsedTime = currentTime - animationStartTime;
        }
        animationFrameId = requestAnimationFrame(animate);
        return;
      }

      if (pausedElapsedTime > 0) {
        animationStartTime = currentTime - pausedElapsedTime;
        pausedElapsedTime = 0;
      }

      if (animationStartTime === null) {
        animationStartTime = currentTime;
      }

      const elapsed = currentTime - animationStartTime;

      if (elapsed >= animationDuration) {
        if (!isPaused) {
          isPaused = true;
          pauseStartTime = currentTime;
          time = 1;
          draw();
        }

        if (
          pauseStartTime &&
          currentTime - pauseStartTime >= animationPauseTime
        ) {
          animationStartTime = currentTime;
          isPaused = false;
          pauseStartTime = null;
          time = 0;
        }
      } else {
        time = Math.min(elapsed / animationDuration, 1);
        draw();
      }

      animationFrameId = requestAnimationFrame(animate);
    }

    animationFrameId = requestAnimationFrame(animate);
  }

  function stopAnimation() {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  }

  // Update visualization when time changes (e.g., from slider drag)
  $: if (isInitialized && time !== undefined) {
    draw();
  }

  // React to data changes and initialize visualization once
  $: if (
    !isInitialized &&
    sourceDistributionSamples.length > 0 &&
    targetDistributionSamples.length > 0 &&
    $allTimeSamples?.length > 0 &&
    canvas
  ) {
    initializeVisualization();
    isInitialized = true;
    draw();
    startAnimation();
  }

  // Animation control
  $: if (isPlaying && isInitialized && !animationFrameId) startAnimation();
  $: if (!isPlaying && animationFrameId) stopAnimation();

  onDestroy(() => stopAnimation());
</script>

<Figure {caption} {backgroundVisible} bind:isActive={figureIsActive}>
  {#snippet children()}
    <div
      style="display: flex; flex-direction: column; align-items: center; width: 100%;"
    >
      <div style="width: 100%; max-width: {width}px;">
        <canvas
          bind:this={canvas}
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
