<script>
  import { onMount, onDestroy } from "svelte";
  import * as d3 from "d3";
  import DoubleFigure from "$lib/components/DoubleFigure.svelte";
  import TimeSlider from "$lib/components/TimeSlider.svelte";
  import { settings } from "$lib/settings";
  import { drawScatterPlot } from "$lib/plotting/plotting";
  import { callSamplingWorkerThreadFromInitialPoints } from "@diffusion-explorer/diffusion";

  // ===== PROPS =====

  // Data
  export let leftTrajectories = [];  // [timestep][sample][dim]
  export let rightTrajectories = []; // [timestep][sample][dim]
  export let targetDistribution = [];

  // Layout
  export let canvasWidth = 400;
  export let canvasHeight = 400;
  export let marginWidth = 10;
  export let marginHeight = 10;
  export let gap = 20;
  export let domainRange = { xMin: -1.9, xMax: 1.9, yMin: -1.9, yMax: 1.9 };

  // Labels
  export let leftLabel = "Flow Matching";
  export let rightLabel = "Rectified Flow";
  export let labelFontSize = 30;
  export let labelColor = settings.stylingSettings.label.color;

  // Subtitles
  export let leftSubtitle = "Curved Paths Flow Slow";
  export let rightSubtitle = "Straight Paths Flow Fast";
  export let subtitleFontSize = 26;
  export let subtitleColor = settings.stylingSettings.label.color;

  // Target distribution styling
  export let targetColor = "#3b82f6";
  export let targetOpacity = 0.35;
  export let targetPointRadius = 5;

  // Trajectory styling
  export let trajectoryColor = settings.stylingSettings.trajectory.color;
  export let trajectoryStrokeWidth = settings.stylingSettings.trajectory.strokeWidth;
  export let trajectoryPointRadius = settings.stylingSettings.trajectory.pointRadius;
  export let trajectoryProgressOpacity = settings.stylingSettings.trajectory.progressOpacity;
  export let trajectoryFullOpacity = settings.stylingSettings.trajectory.fullOpacity;
  export let showTrajectoryPreview = false;
  export let alphaTimeWindow = 0.8; // Fraction (0-1) of trajectory visible with fade

  // Animation
  export let leftAnimationDuration = 10000;
  export let rightAnimationDuration = 5000;
  export let pauseDuration = 2000;
  export let playingByDefault = true;

  // Interactive sampling
  export let samplingSteps = 200;
  export let highlightedTrajectoryOpacity = 1.0;
  export let dimmedTrajectoryOpacity = 0.15;

  // Callbacks & misc
  export let onInitialized = undefined;
  export let backgroundVisible = true;
  export let children = undefined;

  // ===== DERIVED FROM PROPS =====

  $: caption = children;
  $: isDataValid =
    leftTrajectories?.length > 0 &&
    rightTrajectories?.length > 0 &&
    targetDistribution?.length > 0;
  $: numTimeSteps = isDataValid ? leftTrajectories.length : 1;
  $: numSegments = numTimeSteps - 1;
  $: leftMsPerSegment = numSegments > 0 ? leftAnimationDuration / numSegments : leftAnimationDuration;
  $: rightMsPerSegment = numSegments > 0 ? rightAnimationDuration / numSegments : rightAnimationDuration;

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

  // Animation - Shared state
  let isPlaying = playingByDefault;
  let leftFinished = false;
  let rightFinished = false;
  let restartPauseStartTime = null;

  // Animation - Left
  let leftTime = 0;
  let leftCurrentSegmentIndex = 0;
  let leftSegmentAccumulator = 0;
  let leftAnimationFrameId = null;
  let leftLastTimestamp = null;

  // Animation - Right
  let rightTime = 0;
  let rightCurrentSegmentIndex = 0;
  let rightSegmentAccumulator = 0;
  let rightAnimationFrameId = null;
  let rightLastTimestamp = null;

  // Initialization
  let isInitialized = false;
  let pathsInitialized = false;

  // Pre-computed pixel coordinates (scaled once upfront)
  let scaledTargetDistribution = [];  // [point][x,y] in pixels - target distribution
  let scaledLeftTrajectories = [];    // [trajectory][timestep][x,y] in pixels
  let scaledRightTrajectories = [];   // [trajectory][timestep][x,y] in pixels

  // Visibility
  let figureIsActive;
  let wasPlayingBeforeHidden = false;

  // User-clicked trajectory state
  let leftClickedTrajectory = null;   // [timestep][x,y] in pixels
  let rightClickedTrajectory = null;
  let hasClickedTrajectory = false;

  // ===== FUNCTIONS =====

  function initializeScales() {
    if (!isDataValid) return;

    const { xMin, xMax, yMin, yMax } = domainRange;

    // Create scales with no translation
    xScale = d3
      .scaleLinear()
      .domain([xMin, xMax])
      .range([marginWidth, canvasWidth - marginWidth]);

    yScale = d3
      .scaleLinear()
      .domain([yMin, yMax])
      .range([marginHeight, canvasHeight - marginHeight]);
  }

  // Initialize canvas contexts with high-DPI support
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

  // Transpose trajectories from [timestep][sample][dim] to [sample][timestep][x,y] and scale to pixels
  function transposeAndScale(trajectories) {
    if (!xScale || !yScale || !trajectories || trajectories.length === 0) return [];
    const numSamples = trajectories[0]?.length || 0;
    return Array.from({ length: numSamples }, (_, i) =>
      trajectories.map(ts => [xScale(ts[i][0]), yScale(ts[i][1])])
    );
  }

  // Pre-compute all coordinates in pixel space (called once after scales are initialized)
  function precomputeCoordinates() {
    if (!xScale || !yScale) return;

    // Scale and transpose trajectories
    scaledLeftTrajectories = transposeAndScale(leftTrajectories);
    scaledRightTrajectories = transposeAndScale(rightTrajectories);

    // Scale target distribution
    scaledTargetDistribution = targetDistribution.map(p => [xScale(p[0]), yScale(p[1])]);
  }

  // Draw scatter plot + trajectories (using pre-scaled pixel coordinates)
  function draw(ctx, scaledTrajectories, segmentIndex, clickedTrajectory, time) {
    if (!ctx) return;

    // Clear previous frame
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // Draw target distribution as scatter (behind trajectories)
    drawScatterPlot(ctx, scaledTargetDistribution, targetPointRadius, targetColor, targetOpacity);

    // Draw default trajectories (dimmed if user has clicked)
    const defaultOpacity = hasClickedTrajectory ? dimmedTrajectoryOpacity : trajectoryProgressOpacity;
    ctx.strokeStyle = trajectoryColor;
    ctx.lineWidth = trajectoryStrokeWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = defaultOpacity;

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

    // Draw clicked trajectory (highlighted) - sync with time proportion
    if (clickedTrajectory && clickedTrajectory.length > 0) {
      ctx.globalAlpha = highlightedTrajectoryOpacity;
      ctx.lineWidth = trajectoryStrokeWidth;
      // Calculate segment index based on time (0-1) to sync with animation
      const clickedNumSegments = clickedTrajectory.length - 1;
      const clickedSegmentIndex = Math.floor(time * clickedNumSegments);
      const endIdx = Math.min(clickedSegmentIndex + 1, clickedTrajectory.length);
      if (endIdx >= 2) {
        ctx.beginPath();
        ctx.moveTo(clickedTrajectory[0][0], clickedTrajectory[0][1]);
        for (let i = 1; i < endIdx; i++) {
          ctx.lineTo(clickedTrajectory[i][0], clickedTrajectory[i][1]);
        }
        ctx.stroke();
      }
    }

    ctx.globalAlpha = 1.0;
  }

  function initializeVisualization() {
    if (!leftCanvas || !rightCanvas || !isDataValid) return;

    initializeScales();
    initializeCanvas();
    precomputeCoordinates();
    pathsInitialized = true;
    updateLeftVisualization();
    updateRightVisualization();
    isInitialized = true;
    onInitialized?.();
  }

  function updateLeftVisualization() {
    if (!isDataValid || !leftCtx) return;
    draw(leftCtx, scaledLeftTrajectories, leftCurrentSegmentIndex, leftClickedTrajectory, leftTime);
  }

  function updateRightVisualization() {
    if (!isDataValid || !rightCtx) return;
    draw(rightCtx, scaledRightTrajectories, rightCurrentSegmentIndex, rightClickedTrajectory, rightTime);
  }

  // Synchronized restart check (called from both animate functions)
  function checkSynchronizedRestart(ts) {
    if (leftFinished && rightFinished) {
      if (restartPauseStartTime === null) {
        restartPauseStartTime = ts;
      } else if (ts - restartPauseStartTime >= pauseDuration) {
        // Reset both animations
        leftFinished = false;
        rightFinished = false;
        restartPauseStartTime = null;
        leftCurrentSegmentIndex = 0;
        leftSegmentAccumulator = 0;
        leftTime = 0;
        rightCurrentSegmentIndex = 0;
        rightSegmentAccumulator = 0;
        rightTime = 0;
        updateLeftVisualization();
        updateRightVisualization();
      }
    }
  }

  // Left animation
  function animateLeft(ts) {
    if (!isPlaying) {
      leftAnimationFrameId = null;
      return;
    }
    if (leftLastTimestamp === null) leftLastTimestamp = ts;
    const elapsed = ts - leftLastTimestamp;
    leftLastTimestamp = ts;

    // Check for synchronized restart
    checkSynchronizedRestart(ts);

    // If already finished, just keep the animation frame going for restart check
    if (leftFinished) {
      leftAnimationFrameId = requestAnimationFrame(animateLeft);
      return;
    }

    leftSegmentAccumulator += elapsed;
    while (leftSegmentAccumulator >= leftMsPerSegment && leftCurrentSegmentIndex < numSegments) {
      leftSegmentAccumulator -= leftMsPerSegment;
      leftCurrentSegmentIndex += 1;
    }

    leftTime = numSegments > 0 ? leftCurrentSegmentIndex / numSegments : 0;
    updateLeftVisualization();

    if (leftCurrentSegmentIndex >= numSegments) {
      leftFinished = true;
    }

    leftAnimationFrameId = requestAnimationFrame(animateLeft);
  }

  function startLeftAnimation() {
    if (leftAnimationFrameId !== null) return;
    leftLastTimestamp = null;
    leftAnimationFrameId = requestAnimationFrame(animateLeft);
  }

  function stopLeftAnimation() {
    if (leftAnimationFrameId !== null) {
      cancelAnimationFrame(leftAnimationFrameId);
      leftAnimationFrameId = null;
    }
  }

  // Unified toggle for both animations
  function togglePlayPause() {
    isPlaying = !isPlaying;
    if (!isPlaying) {
      stopLeftAnimation();
      stopRightAnimation();
    }
  }

  // Right animation
  function animateRight(ts) {
    if (!isPlaying) {
      rightAnimationFrameId = null;
      return;
    }
    if (rightLastTimestamp === null) rightLastTimestamp = ts;
    const elapsed = ts - rightLastTimestamp;
    rightLastTimestamp = ts;

    // Check for synchronized restart
    checkSynchronizedRestart(ts);

    // If already finished, just keep the animation frame going for restart check
    if (rightFinished) {
      rightAnimationFrameId = requestAnimationFrame(animateRight);
      return;
    }

    rightSegmentAccumulator += elapsed;
    while (rightSegmentAccumulator >= rightMsPerSegment && rightCurrentSegmentIndex < numSegments) {
      rightSegmentAccumulator -= rightMsPerSegment;
      rightCurrentSegmentIndex += 1;
    }

    rightTime = numSegments > 0 ? rightCurrentSegmentIndex / numSegments : 0;
    updateRightVisualization();

    if (rightCurrentSegmentIndex >= numSegments) {
      rightFinished = true;
    }

    rightAnimationFrameId = requestAnimationFrame(animateRight);
  }

  function startRightAnimation() {
    if (rightAnimationFrameId !== null) return;
    rightLastTimestamp = null;
    rightAnimationFrameId = requestAnimationFrame(animateRight);
  }

  function stopRightAnimation() {
    if (rightAnimationFrameId !== null) {
      cancelAnimationFrame(rightAnimationFrameId);
      rightAnimationFrameId = null;
    }
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

  // Handle canvas click - convert to domain coordinates and sample
  function handleCanvasClick(event, side) {
    if (!settings.samplingWorkerUrl || !settings.flowMatchingModelPath || !settings.rectifiedFlowModelPath) return;

    const canvas = side === 'left' ? leftCanvas : rightCanvas;
    const rect = canvas.getBoundingClientRect();

    // Get click position in CSS pixels (account for canvas scaling)
    const scaleX = canvasWidth / rect.width;
    const scaleY = canvasHeight / rect.height;
    const clickX = (event.clientX - rect.left) * scaleX;
    const clickY = (event.clientY - rect.top) * scaleY;

    // Convert to domain coordinates using scale.invert()
    const domainX = xScale.invert(clickX);
    const domainY = yScale.invert(clickY);

    // Trigger sampling for both panels from the same point
    sampleFromPoint([domainX, domainY]);
  }

  // Sample trajectory from a specific point using both models (streaming)
  function sampleFromPoint(point) {
    hasClickedTrajectory = true;

    // Initialize trajectories with the initial click point (scaled to pixels)
    const initialPixelPoint = [xScale(point[0]), yScale(point[1])];
    leftClickedTrajectory = [initialPixelPoint];
    rightClickedTrajectory = [initialPixelPoint];

    // Reset and start animation immediately
    leftCurrentSegmentIndex = 0;
    rightCurrentSegmentIndex = 0;
    leftSegmentAccumulator = 0;
    rightSegmentAccumulator = 0;
    leftTime = 0;
    rightTime = 0;
    leftFinished = false;
    rightFinished = false;
    restartPauseStartTime = null;
    leftLastTimestamp = null;
    rightLastTimestamp = null;
    isPlaying = true;

    // Sample from left model (Flow Matching) with streaming
    callSamplingWorkerThreadFromInitialPoints(
      settings.samplingWorkerUrl,
      settings.flowMatchingModelPath,
      'Flow Matching',
      settings.trainingSettings.modelConfig,
      [point],
      samplingSteps,
      () => {}, // onComplete - not used since we build trajectory via onStep
      settings.trainingSettings.domainRange,
      {},
      // onStep callback - append each new point as it arrives
      (_step, x_t) => {
        const newPoint = [xScale(x_t[0][0]), yScale(x_t[0][1])];
        leftClickedTrajectory = [...leftClickedTrajectory, newPoint];
      }
    );

    // Sample from right model (Rectified Flow) with streaming
    callSamplingWorkerThreadFromInitialPoints(
      settings.samplingWorkerUrl,
      settings.rectifiedFlowModelPath,
      'Flow Matching',
      settings.trainingSettings.modelConfig,
      [point],
      samplingSteps,
      () => {}, // onComplete - not used since we build trajectory via onStep
      settings.trainingSettings.domainRange,
      {},
      // onStep callback - append each new point as it arrives
      (_step, x_t) => {
        const newPoint = [xScale(x_t[0][0]), yScale(x_t[0][1])];
        rightClickedTrajectory = [...rightClickedTrajectory, newPoint];
      }
    );
  }

  // ===== REACTIVE EFFECTS =====

  $: if (isDataValid && leftCanvas && rightCanvas && !isInitialized) {
    initializeVisualization();
  }

  $: if (isPlaying && pathsInitialized && !leftAnimationFrameId) startLeftAnimation();
  $: if (!isPlaying && leftAnimationFrameId) stopLeftAnimation();

  $: if (isPlaying && pathsInitialized && !rightAnimationFrameId) startRightAnimation();
  $: if (!isPlaying && rightAnimationFrameId) stopRightAnimation();

  // Handle visibility changes (pause when off-screen, resume when back)
  $: if (figureIsActive !== undefined && isInitialized) {
    handleVisibilityChange($figureIsActive);
  }

  // ===== LIFECYCLE =====

  onMount(() => {
    // Scales and animation are handled by the reactive statement
  });

  onDestroy(() => {
    if (leftAnimationFrameId) {
      cancelAnimationFrame(leftAnimationFrameId);
    }
    if (rightAnimationFrameId) {
      cancelAnimationFrame(rightAnimationFrameId);
    }
  });
</script>

{#if isDataValid}
  <DoubleFigure {gap} {caption} {backgroundVisible} bind:isActive={figureIsActive}>
    {#snippet left()}
      <div class="panel-container" style="max-width: {canvasWidth}px;">
        <div class="panel-label" style="font-size: {labelFontSize}px; color: {labelColor};">
          {leftLabel}
        </div>
        <div class="panel-subtitle" style="font-size: {subtitleFontSize}px; color: {subtitleColor};">
          {leftSubtitle}
        </div>
        <canvas
          bind:this={leftCanvas}
          class="panel-canvas"
          onclick={(e) => handleCanvasClick(e, 'left')}
          style="cursor: pointer;"
        ></canvas>
        <div class="slider-wrapper">
          <TimeSlider
            bind:value={leftTime}
            isPlaying={isPlaying}
            min={0}
            max={1}
            onTogglePlay={togglePlayPause}
            color="#f17720"
            showTicks={false}
            showTimeLabel={false}
            dragEnabled={false}
          />
        </div>
        <div class="duration-label">Sampling Duration</div>
      </div>
    {/snippet}

    {#snippet right()}
      <div class="panel-container" style="max-width: {canvasWidth}px;">
        <div class="panel-label" style="font-size: {labelFontSize}px; color: {labelColor};">
          {rightLabel}
        </div>
        <div class="panel-subtitle" style="font-size: {subtitleFontSize}px; color: {subtitleColor};">
          {rightSubtitle}
        </div>
        <canvas
          bind:this={rightCanvas}
          class="panel-canvas"
          onclick={(e) => handleCanvasClick(e, 'right')}
          style="cursor: pointer;"
        ></canvas>
        <div class="slider-wrapper">
          <TimeSlider
            bind:value={rightTime}
            isPlaying={isPlaying}
            min={0}
            max={1}
            onTogglePlay={togglePlayPause}
            color="#f17720"
            showTicks={false}
            showTimeLabel={false}
            dragEnabled={false}
          />
        </div>
        <div class="duration-label">Sampling Duration</div>
      </div>
    {/snippet}
  </DoubleFigure>
{:else}
  <div class="placeholder">
    <p>
      Rectified flow superimposed visualization requires rectified flow data
      with at least 2 steps.
    </p>
  </div>
{/if}

<style>
  .panel-container {
    width: 100%;
  }

  .panel-label {
    text-align: center;
    padding-bottom: 4px;
    font-weight: 500;
  }

  .panel-subtitle {
    text-align: center;
    white-space: nowrap;
    font-weight: 200;
  }

  .duration-label {
    text-align: center;
    font-size: 16px;
    font-family: Helvetica, sans-serif;
    color: #7b7b7b;
    opacity: 0.6;
    padding-left: 25px;
    margin-top: -14px;
  }

  .panel-canvas {
    width: 100%;
    height: auto;
    display: block;
  }

  .slider-wrapper {
    padding-left: 30px;
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
    .panel-subtitle {
      font-size: 13px !important;
    }
    .slider-wrapper {
      padding-left: 0;
    }
    .duration-label {
      font-size: 12px;
      padding-left: 15px;
    }
  }

  @media (max-width: 400px) {
    .panel-label {
      font-size: 16px !important;
    }
    .panel-subtitle {
      font-size: 11px !important;
    }
  }
</style>
