<script lang="ts">
  import { onDestroy } from "svelte";
  import * as d3 from "d3";
  import { DoubleFigure, TimeSlider, drawScatterPlot, drawTrajectoriesWithPreview, Timeline, createPauseClip, useCanvas2D } from "@diffusion-explorer/ui";
  import { settings } from "$lib/settings";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  // FlowModelClient instances (passed from parent, created with correct base path)
  export let flowMatchingClient = null;
  export let rectifiedFlowClient = null;

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
  export let labelOpacity = settings.stylingSettings.label.opacity;

  // Target distribution styling
  export let targetColor = "#3b82f6";
  export let targetOpacity = 0.35;
  export let targetPointRadius = 5;

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
  export let animationDuration = 8000;
  export let pauseDuration = 2000;
  export let playingByDefault = true;

  // Interactive sampling
  export let maxUserTrajectories = settings.interactiveSettings.maxUserTrajectories;

  // Callbacks & misc
  export let onInitialized = undefined;
  export let backgroundVisible = true;
  export let children = undefined;

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  $: caption = children;
  $: isDataValid =
    leftTrajectories?.length > 0 &&
    rightTrajectories?.length > 0 &&
    targetDistribution?.length > 0;
  $: numTimeSteps = isDataValid ? leftTrajectories.length : 1;
  $: numSegments = numTimeSteps - 1;
  $: msPerSegment = numSegments > 0 ? animationDuration / numSegments : animationDuration;

  // Canvas - need both bind:this (for reactivity) and action (for DPR setup)
  let leftCanvas = null;
  let rightCanvas = null;
  const leftCanvas2d = useCanvas2D(canvasWidth, canvasHeight);
  const rightCanvas2d = useCanvas2D(canvasWidth, canvasHeight);
  // Tie ctx reactivity to canvas variables so it updates when action runs
  $: leftCtx = leftCanvas && leftCanvas2d.ctx;
  $: rightCtx = rightCanvas && rightCanvas2d.ctx;

  // Scales
  let xScale;
  let yScale;

  // Animation state type
  type AnimState = {
    time: number;  // WARNING: Using time in draw() is an antipattern. Prefer derived state.
    segmentIndex: number;
  };

  // Animation - Timeline system
  let time = 0;
  let currentSegmentIndex = 0;
  let isPlaying = playingByDefault;
  let timeline: Timeline<AnimState> | null = null;

  // Initialization
  let isInitialized = false;
  let pathsInitialized = false;

  // Pre-computed pixel coordinates (scaled once upfront)
  let scaledTargetDistribution = [];  // [point][x,y] in pixels
  let scaledLeftTrajectories = [];    // [trajectory][timestep][x,y] in pixels
  let scaledRightTrajectories = [];   // [trajectory][timestep][x,y] in pixels

  // User-defined trajectory state (supports multiple trajectories)
  let userStartPoints = []; // Array of [x, y] domain coordinates
  let userFlowMatchingTrajectories = []; // Array of trajectories, each is [timestep][x,y] in pixels
  let userRectifiedFlowTrajectories = []; // Array of trajectories, each is [timestep][x,y] in pixels
  let hasUserTrajectory = false;
  let isStreamingTrajectory = false;
  let streamingCompleteCount = 0;
  let activeFlowMatchingRequestId = null; // Track active request for cancellation
  let activeRectifiedFlowRequestId = null; // Track active request for cancellation

  // Visibility
  let figureIsActive;
  let wasPlayingBeforeHidden = false;

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

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

    // Scale target distribution
    scaledTargetDistribution = targetDistribution.map(p => [xScale(p[0]), yScale(p[1])]);

    // Scale and transpose trajectories
    scaledLeftTrajectories = transposeAndScale(leftTrajectories);
    scaledRightTrajectories = transposeAndScale(rightTrajectories);
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function runInitialComputation() {
    if (!leftCanvas || !rightCanvas || !isDataValid) return;

    initializeScales();
    precomputeCoordinates();
    pathsInitialized = true;
    updateVisualization({ time: 0, segmentIndex: 0 });
    isInitialized = true;
    onInitialized?.();
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  // Main animation clip (reducer pattern, closes over numSegments)
  const mainClip = {
    name: "Animation",
    duration: 1,
    reduce(t: number) {
      return {
        time: t,
        segmentIndex: Math.floor(t * numSegments)
      };
    }
  };

  function setupTimeline() {
    timeline = new Timeline<AnimState>();
    timeline.initialState = { time: 0, segmentIndex: 0 };

    // Calculate normalized durations for timeline
    const totalDuration = animationDuration + pauseDuration;
    const mainDuration = animationDuration / totalDuration;
    const pauseClipDuration = pauseDuration / totalDuration;

    // Add main animation clip (0 to mainDuration of timeline)
    timeline.add({ ...mainClip, duration: mainDuration }, 0);
    // Add pause clip (mainDuration to 1)
    timeline.add(createPauseClip(pauseClipDuration), mainDuration);

    // Set timeline duration in seconds and enable looping
    timeline.duration = totalDuration / 1000;
    timeline.looping = true;

    // Register tick callback
    timeline.onTick((_t, state) => {
      time = state.time;  // For slider binding
      currentSegmentIndex = state.segmentIndex;
      updateVisualization(state);
    });
  }

  function startAnimation() {
    if (!timeline) return;
    timeline.play();
  }

  function stopAnimation() {
    if (timeline) timeline.pause();
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  // Draw scatter plot + trajectories (using pre-scaled pixel coordinates)
  function draw(ctx, scaledTrajectories, segmentIndex, userTrajectories) {
    if (!ctx) return;

    // Clear previous frame
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // Draw target distribution scatter (behind trajectories)
    drawScatterPlot(ctx, scaledTargetDistribution, targetPointRadius, targetColor, targetOpacity);

    // Draw default trajectories (dimmed if user has clicked)
    const defaultOpacity = hasUserTrajectory ? 0.15 : trajectoryProgressOpacity;
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

    // Draw endpoint circles at the current position of each trajectory
    ctx.fillStyle = trajectoryColor;
    for (const trajectory of scaledTrajectories) {
      const endIdx = Math.min(segmentIndex + 1, trajectory.length) - 1;
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
        const userSegmentIndex = Math.min(segmentIndex, userNumSegments - 1);

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

  // Pure renderer: receives state explicitly
  function updateVisualization(state: AnimState) {
    if (!isDataValid || !leftCtx || !rightCtx) return;

    draw(leftCtx, scaledLeftTrajectories, state.segmentIndex, userFlowMatchingTrajectories);
    draw(rightCtx, scaledRightTrajectories, state.segmentIndex, userRectifiedFlowTrajectories);
  }

  // ----------------------------------------------------------------
  // Event Handlers
  // ----------------------------------------------------------------

  // Handle canvas click - convert to domain coordinates and sample
  function handleCanvasClick(event, side) {
    // Clients are passed as props; check they're available
    if (!flowMatchingClient || !rectifiedFlowClient) return;

    const canvas = side === 'left' ? leftCanvas : rightCanvas;
    const rect = canvas.getBoundingClientRect();
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

  // Sample trajectories from all user start points using both models (streaming)
  function sampleFromPoint(point) {
    // Ensure clients are initialized
    if (!flowMatchingClient || !rectifiedFlowClient) return;

    // Cancel any in-progress requests before starting new ones
    if (activeFlowMatchingRequestId) {
      flowMatchingClient.stopRequest(activeFlowMatchingRequestId);
      activeFlowMatchingRequestId = null;
    }
    if (activeRectifiedFlowRequestId) {
      rectifiedFlowClient.stopRequest(activeRectifiedFlowRequestId);
      activeRectifiedFlowRequestId = null;
    }

    // Add new point to the list of user start points
    userStartPoints = [...userStartPoints, point];

    // If we exceed the max, remove the oldest point
    if (userStartPoints.length > maxUserTrajectories) {
      userStartPoints = userStartPoints.slice(-maxUserTrajectories);
    }

    hasUserTrajectory = true;
    isStreamingTrajectory = true;
    streamingCompleteCount = 0;

    // Initialize trajectory arrays with initial pixel points for all start points
    userFlowMatchingTrajectories = userStartPoints.map(p => [[xScale(p[0]), yScale(p[1])]]);
    userRectifiedFlowTrajectories = userStartPoints.map(p => [[xScale(p[0]), yScale(p[1])]]);

    // Reset animation state and start
    currentSegmentIndex = 0;
    time = 0;
    if (timeline) timeline.reset();
    isPlaying = true;
    startAnimation();

    // Helper to check if both samples are complete
    function checkComplete() {
      streamingCompleteCount++;
      if (streamingCompleteCount >= 2) {
        isStreamingTrajectory = false;
        activeFlowMatchingRequestId = null;
        activeRectifiedFlowRequestId = null;
      }
    }

    // Sample from left model (Flow Matching) with streaming
    const fmResult = flowMatchingClient.sampleFromInitialPoints(
      userStartPoints,
      numTimeSteps,
      {},
      // onStep callback - append new points for all trajectories
      (_step, x_t) => {
        userFlowMatchingTrajectories = userFlowMatchingTrajectories.map((traj, i) => [
          ...traj,
          [xScale(x_t[i][0]), yScale(x_t[i][1])]
        ]);
      }
    );
    activeFlowMatchingRequestId = fmResult.requestId;
    fmResult.promise.then(checkComplete);

    // Sample from right model (Rectified Flow) with streaming
    const rfResult = rectifiedFlowClient.sampleFromInitialPoints(
      userStartPoints,
      numTimeSteps,
      {},
      // onStep callback - append new points for all trajectories
      (_step, x_t) => {
        userRectifiedFlowTrajectories = userRectifiedFlowTrajectories.map((traj, i) => [
          ...traj,
          [xScale(x_t[i][0]), yScale(x_t[i][1])]
        ]);
      }
    );
    activeRectifiedFlowRequestId = rfResult.requestId;
    rfResult.promise.then(checkComplete);
  }

  function togglePlayPause() {
    isPlaying = !isPlaying;
    if (isPlaying) {
      startAnimation();
    } else {
      stopAnimation();
    }
  }

  function handleSliderInput() {
    // Sync timeline with slider using seek
    if (timeline) {
      timeline.seek(time);
    }
  }

  function handleVisibilityChange(isActive) {
    if (!isActive && isPlaying) {
      wasPlayingBeforeHidden = true;
      isPlaying = false;
      stopAnimation();
    } else if (isActive && wasPlayingBeforeHidden) {
      wasPlayingBeforeHidden = false;
      isPlaying = true;
      startAnimation();
    }
  }

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  // Note: FlowModelClient instances are now passed as props from +page.svelte
  // This ensures they're created with the correct base path prefix

  onDestroy(() => {
    // Stop timeline animation
    if (timeline) timeline.pause();

    // Cancel any pending worker requests to prevent orphaned promises
    if (activeFlowMatchingRequestId && flowMatchingClient) {
      flowMatchingClient.stopRequest(activeFlowMatchingRequestId);
    }
    if (activeRectifiedFlowRequestId && rectifiedFlowClient) {
      rectifiedFlowClient.stopRequest(activeRectifiedFlowRequestId);
    }
  });

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  $: if (isDataValid && leftCanvas && rightCanvas && !isInitialized) {
    runInitialComputation();
    setupTimeline();
    if (isPlaying) startAnimation();
  }

  // Handle visibility changes (pause when off-screen, resume when back)
  $: if (figureIsActive !== undefined && isInitialized) {
    handleVisibilityChange($figureIsActive);
  }
</script>

{#if isDataValid}
  <DoubleFigure {gap} {caption} {backgroundVisible} bind:isActive={figureIsActive}>
    {#snippet left()}
      <div class="panel-container" style="max-width: {canvasWidth}px;">
        <div class="panel-label" style="font-size: {labelFontSize}px; color: {labelColor}; opacity: {labelOpacity};">
          {leftLabel}
        </div>
        <canvas
          bind:this={leftCanvas}
          use:leftCanvas2d.bindCanvas
          onclick={(e) => handleCanvasClick(e, 'left')}
          class="panel-canvas"
          style="cursor: pointer;"
        ></canvas>
      </div>
    {/snippet}

    {#snippet right()}
      <div class="panel-container" style="max-width: {canvasWidth}px;">
        <div class="panel-label" style="font-size: {labelFontSize}px; color: {labelColor}; opacity: {labelOpacity};">
          {rightLabel}
        </div>
        <canvas
          bind:this={rightCanvas}
          use:rightCanvas2d.bindCanvas
          onclick={(e) => handleCanvasClick(e, 'right')}
          class="panel-canvas"
          style="cursor: pointer;"
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

  @media (max-width: 600px) {
    .panel-label {
      font-size: 18px !important;
    }
  }
</style>
