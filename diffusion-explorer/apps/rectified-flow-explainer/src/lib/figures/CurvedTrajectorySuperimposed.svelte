<script lang="ts">
  import { onDestroy } from "svelte";
  import * as d3 from "d3";
  import { Figure, TimeSlider, drawScatterPlot, drawTrajectoriesWithPreview, Timeline, createPauseClip, useCanvas2D } from "@diffusion-explorer/ui";
  import { settings } from "$lib/settings";

  // ===== PROPS =====

  // FlowModelClient instance (passed from parent, created with correct base path)
  export let flowMatchingClient = null;

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

  // Canvas - need both bind:this (for reactivity) and action (for DPR setup)
  let canvas = null;
  const canvas2d = useCanvas2D(canvasWidth, canvasHeight);
  // Tie ctx reactivity to canvas variable so it updates when action runs
  $: ctx = canvas && canvas2d.ctx;

  // Scales
  let xScale;
  let yScale;

  // Animation - Timeline system
  let time = 0;
  let currentSegmentIndex = 0;
  let isPlaying = playingByDefault;
  let timeline: Timeline<{ time: number; segmentIndex: number }> | null = null;

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
    // Client is passed as prop; check it's available
    if (!flowMatchingClient || !canvas) return;

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
    // Ensure client is initialized
    if (!flowMatchingClient) return;

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

    // Reset animation state and start
    currentSegmentIndex = 0;
    time = 0;
    if (timeline) timeline.reset();
    isPlaying = true;
    startAnimation();

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

  // Pure renderer: receives segmentIndex, computes userSegmentIndex from external data
  function draw(segmentIndex: number) {
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
    // userSegmentIndex computed here because userTrajectory.length is external reactive state
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

  function initializeVisualization() {
    if (!canvas || !isDataValid) return;

    initializeScales();
    precomputeCoordinates();
    isInitialized = true;
    draw(0);
  }

  // Initialize animation timeline with main clip and pause
  function initializeAnimation() {
    timeline = new Timeline<{ time: number; segmentIndex: number }>();
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
      draw(state.segmentIndex);
    });
  }

  function startAnimation() {
    if (!timeline) return;
    timeline.play();
  }

  function stopAnimation() {
    if (timeline) timeline.pause();
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

  // ===== REACTIVE EFFECTS =====

  $: if (isDataValid && canvas && !isInitialized) {
    initializeVisualization();
    initializeAnimation();
    if (isPlaying) startAnimation();
  }

  // Animation control - handled by togglePlayPause() and visibility changes
  // Clock manages its own running state

  // Handle visibility changes (pause when off-screen, resume when back)
  $: if (figureIsActive !== undefined && isInitialized) {
    handleVisibilityChange($figureIsActive);
  }

  // ===== LIFECYCLE =====

  // Note: FlowModelClient instance is now passed as props from +page.svelte
  // This ensures it's created with the correct base path prefix

  onDestroy(() => {
    // Stop timeline animation
    if (timeline) timeline.pause();

    // Cancel any pending worker requests to prevent orphaned promises
    if (activeRequestId && flowMatchingClient) {
      flowMatchingClient.stopRequest(activeRequestId);
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
            use:canvas2d.bindCanvas
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
