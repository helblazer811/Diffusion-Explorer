<script lang="ts">
  import { onDestroy, type Snippet } from "svelte";
  import type { Writable } from "svelte/store";
  import * as d3 from "d3";
  import {
    DoubleFigure,
    TimeSlider,
    drawScatterPlot,
    Timeline,
    useCanvas2D,
    useVisibilityHandler,
    createPauseClip,
    PathlineAnimation,
    type PathlineAnimationState,
  } from "@diffusion-explorer/ui";
  import type { DiffusionModelClient } from "@diffusion-explorer/diffusion";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  interface Props {
    diffusionClient?: DiffusionModelClient | null;
    leftTrajectories?: number[][][]; // [timestep][sample][dim] - DDPM
    rightTrajectories?: number[][][]; // [timestep][sample][dim] - DDIM
    targetDistribution?: number[][];
    canvasWidth?: number;
    canvasHeight?: number;
    marginWidth?: number;
    marginHeight?: number;
    gap?: number;
    domainRange?: { xMin: number; xMax: number; yMin: number; yMax: number };
    leftLabel?: string;
    rightLabel?: string;
    labelFontSize?: number;
    labelColor?: string;
    labelOpacity?: number;
    targetColor?: string;
    targetOpacity?: number;
    targetPointRadius?: number;
    trajectoryColor?: string;
    trajectoryStrokeWidth?: number;
    trajectoryPointRadius?: number;
    trajectoryProgressOpacity?: number;
    trajectoryPreviewOpacity?: number;
    animationDuration?: number;
    timing?: { pauseStart: number };
    playingByDefault?: boolean;
    highlightedTrajectoryOpacity?: number;
    dimmedTrajectoryOpacity?: number;
    maxUserTrajectories?: number;
    numSteps?: number;
    onInitialized?: () => void;
    backgroundVisible?: boolean;
    children?: Snippet;
  }

  let {
    diffusionClient = null,
    leftTrajectories = [],
    rightTrajectories = [],
    targetDistribution = [],
    canvasWidth = 400,
    canvasHeight = 400,
    marginWidth = 10,
    marginHeight = 10,
    gap = 20,
    domainRange = { xMin: -1.7, xMax: 1.7, yMin: -1.7, yMax: 1.7 },
    leftLabel = "DDPM (Stochastic)",
    rightLabel = "DDIM (Deterministic)",
    labelFontSize = 30,
    labelColor = "#333",
    labelOpacity = 1.0,
    targetColor = "#3b82f6",
    targetOpacity = 0.35,
    targetPointRadius = 5,
    trajectoryColor = "#f17720",
    trajectoryStrokeWidth = 2,
    trajectoryPointRadius = 4,
    trajectoryProgressOpacity = 0.8,
    trajectoryPreviewOpacity = 0.15,
    animationDuration = 11500, // Total cycle duration in ms
    timing = { pauseStart: 0.870 }, // Animation runs 0→0.870, pause 0.870→1.0
    playingByDefault = true,
    highlightedTrajectoryOpacity = 1.0,
    dimmedTrajectoryOpacity = 0.15,
    maxUserTrajectories = 3,
    numSteps = 200,
    onInitialized = undefined,
    backgroundVisible = true,
    children = undefined,
  }: Props = $props();

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  let caption = $derived(children);
  let isDataValid = $derived(
    leftTrajectories?.length > 0 &&
    rightTrajectories?.length > 0 &&
    targetDistribution?.length > 0
  );
  let numTimeSteps = $derived(isDataValid ? leftTrajectories.length : 1);
  let numSegments = $derived(numTimeSteps - 1);

  // Canvas
  let leftCanvas: HTMLCanvasElement | null = $state(null);
  let rightCanvas: HTMLCanvasElement | null = $state(null);
  const leftCanvas2d = useCanvas2D(canvasWidth, canvasHeight);
  const rightCanvas2d = useCanvas2D(canvasWidth, canvasHeight);
  let leftCtx = $derived(leftCanvas && leftCanvas2d.ctx);
  let rightCtx = $derived(rightCanvas && rightCanvas2d.ctx);

  // Scales
  let xScale: d3.ScaleLinear<number, number> | undefined;
  let yScale: d3.ScaleLinear<number, number> | undefined;

  // Animation state type - extends PathlineAnimationState
  type AnimationState = PathlineAnimationState & { time: number };

  let isPlaying = $state(playingByDefault);
  let currentTime = $state(0);
  let currentSegmentIndex = $state(0);

  // Timeline
  let timeline: Timeline<AnimationState> | null = null;

  // PathlineAnimation instances for left and right panels
  let leftPathlineAnimation: PathlineAnimation<AnimationState> | null = null;
  let rightPathlineAnimation: PathlineAnimation<AnimationState> | null = null;

  // Initialization flags
  let isInitialized = $state(false);
  let pathsInitialized = $state(false);

  // Pre-computed pixel coordinates
  let scaledTargetDistribution: number[][] = [];
  let scaledLeftTrajectories: number[][][] = [];
  let scaledRightTrajectories: number[][][] = [];

  // Visibility
  let figureIsActive: Writable<boolean> | undefined;
  const { handleVisibilityChange } = useVisibilityHandler(() => timeline);

  // User trajectory state
  let userStartPoints: number[][] = $state([]);
  let userDDPMTrajectories: number[][][] = $state([]);
  let userDDIMTrajectories: number[][][] = $state([]);
  let hasUserTrajectory = $state(false);
  let isStreamingTrajectory = $state(false);
  let activeDDPMRequestId: string | null = null;
  let activeDDIMRequestId: string | null = null;
  let streamingCompleteCount = $state(0);

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

  function transposeAndScale(trajectories: number[][][]): number[][][] {
    if (!xScale || !yScale || !trajectories || trajectories.length === 0)
      return [];
    const numSamples = trajectories[0]?.length || 0;
    return Array.from({ length: numSamples }, (_, i) =>
      trajectories.map((ts) => [xScale!(ts[i][0]), yScale!(ts[i][1])])
    );
  }

  function precomputeCoordinates() {
    if (!xScale || !yScale) return;

    scaledLeftTrajectories = transposeAndScale(leftTrajectories);
    scaledRightTrajectories = transposeAndScale(rightTrajectories);

    scaledTargetDistribution = targetDistribution.map((p) => [
      xScale!(p[0]),
      yScale!(p[1]),
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

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  function setupTimeline() {
    // Create PathlineAnimation instances for both panels
    const pathlineStyle = {
      color: trajectoryColor,
      strokeWidth: trajectoryStrokeWidth,
      pointRadius: trajectoryPointRadius,
      progressOpacity: trajectoryProgressOpacity,
      showPreview: true,
      previewOpacity: trajectoryPreviewOpacity,
    };

    leftPathlineAnimation = PathlineAnimation.fromTrajectories<AnimationState>(
      scaledLeftTrajectories,
      { style: pathlineStyle }
    );

    rightPathlineAnimation = PathlineAnimation.fromTrajectories<AnimationState>(
      scaledRightTrajectories,
      { style: pathlineStyle }
    );

    // Create a clip that includes both segmentIndex and time
    const segmentClip = {
      name: "Segments",
      reduce(t: number) {
        return {
          time: t,
          segmentIndex: Math.floor(t * (leftPathlineAnimation?.data.numSegments ?? numSegments)),
        };
      },
    };

    timeline = new Timeline<AnimationState>();
    timeline.initialState = {
      time: 0,
      segmentIndex: 0,
    };

    // Add clips using normalized timing
    timeline.add(segmentClip, { start: 0, end: timing.pauseStart });
    timeline.add(createPauseClip(), { start: timing.pauseStart, end: 1 });

    // Configure timeline
    timeline.duration = animationDuration / 1000;
    timeline.looping = true;

    timeline.onTick((_t, state) => {
      currentTime = state.time;
      currentSegmentIndex = state.segmentIndex;

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
    currentTime = 0;
    currentSegmentIndex = 0;
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function draw(
    ctx: CanvasRenderingContext2D,
    pathlineAnimation: PathlineAnimation<AnimationState>,
    state: AnimationState,
    userTrajectories: number[][][]
  ) {
    if (!ctx || !pathlineAnimation) return;

    const { time: logicalTime } = state;

    // Clear canvas
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // --- Static Background ---
    drawScatterPlot(
      ctx,
      scaledTargetDistribution,
      targetPointRadius,
      targetColor,
      targetOpacity
    );

    // --- Dynamic Foreground ---
    const defaultOpacity = hasUserTrajectory
      ? dimmedTrajectoryOpacity
      : trajectoryProgressOpacity;
    pathlineAnimation.draw(ctx, state, { progressOpacity: defaultOpacity });

    // Draw user trajectories (highlighted)
    if (userTrajectories.length > 0) {
      const validUserTrajectories = userTrajectories.filter(t => t && t.length >= 2);

      if (validUserTrajectories.length > 0) {
        const userNumSegments = validUserTrajectories[0].length - 1;
        const userSegmentIndex = Math.floor(logicalTime * userNumSegments);

        pathlineAnimation.draw(
          ctx,
          { ...state, segmentIndex: userSegmentIndex, pathlines: validUserTrajectories },
          { progressOpacity: highlightedTrajectoryOpacity }
        );
      }

      // Draw starting points for trajectories with only 1 point
      for (const userTrajectory of userTrajectories) {
        if (userTrajectory && userTrajectory.length === 1) {
          const [x, y] = userTrajectory[0];
          ctx.globalAlpha = highlightedTrajectoryOpacity;
          ctx.beginPath();
          ctx.arc(x, y, trajectoryPointRadius, 0, Math.PI * 2);
          ctx.fillStyle = trajectoryColor;
          ctx.fill();
        }
      }
    }

    ctx.globalAlpha = 1.0;
  }

  function getCurrentState(): AnimationState {
    return {
      time: currentTime,
      segmentIndex: currentSegmentIndex,
    };
  }

  function updateLeftVisualization() {
    if (!isDataValid || !leftCtx || !leftPathlineAnimation) return;
    draw(
      leftCtx,
      leftPathlineAnimation,
      getCurrentState(),
      userDDPMTrajectories
    );
  }

  function updateRightVisualization() {
    if (!isDataValid || !rightCtx || !rightPathlineAnimation) return;
    draw(
      rightCtx,
      rightPathlineAnimation,
      getCurrentState(),
      userDDIMTrajectories
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

  function handleTimeInput(newTime: number) {
    if (!pathsInitialized || numSegments === 0) return;

    currentSegmentIndex = Math.min(
      Math.floor(newTime * numSegments),
      numSegments - 1
    );
    currentTime = currentSegmentIndex / numSegments;

    if (timeline) {
      timeline.seek(currentTime);
    }

    updateLeftVisualization();
    updateRightVisualization();
  }

  function handleCanvasClick(event: MouseEvent, side: "left" | "right") {
    if (!diffusionClient) return;

    const canvas = side === "left" ? leftCanvas : rightCanvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();

    const scaleX = canvasWidth / rect.width;
    const scaleY = canvasHeight / rect.height;
    const clickX = (event.clientX - rect.left) * scaleX;
    const clickY = (event.clientY - rect.top) * scaleY;

    if (!xScale || !yScale) return;
    const domainX = xScale.invert(clickX);
    const domainY = yScale.invert(clickY);

    sampleFromPoint([domainX, domainY]);
  }

  function sampleFromPoint(point: number[]) {
    if (!diffusionClient || !xScale || !yScale) return;

    // Cancel any in-flight requests
    if (activeDDPMRequestId) {
      diffusionClient.stopRequest(activeDDPMRequestId);
      activeDDPMRequestId = null;
    }
    if (activeDDIMRequestId) {
      diffusionClient.stopRequest(activeDDIMRequestId);
      activeDDIMRequestId = null;
    }

    userStartPoints = [...userStartPoints, point];

    if (userStartPoints.length > maxUserTrajectories) {
      userStartPoints = userStartPoints.slice(-maxUserTrajectories);
    }

    hasUserTrajectory = true;
    isStreamingTrajectory = true;
    streamingCompleteCount = 0;

    // Initialize with starting points
    userDDPMTrajectories = userStartPoints.map((p) => [
      [xScale!(p[0]), yScale!(p[1])],
    ]);
    userDDIMTrajectories = userStartPoints.map((p) => [
      [xScale!(p[0]), yScale!(p[1])],
    ]);

    resetAnimation();
    isPlaying = true;

    function checkComplete() {
      streamingCompleteCount++;
      if (streamingCompleteCount >= 2) {
        isStreamingTrajectory = false;
      }
    }

    // Sample with DDPM scheduler (left panel)
    const ddpmResult = diffusionClient.sampleFromInitialPoints(
      userStartPoints,
      numSteps,
      { scheduler: 'ddpm' },
      (_step: number, x_t: number[][]) => {
        userDDPMTrajectories = userDDPMTrajectories.map(
          (traj, i) => [...traj, [xScale!(x_t[i][0]), yScale!(x_t[i][1])]]
        );
      }
    );
    activeDDPMRequestId = ddpmResult.requestId;
    ddpmResult.promise.then(checkComplete);

    // Sample with DDIM scheduler (right panel)
    const ddimResult = diffusionClient.sampleFromInitialPoints(
      userStartPoints,
      numSteps,
      { scheduler: 'ddim' },
      (_step: number, x_t: number[][]) => {
        userDDIMTrajectories = userDDIMTrajectories.map(
          (traj, i) => [...traj, [xScale!(x_t[i][0]), yScale!(x_t[i][1])]]
        );
      }
    );
    activeDDIMRequestId = ddimResult.requestId;
    ddimResult.promise.then(checkComplete);
  }

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  onDestroy(() => {
    timeline?.dispose();

    if (activeDDPMRequestId && diffusionClient) {
      diffusionClient.stopRequest(activeDDPMRequestId);
    }
    if (activeDDIMRequestId && diffusionClient) {
      diffusionClient.stopRequest(activeDDIMRequestId);
    }
  });

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  $effect(() => {
    if (isDataValid && leftCanvas && rightCanvas && !isInitialized) {
      runInitialComputation();
      setupTimeline();
    }
  });

  $effect(() => {
    if (isPlaying && pathsInitialized && timeline && !timeline.isPlaying) {
      startAnimation();
    }
  });

  $effect(() => {
    if (!isPlaying && timeline?.isPlaying) {
      stopAnimation();
    }
  });

  $effect(() => {
    if (figureIsActive && isInitialized) {
      const unsubscribe = figureIsActive.subscribe((active: boolean) => {
        handleVisibilityChange(active);
      });
      return unsubscribe;
    }
  });
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
        <canvas
          bind:this={leftCanvas}
          use:leftCanvas2d.bindCanvas
          class="panel-canvas"
          onclick={(e) => handleCanvasClick(e, "left")}
          style="cursor: pointer;"
        ></canvas>
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
        <canvas
          bind:this={rightCanvas}
          use:rightCanvas2d.bindCanvas
          class="panel-canvas"
          onclick={(e) => handleCanvasClick(e, "right")}
          style="cursor: pointer;"
        ></canvas>
      </div>
    {/snippet}

    {#snippet footer()}
      <div class="footer-slider">
        <TimeSlider
          bind:value={currentTime}
          {isPlaying}
          min={0}
          max={1}
          onTogglePlay={togglePlayPause}
          color="#f17720"
          showTicks={false}
          showTimeLabel={false}
          dragEnabled={true}
          onInput={handleTimeInput}
        />
      </div>
    {/snippet}
  </DoubleFigure>
{:else}
  <div class="placeholder">
    <p>Loading data...</p>
  </div>
{/if}

<style>
  .panel-container {
    width: 100%;
  }

  .panel-label {
    text-align: center;
    padding-bottom: 8px;
    font-weight: 500;
  }

  .panel-canvas {
    width: 100%;
    height: auto;
    display: block;
  }

  .footer-slider {
    width: 100%;
    max-width: 600px;
    margin: 0 auto;
    padding: 16px 24px 0;
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
    .footer-slider {
      padding: 12px 16px 0;
    }
  }
</style>
