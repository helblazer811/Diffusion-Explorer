<!-- Demonstrates Euler sampler trajectory with ground truth, approximation, error, and time-dependent vector field -->

<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import * as d3 from "d3";
  import {
    Figure,
    TimeSlider,
    drawScatterPlot,
    drawVectorField,
    drawTrajectories,
    Timeline,
    FigureLegend,
    useCanvas2D,
    useVisibilityHandler,
  } from "@diffusion-explorer/ui";
  import { settings } from "$lib/settings";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  // FlowModelClient instance (passed from parent, created with correct base path)
  export let flowMatchingClient = null;

  // Data
  export let targetDistribution = [];
  export let flowMatchingVectorField = null;

  // Layout
  export let canvasWidth = 450;
  export let canvasHeight = 450;
  export let marginWidth = 0;
  export let marginHeight = 0;
  export let domainRange = { xMin: -1.9, xMax: 1.9, yMin: -1.9, yMax: 1.9 };

  // Labels
  export let label = "";
  export let labelFontSize = settings.stylingSettings.label.fontSize;
  export let labelColor = settings.stylingSettings.label.color;
  export let labelOpacity = settings.stylingSettings.label.opacity;

  // Target distribution styling
  export let targetColor = "#888888";
  export let targetOpacity = 0.2;
  export let targetPointRadius = 5;

  // Trajectory styling
  export let groundTruthColor = "#22c55e";
  export let groundTruthOpacity = 0.8;
  export let approximationColor = "#f17720";
  export let approximationOpacity = 0.8;
  export let errorColor = "#dc2626";
  export let trajectoryStrokeWidth = 3;
  export let endpointRadius =
    settings.stylingSettings.trajectory.endpointRadius;
  export let trajectoryHeadType = "arrow"; // 'circle' or 'arrow'
  export let trajectoryHeadRadius = 8;

  // Vector field styling
  export let arrowColor = "#3b82f6";
  export let arrowScale = 40;
  export let arrowWidth = 2.5;
  export let arrowOpacity = 0.6;
  export let showArrowHeads = false;
  export let centerQuiver = true;

  // Starting points
  export let defaultStartPoints = [[-1.5, -0.2]];
  export let startPointRadius = endpointRadius;
  export let maxUserTrajectories =
    settings.interactiveSettings.maxUserTrajectories;

  // Callbacks & misc
  export let backgroundVisible = true;
  export let children = undefined;

  // Show/hide options
  export let showGroundTruth = true;
  export let showLegend = true;

  // Constants
  const NUM_STEPS = 16;
  const GROUND_TRUTH_STEPS = 64;
  const STEP_DURATION = 400; // Duration per Euler step in ms
  const PAUSE_BEFORE_RESTART = 1500;

  // Derived from props
  $: caption = children;
  $: isDataValid = targetDistribution?.length > 0;
  $: hasVectorField = flowMatchingVectorField?.velocities?.length > 0;

  // Legend items
  const legendItems = [
    { type: 'line', color: arrowColor, label: 'Velocity Field' },
    { type: 'line', color: groundTruthColor, label: 'Ground Truth' },
    { type: 'line', color: approximationColor, label: `Approximation (${NUM_STEPS} steps)` },
  ];

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  // Canvas
  let canvas = null;
  const canvas2d = useCanvas2D(canvasWidth, canvasHeight);
  $: ctx = canvas && canvas2d.ctx;

  // Scales
  let xScale;
  let yScale;

  // Pre-computed pixel coordinates
  let scaledTargetDistribution = [];
  let gridPositions = [];

  // User-defined start points (domain coordinates)
  let userStartPoints = [...defaultStartPoints];

  // Trajectories
  let groundTruthTrajectories = [];
  let approximationTrajectories = [];

  // Request ID tracking for cancellation
  let groundTruthRequestId = null;
  let activeRequestId = null;
  let isStreamingTrajectory = false;

  // Loading state
  let isLoading = true;
  let isInitialized = false;

  // Visibility
  let figureIsActive;
  const { handleVisibilityChange } = useVisibilityHandler(() => timeline);

  // Animation state type
  type AnimationState = {
    time: number;  // WARNING: Using time in draw() is an antipattern. Prefer derived state.
    currentStep: number;
    segmentIndex: number;
    segmentProgress: number;
  };

  // Timeline and playback state
  let timeline: Timeline<AnimationState> | null = null;
  let animState: AnimationState = { time: 0, currentStep: 0, segmentIndex: 0, segmentProgress: 0 };

  // Derived values from animation state
  $: currentStep = animState.currentStep;
  $: segmentIndex = animState.segmentIndex;
  $: showErrorLines = currentStep >= NUM_STEPS;

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  function initializeScales() {
    if (!isDataValid) return;

    xScale = d3
      .scaleLinear()
      .domain([domainRange.xMin, domainRange.xMax])
      .range([marginWidth, canvasWidth - marginWidth]);

    yScale = d3
      .scaleLinear()
      .domain([domainRange.yMin, domainRange.yMax])
      .range([marginHeight, canvasHeight - marginHeight]);
  }

  function precomputeCoordinates() {
    if (!xScale || !yScale) return;

    scaledTargetDistribution = targetDistribution.map((p) => [
      xScale(p[0]),
      yScale(p[1]),
    ]);

    if (hasVectorField && flowMatchingVectorField.gridPoints) {
      gridPositions = flowMatchingVectorField.gridPoints.map((p) => [
        xScale(p[0]),
        yScale(p[1]),
      ]);
    }
  }

  function cancelAllRequests() {
    if (groundTruthRequestId) {
      flowMatchingClient.stopRequest(groundTruthRequestId);
      groundTruthRequestId = null;
    }
    if (activeRequestId) {
      flowMatchingClient.stopRequest(activeRequestId);
      activeRequestId = null;
    }
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function runInitialComputation() {
    if (!canvas || !isDataValid) return;

    initializeScales();
    precomputeCoordinates();
    isInitialized = true;
    computeAllTrajectories();
  }

  function computeAllTrajectories() {
    cancelAllRequests();

    isLoading = true;
    isStreamingTrajectory = true;

    groundTruthTrajectories = userStartPoints.map((p) => [p]);
    approximationTrajectories = userStartPoints.map((p) => [p]);

    isLoading = false;
    resetAnimation();
    draw(timeline!.initialState);
    startAnimation();

    let completedCount = 0;
    const checkComplete = () => {
      completedCount++;
      if (completedCount >= 2) {
        isStreamingTrajectory = false;
      }
    };

    // Ground truth: streaming with many steps
    const gtResult = flowMatchingClient.sampleFromInitialPoints(
      userStartPoints,
      GROUND_TRUTH_STEPS,
      { scheduler: "euler" },
      (_step, x_t) => {
        groundTruthTrajectories = groundTruthTrajectories.map((traj, i) => [
          ...traj,
          [x_t[i][0], x_t[i][1]],
        ]);
      }
    );
    groundTruthRequestId = gtResult.requestId;
    gtResult.promise.then(() => {
      groundTruthRequestId = null;
      checkComplete();
    });

    // Approximation: streaming with fewer steps
    const approxResult = flowMatchingClient.sampleFromInitialPoints(
      userStartPoints,
      NUM_STEPS,
      { scheduler: "euler" },
      (_step, x_t) => {
        approximationTrajectories = approximationTrajectories.map((traj, i) => [
          ...traj,
          [x_t[i][0], x_t[i][1]],
        ]);
      }
    );
    activeRequestId = approxResult.requestId;
    approxResult.promise.then(() => {
      activeRequestId = null;
      checkComplete();
    });
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  function setupTimeline() {
    const EULER_REAL_DURATION = NUM_STEPS * STEP_DURATION;

    const eulerStepClip = {
      name: "EulerSteps",
      reduce(t: number) {
        const rawStep = t * NUM_STEPS;
        const currentStep = Math.floor(rawStep);
        return {
          time: t,
          currentStep,
          segmentIndex: currentStep,
          segmentProgress: rawStep - currentStep,
        };
      }
    };

    timeline = new Timeline<AnimationState>();
    timeline.initialState = {
      time: 0,
      currentStep: 0,
      segmentIndex: 0,
      segmentProgress: 0,
    };
    timeline.add(eulerStepClip, { start: 0, end: 1 });
    timeline.duration = EULER_REAL_DURATION / 1000;
    timeline.setEndPause(PAUSE_BEFORE_RESTART / 1000);
    timeline.looping = true;

    timeline.onTick((t, state) => {
      if (!isInitialized || isLoading) return;
      animState = state;
      draw(state);
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
    if (!timeline) return;
    timeline.reset();
    animState = timeline.initialState;
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function drawTrajectoryOnCtx(
    ctx,
    trajectory,
    color,
    lineWidth,
    showEndpoint = true,
    scaleX = xScale,
    scaleY = yScale
  ) {
    if (!trajectory || trajectory.length < 2) return;

    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    const [startX, startY] = [
      scaleX(trajectory[0][0]),
      scaleY(trajectory[0][1]),
    ];
    ctx.moveTo(startX, startY);

    for (let i = 1; i < trajectory.length; i++) {
      const [x, y] = [scaleX(trajectory[i][0]), scaleY(trajectory[i][1])];
      ctx.lineTo(x, y);
    }
    ctx.stroke();

    if (showEndpoint) {
      const lastPoint = trajectory[trajectory.length - 1];
      const [endX, endY] = [scaleX(lastPoint[0]), scaleY(lastPoint[1])];
      ctx.beginPath();
      ctx.arc(endX, endY, endpointRadius, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
    }
  }

  function drawStartPointsOnCtx(ctx, scaleX = xScale, scaleY = yScale) {
    for (const point of userStartPoints) {
      const [x, y] = [scaleX(point[0]), scaleY(point[1])];

      ctx.beginPath();
      ctx.arc(x, y, startPointRadius + 2, 0, 2 * Math.PI);
      ctx.strokeStyle = groundTruthColor;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(x, y, startPointRadius, 0, 2 * Math.PI);
      ctx.fillStyle = groundTruthColor;
      ctx.globalAlpha = 0.7;
      ctx.fill();
      ctx.globalAlpha = 1.0;
    }
  }

  function draw(state: AnimationState) {
    if (!ctx) return;

    const { segmentIndex } = state;

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
    // Draw vector field if available
    if (hasVectorField) {
      const maxSegments = NUM_STEPS;
      const animationTime = segmentIndex / maxSegments;
      const numTimeSteps = flowMatchingVectorField.timeSteps.length;
      const timeIndex = Math.min(
        Math.floor(animationTime * numTimeSteps),
        numTimeSteps - 1
      );

      ctx.save();
      ctx.beginPath();
      ctx.rect(
        marginWidth,
        marginHeight,
        canvasWidth - 2 * marginWidth,
        canvasHeight - 2 * marginHeight
      );
      ctx.clip();

      drawVectorField(
        ctx,
        gridPositions,
        flowMatchingVectorField.velocities[timeIndex],
        {
          arrowScale,
          strokeWidth: arrowWidth,
          color: arrowColor,
          opacity: arrowOpacity,
          normalizeVectors: false,
          showArrowHeads,
          centerQuiver,
        }
      );

      ctx.restore();
    }

    // Draw ground truth trajectories
    if (showGroundTruth) {
      ctx.globalAlpha = groundTruthOpacity;
      for (const traj of groundTruthTrajectories) {
        drawTrajectoryOnCtx(
          ctx,
          traj,
          groundTruthColor,
          trajectoryStrokeWidth,
          true
        );
      }
      ctx.globalAlpha = 1.0;
    }

    // Draw approximation trajectories
    if (approximationTrajectories.length > 0) {
      const scaledApproxTrajectories = approximationTrajectories.map(traj =>
        traj.map(point => [xScale(point[0]), yScale(point[1])])
      );

      drawTrajectories(ctx, scaledApproxTrajectories, segmentIndex, {
        color: approximationColor,
        strokeWidth: trajectoryStrokeWidth + 0.5,
        pointRadius: endpointRadius,
        progressOpacity: approximationOpacity,
        headStyle: { type: 'arrow', radius: endpointRadius * 2 }
      });
    }
  }

  // ----------------------------------------------------------------
  // Event Handlers
  // ----------------------------------------------------------------

  function handleCanvasClick(event) {
    if (isLoading) return;

    stopAnimation();
    resetAnimation();

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvasWidth / rect.width;
    const scaleY = canvasHeight / rect.height;
    const clickX = (event.clientX - rect.left) * scaleX;
    const clickY = (event.clientY - rect.top) * scaleY;

    const domainX = xScale.invert(clickX);
    const domainY = yScale.invert(clickY);
    const newPoint = [domainX, domainY];

    userStartPoints = [...userStartPoints, newPoint];
    if (userStartPoints.length > maxUserTrajectories) {
      userStartPoints = userStartPoints.slice(-maxUserTrajectories);
    }

    computeAllTrajectories();
    startAnimation();
  }

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  onMount(() => {
    setupTimeline();
  });

  onDestroy(() => {
    timeline?.dispose();
  });

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  $: if (isDataValid && canvas && !isInitialized && timeline) {
    runInitialComputation();
  }

  // Visibility handling - pause when scrolled off-screen
  $: if (figureIsActive !== undefined && isInitialized) {
    handleVisibilityChange($figureIsActive);
  }
</script>

{#if isDataValid}
  <Figure {caption} {backgroundVisible} bind:isActive={figureIsActive}>
    <div class="panel-container" style="max-width: {canvasWidth}px;">
      {#if label}
        <div
          class="panel-label"
          style="font-size: {labelFontSize}px; color: {labelColor}; opacity: {labelOpacity};"
        >
          {label}
        </div>
      {/if}
      <canvas
        bind:this={canvas}
        use:canvas2d.bindCanvas
        class="panel-canvas"
        onclick={handleCanvasClick}
        style="cursor: {isLoading ? 'wait' : 'pointer'};"
      ></canvas>
      <TimeSlider
        {timeline}
        step={1 / NUM_STEPS}
        discreteFill={true}
        color={approximationColor}
      />
    </div>

    {#snippet footer()}
      {#if showLegend}
        <FigureLegend items={legendItems} />
      {/if}
    {/snippet}
  </Figure>
{:else}
  <div class="placeholder">
    <p>Euler step demo requires target distribution data.</p>
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
