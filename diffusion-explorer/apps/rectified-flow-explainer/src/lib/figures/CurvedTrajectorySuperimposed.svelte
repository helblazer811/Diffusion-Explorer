<script>
  import { onMount, onDestroy } from "svelte";
  import * as d3 from "d3";
  import { Figure, TimeSlider, drawScatterPlot, drawTrajectoriesWithPreview } from "@diffusion-explorer/ui";
  import { settings } from "$lib/settings";
  import { FlowModelClient } from "@diffusion-explorer/diffusion";

  // Create sampling client
  const flowMatchingClient = new FlowModelClient(
    settings.flowModelWorkerUrl,
    settings.flowMatchingModelPath,
    "Flow Matching",
    settings.trainingSettings.modelConfig,
    settings.trainingSettings.domainRange
  );

  // ===== PROPS =====

  // Caption slot
  export let children = undefined;

  // Data
  export let trajectories = []; // [timestep][sample][dim]
  export let targetDistribution = [];

  // Layout
  export let marginWidth = 20;
  export let marginHeight = 20;
  export let canvasWidth = 450;
  export let canvasHeight = 450;
  export let domainRange = { xMin: -1.7, xMax: 1.7, yMin: -1.7, yMax: 1.7 };

  // Target distribution styling
  export let targetColor = "#3b82f6";
  export let targetOpacity = 0.35;
  export let distributionPointRadius = 5;

  // Trajectory styling
  export let trajectoryColor = settings.stylingSettings.trajectory.color;
  export let trajectoryStrokeWidth = settings.stylingSettings.trajectory.strokeWidth;
  export let trajectoryPointRadius = settings.stylingSettings.trajectory.endpointRadius;
  export let trajectoryProgressOpacity = settings.stylingSettings.trajectory.progressOpacity;
  export let trajectoryFullOpacity = settings.stylingSettings.trajectory.fullOpacity;
  export let showTrajectoryPreview = false;
  export let alphaTimeWindow = 0.8; // Fraction (0-1) of trajectory visible with fade
  export let endpointRadius = settings.stylingSettings.trajectory.endpointRadius;

  // Animation
  export let animationDuration = 5000;
  export let pauseDuration = 1000;
  export let playingByDefault = true;

  // Interactive sampling
  export let maxUserTrajectories = settings.interactiveSettings.maxUserTrajectories;

  // Background
  export let backgroundVisible = true;

  // ===== DERIVED =====

  $: caption = children;
  $: isDataValid =
    trajectories?.length > 0 &&
    targetDistribution?.length > 0;
  $: numTimeSteps = isDataValid ? trajectories.length : 1;
  $: numSegments = numTimeSteps - 1;
  $: msPerSegment = numSegments > 0 ? animationDuration / numSegments : animationDuration;

  // ===== STATE =====

  // Canvas
  let canvas;
  let ctx;
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

  // Visibility tracking
  let figureIsActive;
  let wasPlayingBeforeHidden = false;

  // Pre-computed coordinates
  let scaledTargetDistribution = [];
  let scaledTrajectories = [];

  // User-defined trajectory state (supports multiple trajectories)
  let userStartPoints = []; // Array of [x, y] domain coordinates
  let userTrajectories = []; // Array of trajectories, each is [timestep][x,y] in pixels
  let hasUserTrajectory = false;
  let isStreamingTrajectory = false;
  let activeRequestId = null; // Track active request for cancellation

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
    if (!canvas) return;

    dpr = window.devicePixelRatio || 1;
    canvas.width = canvasWidth * dpr;
    canvas.height = canvasHeight * dpr;
    ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
  }

  function transposeAndScale(traj) {
    if (!xScale || !yScale || !traj?.length) return [];
    const numSamples = traj[0]?.length || 0;
    return Array.from({ length: numSamples }, (_, i) =>
      traj.map(ts => [xScale(ts[i][0]), yScale(ts[i][1])])
    );
  }

  function precomputeCoordinates() {
    if (!xScale || !yScale) return;

    scaledTargetDistribution = targetDistribution.map(p => [xScale(p[0]), yScale(p[1])]);
    scaledTrajectories = transposeAndScale(trajectories);
  }

  // Handle canvas click - convert to domain coordinates and sample
  function handleCanvasClick(event) {
    if (!settings.flowModelWorkerUrl || !settings.flowMatchingModelPath) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvasWidth / rect.width;
    const scaleY = canvasHeight / rect.height;
    const clickX = (event.clientX - rect.left) * scaleX;
    const clickY = (event.clientY - rect.top) * scaleY;

    // Convert to domain coordinates using scale.invert()
    const domainX = xScale.invert(clickX);
    const domainY = yScale.invert(clickY);

    sampleFromPoint([domainX, domainY]);
  }

  // Sample trajectories from all user start points using streaming
  function sampleFromPoint(point) {
    // Cancel any in-progress request before starting new one
    if (activeRequestId) {
      flowMatchingClient.stopRequest(activeRequestId);
      activeRequestId = null;
    }

    // Add new point to the list of user start points
    userStartPoints = [...userStartPoints, point];

    // If we exceed the max, remove the oldest point
    if (userStartPoints.length > maxUserTrajectories) {
      userStartPoints = userStartPoints.slice(-maxUserTrajectories);
    }

    hasUserTrajectory = true;
    isStreamingTrajectory = true;

    // Initialize trajectory arrays with initial pixel points for all start points
    userTrajectories = userStartPoints.map(p => [[xScale(p[0]), yScale(p[1])]]);

    // Reset and start animation
    currentSegmentIndex = 0;
    segmentAccumulator = 0;
    time = 0;
    isPlaying = true;

    // Sample using streaming - use same number of steps as passed-in trajectories
    const result = flowMatchingClient.sampleFromInitialPoints(
      userStartPoints,
      numTimeSteps,
      {},
      // onStep callback - append new points for all trajectories
      (_step, x_t) => {
        userTrajectories = userTrajectories.map((traj, i) => [
          ...traj,
          [xScale(x_t[i][0]), yScale(x_t[i][1])]
        ]);
      }
    );
    activeRequestId = result.requestId;
    result.promise.then(() => {
      isStreamingTrajectory = false;
      activeRequestId = null;
    });
  }

  function draw() {
    if (!ctx) return;

    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // Draw target distribution
    drawScatterPlot(ctx, scaledTargetDistribution, distributionPointRadius, targetColor, targetOpacity);

    // Draw default trajectories (dimmed if user has clicked)
    const defaultOpacity = hasUserTrajectory ? 0.15 : trajectoryProgressOpacity;
    ctx.strokeStyle = trajectoryColor;
    ctx.lineWidth = trajectoryStrokeWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = defaultOpacity;

    for (const trajectory of scaledTrajectories) {
      const endIdx = Math.min(currentSegmentIndex + 1, trajectory.length);
      if (endIdx < 2) continue;

      ctx.beginPath();
      ctx.moveTo(trajectory[0][0], trajectory[0][1]);
      for (let i = 1; i < endIdx; i++) {
        ctx.lineTo(trajectory[i][0], trajectory[i][1]);
      }
      ctx.stroke();
    }

    // Draw endpoint circles at the current position of each trajectory
    ctx.fillStyle = trajectoryColor;
    for (const trajectory of scaledTrajectories) {
      const endIdx = Math.min(currentSegmentIndex + 1, trajectory.length) - 1;
      if (endIdx < 0) continue;

      const [ex, ey] = trajectory[endIdx];
      ctx.beginPath();
      ctx.arc(ex, ey, endpointRadius, 0, 2 * Math.PI);
      ctx.fill();
    }

    ctx.globalAlpha = 1.0;

    // Draw all user-defined trajectories (highlighted) on top
    for (const userTrajectory of userTrajectories) {
      if (userTrajectory && userTrajectory.length > 1) {
        const userNumSegments = userTrajectory.length - 1;
        const userSegmentIndex = Math.min(currentSegmentIndex, userNumSegments - 1);

        drawTrajectoriesWithPreview(ctx, [userTrajectory], userSegmentIndex, {
          strokeWidth: trajectoryStrokeWidth,
          color: trajectoryColor,
          progressOpacity: 1.0,
          pointRadius: endpointRadius,
          showPreview: false
        });
      } else if (userTrajectory && userTrajectory.length === 1) {
        // Draw just the starting point for immediate feedback
        const [x, y] = userTrajectory[0];
        ctx.globalAlpha = 1.0;
        ctx.beginPath();
        ctx.arc(x, y, endpointRadius, 0, Math.PI * 2);
        ctx.fillStyle = trajectoryColor;
        ctx.fill();
      }
    }
  }

  function initializeVisualization() {
    if (!canvas || !isDataValid) return;

    initializeScales();
    initializeCanvas();
    precomputeCoordinates();
    isInitialized = true;
    draw();
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
        draw();
      }
      animationFrameId = requestAnimationFrame(animate);
      return;
    }

    segmentAccumulator += elapsed;
    while (segmentAccumulator >= msPerSegment && currentSegmentIndex < numSegments) {
      segmentAccumulator -= msPerSegment;
      currentSegmentIndex += 1;
    }

    time = numSegments > 0 ? currentSegmentIndex / numSegments : 0;
    draw();

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
    draw();
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

  $: if (isDataValid && canvas && !isInitialized) {
    initializeVisualization();
  }

  $: if (isPlaying && isInitialized && !animationFrameId) startAnimation();
  $: if (!isPlaying && animationFrameId) stopAnimation();

  // Handle visibility changes (pause when off-screen, resume when back)
  $: if (figureIsActive !== undefined && isInitialized) {
    handleVisibilityChange($figureIsActive);
  }

  // ===== LIFECYCLE =====

  onMount(() => {
    // Initialization handled by reactive statement
  });

  onDestroy(() => {
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
    }
  });
</script>

{#if isDataValid}
  <Figure {caption} {backgroundVisible} bind:isActive={figureIsActive}>
    {#snippet children()}
      <div style="display: flex; flex-direction: column; align-items: center; width: 100%;">
        <div style="width: 100%; max-width: {canvasWidth}px;">
          <canvas
            bind:this={canvas}
            onclick={handleCanvasClick}
            style="cursor: pointer; width: 100%; height: auto; aspect-ratio: {canvasWidth}/{canvasHeight};"
          ></canvas>
          <TimeSlider
            bind:value={time}
            {isPlaying}
            min={0}
            max={1}
            step={numSegments > 0 ? 1 / numSegments : 0.01}
            onTogglePlay={togglePlayPause}
            onInput={handleSliderInput}
            color={trajectoryColor}
          />
        </div>
      </div>
    {/snippet}
  </Figure>
{:else}
  <div class="placeholder">
    <p>Loading curved trajectory visualization...</p>
  </div>
{/if}

<style>
  .placeholder {
    padding: 2rem;
    text-align: center;
    background-color: #f9f9f9;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    color: #666;
  }
</style>
