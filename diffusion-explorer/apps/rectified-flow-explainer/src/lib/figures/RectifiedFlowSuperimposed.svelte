<script>
  import { onMount, onDestroy } from "svelte";
  import * as d3 from "d3";
  import DoubleFigure from "$lib/components/DoubleFigure.svelte";
  import TimeSlider from "$lib/components/TimeSlider.svelte";
  import { settings } from "$lib/settings";
  import { drawScatterPlot } from "$lib/canvas/plotting";
  import { drawTrajectoriesWithOpacityGradient } from "$lib/canvas/trajectories";

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
  export let domainRange = { xMin: -1.7, xMax: 1.7, yMin: -1.7, yMax: 1.7 };

  // Labels
  export let leftLabel = "Flow Matching";
  export let rightLabel = "Rectified Flow";
  export let labelFontSize = 26;
  export let labelColor = settings.stylingSettings.label.color;

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
  export let animationDuration = 8000;
  export let pauseDuration = 1000;
  export let playingByDefault = true;

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
  $: msPerSegment = numSegments > 0 ? animationDuration / numSegments : animationDuration;

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

  // Visibility
  let figureIsActive;
  let wasPlayingBeforeHidden = false;

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

  // Draw scatter plot + trajectories
  function draw(ctx, trajectories, segmentIndex) {
    if (!ctx || !xScale || !yScale) return;

    // Clear previous frame
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // Draw target distribution scatter (behind trajectories)
    drawScatterPlot(ctx, targetDistribution, xScale, yScale, targetPointRadius, targetColor, targetOpacity);

    // Draw trajectories with opacity gradient
    drawTrajectoriesWithOpacityGradient(ctx, trajectories, segmentIndex, xScale, yScale, {
      strokeWidth: trajectoryStrokeWidth,
      color: trajectoryColor,
      progressOpacity: trajectoryProgressOpacity,
      pointRadius: trajectoryPointRadius,
      showPreview: showTrajectoryPreview,
      previewOpacity: trajectoryFullOpacity
    }, alphaTimeWindow);
  }

  function initializeVisualization() {
    if (!leftCanvas || !rightCanvas || !isDataValid) return;

    initializeScales();
    initializeCanvas();
    pathsInitialized = true;
    updateVisualization();
    isInitialized = true;
    onInitialized?.();
  }

  function updateVisualization() {
    if (!isDataValid || !leftCtx || !rightCtx) return;

    draw(leftCtx, leftTrajectories, currentSegmentIndex);
    draw(rightCtx, rightTrajectories, currentSegmentIndex);
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

    // Accumulate time and advance segments one at a time
    segmentAccumulator += elapsed;
    while (segmentAccumulator >= msPerSegment && currentSegmentIndex < numSegments) {
      segmentAccumulator -= msPerSegment;
      currentSegmentIndex += 1;
    }

    // Keep time in sync for slider display
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
    // When user drags the slider, stop playback
    if (isPlaying) {
      isPlaying = false;
      stopAnimation();
    }
    // Convert slider time value to segment index
    currentSegmentIndex = Math.round(time * numSegments);
    segmentAccumulator = 0;
    updateVisualization();
  }

  // ===== REACTIVE EFFECTS =====

  $: if (isDataValid && leftCanvas && rightCanvas && !isInitialized) {
    initializeVisualization();
  }

  $: if (isPlaying && pathsInitialized && !animationFrameId) startAnimation();
  $: if (!isPlaying && animationFrameId) stopAnimation();

  // ===== LIFECYCLE =====

  onMount(() => {
    // Scales and animation are handled by the reactive statement
  });

  onDestroy(() => {
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
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
        <canvas
          bind:this={leftCanvas}
          class="panel-canvas"
        ></canvas>
      </div>
    {/snippet}

    {#snippet right()}
      <div class="panel-container" style="max-width: {canvasWidth}px;">
        <div class="panel-label" style="font-size: {labelFontSize}px; color: {labelColor};">
          {rightLabel}
        </div>
        <canvas
          bind:this={rightCanvas}
          class="panel-canvas"
        ></canvas>
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
</style>
