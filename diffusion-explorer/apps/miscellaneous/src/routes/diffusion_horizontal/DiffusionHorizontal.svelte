<!-- This figure shows a source distribution (noise) mapped to a target distribution with animated intermediate samples for diffusion models. -->

<script lang="ts">
  import { onDestroy } from "svelte";
  import type { Snippet } from "svelte";
  import type { Writable } from "svelte/store";
  import * as d3 from "d3";
  import { Player, Figure, TimeSlider, drawScatterPlot, drawText, drawMathjax, computeContours, plotContours, createSourceTargetScales, Timeline, useCanvas2D } from "@diffusion-explorer/ui";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  // Caption slot (passed as default children)
  export let children: Snippet | undefined = undefined;

  // Data props (from parent +page.svelte)
  export let sourceDistributionSamples: [number, number][] = [];
  export let targetDistributionSamples: [number, number][] = [];
  export let allTimeSamples: Writable<number[][][]>;

  // Props/Configuration
  export let width = 800;
  export let height = 450;

  // Styling props for visualization
  export let sourcePointColor = "#3b82f6";
  export let targetPointColor = "#3b82f6";
  export let marginWidth = 50;
  export let marginHeight = 20;
  export let sourceLabelText = "Noise Distribution";
  export let targetLabelText = "Target Distribution";
  export let labelFontSize = 16;
  export let labelFontWeight = "600";
  export let labelColor = "#333";
  export let labelOpacity = 1.0;
  export let pointRadius = 4;
  export let pointOpacity = 0.7;
  export let sourceCenterX = 0.22;
  export let targetCenterX = 0.78;
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
  export let contourBandwidth = 0.15;
  export let contourThresholds = 10;
  export let contourOpacity = 0.6;
  export let contourFillColor = "#f17720";
  export let contourBlendMode = "multiply";

  // LaTeX label styling
  export let latexLabelOffsetY = 20;
  export let latexFontSize = 20;
  export let latexColor = "#333";

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  type Scales = ReturnType<typeof createSourceTargetScales>;

  // Canvas - need both bind:this (for reactivity) and action (for DPR setup)
  let canvas: HTMLCanvasElement | null = null;
  const canvas2d = useCanvas2D(width, height);
  // Tie ctx reactivity to canvas variable so it updates when action runs
  $: ctx = canvas && canvas2d.ctx;
  $: caption = children;

  // Scales and pre-computed coordinates
  let scales: Scales | null = null;
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
  let wasPlayingBeforeHidden = false;
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

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  function setupTimeline() {
    // Cache numSteps for clip closure
    cachedNumSteps = $allTimeSamples?.length || 1;

    const tl = Timeline.from<AnimationState>({
      duration: animationDuration / 1000,
      initialState: { time: 0, currentStep: 0, centerX: scales.sourceCenterPixelX },
      clips: [
        { clip: mainClip, ...{ start: 0, end: 1 } },
      ],
    });
    player = new Player(tl, { looping: true, endPause: animationPauseTime / 1000 });

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

    // Add main animation clip

    // Set timeline duration and end pause

    // Register tick callback
    player.onTick((_t, state) => {
      draw(state);
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
        const meanX = samples.reduce((s: number, p: number[]) => s + p[0], 0) / samples.length;

        // Draw contours for P_t (behind scatter points)
        if (showContours) {
          // Create scale functions for contour plotting
          const xScaleForContour = (dataX: number) => getPixelX(dataX, meanX, t);
          const yScaleForContour = (dataY: number) => scales!.yScale(dataY);

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
          const coords = samples.map((p: number[]) => [
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
    // Compute y position for math labels (below text labels)
    const yDomain = scales.yScale.domain();
    const yTop = yDomain[0];
    const textLabelY = scales.yScale(yTop) + 0.5 * labelFontSize;
    const mathLabelY = textLabelY + labelFontSize;

    // x_T label (noise at timestep T)
    drawMathjax(
      ctx, "x_T", scales.sourceCenterPixelX, mathLabelY,
      latexFontSize, 0, latexLabelOffsetY, { color: latexColor }
    );

    // x_0 label (clean data at timestep 0)
    drawMathjax(
      ctx, "x_0", scales.targetCenterPixelX, mathLabelY,
      latexFontSize, 0, latexLabelOffsetY, { color: latexColor }
    );

    // x_t label (visible when not at endpoints)
    if (t >= 0.1 && t <= 0.9) {
      drawMathjax(
        ctx, "x_t", state.centerX, mathLabelY,
        latexFontSize, 0, latexLabelOffsetY, { color: intermediatePointColor }
      );
    }
  }

  // ----------------------------------------------------------------
  // Event Handlers
  // ----------------------------------------------------------------

  function handleVisibilityChange(isActive: boolean) {
    if (!player) return;
    if (!isActive && player.isPlaying) {
      wasPlayingBeforeHidden = true;
      stopAnimation();
    } else if (isActive && wasPlayingBeforeHidden) {
      wasPlayingBeforeHidden = false;
      startAnimation();
    }
  }


  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  onDestroy(() => {
    if (player) player.pause();
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
    draw(player!.initialState);
    if (playingByDefault) startAnimation();
  }

  // Handle visibility changes (pause when off-screen, resume when back)
  $: if (figureIsActive !== undefined && isInitialized) {
    handleVisibilityChange($figureIsActive);
  }
</script>

<Figure {caption} {backgroundVisible} bind:isActive={figureIsActive}>
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
      <TimeSlider timeline={player} color="#f17720" />
    </div>
  {/snippet}
</Figure>
