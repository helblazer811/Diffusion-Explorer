<!-- This figure shows the conditional probability path: samples flowing toward a single target point x_1. -->

<script lang="ts">
  import { onDestroy } from "svelte";
  import { Player, Figure, TimeSlider, drawScatterPlot, drawText, drawMathjax, computeContours, plotContours, createSourceTargetScales, Timeline, useCanvas2D } from "@diffusion-explorer/ui";
  import { settings } from "$lib/settings";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  // Caption slot (passed as default children)
  export let children = undefined;

  // Data props (from parent +page.svelte)
  export let sourceDistributionSamples: number[][] = [];
  export let targetDistributionSamples: number[][] = [];

  // Number of samples to use for source and target distributions
  export let numSamples: number | null = null;
  // Number of samples for current distribution (trajectories, lines) - defaults to numSamples
  export let currentNumSamples: number | null = null;

  // Target point x_1 (hardcoded single point)
  // If null, defaults to first point from targetDistributionSamples
  export let targetPoint: [number, number] | null = null;

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
  export let labelOpacity = 1.0;
  export let pointRadius = settings.stylingSettings.scatterPlot.radius;
  export let pointOpacity = settings.stylingSettings.scatterPlot.opacity;
  export let targetPointOpacity: number | null = null;  // Defaults to pointOpacity if null
  export let sourceCenterX = 0.2;
  export let targetCenterX = 0.8;
  export let yShiftFactor = -1.0;
  export let distributionScaleFactor = 0.6;

  // Animation settings
  export let animationDuration = 6000;
  export let playingByDefault = true;
  export let animationPauseTime = 1000;
  export let numSteps = 100;  // Euler integration steps

  // Intermediate point styling
  export let intermediatePointColor = "#f17720";
  export let intermediatePointOpacity = 0.7;

  // Highlighted target point x_1 styling
  export let highlightPointColor = "#e63946";
  export let highlightPointRadius = 8;

  // Flow lines styling (from source to x_1)
  export let showLines = true;
  export let flowLineColor = "#cccccc";
  export let flowLineOpacity = 0.3;
  export let flowLineWidth = 1;

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
  export let currentLabelMargin = 30;  // Margin above highest point of current distribution

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  // Canvas - need both bind:this (for reactivity) and action (for DPR setup)
  let canvas: HTMLCanvasElement | null = null;
  const canvas2d = useCanvas2D(width, height);
  // Tie ctx reactivity to canvas variable so it updates when action runs
  $: ctx = canvas && canvas2d.ctx;
  $: caption = children;

  // Limited samples (after applying numSamples with random selection)
  let sourceSamples: number[][] = [];
  let targetSamples: number[][] = [];
  // Current samples for trajectories/lines (subset of source, uses currentNumSamples)
  let currentSamples: number[][] = [];

  // Scales and pre-computed coordinates
  let scales: ReturnType<typeof createSourceTargetScales> | null = null;
  let sourcePixelCoords: number[][] = [];
  let targetPixelCoords: number[][] = [];
  let currentPixelCoords: number[][] = [];  // For drawing lines from current samples

  // Target point x_1 (the single point all trajectories converge to)
  let x1: [number, number] = [0, 0];
  let x1PixelCoords: [number, number] = [0, 0];

  // Pre-computed trajectories
  // Shape: [particle][timestep][x, y] in domain coords
  let allTrajectories: number[][][] = [];

  // Pre-computed contours for each timestep
  let allContours: ReturnType<typeof computeContours>[] = [];
  // Mean X values for each timestep (for positioning)
  let allMeanX: number[] = [];

  // Animation state type
  type AnimationState = {
    time: number;
    currentStep: number;
    centerX: number;
  };

  // Animation state - Timeline system
  let player: Player<AnimationState> | null = null;

  // Visibility-based animation control
  let figureIsActive;
  let wasPlayingBeforeHidden = false;
  let isInitialized = false;

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  /**
   * Randomly select n samples from an array
   */
  function randomSample<T>(arr: T[], n: number): T[] {
    const shuffled = [...arr].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(n, arr.length));
  }

  /**
   * Compute the conditional velocity field v_t(x | x_1) = (x_1 - x) / (1 - t)
   * @param x - Current positions: number[][] of shape [N, 2]
   * @param x1 - Target point: [number, number]
   * @param t - Current time in [0, 1)
   * @returns Velocities: number[][] of shape [N, 2]
   */
  function computeConditionalVelocity(
    x: number[][],
    x1Pt: [number, number],
    t: number
  ): number[][] {
    // Clamp t to avoid division by zero as t -> 1
    const tClamped = Math.min(t, 0.999);
    const scale = 1 / (1 - tClamped);

    return x.map(([xi, yi]) => [
      (x1Pt[0] - xi) * scale,
      (x1Pt[1] - yi) * scale
    ]);
  }

  /**
   * Simulate trajectories from source points to x_1 using Euler integration.
   * @param startPoints - Initial positions: number[][] of shape [N, 2]
   * @param x1Pt - Target point: [number, number]
   * @param steps - Number of time steps
   * @returns Trajectories: number[][][] of shape [N, steps+1, 2]
   */
  function simulateTrajectories(
    startPoints: number[][],
    x1Pt: [number, number],
    steps: number
  ): number[][][] {
    const dt = 1 / steps;
    const trajectories: number[][][] = [];

    for (const startPoint of startPoints) {
      const trajectory: number[][] = [[...startPoint]];
      let current = [...startPoint];

      for (let step = 0; step < steps; step++) {
        const t = step * dt;
        const velocity = computeConditionalVelocity([current], x1Pt, t)[0];

        // Euler step: x_{t+dt} = x_t + v_t * dt
        current = [
          current[0] + velocity[0] * dt,
          current[1] + velocity[1] * dt
        ];
        trajectory.push([...current]);
      }

      trajectories.push(trajectory);
    }

    return trajectories;
  }

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

    sourcePixelCoords = sourceSamples.map((p) => [
      scales!.sourceCenterPixelX +
        (p[0] - scales!.sourceMeanX) * scales!.xScaleFactor,
      scales!.yScale(p[1]),
    ]);

    targetPixelCoords = targetSamples.map((p) => [
      scales!.targetCenterPixelX +
        (p[0] - scales!.targetMeanX) * scales!.xScaleFactor,
      scales!.yScale(p[1]),
    ]);

    // Current samples pixel coords (at source position, for drawing lines)
    currentPixelCoords = currentSamples.map((p) => [
      scales!.sourceCenterPixelX +
        (p[0] - scales!.sourceMeanX) * scales!.xScaleFactor,
      scales!.yScale(p[1]),
    ]);

    // Compute x_1 pixel coordinates (at target center)
    x1PixelCoords = [
      scales!.targetCenterPixelX + (x1[0] - scales!.targetMeanX) * scales!.xScaleFactor,
      scales!.yScale(x1[1])
    ];
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

    // 1. Randomly select samples for source and target distributions
    const sourceLimit = numSamples ?? sourceDistributionSamples.length;
    const targetLimit = numSamples ?? targetDistributionSamples.length;
    sourceSamples = randomSample(sourceDistributionSamples, sourceLimit);
    targetSamples = randomSample(targetDistributionSamples, targetLimit);

    // 2. Randomly select current samples (subset for trajectories/lines)
    const currentLimit = currentNumSamples ?? numSamples ?? sourceSamples.length;
    currentSamples = randomSample(sourceSamples, currentLimit);

    // 3. Determine x_1 (hardcoded target point)
    x1 = targetPoint ?? [targetDistributionSamples[0][0], targetDistributionSamples[0][1]];

    // 4. Create scales (use full distributions for scale calculation)
    scales = createSourceTargetScales(
      sourceDistributionSamples as [number, number][],
      targetDistributionSamples as [number, number][],
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

    // 5. Pre-compute static scatter coordinates
    precomputeScatterCoords();

    // 6. Simulate trajectories for current samples only
    allTrajectories = simulateTrajectories(currentSamples, x1, numSteps);

    // 5. Precompute contours for each timestep
    allContours = [];
    allMeanX = [];
    for (let step = 0; step <= numSteps; step++) {
      const currentPositions = allTrajectories.map(traj => traj[step]);
      const meanX = currentPositions.reduce((sum, p) => sum + p[0], 0) / currentPositions.length;
      allMeanX.push(meanX);

      const contourData = computeContours(currentPositions, {
        bandwidth: contourBandwidth,
        thresholds: contourThresholds,
      });
      allContours.push(contourData);
    }
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  function setupTimeline() {
    if (!scales) return;

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
      name: "ConditionalFlow",
      reduce(t: number) {
        return {
          time: t,
          currentStep: Math.round(t * numSteps),
          centerX: scales!.sourceCenterPixelX + t * (scales!.targetCenterPixelX - scales!.sourceCenterPixelX)
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
    if (!ctx || !isInitialized || !scales) return;
    ctx.clearRect(0, 0, width, height);

    const { time: t, currentStep, centerX } = state;

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
        targetPointOpacity ?? pointOpacity
      );
    }

    // Draw highlighted x_1 point
    ctx.save();
    ctx.fillStyle = highlightPointColor;
    ctx.globalAlpha = 1.0;
    ctx.beginPath();
    ctx.arc(x1PixelCoords[0], x1PixelCoords[1], highlightPointRadius, 0, 2 * Math.PI);
    ctx.fill();
    ctx.restore();

    // Draw lines from current samples to x_1 (always visible)
    if (showLines) {
      ctx.save();
      ctx.strokeStyle = flowLineColor;
      ctx.lineWidth = flowLineWidth;
      // Lines fade slightly as t increases (particles get closer)
      ctx.globalAlpha = flowLineOpacity * (1 - 0.5 * t);

      for (const currentCoord of currentPixelCoords) {
        ctx.beginPath();
        ctx.moveTo(currentCoord[0], currentCoord[1]);
        ctx.lineTo(x1PixelCoords[0], x1PixelCoords[1]);
        ctx.stroke();
      }

      ctx.restore();
    }

    // --- Dynamic Foreground ---

    // Get current positions from pre-computed trajectories
    if (allTrajectories.length > 0) {
      const stepIndex = Math.min(currentStep, allTrajectories[0].length - 1);
      const currentPositions = allTrajectories.map(traj => traj[stepIndex]);

      // Interpolate reference from sourceMeanX to targetMeanX so particles converge to x_1's pixel position
      const refX = (1 - t) * scales.sourceMeanX + t * scales.targetMeanX;

      // Draw contours for P_t using precomputed contour data
      if (showContours && allContours.length > 0) {
        const xScaleForContour = (dataX: number) => getPixelX(dataX, refX, t);
        const yScaleForContour = (dataY: number) => scales!.yScale(dataY);

        const contourData = allContours[stepIndex];
        if (contourData) {
          plotContours(ctx, contourData, {
            xScale: xScaleForContour,
            yScale: yScaleForContour,
            fillColor: contourFillColor,
            opacity: contourOpacity,
            blendMode: contourBlendMode as GlobalCompositeOperation | undefined,
            fill: true,
            stroke: false,
          });
        }
      }

      // Draw intermediate scatter and track highest point for label
      let highestPixelY = height;  // Start at bottom (highest y value)
      const coords = currentPositions.map((p) => [
        getPixelX(p[0], refX, t),
        scales!.yScale(p[1]),
      ]);

      // Find highest point (minimum y in pixel coords) and mean x
      let sumX = 0;
      for (const coord of coords) {
        if (coord[1] < highestPixelY) {
          highestPixelY = coord[1];
        }
        sumX += coord[0];
      }
      const meanPixelX = sumX / coords.length;

      if (showIntermediateScatter) {
        drawScatterPlot(
          ctx,
          coords,
          pointRadius,
          intermediatePointColor,
          intermediatePointOpacity
        );
      }

      // p_t(x | x_1) label (above highest point, centered on mean x of current distribution)
      if (t >= 0.1 && t <= 0.9) {
        const currentLabelY = highestPixelY - currentLabelMargin;
        drawMathjax(
          ctx, "p_t(x | x_1)", meanPixelX, currentLabelY,
          latexFontSize, 0, 0, { color: intermediatePointColor }
        );
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

    // x_1 label (above the highlighted point)
    drawMathjax(
      ctx, "x_1", x1PixelCoords[0], x1PixelCoords[1] - highlightPointRadius - 10,
      latexFontSize, 0, 0, { color: highlightPointColor }
    );
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
    canvas
  ) {
    runInitialComputation();
    setupTimeline();
    isInitialized = true;
    if (player) {
      draw(player!.timeline.initialState);
      if (playingByDefault) startAnimation();
    }
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
      <TimeSlider timeline={player} color={intermediatePointColor} />
    </div>
  {/snippet}
</Figure>
