<!-- Demonstrates Euler sampler trajectory with ground truth, approximation, error, and time-dependent vector field -->

<script>
  import { onMount, onDestroy } from "svelte";
  import * as d3 from "d3";
  import {
    Figure,
    TimeSlider,
    drawScatterPlot,
    drawVectorField,
    Clock,
    Track,
    createPauseClip,
    FigureLegend,
    useCanvas2D,
  } from "@diffusion-explorer/ui";
  import { settings } from "$lib/settings";

  // ===== PROPS =====

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

  // ===== CONSTANTS =====

  const NUM_STEPS = 16;
  const GROUND_TRUTH_STEPS = 64;

  // Animation timing
  const STEP_DURATION = 400; // Duration per Euler step in ms
  const PAUSE_BEFORE_RESTART = 1500;

  // ===== DERIVED FROM PROPS =====

  $: caption = children;
  $: isDataValid = targetDistribution?.length > 0;
  $: hasVectorField = flowMatchingVectorField?.velocities?.length > 0;

  // ===== STATE =====

  // Canvas - need both bind:this (for reactivity) and action (for DPR setup)
  let canvas = null;
  const canvas2d = useCanvas2D(canvasWidth, canvasHeight);
  // Tie ctx reactivity to canvas variable so it updates when action runs
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
  let activeRequestId = null; // For approximation streaming
  let isStreamingTrajectory = false;

  // Loading state
  let isLoading = true;

  // Initialization
  let isInitialized = false;

  // Animation state (owned by component, mutated by animation system)
  let animationState = {
    time: 0,
    currentStep: 0,
    segmentIndex: 0,
    segmentProgress: 1,
  };

  // Euler step clip - maps normalized time to discrete steps
  const eulerStepClip = {
    name: "EulerSteps",
    duration: 1,
    apply(t, { numSteps }, state) {
      state.time = t;
      state.currentStep = Math.round(t * numSteps);
      state.segmentIndex = state.currentStep;
      state.segmentProgress = 1;
    }
  };

  // Animation system setup
  // Calculate normalized durations for euler steps + pause
  // Total animation = euler steps duration + pause duration
  const EULER_REAL_DURATION = NUM_STEPS * STEP_DURATION; // 6400ms
  const TOTAL_REAL_DURATION = EULER_REAL_DURATION + PAUSE_BEFORE_RESTART; // 7900ms
  const eulerNormalizedDuration = EULER_REAL_DURATION / TOTAL_REAL_DURATION; // ~0.81
  const pauseNormalizedDuration = PAUSE_BEFORE_RESTART / TOTAL_REAL_DURATION; // ~0.19

  // Create track with euler + pause sequence
  const track = new Track();
  track.add({ ...eulerStepClip, duration: eulerNormalizedDuration }, 0);
  track.add(createPauseClip(pauseNormalizedDuration), eulerNormalizedDuration);
  track.duration = 1;
  track.looping = true;

  const clock = new Clock();

  // Playback state
  let isPlaying = true;

  // Time value (bound to slider, updated by animation)
  let time = 0;

  // Derived values from animation state
  $: currentStep = animationState.currentStep;
  $: segmentIndex = animationState.segmentIndex;
  $: segmentProgress = animationState.segmentProgress;
  $: showErrorLines = currentStep >= NUM_STEPS;

  // Legend items
  const legendItems = [
    { type: 'line', color: arrowColor, label: 'Velocity Field' },
    { type: 'line', color: groundTruthColor, label: 'Ground Truth' },
    { type: 'line', color: approximationColor, label: `Approximation (${NUM_STEPS} steps)` },
  ];

  // ===== FUNCTIONS =====

  function initializeScales() {
    if (!isDataValid) return;

    // Always use domainRange prop
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

    // Pre-compute vector field grid positions
    if (hasVectorField && flowMatchingVectorField.gridPoints) {
      gridPositions = flowMatchingVectorField.gridPoints.map((p) => [
        xScale(p[0]),
        yScale(p[1]),
      ]);
    }
  }

  // Cancel all in-flight requests
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

  // Compute all trajectories for all start points
  // Streams both ground truth and approximation in parallel for immediate feedback
  function computeAllTrajectories() {
    // Cancel any in-progress requests
    cancelAllRequests();

    isLoading = true;
    isStreamingTrajectory = true;

    // Initialize all trajectories with just starting points
    groundTruthTrajectories = userStartPoints.map((p) => [p]);
    approximationTrajectories = userStartPoints.map((p) => [p]);

    // Show initial state immediately and start animation
    isLoading = false;
    resetAnimation();
    isPlaying = true;
    draw();
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
      // onStep - append new points to each ground truth trajectory
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
      // onStep - append new points to each approximation trajectory
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

  // Draw a full trajectory path on a given context
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

  // Draw partial trajectory up to segment with interpolation
  function drawPartialTrajectoryOnCtx(
    ctx,
    trajectory,
    segIdx,
    progress,
    color,
    lineWidth,
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

    // Draw complete segments
    for (let i = 1; i <= segIdx && i < trajectory.length; i++) {
      const [x, y] = [scaleX(trajectory[i][0]), scaleY(trajectory[i][1])];
      ctx.lineTo(x, y);
    }

    // Draw partial segment with interpolation
    if (segIdx < trajectory.length - 1 && progress > 0) {
      const fromPt = trajectory[segIdx];
      const toPt = trajectory[segIdx + 1];
      const interpX = fromPt[0] + (toPt[0] - fromPt[0]) * progress;
      const interpY = fromPt[1] + (toPt[1] - fromPt[1]) * progress;
      ctx.lineTo(scaleX(interpX), scaleY(interpY));
    }

    ctx.stroke();

    // Draw endpoint at current position
    let endX, endY;
    if (segIdx < trajectory.length - 1 && progress > 0) {
      const fromPt = trajectory[segIdx];
      const toPt = trajectory[segIdx + 1];
      endX = scaleX(fromPt[0] + (toPt[0] - fromPt[0]) * progress);
      endY = scaleY(fromPt[1] + (toPt[1] - fromPt[1]) * progress);
    } else {
      const pt = trajectory[Math.min(segIdx, trajectory.length - 1)];
      endX = scaleX(pt[0]);
      endY = scaleY(pt[1]);
    }
    ctx.beginPath();
    ctx.arc(endX, endY, endpointRadius, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
  }

  // Draw start point markers on a given context
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

  function draw() {
    if (!ctx) return;

    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // Draw target distribution (low opacity background)
    drawScatterPlot(
      ctx,
      scaledTargetDistribution,
      targetPointRadius,
      targetColor,
      targetOpacity
    );

    // Draw vector field if available (clipped to domain range)
    if (hasVectorField) {
      // Calculate time from animation progress (0 to 1)
      const maxSegments = NUM_STEPS;
      const animationTime = (segmentIndex + segmentProgress) / maxSegments;
      const numTimeSteps = flowMatchingVectorField.timeSteps.length;
      const timeIndex = Math.min(
        Math.floor(animationTime * numTimeSteps),
        numTimeSteps - 1
      );

      // Clip to domain range
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

    // Draw approximation trajectories (animated)
    if (approximationTrajectories.length > 0) {
      ctx.globalAlpha = approximationOpacity;
      for (const traj of approximationTrajectories) {
        drawPartialTrajectoryOnCtx(
          ctx,
          traj,
          segmentIndex,
          segmentProgress,
          approximationColor,
          trajectoryStrokeWidth + 0.5
        );
      }
      ctx.globalAlpha = 1.0;
    }
  }

  // Animation control functions using new animation system
  function startAnimation() {
    if (clock.isRunning) return;

    clock.start((dt) => {
      if (!isInitialized || isLoading) return;

      // Convert real time (seconds) to normalized animation time
      // Total duration includes euler steps + pause
      const totalDurationSeconds = TOTAL_REAL_DURATION / 1000;
      const normalizedDt = dt / totalDurationSeconds;

      track.update(normalizedDt, { numSteps: NUM_STEPS }, animationState);

      // Sync time for slider binding (scaled to euler portion only)
      time = animationState.time;

      // Trigger Svelte reactivity by reassigning
      animationState = animationState;

      draw();
    });
  }

  function stopAnimation() {
    clock.stop();
  }

  function resetAnimation() {
    track.reset();
    animationState = {
      time: 0,
      currentStep: 0,
      segmentIndex: 0,
      segmentProgress: 1,
    };
    time = 0;
  }

  function toggleAnimation() {
    isPlaying = !isPlaying;
    if (isPlaying) {
      startAnimation();
    } else {
      stopAnimation();
    }
  }

  // Handle slider scrubbing (when user manually changes time)
  function handleSliderChange(newTime) {
    // Update track time directly
    track.time = newTime;
    // Apply the clip to update animationState
    track.update(0, { numSteps: NUM_STEPS }, animationState);
    // Trigger reactivity
    animationState = animationState;
    draw();
  }

  // Handle canvas click
  function handleCanvasClick(event) {
    if (isLoading) return;

    // Stop animation and reset state
    stopAnimation();
    resetAnimation();
    isPlaying = true;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvasWidth / rect.width;
    const scaleY = canvasHeight / rect.height;
    const clickX = (event.clientX - rect.left) * scaleX;
    const clickY = (event.clientY - rect.top) * scaleY;

    const domainX = xScale.invert(clickX);
    const domainY = yScale.invert(clickY);
    const newPoint = [domainX, domainY];

    // Add new point to buffer (FIFO with max limit)
    userStartPoints = [...userStartPoints, newPoint];
    if (userStartPoints.length > maxUserTrajectories) {
      userStartPoints = userStartPoints.slice(-maxUserTrajectories);
    }

    // Recompute all trajectories (cancels any in-progress requests)
    computeAllTrajectories();
  }

  function initializeVisualization() {
    if (!canvas || !isDataValid) return;

    initializeScales();
    precomputeCoordinates();
    isInitialized = true;
    computeAllTrajectories();
  }

  // ===== REACTIVE EFFECTS =====

  $: if (isDataValid && canvas && !isInitialized) {
    initializeVisualization();
  }

  // Handle slider scrubbing - when time changes from slider (not from animation)
  // This syncs the slider value back to the animation state
  $: if (isInitialized && !clock.isRunning && time !== animationState.time) {
    handleSliderChange(time);
  }

  // Start/stop animation when isPlaying changes
  $: if (isInitialized && isPlaying && !clock.isRunning) {
    startAnimation();
  }

  // ===== LIFECYCLE =====

  onMount(() => {
    // Initialization handled by reactive statement
  });

  onDestroy(() => {
    stopAnimation();
  });
</script>

{#if isDataValid}
  <Figure {caption} {backgroundVisible}>
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
        bind:value={time}
        bind:isPlaying
        min={0}
        max={1}
        step={1 / NUM_STEPS}
        discreteFill={true}
        onTogglePlay={toggleAnimation}
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
