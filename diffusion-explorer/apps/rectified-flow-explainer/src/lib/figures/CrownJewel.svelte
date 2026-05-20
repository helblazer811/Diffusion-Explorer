<script lang="ts">
  import { onDestroy } from "svelte";
  import * as d3 from "d3";
  import { type Writable } from "svelte/store";
  import { Player,
    DoubleFigure,
    TimeSlider,
    drawScatterPlot,
    Timeline,
    useCanvas2D,
    PathlineAnimation,
    type PathlineAnimationState,
    useVisibilityHandler,
  } from "@diffusion-explorer/ui";
  import { FlowModelClient } from "@diffusion-explorer/diffusion";
  import { settings } from "$lib/settings";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  // FlowModelClient instances (passed from parent, created with correct base path)
  export let flowMatchingClient: FlowModelClient | null = null;
  export let rectifiedFlowClient: FlowModelClient | null = null;

  // Data
  export let leftTrajectories: number[][][] = []; // [timestep][sample][dim]
  export let rightTrajectories: number[][][] = []; // [timestep][sample][dim]
  export let targetDistribution: number[][] = [];

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
  export let trajectoryOpacity =
    settings.stylingSettings.trajectory.opacity;
  export let endpointRadius = settings.stylingSettings.trajectory.endpointRadius;

  // Animation
  export let animationDuration = 10000; // Total cycle duration (ms)
  export let playingByDefault = true;
  export let looping = true;

  // Interactive sampling
  export let highlightedTrajectoryOpacity = 1.0;
  export let dimmedTrajectoryOpacity = 0.08;
  export let maxUserTrajectories =
    settings.interactiveSettings.maxUserTrajectories;

  // Callbacks & misc
  export let onInitialized: (() => void) | undefined = undefined;
  export let backgroundVisible: boolean = true;
  export let interactive: boolean = true;
  export let showPlayButton: boolean = true;
  export let durationLabelFontSize: number = 16;
  export let durationLabelSpacing: number = -14;
  export let children: unknown = undefined;

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

  // Single 2D canvas per panel
  let leftCanvas: HTMLCanvasElement | null = null;
  let rightCanvas: HTMLCanvasElement | null = null;
  const leftCanvas2d = useCanvas2D(canvasWidth, canvasHeight);
  const rightCanvas2d = useCanvas2D(canvasWidth, canvasHeight);
  $: leftCtx = leftCanvas && leftCanvas2d.ctx;
  $: rightCtx = rightCanvas && rightCanvas2d.ctx;

  // PathlineAnimation instances (CPU rendering)
  let leftPathlineAnimation: PathlineAnimation<PathlineAnimationState> | null = null;
  let rightPathlineAnimation: PathlineAnimation<PathlineAnimationState> | null = null;

  // Scales
  let xScale: d3.ScaleLinear<number, number>;
  let yScale: d3.ScaleLinear<number, number>;

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
  let player: Player<AnimationState> | null = null;

  // Initialization
  let isInitialized = false;
  let pathsInitialized = false;

  // Pre-computed pixel coordinates (scaled once upfront)
  let scaledTargetDistribution: number[][] = []; // [point][x,y] in pixels - target distribution
  let scaledLeftTrajectories: number[][][] = []; // [trajectory][timestep][x,y] in pixels
  let scaledRightTrajectories: number[][][] = []; // [trajectory][timestep][x,y] in pixels

  // Visibility
  let figureIsActive: Writable<boolean>;
  const { handleVisibilityChange } = useVisibilityHandler(() => player);

  // User-defined trajectory state (supports multiple trajectories)
  let userStartPoints: number[][] = []; // Array of [x, y] domain coordinates
  let userFlowMatchingTrajectories: number[][][] = []; // Array of trajectories, each is [timestep][x,y] in pixels
  let userRectifiedFlowTrajectories: number[][][] = []; // Array of trajectories, each is [timestep][x,y] in pixels
  let hasUserTrajectory: boolean = false;
  let isStreamingTrajectory: boolean = false;
  let activeFlowMatchingRequestId: string | null = null; // Track active request for cancellation
  let activeRectifiedFlowRequestId: string | null = null; // Track active request for cancellation
  let streamingCompleteCount: number = 0;

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
  function transposeAndScale(trajectories: number[][][]) {
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

  async function initPathlineAnimations() {
    if (!leftCanvas || !rightCanvas) return;

    const pathlineStyle = {
      color: trajectoryColor,
      strokeWidth: trajectoryStrokeWidth,
      pointRadius: endpointRadius,
      opacity: trajectoryOpacity,
    };

    leftPathlineAnimation = PathlineAnimation.fromTrajectories<PathlineAnimationState>(
      scaledLeftTrajectories,
      { style: pathlineStyle }
    );

    rightPathlineAnimation = PathlineAnimation.fromTrajectories<PathlineAnimationState>(
      scaledRightTrajectories,
      { style: pathlineStyle }
    );

    await Promise.all([
      leftPathlineAnimation.init(leftCanvas),
      rightPathlineAnimation.init(rightCanvas),
    ]);
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  // Left segment clip - runs full timeline duration
  const leftSegmentClip = {
    name: "LeftSegments",
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
    reduce(t: number) {
      return {
        rightTime: t,
        rightSegmentIndex: Math.floor(t * numSegments),
      };
    },
  };

  function setupTimeline() {
    const tl = Timeline.from<AnimationState>({
      duration: (animationDuration - endPauseDurationMs) / 1000,
      initialState: {},
      clips: [
        { clip: leftSegmentClip, ...{ start: 0, end: 1 } },
        { clip: rightSegmentClip, ...{ start: 0, end: rightSpeedMultiplier } },
      ],
    });
    player = new Player(tl, { looping: looping, endPause: endPauseDurationMs / 1000 });

    // Add clips - both start at 0, right finishes at 0.5 (2x speed)
    // Note: No explicit pause clip needed - Timeline holds final state for ended clips


    // Set timeline duration (animation only) and end pause

    // Register tick callback
    player.onTick((_t, state) => {
      leftTime = state.leftTime;
      rightTime = state.rightTime;
      leftCurrentSegmentIndex = state.leftSegmentIndex;
      rightCurrentSegmentIndex = state.rightSegmentIndex;

      updateLeftVisualization();
      updateRightVisualization();
    });
  }

  function startAnimation() {
    if (!player || player.isPlaying) return;
    player.play();
  }

  function stopAnimation() {
    if (player) player.pause();
  }

  function resetAnimation() {
    if (player) player.reset();
    leftTime = 0;
    rightTime = 0;
    leftCurrentSegmentIndex = 0;
    rightCurrentSegmentIndex = 0;
  }

  export function restart() {
    resetAnimation();
    if (player) player.play();
    isPlaying = true;
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function draw(
    ctx: CanvasRenderingContext2D | null,
    pathlineAnimation: PathlineAnimation<PathlineAnimationState> | null,
    segmentIndex: number,
    userTrajectories: number[][][],
    logicalTime: number
  ) {
    if (!ctx) return;

    // Clear previous frame
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // --- Static Background ---
    if (showTargetScatter) {
      drawScatterPlot(ctx, scaledTargetDistribution, targetPointRadius, targetColor, targetOpacity);
    }

    // --- Dynamic Foreground ---
    if (pathlineAnimation) {
      // Draw default trajectories (dimmed if user has clicked)
      const defaultOpacity = hasUserTrajectory ? dimmedTrajectoryOpacity : trajectoryOpacity;
      const state: PathlineAnimationState = { segmentIndex };
      pathlineAnimation.draw(state, { opacity: defaultOpacity });

      // Draw all user-defined trajectories (highlighted) on top
      if (userTrajectories.length > 0) {
        const validUserTrajectories = userTrajectories.filter(t => t && t.length >= 2);

        if (validUserTrajectories.length > 0) {
          const userNumSegments = validUserTrajectories[0].length - 1;
          const userSegmentIndex = Math.min(
            Math.floor(logicalTime * userNumSegments),
            userNumSegments - 1
          );

          pathlineAnimation.draw(
            { segmentIndex: userSegmentIndex, pathlines: validUserTrajectories },
            { opacity: highlightedTrajectoryOpacity }
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
  }

  function updateLeftVisualization() {
    if (!isDataValid) return;
    draw(leftCtx, leftPathlineAnimation, leftCurrentSegmentIndex, userFlowMatchingTrajectories, leftTime);
  }

  function updateRightVisualization() {
    if (!isDataValid) return;
    draw(rightCtx, rightPathlineAnimation, rightCurrentSegmentIndex, userRectifiedFlowTrajectories, rightTime);
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
  function handleLeftTimeInput(newTime: number) {
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
    if (player) {
      player.seek(leftTime);
    }

    // Update visualizations
    updateLeftVisualization();
    updateRightVisualization();
  }

  // Handler for when user drags the right (fast) slider
  function handleRightTimeInput(newTime: number) {
    if (!pathsInitialized || numSegments === 0) return;

    // Snap to discrete segment and update right side
    rightCurrentSegmentIndex = Math.min(
      Math.floor(newTime * numSegments),
      numSegments - 1
    );
    rightTime = rightCurrentSegmentIndex / numSegments;

    // Calculate timeline position (right covers 0 to rightSpeedMultiplier of player)
    const timelinePosition = rightTime * rightSpeedMultiplier;

    // Sync left side (left covers full player, so leftTime = timelinePosition)
    leftTime = timelinePosition;
    leftCurrentSegmentIndex = Math.min(
      Math.floor(leftTime * numSegments),
      numSegments - 1
    );

    // Seek timeline to corresponding position
    if (player) {
      player.seek(timelinePosition);
    }

    // Update visualizations
    updateLeftVisualization();
    updateRightVisualization();
  }

  // Handle canvas click - convert to domain coordinates and sample
  function handleCanvasClick(event: MouseEvent, side: "left" | "right") {
    // Clients are passed as props; check they're available
    if (!flowMatchingClient || !rectifiedFlowClient) return;

    const canvas = side === "left" ? leftCanvas : rightCanvas;
    if (!canvas) return;
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
  function sampleFromPoint(point: number[]) {
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
    player?.dispose();

    // Destroy PathlineAnimation instances
    leftPathlineAnimation?.destroy();
    rightPathlineAnimation?.destroy();

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
    initPathlineAnimations().then(() => {
      setupTimeline();
    });
  }

  $: if (isPlaying && pathsInitialized && player && !player.isPlaying)
    startAnimation();
  $: if (!isPlaying && player?.isPlaying) stopAnimation();

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
          style="font-size: {subtitleFontSize}px; color: {subtitleColor}; opacity: {labelOpacity};"
        >
          {leftSubtitle}
        </div>
        <canvas
          bind:this={leftCanvas}
          use:leftCanvas2d.bindCanvas
          class="panel-canvas"
          onclick={interactive ? (e) => handleCanvasClick(e, "left") : undefined}
          style={interactive ? "cursor: pointer;" : "pointer-events: none;"}
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
            {showPlayButton}
          />
        </div>
        <div class="duration-label" style="font-size: {durationLabelFontSize}px; margin-top: {durationLabelSpacing}px;">Sampling Duration</div>
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
          style="font-size: {subtitleFontSize}px; color: {subtitleColor}; opacity: {labelOpacity};"
        >
          {rightSubtitle}
        </div>
        <canvas
          bind:this={rightCanvas}
          use:rightCanvas2d.bindCanvas
          class="panel-canvas"
          onclick={interactive ? (e) => handleCanvasClick(e, "right") : undefined}
          style={interactive ? "cursor: pointer;" : "pointer-events: none;"}
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
            {showPlayButton}
          />
        </div>
        <div class="duration-label" style="font-size: {durationLabelFontSize}px; margin-top: {durationLabelSpacing}px;">Sampling Duration</div>
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
