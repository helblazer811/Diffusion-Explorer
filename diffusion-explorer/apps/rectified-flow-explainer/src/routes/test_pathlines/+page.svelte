<script lang="ts">
  import { onMount, onDestroy, afterUpdate } from "svelte";
  import * as d3 from "d3";
  import { DoubleFigure, TimeSlider, drawScatterPlot, generateSpatiallySpacedPathlines } from "@diffusion-explorer/ui";
  import { settings } from "$lib/settings";
  import * as sample from "$lib/flow_matching/sample";
  import * as train from "$lib/flow_matching/train";
  import { callSamplingWorkerThreadFromInitialPoints, downloadJSON } from "@diffusion-explorer/diffusion";

  // ===== DATA =====
  let leftTrajectories: number[][][] = []; // [timestep][sample][dim]
  let rightTrajectories: number[][][] = []; // [timestep][sample][dim]
  let targetDistribution: number[][] = [];
  let isLoading = true;
  let loadError: string | null = null;

  // ===== PATHLINE FILTERING =====
  // Filtered pathlines in [sample][timestep][dim] format
  let leftFilteredPathlines: number[][][] = [];
  let rightFilteredPathlines: number[][][] = [];
  const pathlineSpacingOptions = {
    dMin: 0.12, // Minimum spacing distance
  };

  // ===== LAYOUT =====
  let canvasWidth = 400;
  let canvasHeight = 400;
  let marginWidth = 10;
  let marginHeight = 10;
  let gap = 20;
  let domainRange = { xMin: -2.0, xMax: 2.0, yMin: -2.0, yMax: 2.0 };

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
  let trajectoryOpacity = settings.stylingSettings.trajectory.progressOpacity;

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

  function scalePathlines(pathlines: number[][][]): number[][][] {
    if (!xScale || !yScale || !pathlines || pathlines.length === 0) return [];
    return pathlines.map((pathline) =>
      pathline.map((point) => [xScale(point[0]), yScale(point[1])])
    );
  }

  function precomputeCoordinates() {
    if (!xScale || !yScale) return;

    scaledTargetDistribution = targetDistribution.map((p) => [
      xScale(p[0]),
      yScale(p[1]),
    ]);
    // Scale the filtered pathlines (already in [sample][timestep][dim] format)
    scaledLeftTrajectories = scalePathlines(leftFilteredPathlines);
    scaledRightTrajectories = scalePathlines(rightFilteredPathlines);
  }

  function draw(
    ctx: CanvasRenderingContext2D,
    scaledTrajectories: number[][][],
    segmentIndex: number
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

    // Draw trajectories as simple lines up to segmentIndex
    ctx.strokeStyle = trajectoryColor;
    ctx.lineWidth = trajectoryStrokeWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = trajectoryOpacity;

    for (const trajectory of scaledTrajectories) {
      const endIdx = Math.min(segmentIndex + 1, trajectory.length);
      if (endIdx < 2) continue;

      ctx.beginPath();
      ctx.moveTo(trajectory[0][0], trajectory[0][1]);
      for (let i = 1; i < endIdx; i++) {
        ctx.lineTo(trajectory[i][0], trajectory[i][1]);
      }
      ctx.stroke();
    }

    ctx.globalAlpha = 1.0;
  }

  function initializeVisualization() {
    if (!leftCanvas || !rightCanvas || !isDataValid) {
      return;
    }

    initializeScales();
    initializeCanvas();
    precomputeCoordinates();
    pathsInitialized = true;
    updateVisualization();
    isInitialized = true;
  }

  function updateVisualization() {
    if (!isDataValid || !leftCtx || !rightCtx) return;

    draw(leftCtx, scaledLeftTrajectories, currentSegmentIndex);
    draw(rightCtx, scaledRightTrajectories, currentSegmentIndex);
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

  // Use afterUpdate to initialize visualization after DOM has updated
  afterUpdate(() => {
    if (isDataValid && leftCanvas && rightCanvas && !isInitialized) {
      initializeVisualization();
    }
  });

  // Re-precompute coordinates when filtered pathlines change
  $: if (isInitialized && leftFilteredPathlines.length > 0 && rightFilteredPathlines.length > 0) {
    precomputeCoordinates();
    updateVisualization();
  }

  $: if (isPlaying && pathsInitialized && !animationFrameId) startAnimation();
  $: if (!isPlaying && animationFrameId) stopAnimation();

  $: if (figureIsActive !== undefined && isInitialized) {
    handleVisibilityChange($figureIsActive);
  }

  // ===== TRAJECTORY GENERATION =====

  // Configuration for trajectory generation
  const numRandomSamples = 2000;
  const numSteps = 300;

  // Training state
  let isTraining = false;
  let trainingWorker: Worker | null = null;
  let rectifiedTrainingWorker: Worker | null = null;
  let flowMatchingModelPath: string | null = null;
  let rectifiedFlowModelPath: string | null = null;

  // Configuration for uniform grid generation
  const uniformGridResolution = 45; // 45x45 = 2025 samples
  const uniformGridDomainRange = { xMin: -2.0, xMax: 2.0, yMin: -2.0, yMax: 2.0 };

  // Toggle for initial point source: 'random' or 'grid'
  type InitialPointSource = 'random' | 'grid';
  let initialPointSource: InitialPointSource = 'random';

  // Configuration for dense grid sampling (manual override button)
  const denseGridResolution = 50;
  const denseGridNumSteps = 100;
  const denseGridDomainRange = { xMin: -2.5, xMax: 2.5, yMin: -2.5, yMax: 2.5 };

  let isGenerating = false;
  let generationStatus = "";

  /**
   * Clip samples to the display domain range so trajectories don't start off screen
   */
  function clipSamplesToDomain(samples: number[][]): number[][] {
    const { xMin, xMax, yMin, yMax } = domainRange;
    return samples.filter(point =>
      point[0] >= xMin && point[0] <= xMax &&
      point[1] >= yMin && point[1] <= yMax
    );
  }

  /**
   * Train a flow matching model
   */
  async function trainFlowMatchingModel(): Promise<string> {
    generationStatus = "Training flow matching model...";
    isTraining = true;

    const result = await train.trainModel(
      settings.trainingSettings,
      settings.trainWorkerUrl,
      () => { isTraining = true; },
      () => { isTraining = false; }
    );

    trainingWorker = result.worker;
    flowMatchingModelPath = result.modelPath;
    return result.modelPath;
  }

  /**
   * Train a rectified flow model
   */
  async function trainRectifiedFlowModel(): Promise<string> {
    generationStatus = "Training rectified flow model...";
    isTraining = true;

    const result = await train.trainRectifiedFlow(
      settings.trainingSettings,
      settings.trainWorkerUrl
    );

    rectifiedTrainingWorker = result.worker;
    rectifiedFlowModelPath = result.data.modelPath;
    isTraining = false;
    return result.data.modelPath;
  }

  /**
   * Generate trajectories from specific initial points using the sampling worker
   */
  function generateFromInitialPoints(
    modelPath: string,
    initialPoints: number[][]
  ): Promise<number[][][]> {
    return new Promise((resolve) => {
      callSamplingWorkerThreadFromInitialPoints(
        settings.samplingWorkerUrl,
        modelPath,
        "Flow Matching",
        settings.trainingSettings.modelConfig,
        initialPoints,
        numSteps,
        (allSamples: number[][][]) => {
          resolve(allSamples);
        },
        settings.trainingSettings.domainRange
      );
    });
  }

  /**
   * Generate uniform grid samples
   */
  function generateUniformGridSamples(): number[][] {
    const samples: number[][] = [];
    const { xMin, xMax, yMin, yMax } = uniformGridDomainRange;

    for (let i = 0; i < uniformGridResolution; i++) {
      for (let j = 0; j < uniformGridResolution; j++) {
        const x = xMin + (xMax - xMin) * (i / (uniformGridResolution - 1));
        const y = yMin + (yMax - yMin) * (j / (uniformGridResolution - 1));
        samples.push([x, y]);
      }
    }
    return samples;
  }

  /**
   * Generate trajectories for both panels on page load
   * Uses either random Gaussian samples or uniform grid based on initialPointSource
   * Trains models from scratch instead of loading from files
   */
  async function generateTrajectories() {
    isGenerating = true;
    generationStatus = "Starting...";

    try {
      // Train flow matching model if not already trained
      if (!flowMatchingModelPath) {
        flowMatchingModelPath = await trainFlowMatchingModel();
      }

      // Train rectified flow model if not already trained
      if (!rectifiedFlowModelPath) {
        rectifiedFlowModelPath = await trainRectifiedFlowModel();
      }

      // Generate shared initial points for both models
      generationStatus = "Generating initial points...";
      let initialPoints = initialPointSource === 'grid'
        ? generateUniformGridSamples()
        : sample.generateClippedGaussianSamples(numRandomSamples);

      // Clip samples to domain so trajectories don't start off screen
      initialPoints = clipSamplesToDomain(initialPoints);

      // Generate Flow Matching trajectories (left panel)
      generationStatus = "Generating Flow Matching trajectories...";
      leftTrajectories = await generateFromInitialPoints(flowMatchingModelPath, initialPoints);

      // Generate Rectified Flow trajectories (right panel)
      generationStatus = "Generating Rectified Flow trajectories...";
      rightTrajectories = await generateFromInitialPoints(rectifiedFlowModelPath, initialPoints);

      // Use final timestep as target distribution
      if (leftTrajectories.length > 0) {
        targetDistribution = leftTrajectories[leftTrajectories.length - 1];
      }

      // Run spatial filtering
      runPathlineFiltering();

      generationStatus = "Done!";
      isLoading = false;
    } catch (error) {
      loadError =
        error instanceof Error
          ? error.message
          : "Failed to generate trajectories";
      console.error("Error generating trajectories:", error);
      isLoading = false;
    } finally {
      isGenerating = false;
    }
  }

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
   * Transpose pathlines from [sample][timestep][dim] back to [timestep][sample][dim]
   */
  function transposePathlinesToTimesteps(pathlines: number[][][]): number[][][] {
    if (pathlines.length === 0) return [];
    const numSamples = pathlines.length;
    const numTimesteps = pathlines[0].length;

    return Array.from({ length: numTimesteps }, (_, t) =>
      Array.from({ length: numSamples }, (_, s) => pathlines[s][t])
    );
  }

  /**
   * Run independent spatial pathline filtering on each trajectory set
   */
  function runPathlineFiltering() {
    if (leftTrajectories.length === 0 || rightTrajectories.length === 0) {
      return;
    }

    // Transpose from [timestep][sample][dim] to [sample][timestep][dim]
    const leftTransposed = transposeTrajectories(leftTrajectories);
    const rightTransposed = transposeTrajectories(rightTrajectories);

    // Run independent filtering on each set
    leftFilteredPathlines = generateSpatiallySpacedPathlines(
      leftTransposed,
      pathlineSpacingOptions
    );
    rightFilteredPathlines = generateSpatiallySpacedPathlines(
      rightTransposed,
      pathlineSpacingOptions
    );

    // Download filtered trajectory sets (transpose back to [timestep][sample][dim] format)
    // Flow matching: raw array format
    downloadJSON(transposePathlinesToTimesteps(leftFilteredPathlines), 'flow_matching_filtered_pathlines.json');
    // Rectified flow: RectifiedFlowData format with allRectifiedTrajectories
    downloadJSON(
      {
        allRectifiedTrajectories: [transposePathlinesToTimesteps(rightFilteredPathlines)],
        modelPath: rectifiedFlowModelPath || 'trained'
      },
      'rectified_flow_filtered_pathlines.json'
    );
  }

  // ===== LIFECYCLE =====

  onMount(() => {
    generateTrajectories();
  });

  onDestroy(() => {
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
    }
    if (trainingWorker) {
      trainingWorker.terminate();
    }
    if (rectifiedTrainingWorker) {
      rectifiedTrainingWorker.terminate();
    }
  });
</script>

<div class="page-container">
  <h1>Pathlines Test Page</h1>

  <div class="controls">
    <div class="button-group">
      <button
        onclick={() => { initialPointSource = 'random'; generateTrajectories(); }}
        disabled={isGenerating || isTraining}
        class="generate-button"
        class:active={initialPointSource === 'random'}
      >
        Random Points
      </button>
      <button
        onclick={() => { initialPointSource = 'grid'; generateTrajectories(); }}
        disabled={isGenerating || isTraining}
        class="generate-button"
        class:active={initialPointSource === 'grid'}
      >
        Uniform Grid
      </button>
    </div>
    {#if generationStatus}
      <span class="status">{generationStatus}</span>
    {/if}
  </div>

  {#if isLoading || isTraining}
    <div class="loading">
      {generationStatus || (isTraining ? "Training models..." : "Generating trajectories...")}
    </div>
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
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1.5rem;
  }

  .button-group {
    display: flex;
    gap: 0.5rem;
  }

  .generate-button {
    padding: 0.6rem 1.25rem;
    font-size: 0.95rem;
    background-color: #e5e7eb;
    color: #374151;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    transition: background-color 0.2s, color 0.2s;
  }

  .generate-button:hover:not(:disabled) {
    background-color: #d1d5db;
  }

  .generate-button.active {
    background-color: #3b82f6;
    color: white;
  }

  .generate-button.active:hover:not(:disabled) {
    background-color: #2563eb;
  }

  .generate-button:disabled {
    background-color: #9ca3af;
    color: white;
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
