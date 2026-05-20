<!-- This figure shows a source distribution mapped to a target distribution with animated intermediate samples. -->

<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import * as d3 from "d3";
  import { Player, Figure, TimeSlider, Slider, drawScatterPlot, drawText, drawMathjax, computeContours, plotContours, ContourRenderer, createLinearColorScale, parseContourColor, createSourceTargetScales, Timeline, useCanvas2D, useVisibilityHandler } from "@diffusion-explorer/ui";
  import { settings } from "$lib/settings";
  import type { Writable } from "svelte/store";
  import type { Snippet } from "svelte";

  type SourceTargetScales = {
    yScale: d3.ScaleLinear<number, number>;
    xScaleFactor: number;
    sourceCenterPixelX: number;
    targetCenterPixelX: number;
    sourceMeanX: number;
    targetMeanX: number;
  };

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  // Caption slot (passed as default children)
  export let children: Snippet | undefined = undefined;

  // Data props (from parent +page.svelte)
  export let sourceDistributionSamples: number[][] = [];
  export let targetDistributionSamples: number[][] = [];
  export let allTimeSamples: Writable<number[][][]>;
  export let isTraining: Writable<boolean>;

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
  export let labelFontFamily = "Helvetica, Arial, sans-serif";
  export let labelColor = settings.stylingSettings.label.color;
  export let labelOpacity = settings.stylingSettings.label.opacity;
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

  // Time slider visibility
  export let showTimeSlider = true;
  export let showPlayButton = true;
  export let sliderMaxWidth = '644px';
  export let sliderLabelSize = '0.85em';
  export let useRawSlider = false;

  let rawSliderValue = 0;

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

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  // Canvas - need both bind:this (for reactivity) and action (for DPR setup)
  let canvas: HTMLCanvasElement | null = null;
  const canvas2d = useCanvas2D(width, height);
  // Tie ctx reactivity to canvas variable so it updates when action runs
  $: ctx = canvas && canvas2d.ctx;
  $: caption = children;

  // GPU contour rendering
  let contourRenderer: ContourRenderer | null = null;
  let contourCanvas: HTMLCanvasElement | null = null;
  let contoursReady = false;
  let useGPUContours = true; // Feature flag - can fall back to CPU if needed
  let contourDataDomain: { xMin: number; xMax: number; yMin: number; yMax: number } | null = null;

  // Scales and pre-computed coordinates
  let scales: SourceTargetScales | null = null;
  let sourcePixelCoords: number[][] = [];
  let targetPixelCoords: number[][] = [];

  // Animation state type
  type AnimationState = {
    time: number;  // WARNING: Using time in draw() is an antipattern. Prefer derived state.
    currentStep: number;
    centerX: number;
  };

  // Animation state - Timeline system
  let player: Player<AnimationState> | null = null;

  // Cached numSteps for clip closure
  let cachedNumSteps = 1;

  // Visibility-based animation control
  let figureIsActive: Writable<boolean>;
  const { handleVisibilityChange } = useVisibilityHandler(() => player);
  let isInitialized = false;

  // Derived
  $: numSteps = $allTimeSamples?.length || 1;

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  /**
   * Compute pixel x position for a point at a given time
   * At t=0, centered at source; at t=1, centered at target
   */
  function getPixelX(dataX: number, dataMeanX: number, t: number): number {
    if (!scales) return 0;
    const centerPixelX =
      scales.sourceCenterPixelX +
      t * (scales.targetCenterPixelX - scales.sourceCenterPixelX);
    return centerPixelX + (dataX - dataMeanX) * scales.xScaleFactor;
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

    // Pre-compute static scatter coordinates
    precomputeScatterCoords();
  }

  /**
   * Initialize GPU contour renderer and pre-compute all frames.
   * This enables fast frame switching during animation.
   */
  async function initGPUContours() {
    if (!showContours || !useGPUContours || !scales) return;

    const allSamples = $allTimeSamples;
    if (!allSamples || allSamples.length === 0) return;

    try {
      // Compute domain from all samples (use consistent domain across all frames)
      let xMin = Infinity, xMax = -Infinity;
      let yMin = Infinity, yMax = -Infinity;
      for (const samples of allSamples) {
        for (const [x, y] of samples) {
          if (x < xMin) xMin = x;
          if (x > xMax) xMax = x;
          if (y < yMin) yMin = y;
          if (y > yMax) yMax = y;
        }
      }
      // Add padding
      const xPad = (xMax - xMin) * 0.1;
      const yPad = (yMax - yMin) * 0.1;
      contourDataDomain = {
        xMin: xMin - xPad,
        xMax: xMax + xPad,
        yMin: yMin - yPad,
        yMax: yMax + yPad,
      };

      // Compute pixel size for contour region based on data extent
      const dataWidth = contourDataDomain.xMax - contourDataDomain.xMin;
      const dataHeight = contourDataDomain.yMax - contourDataDomain.yMin;
      const pixelWidth = dataWidth * scales.xScaleFactor;
      // For yScale, compute the pixel height from the data height
      const yTop = scales.yScale(contourDataDomain.yMax);
      const yBottom = scales.yScale(contourDataDomain.yMin);
      const pixelHeight = Math.abs(yBottom - yTop);

      // Use a square canvas sized to the larger dimension for consistent rendering
      const contourPixelSize = Math.max(pixelWidth, pixelHeight);

      // Create offscreen canvas for GPU rendering (sized to contour region)
      const dpr = window.devicePixelRatio || 1;
      contourCanvas = document.createElement('canvas');
      contourCanvas.width = Math.ceil(contourPixelSize * dpr);
      contourCanvas.height = Math.ceil(contourPixelSize * dpr);

      // Parse the fill color and create a color scale
      const baseColor = parseContourColor(contourFillColor);
      // With only 3 levels (default), use a wide alpha range for visible differentiation
      // Level 0 (outer): t≈0.25 → alpha≈0.25, Level 2 (inner): t≈0.75 → alpha≈0.75
      const colorScale = createLinearColorScale(
        [baseColor[0], baseColor[1], baseColor[2], 0.0],   // Outer: fully transparent
        [baseColor[0], baseColor[1], baseColor[2], 1.0]    // Inner: fully opaque
      );

      // Create the unified ContourRenderer (auto-detects GPU, falls back to CPU)
      // Note: opacity is controlled via colorScale alpha, so set renderer opacity to 1.0
      contourRenderer = await ContourRenderer.create({
        canvas: contourCanvas,
        gridSize: 100,
        bandwidth: contourBandwidth,
        thresholds: contourThresholds,
        opacity: 1.0,  // Alpha is controlled in colorScale, not here
        colorScale,
        dpr,
        preferGPU: true,
      });

      console.log(`[ProbabilityPath] ContourRenderer using ${contourRenderer.backend} backend`);

      // Queue all frames for computation
      for (let i = 0; i < allSamples.length; i++) {
        const samples = allSamples[i];
        // Convert to Float32Array for GPU
        const points = new Float32Array(samples.length * 2);
        for (let j = 0; j < samples.length; j++) {
          points[j * 2] = samples[j][0];
          points[j * 2 + 1] = samples[j][1];
        }
        contourRenderer.setPointsForFrame(i, points, contourDataDomain);
      }

      // Pre-compute all frames (parallel on GPU, sequential on CPU)
      console.log(`[ProbabilityPath] Pre-computing ${allSamples.length} contour frames...`);
      const startTime = performance.now();
      await contourRenderer.computeAllFrames();
      const elapsed = performance.now() - startTime;
      console.log(`[ProbabilityPath] Contour frames computed in ${elapsed.toFixed(1)}ms`);

      contoursReady = true;
    } catch (e) {
      console.warn('[ProbabilityPath] GPU contour init failed, falling back to CPU:', e);
      useGPUContours = false;
      contourRenderer = null;
      contourCanvas = null;
      contourDataDomain = null;
    }
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  function setupTimeline() {
    // Cache numSteps for clip closure
    cachedNumSteps = $allTimeSamples?.length || 1;

    // Main animation clip - computes derived state from t
    const mainClip = {
      name: "Animation",
      reduce(t: number) {
        return {
          time: t,
          currentStep: Math.round(t * (cachedNumSteps - 1)),
          centerX: scales.sourceCenterPixelX + t * (scales.targetCenterPixelX - scales.sourceCenterPixelX)
        };
      }
    };

    const tl = Timeline.from<AnimationState>({
      duration: animationDuration / 1000,
      initialState: { time: 0, currentStep: 0, centerX: scales.sourceCenterPixelX },
      clips: [
        { clip: mainClip, ...{ start: 0, end: 1 } },
      ],
    });
    player = new Player(tl, { looping: true, endPause: animationPauseTime / 1000 });

    // Register tick callback
    player.onTick((t, state) => {
      draw(state);
      rawSliderValue = t;
    });
  }

  function startAnimation() {
    if (!player) return;
    player.play();
  }

  function stopAnimation() {
    if (player) player.pause();
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

    // --- Dynamic Foreground ---
    const t = state.time;

    // Draw intermediate distribution (contours and/or scatter)
    const allSamples = $allTimeSamples;
    if (allSamples && allSamples.length > 0) {
      const samples = allSamples[state.currentStep];
      if (samples && samples.length > 0) {
        const meanX = samples.reduce((s, p) => s + p[0], 0) / samples.length;

        // Draw contours for P_t (behind scatter points)
        if (showContours) {
          // Use GPU-accelerated contours if available
          if (contoursReady && contourRenderer && contourCanvas && contourDataDomain) {
            // Draw pre-computed frame to offscreen canvas
            contourRenderer.drawFrame(state.currentStep);

            // Compute destination position (animated based on time t)
            // Center X interpolates from source to target based on t
            const centerPixelX = scales.sourceCenterPixelX +
              t * (scales.targetCenterPixelX - scales.sourceCenterPixelX);

            // Compute destination rectangle
            // The contour canvas covers [xMin, xMax] in data coords
            const dataWidth = contourDataDomain.xMax - contourDataDomain.xMin;
            const dataHeight = contourDataDomain.yMax - contourDataDomain.yMin;

            // Map data domain to pixel coords
            // X: offset from center based on data domain and meanX
            const leftOffset = (contourDataDomain.xMin - meanX) * scales.xScaleFactor;
            const destX = centerPixelX + leftOffset;
            const destWidth = dataWidth * scales.xScaleFactor;

            // Y: use yScale (yMax is top in data, maps to smaller pixel Y)
            const destY = scales.yScale(contourDataDomain.yMax);
            const destHeight = scales.yScale(contourDataDomain.yMin) - destY;

            // Composite onto main canvas with blend mode
            ctx.save();
            if (contourBlendMode) {
              ctx.globalCompositeOperation = contourBlendMode;
            }
            // GPU renders with Y=0 at bottom, need to flip when drawing
            // Use a local transform for the contour region
            ctx.translate(destX, destY + destHeight);
            ctx.scale(1, -1);
            ctx.drawImage(
              contourCanvas,
              0, 0, contourCanvas.width, contourCanvas.height,  // Source (full texture)
              0, 0, destWidth, destHeight                       // Destination (local coords after transform)
            );
            ctx.restore();
          } else {
            // Fallback: CPU-based contour computation (original approach)
            const xScaleForContour = (dataX: number) => getPixelX(dataX, meanX, t);
            const yScaleForContour = (dataY: number) => scales.yScale(dataY);

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
        }

        // Draw intermediate scatter
        if (showIntermediateScatter) {
          const coords = samples.map((p) => [
            getPixelX(p[0], meanX, t),
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
    drawMathjax(
      ctx, "p_0", scales.sourceCenterPixelX, mathLabelY,
      latexFontSize, 0, latexLabelOffsetY, { color: latexColor }
    );

    // p_1 label
    drawMathjax(
      ctx, "p_1", scales.targetCenterPixelX, mathLabelY,
      latexFontSize, 0, latexLabelOffsetY, { color: latexColor }
    );

    // p_t label (visible when not at endpoints)
    if (t >= 0.1 && t <= 0.9) {
      drawMathjax(
        ctx, "p_t", state.centerX, mathLabelY,
        latexFontSize, 0, latexLabelOffsetY, { color: intermediatePointColor }
      );
    }
  }

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  onDestroy(() => {
    if (player) player.pause();
    if (contourRenderer) {
      contourRenderer.destroy();
      contourRenderer = null;
    }
    contourCanvas = null;
    contoursReady = false;
    contourDataDomain = null;
  });

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  // React to data changes and initialize visualization once
  $: if (
    !isInitialized &&
    sourceDistributionSamples.length > 0 &&
    targetDistributionSamples.length > 0 &&
    $allTimeSamples?.length > 0 &&
    canvas
  ) {
    runInitialComputation();
    setupTimeline();
    isInitialized = true;

    // Initialize GPU contours asynchronously (don't block initial render)
    if (showContours && useGPUContours) {
      initGPUContours().then(() => {
        // Redraw with GPU contours once ready
        if (player && contoursReady) {
          draw(player.state);
        }
      });
    }

    draw(player!.initialState);
    if (playingByDefault) startAnimation();
  }

  // Handle visibility changes (pause when off-screen, resume when back)
  $: if (figureIsActive !== undefined && isInitialized) {
    handleVisibilityChange($figureIsActive);
  }
</script>

<Figure {caption} {backgroundVisible} {player} devMode={settings.devMode} bind:isActive={figureIsActive}>
  {#snippet children()}
    <div
      style="display: flex; flex-direction: column; align-items: center; width: 100%;"
    >
      <div style="width: 100%; max-width: {width}px;">
        <canvas
          bind:this={canvas}
          use:canvas2d.bindCanvas
          style="width: 100%; height: auto; aspect-ratio: {width}/{height};"
        ></canvas>
      </div>
      {#if showTimeSlider}
        {#if useRawSlider}
          <div style="width: 100%; padding: 0 20px; box-sizing: border-box; font-size: {sliderLabelSize};">
            <Slider
              value={rawSliderValue}
              min={0}
              max={1}
              step={0.001}
              color="#f17720"
              showTicks={true}
              showLabel={true}
              label="Time"
              minLabel="t=0"
              maxLabel="t=1"
              maxWidth={sliderMaxWidth}
              labelSize={sliderLabelSize}
              onInput={(v) => { if (player) player.seek(v); }}
              
              
            />
          </div>
        {:else}
          <TimeSlider timeline={player} color="#f17720" {showPlayButton} maxWidth={sliderMaxWidth} labelSize={sliderLabelSize} />
        {/if}
      {/if}
    </div>
  {/snippet}
</Figure>
