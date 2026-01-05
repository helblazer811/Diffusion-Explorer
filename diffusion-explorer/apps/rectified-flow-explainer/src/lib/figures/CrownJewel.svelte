<script lang="ts">
  import { onDestroy } from "svelte";
  import * as d3 from "d3";
  import {
    DoubleFigure,
    TimeSlider,
    drawScatterPlot,
    drawTrajectories,
    computeContours,
    plotContours,
    Timeline,
    useCanvas2D,
    createVisibilityHandler,
  } from "@diffusion-explorer/ui";
  import { settings } from "$lib/settings";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  // FlowModelClient instances (passed from parent, created with correct base path)
  export let flowMatchingClient = null;
  export let rectifiedFlowClient = null;

  // Data
  export let leftTrajectories = []; // [timestep][sample][dim]
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
  export let labelFontSize = 30;
  export let labelColor = settings.stylingSettings.label.color;
  export let labelOpacity = settings.stylingSettings.label.opacity;

  // Subtitles
  export let leftSubtitle = "Curved Paths Flow Slow";
  export let rightSubtitle = "Straight Paths Flow Fast";
  export let subtitleFontSize = 26;
  export let subtitleColor = settings.stylingSettings.label.color;

  // Target distribution styling
  export let targetColor = "#3b82f6";
  export let targetOpacity = 0.35;
  export let targetPointRadius = 5;
  export let showTargetScatter = true; // On by default
  export let showTargetContour = false; // Off by default

  // Trajectory styling
  export let trajectoryColor = settings.stylingSettings.trajectory.color;
  export let trajectoryStrokeWidth =
    settings.stylingSettings.trajectory.strokeWidth;
  export let trajectoryPointRadius =
    settings.stylingSettings.trajectory.endpointRadius;
  export let trajectoryProgressOpacity =
    settings.stylingSettings.trajectory.progressOpacity;
  export let trajectoryPreviewOpacity =
    settings.stylingSettings.trajectory.previewOpacity;

  // Trajectory outline styling
  export let trajectoryOutlineColor =
    settings.stylingSettings.trajectory.outline.color;
  export let trajectoryOutlineWidth =
    settings.stylingSettings.trajectory.outline.width;
  export let trajectoryOutlineOpacity =
    settings.stylingSettings.trajectory.outline.opacity;
  export let showTrajectoryOutline =
    settings.stylingSettings.trajectory.outline.enabled;

  // Animation
  export let animationDuration = 10000; // Total cycle duration (ms)
  export let playingByDefault = true;

  // Interactive sampling
  export let highlightedTrajectoryOpacity = 1.0;
  export let dimmedTrajectoryOpacity = 0.15;
  export let maxUserTrajectories =
    settings.interactiveSettings.maxUserTrajectories;

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

  // Animation state (combined for single Timeline)
  type AnimationState = {
    leftTime: number; // WARNING: Using time in draw() is an antipattern. Prefer derived state.
    leftSegmentIndex: number;
    rightTime: number; // WARNING: Using time in draw() is an antipattern. Prefer derived state.
    rightSegmentIndex: number;
  };

  let isPlaying = playingByDefault;
  let leftTime = 0;
  let rightTime = 0;
  let leftCurrentSegmentIndex = 0;
  let rightCurrentSegmentIndex = 0;

  // Pause at end before looping (as fraction of total duration)
  // Timing constants
  const endPauseDurationMs = 1500; // End pause in ms
  const rightSpeedMultiplier = 0.5; // Right animation runs at 2x speed (half duration)

  // Timeline for animation
  let timeline: Timeline<AnimationState> | null = null;

  // Initialization
  let isInitialized = false;
  let pathsInitialized = false;

  // Pre-computed pixel coordinates (scaled once upfront)
  let scaledTargetDistribution = []; // [point][x,y] in pixels - target distribution
  let scaledLeftTrajectories = []; // [trajectory][timestep][x,y] in pixels
  let scaledRightTrajectories = []; // [trajectory][timestep][x,y] in pixels
  let computedTargetContours = null; // Pre-computed contour data

  // Visibility
  let figureIsActive;
  const { handleVisibilityChange } = createVisibilityHandler(() => timeline);

  // User-defined trajectory state (supports multiple trajectories)
  let userStartPoints = []; // Array of [x, y] domain coordinates
  let userFlowMatchingTrajectories = []; // Array of trajectories, each is [timestep][x,y] in pixels
  let userRectifiedFlowTrajectories = []; // Array of trajectories, each is [timestep][x,y] in pixels
  let hasUserTrajectory = false;
  let isStreamingTrajectory = false;
  let activeFlowMatchingRequestId = null; // Track active request for cancellation
  let activeRectifiedFlowRequestId = null; // Track active request for cancellation
  let streamingCompleteCount = 0;

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
    if (!xScale || !yScale || !trajectories || trajectories.length === 0)
      return [];
    const numSamples = trajectories[0]?.length || 0;
    return Array.from({ length: numSamples }, (_, i) =>
      trajectories.map((ts) => [xScale(ts[i][0]), yScale(ts[i][1])])
    );
  }

  // Pre-compute all coordinates in pixel space (called once after scales are initialized)
  function precomputeCoordinates() {
    if (!xScale || !yScale) return;

    // Scale and transpose trajectories
    scaledLeftTrajectories = transposeAndScale(leftTrajectories);
    scaledRightTrajectories = transposeAndScale(rightTrajectories);

    // Scale target distribution
    scaledTargetDistribution = targetDistribution.map((p) => [
      xScale(p[0]),
      yScale(p[1]),
    ]);

    // Pre-compute contours if needed
    if (showTargetContour && targetDistribution.length > 0) {
      computedTargetContours = computeContours(targetDistribution, {
        bandwidth: settings.stylingSettings.contour.bandwidth,
        thresholds: 8, // More contour lines for CrownJewel
        domain: [
          domainRange.xMin,
          domainRange.xMax,
          domainRange.yMin,
          domainRange.yMax,
        ],
      });
    } else {
      computedTargetContours = null;
    }
  }

  // Build style object for trajectory drawing
  function getTrajectoryStyle(opacity) {
    return {
      strokeWidth: trajectoryStrokeWidth,
      color: trajectoryColor,
      progressOpacity: opacity,
      showPreview: true,
      previewOpacity: trajectoryPreviewOpacity,
      pointRadius: trajectoryPointRadius,
      outline: showTrajectoryOutline
        ? {
            color: trajectoryOutlineColor,
            width: trajectoryOutlineWidth,
            opacity: trajectoryOutlineOpacity,
          }
        : undefined,
    };
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function runInitialComputation() {
    if (!leftCanvas || !rightCanvas || !isDataValid) return;

    initializeScales();
    precomputeCoordinates();
    pathsInitialized = true;
    updateLeftVisualization();
    updateRightVisualization();
    isInitialized = true;
    onInitialized?.();
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  // Left segment clip - runs full timeline duration
  const leftSegmentClip = {
    name: "LeftSegments",
    duration: 1,
    reduce(t: number) {
      return {
        leftTime: t,
        leftSegmentIndex: Math.floor(t * numSegments),
      };
    },
  };

  // Right segment clip - runs at 2x speed (completes in half the time)
  const rightSegmentClip = {
    name: "RightSegments",
    duration: rightSpeedMultiplier,
    reduce(t: number) {
      return {
        rightTime: t,
        rightSegmentIndex: Math.floor(t * numSegments),
      };
    },
  };

  function setupTimeline() {
    timeline = new Timeline<AnimationState>();
    timeline.initialState = {
      leftTime: 0,
      leftSegmentIndex: 0,
      rightTime: 0,
      rightSegmentIndex: 0,
    };

    // Add clips - both start at 0, right finishes at 0.5
    // Note: No explicit pause clip needed - Timeline holds final state for ended clips
    timeline.add(leftSegmentClip, 0);
    timeline.add(rightSegmentClip, 0);

    // Set timeline duration (animation only) and end pause
    timeline.duration = (animationDuration - endPauseDurationMs) / 1000;
    timeline.setEndPause(endPauseDurationMs / 1000);
    timeline.looping = true;

    // Register tick callback
    timeline.onTick((_t, state) => {
      leftTime = state.leftTime;
      rightTime = state.rightTime;
      leftCurrentSegmentIndex = state.leftSegmentIndex;
      rightCurrentSegmentIndex = state.rightSegmentIndex;

      updateLeftVisualization();
      updateRightVisualization();
    });
  }

  function startAnimation() {
    if (!timeline || timeline.isPlaying) return;
    timeline.play();
  }

  function stopAnimation() {
    if (timeline) timeline.pause();
  }

  function resetAnimation() {
    if (timeline) timeline.reset();
    leftTime = 0;
    rightTime = 0;
    leftCurrentSegmentIndex = 0;
    rightCurrentSegmentIndex = 0;
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  // Draw trajectories (clears and redraws each frame)
  // Pure renderer: receives pre-computed state, only derives userSegmentIndex from logicalTime + trajectory length
  function draw(
    ctx: CanvasRenderingContext2D,
    scaledTrajectories: number[][][],
    state: AnimationState,
    panel: "left" | "right",
    userTrajectories: number[][][]
  ) {
    if (!ctx) return;

    const segmentIndex =
      panel === "left" ? state.leftSegmentIndex : state.rightSegmentIndex;
    const logicalTime = panel === "left" ? state.leftTime : state.rightTime;

    // Clear canvas
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // --- Static Background ---
    // Draw contour plot if enabled
    if (showTargetContour && computedTargetContours) {
      plotContours(ctx, computedTargetContours, {
        fillColor: targetColor,
        fill: true,
        stroke: false,
        opacity: 0.15, // Lower opacity for CrownJewel contours
        xScale,
        yScale,
      });
    }

    // Draw scatter plot if enabled
    if (showTargetScatter) {
      drawScatterPlot(
        ctx,
        scaledTargetDistribution,
        targetPointRadius,
        targetColor,
        targetOpacity
      );
    }

    // --- Dynamic Foreground ---
    // Draw default trajectories
    const defaultOpacity = hasUserTrajectory
      ? dimmedTrajectoryOpacity
      : trajectoryProgressOpacity;
    drawTrajectories(
      ctx,
      scaledTrajectories,
      segmentIndex,
      getTrajectoryStyle(defaultOpacity)
    );

    // Draw all user-defined trajectories (highlighted) on top
    // Note: userSegmentIndex derived here because trajectory.length is external reactive state
    for (const userTrajectory of userTrajectories) {
      if (userTrajectory && userTrajectory.length > 1) {
        const userNumSegments = userTrajectory.length - 1;
        const userSegmentIndex = Math.floor(logicalTime * userNumSegments);
        drawTrajectories(
          ctx,
          [userTrajectory],
          userSegmentIndex,
          getTrajectoryStyle(highlightedTrajectoryOpacity)
        );
      } else if (userTrajectory && userTrajectory.length === 1) {
        // Draw just the starting point for immediate feedback
        const [x, y] = userTrajectory[0];
        ctx.globalAlpha = highlightedTrajectoryOpacity;
        ctx.beginPath();
        ctx.arc(x, y, trajectoryPointRadius, 0, Math.PI * 2);
        ctx.fillStyle = trajectoryColor;
        ctx.fill();
      }
    }

    ctx.globalAlpha = 1.0;
  }

  function getCurrentState(): AnimationState {
    return {
      leftTime,
      leftSegmentIndex: leftCurrentSegmentIndex,
      rightTime,
      rightSegmentIndex: rightCurrentSegmentIndex,
    };
  }

  function updateLeftVisualization() {
    if (!isDataValid || !leftCtx) return;
    draw(
      leftCtx,
      scaledLeftTrajectories,
      getCurrentState(),
      "left",
      userFlowMatchingTrajectories
    );
  }

  function updateRightVisualization() {
    if (!isDataValid || !rightCtx) return;
    draw(
      rightCtx,
      scaledRightTrajectories,
      getCurrentState(),
      "right",
      userRectifiedFlowTrajectories
    );
  }

  // ----------------------------------------------------------------
  // Event Handlers
  // ----------------------------------------------------------------

  function togglePlayPause() {
    isPlaying = !isPlaying;
    if (!isPlaying) {
      stopAnimation();
    }
  }

  // Handler for when user drags the left (slow) slider
  function handleLeftTimeInput(newTime) {
    if (!pathsInitialized || numSegments === 0) return;

    // Snap to discrete segment and update left side
    leftCurrentSegmentIndex = Math.min(
      Math.floor(newTime * numSegments),
      numSegments - 1
    );
    leftTime = leftCurrentSegmentIndex / numSegments;

    // Sync right side (right is 2x faster, so it's at 2x the left position, capped at 1)
    rightCurrentSegmentIndex = Math.min(
      leftCurrentSegmentIndex * 2,
      numSegments - 1
    );
    rightTime = rightCurrentSegmentIndex / numSegments;

    // Seek timeline to corresponding position (leftTime is already normalized 0-1)
    if (timeline) {
      timeline.seek(leftTime);
    }

    // Update visualizations
    updateLeftVisualization();
    updateRightVisualization();
  }

  // Handler for when user drags the right (fast) slider
  function handleRightTimeInput(newTime) {
    if (!pathsInitialized || numSegments === 0) return;

    // Snap to discrete segment and update right side
    rightCurrentSegmentIndex = Math.min(
      Math.floor(newTime * numSegments),
      numSegments - 1
    );
    rightTime = rightCurrentSegmentIndex / numSegments;

    // Calculate timeline position (right covers 0 to rightSpeedMultiplier of timeline)
    const timelinePosition = rightTime * rightSpeedMultiplier;

    // Sync left side (left covers full timeline, so leftTime = timelinePosition)
    leftTime = timelinePosition;
    leftCurrentSegmentIndex = Math.min(
      Math.floor(leftTime * numSegments),
      numSegments - 1
    );

    // Seek timeline to corresponding position
    if (timeline) {
      timeline.seek(timelinePosition);
    }

    // Update visualizations
    updateLeftVisualization();
    updateRightVisualization();
  }

  // Handle canvas click - convert to domain coordinates and sample
  function handleCanvasClick(event, side) {
    // Clients are passed as props; check they're available
    if (!flowMatchingClient || !rectifiedFlowClient) return;

    const canvas = side === "left" ? leftCanvas : rightCanvas;
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

  // Sample trajectories from all user start points using both models (streaming)
  function sampleFromPoint(point) {
    // Ensure clients are initialized
    if (!flowMatchingClient || !rectifiedFlowClient) return;

    // Cancel any in-flight requests from previous clicks
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
    userFlowMatchingTrajectories = userStartPoints.map((p) => [
      [xScale(p[0]), yScale(p[1])],
    ]);
    userRectifiedFlowTrajectories = userStartPoints.map((p) => [
      [xScale(p[0]), yScale(p[1])],
    ]);

    // Reset and start animation immediately
    resetAnimation();
    isPlaying = true;

    // Helper to check if both samples are complete
    function checkComplete() {
      streamingCompleteCount++;
      if (streamingCompleteCount >= 2) {
        isStreamingTrajectory = false;
      }
    }

    // Sample from left model (Flow Matching) with streaming
    const fmResult = flowMatchingClient.sampleFromInitialPoints(
      userStartPoints,
      numTimeSteps,
      {},
      // onStep callback - append new points for all trajectories
      (_step, x_t) => {
        userFlowMatchingTrajectories = userFlowMatchingTrajectories.map(
          (traj, i) => [...traj, [xScale(x_t[i][0]), yScale(x_t[i][1])]]
        );
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
        userRectifiedFlowTrajectories = userRectifiedFlowTrajectories.map(
          (traj, i) => [...traj, [xScale(x_t[i][0]), yScale(x_t[i][1])]]
        );
      }
    );
    activeRectifiedFlowRequestId = rfResult.requestId;
    rfResult.promise.then(checkComplete);
  }

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  // Note: FlowModelClient instances are now passed as props from +page.svelte
  // This ensures they're created with the correct base path prefix

  onDestroy(() => {
    // Dispose timeline (stops animation and cleans up)
    timeline?.dispose();

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
  }

  $: if (isPlaying && pathsInitialized && timeline && !timeline.isPlaying)
    startAnimation();
  $: if (!isPlaying && timeline?.isPlaying) stopAnimation();

  // Handle visibility changes (pause when off-screen, resume when back)
  $: if (figureIsActive !== undefined && isInitialized) {
    handleVisibilityChange($figureIsActive);
  }
</script>

{#if isDataValid}
  <DoubleFigure
    {gap}
    {caption}
    {backgroundVisible}
    bind:isActive={figureIsActive}
  >
    {#snippet left()}
      <div class="panel-container" style="max-width: {canvasWidth}px;">
        <div
          class="panel-label"
          style="font-size: {labelFontSize}px; color: {labelColor}; opacity: {labelOpacity};"
        >
          {leftLabel}
        </div>
        <div
          class="panel-subtitle"
          style="font-size: {subtitleFontSize}px; color: {subtitleColor};"
        >
          {leftSubtitle}
        </div>
        <canvas
          bind:this={leftCanvas}
          use:leftCanvas2d.bindCanvas
          class="panel-canvas"
          onclick={(e) => handleCanvasClick(e, "left")}
          style="cursor: pointer;"
        ></canvas>
        <div class="slider-wrapper">
          <TimeSlider
            bind:value={leftTime}
            {isPlaying}
            min={0}
            max={1}
            onTogglePlay={togglePlayPause}
            color="#f17720"
            showTicks={false}
            showTimeLabel={false}
            dragEnabled={true}
            onInput={handleLeftTimeInput}
            hideSpacerOnMobile={true}
          />
        </div>
        <div class="duration-label">Sampling Duration</div>
      </div>
    {/snippet}

    {#snippet right()}
      <div class="panel-container" style="max-width: {canvasWidth}px;">
        <div
          class="panel-label"
          style="font-size: {labelFontSize}px; color: {labelColor}; opacity: {labelOpacity};"
        >
          {rightLabel}
        </div>
        <div
          class="panel-subtitle"
          style="font-size: {subtitleFontSize}px; color: {subtitleColor};"
        >
          {rightSubtitle}
        </div>
        <canvas
          bind:this={rightCanvas}
          use:rightCanvas2d.bindCanvas
          class="panel-canvas"
          onclick={(e) => handleCanvasClick(e, "right")}
          style="cursor: pointer;"
        ></canvas>
        <div class="slider-wrapper">
          <TimeSlider
            bind:value={rightTime}
            {isPlaying}
            min={0}
            max={1}
            onTogglePlay={togglePlayPause}
            color="#f17720"
            showTicks={false}
            showTimeLabel={false}
            dragEnabled={true}
            onInput={handleRightTimeInput}
            hideSpacerOnMobile={true}
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
