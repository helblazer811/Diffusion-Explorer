<script lang="ts">
  import { onDestroy, type Snippet } from "svelte";
  import * as d3 from "d3";
  import { Player, DoubleFigure, TimeSlider, drawScatterPlot, Timeline, createPauseClip, useCanvas2D, PathlineAnimation, type PathlineAnimationState, useVisibilityHandler } from "@diffusion-explorer/ui";
  import { type FlowModelClient } from "@diffusion-explorer/diffusion";
  import { settings } from "$lib/settings";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  // FlowModelClient instances (passed from parent, created with correct base path)
  export let flowMatchingClient: FlowModelClient | null = null;
  export let rectifiedFlowClient: FlowModelClient | null = null;

  // Data
  export let leftTrajectories: number[][][] = [];  // [timestep][sample][dim]
  export let rightTrajectories: number[][][] = []; // [timestep][sample][dim]
  export let targetDistribution: number[][] = [];

  // Layout
  export let canvasWidth: number = 400;
  export let canvasHeight: number = 400;
  export let marginWidth: number = 10;
  export let marginHeight: number = 10;
  export let gap: number = 20;
  export let domainRange: { xMin: number; xMax: number; yMin: number; yMax: number } = { xMin: -1.7, xMax: 1.7, yMin: -1.7, yMax: 1.7 };

  // Labels
  export let leftLabel: string = "Flow Matching";
  export let rightLabel: string = "Rectified Flow";
  export let labelFontSize: number = 26;
  export let labelColor: string = settings.stylingSettings.label.color;
  export let labelOpacity: number = settings.stylingSettings.label.opacity;

  // Target distribution styling
  export let targetColor: string = "#3b82f6";
  export let targetOpacity: number = 0.35;
  export let targetPointRadius: number = 5;

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
  export let animationDuration: number = 10000; // Total cycle duration in ms
  export let timing: { pauseStart: number } = {
    pauseStart: 0.8,  // Animation runs 0→0.8, pause 0.8→1.0
  };
  export let playingByDefault: boolean = true;

  // Interactive sampling
  export let maxUserTrajectories: number = settings.interactiveSettings.maxUserTrajectories;

  // Callbacks & misc
  export let onInitialized: (() => void) | undefined = undefined;
  export let backgroundVisible: boolean = true;
  export let showTimeSlider: boolean = true;
  export let children: Snippet | undefined = undefined;

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
  let leftCanvas: HTMLCanvasElement | null = null;
  let rightCanvas: HTMLCanvasElement | null = null;
  const leftCanvas2d = useCanvas2D(canvasWidth, canvasHeight);
  const rightCanvas2d = useCanvas2D(canvasWidth, canvasHeight);
  // Tie ctx reactivity to canvas variables so it updates when action runs
  $: leftCtx = leftCanvas && leftCanvas2d.ctx;
  $: rightCtx = rightCanvas && rightCanvas2d.ctx;

  // Scales
  let xScale: d3.ScaleLinear<number, number>;
  let yScale: d3.ScaleLinear<number, number>;

  // Animation state type - extends PathlineAnimationState
  type AnimationState = PathlineAnimationState;

  // Animation - Timeline system
  let currentSegmentIndex: number = 0;
  let player: Player<AnimationState> | null = null;

  // PathlineAnimation instances for left and right panels
  let leftPathlineAnimation: PathlineAnimation<AnimationState> | null = null;
  let rightPathlineAnimation: PathlineAnimation<AnimationState> | null = null;

  // Initialization
  let isInitialized: boolean = false;
  let pathsInitialized: boolean = false;

  // Pre-computed pixel coordinates (scaled once upfront)
  let scaledTargetDistribution: number[][] = [];  // [point][x,y] in pixels
  let scaledLeftTrajectories: number[][][] = [];    // [trajectory][timestep][x,y] in pixels
  let scaledRightTrajectories: number[][][] = [];   // [trajectory][timestep][x,y] in pixels

  // User-defined trajectory state (supports multiple trajectories)
  let userStartPoints: number[][] = []; // Array of [x, y] domain coordinates
  let userFlowMatchingTrajectories: number[][][] = []; // Array of trajectories, each is [timestep][x,y] in pixels
  let userRectifiedFlowTrajectories: number[][][] = []; // Array of trajectories, each is [timestep][x,y] in pixels
  let hasUserTrajectory: boolean = false;
  let isStreamingTrajectory: boolean = false;
  let streamingCompleteCount: number = 0;
  let activeFlowMatchingRequestId: string | null = null; // Track active request for cancellation
  let activeRectifiedFlowRequestId: string | null = null; // Track active request for cancellation

  // Visibility
  let figureIsActive: boolean;
  const { handleVisibilityChange } = useVisibilityHandler(() => player);

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
  function transposeAndScale(trajectories: number[][][]): number[][][] {
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

  async function setupTimeline() {
    // Create PathlineAnimation instances for both panels
    const pathlineStyle = {
      color: trajectoryColor,
      strokeWidth: trajectoryStrokeWidth,
      pointRadius: endpointRadius,
      opacity: trajectoryOpacity,
    };

    leftPathlineAnimation = PathlineAnimation.fromTrajectories<AnimationState>(
      scaledLeftTrajectories,
      { style: pathlineStyle }
    );

    rightPathlineAnimation = PathlineAnimation.fromTrajectories<AnimationState>(
      scaledRightTrajectories,
      { style: pathlineStyle }
    );

    // Initialize both animations with their respective canvases
    await Promise.all([
      leftPathlineAnimation.init(leftCanvas),
      rightPathlineAnimation.init(rightCanvas),
    ]);

    const tl = Timeline.from<AnimationState>({
      duration: animationDuration / 1000,
      initialState: { segmentIndex: 0 },
      clips: [
        { clip: leftPathlineAnimation.clip, ...{ start: 0, end: timing.pauseStart } },
        { clip: createPauseClip(), ...{ start: timing.pauseStart, end: 1 } },
      ],
    });
    player = new Player(tl, { looping: true });
    player.onTick((_t, state) => {
      currentSegmentIndex = state.segmentIndex;
      updateVisualization(state);
    });

    // Use the clip from PathlineAnimation (both have same numSegments)

    // Set timeline duration

    // Register tick callback
  }

  function startAnimation() {
    if (!player) return;
    player.play();
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  // Draw scatter plot + trajectories (using PathlineAnimation)
  function draw(
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    pathlineAnimation: PathlineAnimation<AnimationState>,
    state: AnimationState,
    userTrajectories: number[][][]
  ) {
    if (!canvas || !ctx || !pathlineAnimation) return;

    // Clear previous frame
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // --- Static Background ---
    drawScatterPlot(ctx, scaledTargetDistribution, targetPointRadius, targetColor, targetOpacity);

    // --- Dynamic Foreground ---
    // Draw default trajectories (dimmed if user has clicked)
    const defaultOpacity = hasUserTrajectory ? 0.15 : trajectoryOpacity;
    pathlineAnimation.draw(state, { opacity: defaultOpacity });

    // Draw all user-defined trajectories (highlighted) on top
    if (userTrajectories.length > 0) {
      // Filter to trajectories with at least 2 points
      const validUserTrajectories = userTrajectories.filter(t => t && t.length >= 2);

      if (validUserTrajectories.length > 0) {
        // Calculate segment index for user trajectories (may have different length)
        const userNumSegments = validUserTrajectories[0].length - 1;
        const userSegmentIndex = Math.min(state.segmentIndex, userNumSegments - 1);

        pathlineAnimation.draw(
          { ...state, segmentIndex: userSegmentIndex, pathlines: validUserTrajectories },
          { opacity: 1.0 }
        );
      }

      // Draw starting points for trajectories with only 1 point (immediate feedback)
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

  // Pure renderer: receives state explicitly
  function updateVisualization(state: AnimationState) {
    if (!isDataValid || !leftCtx || !rightCtx || !leftPathlineAnimation || !rightPathlineAnimation) return;

    draw(leftCanvas2d.canvas, leftCtx, leftPathlineAnimation, state, userFlowMatchingTrajectories);
    draw(rightCanvas2d.canvas, rightCtx, rightPathlineAnimation, state, userRectifiedFlowTrajectories);
  }

  // ----------------------------------------------------------------
  // Event Handlers
  // ----------------------------------------------------------------

  // Handle canvas click - convert to domain coordinates and sample
  function handleCanvasClick(event: MouseEvent, side: string) {
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
  function sampleFromPoint(point: number[]) {
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
    if (player) player.reset();
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
      (_step: number, x_t: number[][]) => {
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
      (_step: number, x_t: number[][]) => {
        userRectifiedFlowTrajectories = userRectifiedFlowTrajectories.map((traj, i) => [
          ...traj,
          [xScale(x_t[i][0]), yScale(x_t[i][1])]
        ]);
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
    // Stop timeline animation
    if (player) player.pause();

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
      {#if showTimeSlider}
        <TimeSlider timeline={player}
          color="#f17720"
        />
      {/if}
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
