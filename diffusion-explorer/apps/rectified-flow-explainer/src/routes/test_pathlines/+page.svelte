<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import * as d3 from "d3";
  import { base } from "$app/paths";
  import DoubleFigure from "$lib/components/DoubleFigure.svelte";
  import TimeSlider from "$lib/components/TimeSlider.svelte";
  import { settings } from "$lib/settings";
  import { drawScatterPlot } from "$lib/plotting/plotting";
  import { drawTrajectoriesWithOpacityGradient } from "$lib/plotting/trajectories";
  import * as sample from "$lib/flow_matching/sample";
  import { generateTemporallySpacedPathlines } from "$lib/plotting/pathlines";

  // ===== DATA =====
  let leftTrajectories: number[][][] = []; // [timestep][sample][dim]
  let rightTrajectories: number[][][] = []; // [timestep][sample][dim]
  let targetDistribution: number[][] = [];
  let isLoading = true;
  let loadError: string | null = null;

  // ===== PATHLINE FILTERING =====
  let leftDeactivationTimes: number[] = [];
  let rightDeactivationTimes: number[] = [];
  const pathlineSpacingOptions = {
    dMin: 0.05, // Minimum spacing distance
    windowDeltaT: 0.25, // Time window (25% of interval)
  };

  // ===== LAYOUT =====
  let canvasWidth = 400;
  let canvasHeight = 400;
  let marginWidth = 10;
  let marginHeight = 10;
  let gap = 20;
  let domainRange = { xMin: -1.7, xMax: 1.7, yMin: -1.7, yMax: 1.7 };

  // ===== LABELS =====
  let leftLabel = "Flow Matching";
  let rightLabel = "Rectified Flow";
  let labelFontSize = 26;
  let labelColor = settings.stylingSettings.label.color;

  // ===== TARGET DISTRIBUTION STYLING =====
  let targetColor = "#3b82f6";
  let targetOpacity = 0.35;
  let targetPointRadius = 5;

  // ===== TRAJECTORY STYLING =====
  let trajectoryColor = settings.stylingSettings.trajectory.color;
  let trajectoryStrokeWidth = settings.stylingSettings.trajectory.strokeWidth;
  let trajectoryPointRadius = settings.stylingSettings.trajectory.pointRadius;
  let trajectoryProgressOpacity =
    settings.stylingSettings.trajectory.progressOpacity;
  let trajectoryFullOpacity = settings.stylingSettings.trajectory.fullOpacity;
  let showTrajectoryPreview = false;
  let alphaTimeWindow = 1.0;

  // ===== ANIMATION =====
  let animationDuration = 8000;
  let pauseDuration = 1000;
  let playingByDefault = true;

  // ===== DERIVED =====
  $: isDataValid =
    leftTrajectories?.length > 0 &&
    rightTrajectories?.length > 0 &&
    targetDistribution?.length > 0;
  $: numTimeSteps = isDataValid ? leftTrajectories.length : 1;
  $: numSegments = numTimeSteps - 1;
  $: msPerSegment =
    numSegments > 0 ? animationDuration / numSegments : animationDuration;

  // ===== STATE =====

  // Canvas
  let leftCanvas;
  let rightCanvas;
  let leftCtx;
  let rightCtx;
  let dpr = 1;

  // Scales
  let xScale;
  let yScale;

  // Animation
  let time = 0;
  let currentSegmentIndex = 0;
  let segmentAccumulator = 0;
  let isPlaying = playingByDefault;
  let animationFrameId = null;
  let lastTimestamp = null;
  let isPaused = false;
  let pauseStartTime = null;

  // Initialization
  let isInitialized = false;
  let pathsInitialized = false;

  // Pre-computed pixel coordinates
  let scaledTargetDistribution = [];
  let scaledLeftTrajectories = [];
  let scaledRightTrajectories = [];

  // Visibility
  let figureIsActive;
  let wasPlayingBeforeHidden = false;

  // ===== FUNCTIONS =====

  function initializeScales() {
    if (!isDataValid) return;

    const { xMin, xMax, yMin, yMax } = domainRange;

    xScale = d3
      .scaleLinear()
      .domain([xMin, xMax])
      .range([marginWidth, canvasWidth - marginWidth]);

    yScale = d3
      .scaleLinear()
      .domain([yMin, yMax])
      .range([marginHeight, canvasHeight - marginHeight]);
  }

  function initializeCanvas() {
    dpr = window.devicePixelRatio || 1;

    if (leftCanvas) {
      leftCanvas.width = canvasWidth * dpr;
      leftCanvas.height = canvasHeight * dpr;
      leftCtx = leftCanvas.getContext("2d");
      leftCtx.scale(dpr, dpr);
    }
    if (rightCanvas) {
      rightCanvas.width = canvasWidth * dpr;
      rightCanvas.height = canvasHeight * dpr;
      rightCtx = rightCanvas.getContext("2d");
      rightCtx.scale(dpr, dpr);
    }
  }

  function transposeAndScale(trajectories) {
    if (!xScale || !yScale || !trajectories || trajectories.length === 0)
      return [];
    const numSamples = trajectories[0]?.length || 0;
    return Array.from({ length: numSamples }, (_, i) =>
      trajectories.map((ts) => [xScale(ts[i][0]), yScale(ts[i][1])])
    );
  }

  function precomputeCoordinates() {
    if (!xScale || !yScale) return;

    scaledTargetDistribution = targetDistribution.map((p) => [
      xScale(p[0]),
      yScale(p[1]),
    ]);
    scaledLeftTrajectories = transposeAndScale(leftTrajectories);
    scaledRightTrajectories = transposeAndScale(rightTrajectories);
  }

  function draw(
    ctx: CanvasRenderingContext2D,
    scaledTrajectories: number[][][],
    segmentIndex: number,
    deactivationTimes: number[]
  ) {
    if (!ctx) return;

    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    drawScatterPlot(
      ctx,
      scaledTargetDistribution,
      targetPointRadius,
      targetColor,
      targetOpacity
    );

    // Calculate window size in timesteps
    const numTimesteps = scaledTrajectories[0]?.length || 1;
    const windowSteps = Math.floor(alphaTimeWindow * numTimesteps);

    // The visible window is [windowStart, segmentIndex]
    const windowStart = Math.max(0, segmentIndex - windowSteps);

    // Filter and trim trajectories
    const filteredTrajectories: number[][][] = [];
    for (let i = 0; i < scaledTrajectories.length; i++) {
      const deactivateAt = deactivationTimes[i] ?? Infinity;
      const trajectory = scaledTrajectories[i];

      // Trajectory geometry ends at deactivation time (frozen, no new segments revealed)
      const geometryEnd = Math.min(
        deactivateAt === Infinity ? segmentIndex + 1 : deactivateAt + 1,
        trajectory.length
      );

      // Visible portion is intersection of [windowStart, segmentIndex] and [0, geometryEnd]
      const visibleStart = windowStart;
      const visibleEnd = Math.min(segmentIndex + 1, geometryEnd);

      // Skip if no visible portion (window has moved past the frozen geometry)
      if (visibleStart >= visibleEnd) continue;

      const trimmedTrajectory = trajectory.slice(visibleStart, visibleEnd);
      filteredTrajectories.push(trimmedTrajectory);
    }

    // Draw all visible trajectories
    // The segment index for drawing is relative to each trimmed trajectory
    const trimmedSegmentIndex = Math.min(windowSteps, segmentIndex);

    drawTrajectoriesWithOpacityGradient(
      ctx,
      filteredTrajectories,
      trimmedSegmentIndex,
      {
        strokeWidth: trajectoryStrokeWidth,
        color: trajectoryColor,
        progressOpacity: trajectoryProgressOpacity,
        pointRadius: trajectoryPointRadius,
        showPreview: showTrajectoryPreview,
        previewOpacity: trajectoryFullOpacity,
        showHeadMarker: false,
      },
      alphaTimeWindow
    );
  }

  function initializeVisualization() {
    if (!leftCanvas || !rightCanvas || !isDataValid) return;

    initializeScales();
    initializeCanvas();
    precomputeCoordinates();
    pathsInitialized = true;
    updateVisualization();
    isInitialized = true;
  }

  function updateVisualization() {
    if (!isDataValid || !leftCtx || !rightCtx) return;

    draw(
      leftCtx,
      scaledLeftTrajectories,
      currentSegmentIndex,
      leftDeactivationTimes
    );
    draw(
      rightCtx,
      scaledRightTrajectories,
      currentSegmentIndex,
      rightDeactivationTimes
    );
  }

  function animate(ts) {
    if (!isPlaying) {
      animationFrameId = null;
      return;
    }
    if (lastTimestamp === null) lastTimestamp = ts;
    const elapsed = ts - lastTimestamp;
    lastTimestamp = ts;

    if (isPaused && pauseStartTime !== null) {
      if (ts - pauseStartTime >= pauseDuration) {
        isPaused = false;
        pauseStartTime = null;
        currentSegmentIndex = 0;
        segmentAccumulator = 0;
        time = 0;
        updateVisualization();
      }
      animationFrameId = requestAnimationFrame(animate);
      return;
    }

    segmentAccumulator += elapsed;
    while (
      segmentAccumulator >= msPerSegment &&
      currentSegmentIndex < numSegments
    ) {
      segmentAccumulator -= msPerSegment;
      currentSegmentIndex += 1;
    }

    time = numSegments > 0 ? currentSegmentIndex / numSegments : 0;

    updateVisualization();

    if (currentSegmentIndex >= numSegments) {
      isPaused = true;
      pauseStartTime = ts;
    }

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

  function togglePlayPause() {
    isPlaying = !isPlaying;
    if (!isPlaying) {
      stopAnimation();
    }
  }

  function handleSliderInput() {
    if (isPlaying) {
      isPlaying = false;
      stopAnimation();
    }
    currentSegmentIndex = Math.round(time * numSegments);
    segmentAccumulator = 0;
    updateVisualization();
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

  // ===== REACTIVE EFFECTS =====

  $: if (isDataValid && leftCanvas && rightCanvas && !isInitialized) {
    initializeVisualization();
  }

  $: if (isPlaying && pathsInitialized && !animationFrameId) startAnimation();
  $: if (!isPlaying && animationFrameId) stopAnimation();

  $: if (figureIsActive !== undefined && isInitialized) {
    handleVisibilityChange($figureIsActive);
  }

  // ===== DENSE GRID GENERATION =====

  // Configuration for dense grid sampling
  const denseGridResolution = 50;
  const denseGridNumSteps = 100;
  const denseGridDomainRange = { xMin: -2.5, xMax: 2.5, yMin: -2.5, yMax: 2.5 };

  let isGenerating = false;
  let generationStatus = "";

  /**
   * Generate dense grid trajectories from a model
   * @param modelPath - Path to the model (flow matching or rectified flow)
   * @returns Promise with trajectories in [timestep][sample][dim] format
   */
  async function generateDenseGridTrajectories(
    modelPath: string
  ): Promise<number[][][]> {
    const result = await sample.generateSamplesUniformGrid(
      modelPath,
      denseGridResolution,
      denseGridDomainRange,
      denseGridNumSteps,
      settings.trainingSettings,
      settings.samplingWorkerUrl
    );
    return result.allTimeSamples;
  }

  /**
   * Generate trajectories for both panels using flow matching and rectified flow models
   */
  async function generateBothTrajectories() {
    isGenerating = true;
    generationStatus = "Generating flow matching trajectories...";

    try {
      // Generate flow matching trajectories (left panel)
      if (settings.flowMatchingModelPath) {
        const fmModelPath = `${base}/${settings.flowMatchingModelPath}`;
        leftTrajectories = await generateDenseGridTrajectories(fmModelPath);
        console.log(
          `Generated ${leftTrajectories[0]?.length || 0} flow matching trajectories`
        );
      }

      generationStatus = "Generating rectified flow trajectories...";

      // Generate rectified flow trajectories (right panel)
      if (settings.rectifiedFlowModelPath) {
        const rfModelPath = `${base}/${settings.rectifiedFlowModelPath}`;
        rightTrajectories = await generateDenseGridTrajectories(rfModelPath);
        console.log(
          `Generated ${rightTrajectories[0]?.length || 0} rectified flow trajectories`
        );
      }

      // Use final timestep as target distribution
      if (leftTrajectories.length > 0) {
        targetDistribution = leftTrajectories[leftTrajectories.length - 1];
      }

      generationStatus = "Done!";
      isLoading = false;
    } catch (error) {
      loadError =
        error instanceof Error
          ? error.message
          : "Failed to generate trajectories";
      console.error("Error generating trajectories:", error);
    } finally {
      isGenerating = false;
    }
  }

  // ===== PATHLINE FILTERING =====

  /**
   * Transpose trajectories from [timestep][sample][dim] to [sample][timestep][dim]
   */
  function transposeTrajectories(trajectories: number[][][]): number[][][] {
    if (trajectories.length === 0) return [];
    const numTimesteps = trajectories.length;
    const numSamples = trajectories[0].length;

    return Array.from({ length: numSamples }, (_, sampleIdx) =>
      Array.from(
        { length: numTimesteps },
        (_, timeIdx) => trajectories[timeIdx][sampleIdx]
      )
    );
  }

  /**
   * Run pathline filtering on both trajectory sets
   */
  function runPathlineFiltering() {
    if (leftTrajectories.length === 0 && rightTrajectories.length === 0) {
      return;
    }

    console.log("Running pathline filtering...");
    console.log(
      `Left trajectories: ${leftTrajectories.length} timesteps, ${leftTrajectories[0]?.length || 0} samples`
    );
    console.log(
      `Right trajectories: ${rightTrajectories.length} timesteps, ${rightTrajectories[0]?.length || 0} samples`
    );

    // Transpose from [timestep][sample][dim] to [sample][timestep][dim]
    if (leftTrajectories.length > 0) {
      const leftTransposed = transposeTrajectories(leftTrajectories);
      leftDeactivationTimes = generateTemporallySpacedPathlines(
        leftTransposed,
        pathlineSpacingOptions
      );

      const leftActive = leftDeactivationTimes.filter(
        (t) => t === Infinity
      ).length;
      const leftDeactivated = leftDeactivationTimes.filter(
        (t) => t !== Infinity
      ).length;
      console.log(
        `Left pathlines: ${leftActive} active, ${leftDeactivated} deactivated`
      );
      console.log("Left deactivation times:", leftDeactivationTimes);
    }

    if (rightTrajectories.length > 0) {
      const rightTransposed = transposeTrajectories(rightTrajectories);
      rightDeactivationTimes = generateTemporallySpacedPathlines(
        rightTransposed,
        pathlineSpacingOptions
      );

      const rightActive = rightDeactivationTimes.filter(
        (t) => t === Infinity
      ).length;
      const rightDeactivated = rightDeactivationTimes.filter(
        (t) => t !== Infinity
      ).length;
      console.log(
        `Right pathlines: ${rightActive} active, ${rightDeactivated} deactivated`
      );
      console.log("Right deactivation times:", rightDeactivationTimes);
    }
  }

  // ===== DATA LOADING =====

  async function loadTrajectoryData() {
    try {
      // Load target distribution
      const targetSamples = await sample.loadTargetDistribution(
        `${base}/${settings.targetDistributionPointsPath}`,
        settings.samplingSettings.flowMatching.numSamples
      );
      if (targetSamples) {
        targetDistribution = targetSamples;
      }

      // Load flow matching grid trajectories
      if (settings.cachedFlowMatchingGridTrajectoriesPath) {
        const fmResult = await sample.loadCachedTrajectories(
          `${base}/${settings.cachedFlowMatchingGridTrajectoriesPath}`
        );
        if (fmResult) {
          leftTrajectories = fmResult.trajectories;
        }
      }

      // Load rectified flow grid trajectories
      if (settings.cachedRectifiedFlowGridTrajectoriesPath) {
        const rfResult = await sample.loadCachedRectifiedFlowTrajectories(
          `${base}/${settings.cachedRectifiedFlowGridTrajectoriesPath}`
        );
        if (rfResult && rfResult.allRectifiedTrajectories.length > 0) {
          // Use the last rectified step (most straightened trajectories)
          rightTrajectories =
            rfResult.allRectifiedTrajectories[
              rfResult.allRectifiedTrajectories.length - 1
            ];
        }
      }

      // Run pathline filtering on both trajectory sets
      runPathlineFiltering();

      isLoading = false;
    } catch (error) {
      loadError =
        error instanceof Error ? error.message : "Failed to load data";
      isLoading = false;
      console.error("Error loading trajectory data:", error);
    }
  }

  // ===== LIFECYCLE =====

  onMount(() => {
    loadTrajectoryData();
  });

  onDestroy(() => {
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
    }
  });
</script>

<div class="page-container">
  <h1>Pathlines Test Page</h1>

  <div class="controls">
    <button
      onclick={generateBothTrajectories}
      disabled={isGenerating}
      class="generate-button"
    >
      {isGenerating ? "Generating..." : "Generate Dense Grid Trajectories"}
    </button>
    {#if generationStatus}
      <span class="status">{generationStatus}</span>
    {/if}
  </div>

  {#if isLoading}
    <div class="loading">Loading trajectory data...</div>
  {:else if loadError}
    <div class="error">Error: {loadError}</div>
  {:else if isDataValid}
    <DoubleFigure {gap} bind:isActive={figureIsActive}>
      {#snippet left()}
        <div class="panel-container" style="max-width: {canvasWidth}px;">
          <div
            class="panel-label"
            style="font-size: {labelFontSize}px; color: {labelColor};"
          >
            {leftLabel}
          </div>
          <canvas bind:this={leftCanvas} class="panel-canvas"></canvas>
        </div>
      {/snippet}

      {#snippet right()}
        <div class="panel-container" style="max-width: {canvasWidth}px;">
          <div
            class="panel-label"
            style="font-size: {labelFontSize}px; color: {labelColor};"
          >
            {rightLabel}
          </div>
          <canvas bind:this={rightCanvas} class="panel-canvas"></canvas>
        </div>
      {/snippet}

      {#snippet footer()}
        <TimeSlider
          bind:value={time}
          {isPlaying}
          min={0}
          max={1}
          onTogglePlay={togglePlayPause}
          onInput={handleSliderInput}
          color="#f17720"
        />
      {/snippet}
    </DoubleFigure>
  {:else}
    <div class="placeholder">
      <p>No pathline data loaded. Add trajectory data to visualize.</p>
    </div>
  {/if}
</div>

<style>
  .page-container {
    padding: 2rem;
    max-width: 1200px;
    margin: 0 auto;
  }

  h1 {
    text-align: center;
    margin-bottom: 2rem;
    color: #333;
  }

  .controls {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1.5rem;
    justify-content: center;
  }

  .generate-button {
    padding: 0.75rem 1.5rem;
    font-size: 1rem;
    background-color: #3b82f6;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    transition: background-color 0.2s;
  }

  .generate-button:hover:not(:disabled) {
    background-color: #2563eb;
  }

  .generate-button:disabled {
    background-color: #9ca3af;
    cursor: not-allowed;
  }

  .status {
    color: #666;
    font-style: italic;
  }

  .loading,
  .error {
    padding: 2rem;
    text-align: center;
    border-radius: 8px;
  }

  .loading {
    background-color: #f0f9ff;
    color: #0369a1;
  }

  .error {
    background-color: #fef2f2;
    color: #dc2626;
  }

  .panel-container {
    width: 100%;
  }

  .panel-label {
    text-align: center;
    padding-bottom: 8px;
  }

  .panel-canvas {
    width: 100%;
    height: auto;
    display: block;
  }

  .placeholder {
    padding: 2rem;
    text-align: center;
    background-color: #f9f9f9;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    color: #666;
  }

  @media (max-width: 600px) {
    .panel-label {
      font-size: 18px !important;
    }
  }
</style>
