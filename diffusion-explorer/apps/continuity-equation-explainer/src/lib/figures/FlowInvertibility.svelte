<!-- FlowInvertibility: Shows a flow transformation from Gaussian to smiley face with horizontal animation, demonstrating probability mass conservation. -->

<script lang="ts">
  import { onDestroy } from "svelte";
  import * as d3 from "d3";
  import { Player,
    Figure,
    TimeSlider,
    computeContours,
    plotContours,
    drawScatterPlot,
    PathlineAnimation,
    Timeline,
    useCanvas2D,
    useVisibilityHandler,
    createPauseClip,
    createSourceTargetScales,
    drawMathjax,
    type PathlineAnimationState,
    type ComputedContours,
  } from "@diffusion-explorer/ui";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  // Caption slot (receives content from parent as default slot)
  export let children = undefined;

  // Data props (loaded from JSON)
  export let data: {
    allTrajectories: number[][][];
    highlightedIndices: number[];
    sourceDistribution: number[][];
    targetDistribution: number[][];  // Ground truth target data
    config: {
      numSteps: number;
      gaussianStd: number;
      clipRadius: number;
    };
  } | null = null;

  // Layout props
  export let width = 800;
  export let height = 300;
  export let marginWidth = 50;
  export let marginHeight = 45;

  // Source/Target layout (normalized 0-1)
  export let sourceCenterX = 0.2;
  export let targetCenterX = 0.8;
  export let distributionScaleFactor = 1.0;
  export let yShiftFactor = -0.10;  // Shift distributions up (negative = up)

  // Styling props - contours (matching ProbabilityPath settings)
  export let contourBandwidth = 10;
  export let contourThresholds = 4;
  export let contourOpacity = 0.3;
  export let contourFillColor = "#f17720";
  export let contourBlendMode: string | undefined = undefined;
  export let contourMinThreshold: number | undefined = 0.0005;  // Filter out low density contours
  export let staticContourOpacity = 0.15;  // Faded source/target contours
  export let staticContourColor = "#3b82f6";  // Blue for source/target

  // Styling props - scatter plots
  export let scatterRadius = 4;
  export let scatterOpacity = 0.15;
  export let scatterColor = "#3b82f6";  // Blue to match static contours
  export let scatterNumSamples = 300;  // Number of samples to show in scatter plots

  // Visibility toggles
  export let showSourceScatter = false;
  export let showTargetScatter = false;
  export let showCurrentScatter = true;
  export let showSourceContour = true;
  export let showTargetContour = true;
  export let showCurrentContour = true;

  // Styling props - trajectories
  export let trajectoryColor = "#f17720";
  export let trajectoryStrokeWidth = 3;
  export let trajectoryPointRadius = 5;

  // Styling props - labels
  export let latexFontSize = 20;
  export let latexColor = "#333";
  export let labelFontSize = 26;
  export let labelFontFamily = "sans-serif";
  export let labelColor = "#5e5e5e";

  // Animation props
  export let animationDuration = 8000;
  export let timing = {
    animationEnd: 1.0,
  };
  export let playingByDefault = true;

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  // Canvas refs
  let canvas: HTMLCanvasElement | null = null;
  const canvas2d = useCanvas2D(width, height);
  $: ctx = canvas && canvas2d.ctx;

  // Scales (from createSourceTargetScales)
  let scales: {
    yScale: d3.ScaleLinear<number, number>;
    xScaleFactor: number;
    sourceCenterPixelX: number;
    targetCenterPixelX: number;
    sourceMeanX: number;
    targetMeanX: number;
  } | null = null;

  // Precomputed contours for each timestep
  let precomputedContours: ComputedContours[] = [];

  // Precomputed mean X values for each timestep (for centering)
  let precomputedMeanX: number[] = [];

  // Precomputed pixel coordinates for static distributions
  let sourceContourData: ComputedContours | null = null;
  let targetContourData: ComputedContours | null = null;

  // Precomputed pixel coordinates for scatter plots
  let sourcePixelCoords: number[][] = [];
  let targetPixelCoords: number[][] = [];

  // Randomized indices for scatter plot sampling
  let randomScatterIndices: number[] = [];

  // Pathline animation for highlighted trajectories
  let pathlineAnim: PathlineAnimation<AnimationState> | null = null;

  // Precomputed pixel coordinates for highlighted trajectories (for labels)
  let highlightedTrajPixelCoords: number[][][] = [];

  // Animation state type
  type AnimationState = PathlineAnimationState & {
    currentStep: number;
    time: number;
    centerX: number;
  };

  // Timeline
  let player: Player<AnimationState> | null = null;

  // Visibility handling
  let figureIsActive: import("svelte/store").Writable<boolean>;
  const { handleVisibilityChange } = useVisibilityHandler(() => player);
  let isInitialized = false;

  // Cached values for closures
  let cachedNumSteps = 1;

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  function getDistributionAtStep(step: number): number[][] {
    if (!data) return [];
    return data.allTrajectories.map(traj => traj[step]);
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

  /**
   * Shuffle array in place using Fisher-Yates algorithm
   */
  function shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function runInitialComputation() {
    if (!canvas || !data) return;

    const numSteps = data.config.numSteps;
    cachedNumSteps = numSteps;

    // Get source distribution (from trajectory starting points)
    const sourceDistribution = getDistributionAtStep(0);
    // Use ground truth target distribution (not trajectory endpoints)
    const targetDistribution = data.targetDistribution;

    // Create scales using the same approach as ProbabilityPath
    scales = createSourceTargetScales(
      sourceDistribution as [number, number][],
      targetDistribution as [number, number][],
      {
        width,
        height,
        marginWidth,
        marginHeight,
        sourceCenterX,
        targetCenterX,
        distributionScaleFactor,
        yShiftFactor,
      }
    );

    // Compute source distribution contour (step 0)
    sourceContourData = computeContours(sourceDistribution, {
      bandwidth: contourBandwidth,
      thresholds: contourThresholds,
    });

    // Compute target distribution contour (ground truth)
    targetContourData = computeContours(targetDistribution, {
      bandwidth: contourBandwidth,
      thresholds: contourThresholds,
    });

    // Precompute pixel coordinates for scatter plots
    sourcePixelCoords = sourceDistribution.map((p) => [
      scales!.sourceCenterPixelX + (p[0] - scales!.sourceMeanX) * scales!.xScaleFactor,
      scales!.yScale(p[1]),
    ]);
    targetPixelCoords = targetDistribution.map((p) => [
      scales!.targetCenterPixelX + (p[0] - scales!.targetMeanX) * scales!.xScaleFactor,
      scales!.yScale(p[1]),
    ]);

    // Create randomized indices for scatter plot sampling
    const allIndices = Array.from({ length: sourceDistribution.length }, (_, i) => i);
    randomScatterIndices = shuffleArray(allIndices).slice(0, scatterNumSamples);

    // Precompute contours and mean X for ALL timesteps (eliminates jitter)
    precomputedContours = [];
    precomputedMeanX = [];
    for (let step = 0; step <= numSteps; step++) {
      const distribution = getDistributionAtStep(step);
      precomputedContours[step] = computeContours(distribution, {
        bandwidth: contourBandwidth,
        thresholds: contourThresholds,
      });
      precomputedMeanX[step] = distribution.reduce((s, p) => s + p[0], 0) / distribution.length;
    }

    // Create pathline animation for highlighted trajectories
    // Trajectories need to be in pixel coordinates that interpolate horizontally
    const highlightedTrajectories = data.highlightedIndices.map(idx => {
      const traj = data!.allTrajectories[idx];
      return traj.map((pt, stepIdx) => {
        const t = stepIdx / numSteps;
        // Use precomputed mean X for consistent centering
        const meanX = precomputedMeanX[stepIdx];
        return [getPixelX(pt[0], meanX, t), scales!.yScale(pt[1])];
      });
    });

    // Store for label positioning
    highlightedTrajPixelCoords = highlightedTrajectories;

    pathlineAnim = PathlineAnimation.fromTrajectories<AnimationState>(highlightedTrajectories, {
      style: {
        strokeWidth: trajectoryStrokeWidth,
        color: trajectoryColor,
        opacity: 1.0,
        pointRadius: trajectoryPointRadius,
        showHeadMarker: true,
        showPreview: true,
        previewOpacity: 0.15,
      }
    });
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  async function setupTimeline() {
    if (!pathlineAnim || !data || !scales || !canvas) return;

    // Initialize the animation with the canvas
    await pathlineAnim.init(canvas);

    const tl = Timeline.from<AnimationState>({
      duration: animationDuration / 1000,
      initialState: {},
      clips: [
        { clip: mainClip, ...{ start: 0, end: timing.animationEnd } },
        { clip: createPauseClip(), ...{ start: timing.animationEnd, end: 1 } },
      ],
    });
    player = new Player(tl, { looping: true });

    // Main animation clip
    const mainClip = {
      name: "FlowAnimation",
      reduce(t: number) {
        const numSegments = pathlineAnim!.data.numSegments;
        return {
          segmentIndex: Math.floor(t * numSegments),
          currentStep: Math.round(t * cachedNumSteps),
          time: t,
          centerX: scales!.sourceCenterPixelX + t * (scales!.targetCenterPixelX - scales!.sourceCenterPixelX),
        };
      }
    };


    player.onTick((_, state) => {
      draw(state);
    });
  }

  function startAnimation() {
    if (!player) return;
    player.play();
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function requestRedraw() {
    if (player) {
      draw(player.state);
    }
  }

  function draw(state: AnimationState) {
    if (!ctx || !scales || !data || !pathlineAnim) return;
    ctx.clearRect(0, 0, width, height);

    const t = state.time;
    const currentStep = state.currentStep;

    // --- Static Background ---

    // Draw source distribution (faded blue)
    if (showSourceContour && sourceContourData) {
      plotContours(ctx, sourceContourData, {
        xScale: (dataX) => getPixelX(dataX, scales!.sourceMeanX, 0),
        yScale: (dataY) => scales!.yScale(dataY),
        fillColor: staticContourColor,
        opacity: staticContourOpacity,
        blendMode: contourBlendMode,
        minThreshold: contourMinThreshold,
        fill: true,
        stroke: false,
      });
    }

    // Draw target distribution (faded blue)
    if (showTargetContour && targetContourData) {
      plotContours(ctx, targetContourData, {
        xScale: (dataX) => getPixelX(dataX, scales!.targetMeanX, 1),
        yScale: (dataY) => scales!.yScale(dataY),
        fillColor: staticContourColor,
        opacity: staticContourOpacity,
        blendMode: contourBlendMode,
        minThreshold: contourMinThreshold,
        fill: true,
        stroke: false,
      });
    }

    // Draw scatter plots for source and target (using randomized indices)
    if (showSourceScatter) {
      const sourceScatterCoords = randomScatterIndices.map(i => sourcePixelCoords[i]);
      drawScatterPlot(ctx, sourceScatterCoords, scatterRadius, scatterColor, scatterOpacity);
    }
    if (showTargetScatter) {
      const targetScatterCoords = randomScatterIndices.map(i => targetPixelCoords[i]);
      drawScatterPlot(ctx, targetScatterCoords, scatterRadius, scatterColor, scatterOpacity);
    }

    // --- Dynamic Foreground ---

    // Get precomputed contour and mean for current step (no jitter)
    const currentContours = precomputedContours[currentStep];
    const currentMeanX = precomputedMeanX[currentStep];

    // Draw current (intermediate) distribution contours
    if (showCurrentContour && currentContours) {
      plotContours(ctx, currentContours, {
        xScale: (dataX) => getPixelX(dataX, currentMeanX, t),
        yScale: (dataY) => scales!.yScale(dataY),
        fillColor: contourFillColor,
        opacity: contourOpacity,
        blendMode: contourBlendMode,
        minThreshold: contourMinThreshold,
        fill: true,
        stroke: false,
      });
    }

    // Draw scatter plot for current distribution (using randomized indices)
    if (showCurrentScatter && currentContours) {
      const currentDistAtStep = getDistributionAtStep(currentStep);
      const currentPixelCoords = randomScatterIndices.map(i => {
        const p = currentDistAtStep[i];
        return [getPixelX(p[0], currentMeanX, t), scales!.yScale(p[1])];
      });
      drawScatterPlot(ctx, currentPixelCoords, scatterRadius, contourFillColor, scatterOpacity);
    }

    // Draw pathline animations
    pathlineAnim.draw(state);

    // Draw labels for highlighted trajectory points
    if (highlightedTrajPixelCoords.length >= 2) {
      const labelMargin = 15;

      // x_a and x_b labels at source positions (step 0)
      const startA = highlightedTrajPixelCoords[0][0];
      const startB = highlightedTrajPixelCoords[1][0];

      // Draw points at x_a and x_b
      ctx.fillStyle = trajectoryColor;
      ctx.beginPath();
      ctx.arc(startA[0], startA[1], trajectoryPointRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(startB[0], startB[1], trajectoryPointRadius, 0, Math.PI * 2);
      ctx.fill();

      drawMathjax(
        ctx,
        "x_a",
        startA[0],
        startA[1] - labelMargin,
        latexFontSize,
        0,
        0,
        { color: "#666", stroke: "#fff", strokeWidth: 3 },
        requestRedraw
      );

      drawMathjax(
        ctx,
        "x_b",
        startB[0],
        startB[1] - labelMargin,
        latexFontSize,
        0,
        0,
        { color: "#666", stroke: "#fff", strokeWidth: 3 },
        requestRedraw
      );

      // \psi_t(x_a) and \psi_t(x_b) labels at current positions
      const currentA = highlightedTrajPixelCoords[0][currentStep];
      const currentB = highlightedTrajPixelCoords[1][currentStep];

      if (currentA && currentB) {
        drawMathjax(
          ctx,
          "\\psi_t(x_a)",
          currentA[0],
          currentA[1] - labelMargin,
          latexFontSize,
          0,
          0,
          { color: "#666", stroke: "#fff", strokeWidth: 3 },
          requestRedraw
        );

        drawMathjax(
          ctx,
          "\\psi_t(x_b)",
          currentB[0],
          currentB[1] + labelMargin + 30,
          latexFontSize,
          0,
          0,
          { color: "#666", stroke: "#fff", strokeWidth: 3 },
          requestRedraw
        );
      }
    }

    // Draw center label
    const centerLabelY = height / 2 - 130;
    ctx.font = `500 ${labelFontSize - 4}px ${labelFontFamily}`;
    ctx.fillStyle = trajectoryColor;
    ctx.textAlign = "center";
    ctx.fillText("Flow ψₜ(x) is invertible, mapping distinct points to distinct locations.", width / 2, centerLabelY);

    // Draw integral labels below distributions
    const integralY = height - marginHeight + 35;

    // Integral below source distribution (always visible)
    drawMathjax(
      ctx,
      "\\int p_0(x) \\, dx = 1",
      scales.sourceCenterPixelX,
      integralY,
      latexFontSize,
      0,
      0,
      { color: staticContourColor },
      requestRedraw
    );

    // Integral below current distribution (show after t >= 0.4)
    if (t >= 0.4 && t <= 0.8) {
      drawMathjax(
        ctx,
        "\\int p_t(x) \\, dx = 1",
        state.centerX,
        integralY,
        latexFontSize,
        0,
        0,
        { color: trajectoryColor },
        requestRedraw
      );
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

  // Store reference to avoid shadowing by snippet name
  $: captionSnippet = children;

  // Initialize when data and canvas are ready
  $: if (
    !isInitialized &&
    data &&
    data.allTrajectories?.length > 0 &&
    canvas
  ) {
    isInitialized = true;
    runInitialComputation();
    setupTimeline().then(() => {
      if (player) {
        draw(player!.timeline.initialState);
        if (playingByDefault) startAnimation();
      }
    });
  }

  // Handle visibility changes
  $: if (figureIsActive !== undefined && isInitialized) {
    handleVisibilityChange($figureIsActive);
  }
</script>

<Figure bind:isActive={figureIsActive} backgroundVisible={false}>
  {#snippet children()}
    <div style="display: flex; flex-direction: column; align-items: center; width: 100%;">
      <div style="width: 100%; max-width: {width}px;">
        <canvas
          bind:this={canvas}
          use:canvas2d.bindCanvas
          style="width: 100%; height: auto; aspect-ratio: {width}/{height};"
        ></canvas>
      </div>
      <TimeSlider timeline={player} color={trajectoryColor} />
    </div>
  {/snippet}

  {#snippet caption()}
    {@render captionSnippet?.()}
  {/snippet}
</Figure>
