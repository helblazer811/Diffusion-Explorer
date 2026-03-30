<script lang="ts">
  import { onDestroy, type Snippet } from "svelte";
  import type { Writable } from "svelte/store";
  import * as d3 from "d3";
  import { Figure, TimeSlider, drawScatterPlot, Timeline, useCanvas2D, createPauseClip, PathlineAnimation, type PathlineAnimationState, useVisibilityHandler } from "@diffusion-explorer/ui";
  import { FlowModelClient } from "@diffusion-explorer/diffusion";
  import { settings } from "$lib/settings";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  // FlowModelClient instance (passed from parent, created with correct base path)
  export let flowMatchingClient: FlowModelClient | null = null;

  // Caption slot
  export let children: Snippet | undefined = undefined;

  // Data
  export let trajectories: number[][][] = []; // [timestep][sample][dim]
  export let targetDistribution: number[][] = [];

  // Layout
  export let marginWidth: number = 20;
  export let marginHeight: number = 20;
  export let canvasWidth: number = 450;
  export let canvasHeight: number = 450;
  export let domainRange: { xMin: number; xMax: number; yMin: number; yMax: number } = { xMin: -1.7, xMax: 1.7, yMin: -1.7, yMax: 1.7 };

  // Target distribution styling
  export let targetColor: string = "#3b82f6";
  export let targetOpacity: number = 0.35;
  export let distributionPointRadius: number = 5;

  // Trajectory styling
  export let trajectoryColor: string = settings.stylingSettings.trajectory.color;
  export let trajectoryStrokeWidth: number = settings.stylingSettings.trajectory.strokeWidth;
  export let trajectoryPointRadius: number = settings.stylingSettings.trajectory.endpointRadius;
  export let trajectoryOpacity: number = settings.stylingSettings.trajectory.opacity;
  export let trajectoryFullOpacity: number = settings.stylingSettings.trajectory.fullOpacity;
  export let showTrajectoryPreview: boolean = false;
  export let alphaTimeWindow: number = 0.8; // Fraction (0-1) of trajectory visible with fade
  export let endpointRadius: number = settings.stylingSettings.trajectory.endpointRadius;

  // Animation timing (normalized 0-1, scaled by animationDuration)
  export let animationDuration: number = 6000; // Total cycle duration in ms
  export let timing: { pauseStart: number } = {
    pauseStart: 0.833,  // Animation runs 0→0.833, pause 0.833→1.0
  };
  export let playingByDefault: boolean = true;

  // Interactive sampling
  export let maxUserTrajectories: number = settings.interactiveSettings.maxUserTrajectories;

  // Background
  export let backgroundVisible: boolean = true;

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  $: caption = children;
  $: isDataValid =
    trajectories?.length > 0 &&
    targetDistribution?.length > 0;
  $: numTimeSteps = isDataValid ? trajectories.length : 1;
  $: numSegments = numTimeSteps - 1;
  $: msPerSegment = numSegments > 0 ? animationDuration / numSegments : animationDuration;

  // Canvas - need both bind:this (for reactivity) and action (for DPR setup)
  let canvas: HTMLCanvasElement | null = null;
  const canvas2d = useCanvas2D(canvasWidth, canvasHeight);
  // Tie ctx reactivity to canvas variable so it updates when action runs
  $: ctx = canvas && canvas2d.ctx;

  // Scales
  let xScale: d3.ScaleLinear<number, number>;
  let yScale: d3.ScaleLinear<number, number>;

  // Animation state type - extends PathlineAnimationState
  type AnimationState = PathlineAnimationState;

  // Animation - Timeline system
  let currentSegmentIndex: number = 0;
  let timeline: Timeline<AnimationState> | null = null;

  // PathlineAnimation instance
  let pathlineAnimation: PathlineAnimation<AnimationState> | null = null;

  // Initialization
  let isInitialized: boolean = false;

  // Visibility tracking
  let figureIsActive: Writable<boolean>;
  const { handleVisibilityChange } = useVisibilityHandler(() => timeline);

  // Pre-computed coordinates
  let scaledTargetDistribution: number[][] = [];
  let scaledTrajectories: number[][][] = [];

  // User-defined trajectory state (supports multiple trajectories)
  let userStartPoints: number[][] = []; // Array of [x, y] domain coordinates
  let userTrajectories: number[][][] = []; // Array of trajectories, each is [timestep][x,y] in pixels
  let hasUserTrajectory: boolean = false;
  let isStreamingTrajectory: boolean = false;
  let activeRequestId: string | null = null; // Track active request for cancellation

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

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


  function transposeAndScale(traj: number[][][]) {
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

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function runInitialComputation() {
    if (!canvas || !isDataValid) return;

    initializeScales();
    precomputeCoordinates();
    isInitialized = true;
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  async function setupTimeline() {
    // Create PathlineAnimation for trajectories
    pathlineAnimation = PathlineAnimation.fromTrajectories<AnimationState>(
      scaledTrajectories,
      {
        style: {
          color: trajectoryColor,
          strokeWidth: trajectoryStrokeWidth,
          pointRadius: endpointRadius,
          opacity: trajectoryOpacity,
        }
      }
    );

    // Initialize the animation with the canvas
    await pathlineAnimation.init(canvas);

    timeline = new Timeline<AnimationState>();
    timeline.initialState = { segmentIndex: 0 };

    // Use PathlineAnimation's clip
    timeline.add(pathlineAnimation.clip, { start: 0, end: timing.pauseStart });
    timeline.add(createPauseClip(), { start: timing.pauseStart, end: 1 });

    // Configure timeline
    timeline.duration = animationDuration / 1000;
    timeline.looping = true;

    // Register tick callback
    timeline.onTick((_t, state) => {
      currentSegmentIndex = state.segmentIndex;
      draw(state);
    });
  }

  function startAnimation() {
    if (!timeline) return;
    timeline.play();
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  // Pure renderer: receives state, computes userSegmentIndex from external data
  function draw(state: AnimationState) {
    if (!ctx || !pathlineAnimation) return;

    const { segmentIndex } = state;

    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // --- Static Background ---
    drawScatterPlot(ctx, scaledTargetDistribution, distributionPointRadius, targetColor, targetOpacity);

    // --- Dynamic Foreground ---
    // Draw default trajectories (dimmed if user has clicked)
    const defaultOpacity = hasUserTrajectory ? 0.15 : trajectoryOpacity;
    pathlineAnimation.draw(state, { opacity: defaultOpacity });

    // Draw all user-defined trajectories (highlighted) on top
    if (userTrajectories.length > 0) {
      const validUserTrajectories = userTrajectories.filter(t => t && t.length >= 2);

      if (validUserTrajectories.length > 0) {
        const userNumSegments = validUserTrajectories[0].length - 1;
        const userSegmentIndex = Math.min(segmentIndex, userNumSegments - 1);

        pathlineAnimation.draw(
          { ...state, segmentIndex: userSegmentIndex, pathlines: validUserTrajectories },
          { opacity: 1.0 }
        );
      }

      // Draw starting points for trajectories with only 1 point
      for (const userTrajectory of userTrajectories) {
        if (userTrajectory && userTrajectory.length === 1) {
          const [x, y] = userTrajectory[0];
          ctx.globalAlpha = 1.0;
          ctx.beginPath();
          ctx.arc(x, y, endpointRadius, 0, Math.PI * 2);
          ctx.fillStyle = trajectoryColor;
          ctx.fill();
        }
      }
    }
  }

  // ----------------------------------------------------------------
  // Event Handlers
  // ----------------------------------------------------------------

  // Handle canvas click - convert to domain coordinates and sample
  function handleCanvasClick(event: MouseEvent) {
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
  function sampleFromPoint(point: number[]) {
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
    if (timeline) timeline.reset();
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

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

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

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  $: if (isDataValid && canvas && !isInitialized) {
    runInitialComputation();
    setupTimeline().then(() => {
      if (playingByDefault) startAnimation();
    });
  }

  // Handle visibility changes (pause when off-screen, resume when back)
  $: if (figureIsActive !== undefined && isInitialized) {
    handleVisibilityChange($figureIsActive);
  }
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
            {timeline}
            step={numSegments > 0 ? 1 / numSegments : 0.01}
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
