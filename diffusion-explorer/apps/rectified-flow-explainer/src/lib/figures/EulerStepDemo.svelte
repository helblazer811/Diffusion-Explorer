<!-- Demonstrates Euler sampler trajectory with ground truth, approximation, error, and time-dependent vector field -->

<script>
  import { onMount, onDestroy } from "svelte";
  import * as d3 from "d3";
  import {
    Figure,
    drawScatterPlot,
    drawVectorField,
  } from "@diffusion-explorer/ui";
  import { settings } from "$lib/settings";
  import { callSamplingWorkerThreadFromInitialPoints } from "@diffusion-explorer/diffusion";

  // ===== PROPS =====

  // Data
  export let targetDistribution = [];
  export let flowMatchingVectorField = null;

  // Layout
  export let canvasWidth = 400;
  export let canvasHeight = 400;
  export let marginWidth = 10;
  export let marginHeight = 10;
  export let domainRange = { xMin: -1.9, xMax: 1.9, yMin: -1.9, yMax: 1.9 };

  // Labels
  export let label = "Velocity Field";
  export let labelFontSize = settings.stylingSettings.label.fontSize;
  export let labelColor = settings.stylingSettings.label.color;

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
  export let endpointRadius = settings.stylingSettings.trajectory.endpointRadius;
  export let trajectoryHeadType = 'arrow'; // 'circle' or 'arrow'
  export let trajectoryHeadRadius = 8;

  // Vector field styling
  export let arrowColor = "#3b82f6";
  export let arrowScale = 45;
  export let arrowWidth = 2.5;
  export let arrowOpacity = 0.6;
  export let showArrowHeads = false;
  export let centerQuiver = true;

  // Starting points
  export let defaultStartPoints = [
    [-1.5, -0.2],
    [1.2, 0.0],
    [0.3, -0.7],
  ];
  export let startPointRadius = endpointRadius;
  export let maxStartPoints = 5;

  // Callbacks & misc
  export let backgroundVisible = true;
  export let children = undefined;

  // ===== CONSTANTS =====

  const NUM_STEPS = 8;
  const GROUND_TRUTH_STEPS = 64;

  // Animation timing
  const SEGMENT_DURATION = 600;
  const SEGMENT_PAUSE_DURATION = 400;
  const END_PAUSE_DURATION = 2500;

  // ===== DERIVED FROM PROPS =====

  $: caption = children;
  $: isDataValid = targetDistribution?.length > 0;
  $: hasVectorField = flowMatchingVectorField?.velocities?.length > 0;

  // ===== STATE =====

  // Canvas
  let canvas;
  let ctx;
  let dpr = 1;

  // Scales
  let xScale;
  let yScale;

  // Pre-computed pixel coordinates
  let scaledTargetDistribution = [];
  let gridPositions = [];

  // Starting points (domain coordinates)
  let startPoints = [...defaultStartPoints];

  // Trajectories
  let groundTruthTrajectories = [];
  let approximationTrajectories = [];

  // Loading state
  let isLoading = true;

  // Streaming state for ground truth trajectories
  let streamingGroundTruths = [];
  let isStreamingGroundTruth = false;

  // Initialization
  let isInitialized = false;

  // Animation state
  let animationFrameId = null;
  let segmentIndex = 0;
  let segmentProgress = 0;
  let lastAnimationTime = null;
  let isPaused = false;
  let pauseStartTime = null;
  let showErrorLines = false;

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

  function initializeCanvas() {
    dpr = window.devicePixelRatio || 1;

    if (canvas) {
      canvas.width = canvasWidth * dpr;
      canvas.height = canvasHeight * dpr;
      ctx = canvas.getContext("2d");
      ctx.scale(dpr, dpr);
    }
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

  // Sample trajectories for multiple points using Euler scheduler
  // Returns array of trajectories, one per point
  async function sampleTrajectoriesBatch(points, numSteps) {
    return new Promise((resolve) => {
      callSamplingWorkerThreadFromInitialPoints(
        settings.samplingWorkerUrl,
        settings.flowMatchingModelPath,
        "Flow Matching",
        settings.trainingSettings.modelConfig,
        points,
        numSteps,
        (allSamples) => {
          // allSamples format: [timestep][sample][dim]
          // Extract trajectories for each point
          const trajectories = points.map((point, pointIdx) => [
            point,
            ...allSamples.map((ts) => [ts[pointIdx][0], ts[pointIdx][1]]),
          ]);
          resolve(trajectories);
        },
        settings.trainingSettings.domainRange,
        { scheduler: "euler" }
      );
    });
  }

  // Compute all trajectories for all start points
  async function computeAllTrajectories() {
    isLoading = true;
    isStreamingGroundTruth = true;

    const numPoints = startPoints.length;

    // Clear previous ground truths
    groundTruthTrajectories = [];

    // Initialize streaming trajectories with start points
    streamingGroundTruths = startPoints.map((pt) => [
      [xScale(pt[0]), yScale(pt[1])],
    ]);

    // Draw immediately to show initial points
    draw();

    let completeCount = 0;

    async function onGroundTruthComplete() {
      completeCount++;
      if (completeCount >= numPoints) {
        isStreamingGroundTruth = false;

        // Convert streaming trajectories to domain coordinates
        groundTruthTrajectories = streamingGroundTruths.map((traj) =>
          traj.map((p) => [xScale.invert(p[0]), yScale.invert(p[1])])
        );

        // Compute approximation trajectories
        await computeApproximationTrajectories();
      }
    }

    // Stream ground truth for each start point
    startPoints.forEach((point, idx) => {
      callSamplingWorkerThreadFromInitialPoints(
        settings.samplingWorkerUrl,
        settings.flowMatchingModelPath,
        "Flow Matching",
        settings.trainingSettings.modelConfig,
        [point],
        GROUND_TRUTH_STEPS,
        onGroundTruthComplete,
        settings.trainingSettings.domainRange,
        { scheduler: "euler" },
        (_step, x_t) => {
          const newPoint = [xScale(x_t[0][0]), yScale(x_t[0][1])];
          streamingGroundTruths[idx] = [
            ...streamingGroundTruths[idx],
            newPoint,
          ];
          draw();
        }
      );
    });
  }

  // Compute approximation trajectories
  async function computeApproximationTrajectories() {
    // Batch all points together in a single call
    approximationTrajectories = await sampleTrajectoriesBatch(startPoints, NUM_STEPS);

    // Start animation
    isLoading = false;
    segmentIndex = 0;
    segmentProgress = 0;
    showErrorLines = false;
    startAnimation();
  }

  // Draw a full trajectory path on a given context
  function drawTrajectoryOnCtx(ctx, trajectory, color, lineWidth, showEndpoint = true, scaleX = xScale, scaleY = yScale) {
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
  function drawPartialTrajectoryOnCtx(ctx, trajectory, segIdx, progress, color, lineWidth, scaleX = xScale, scaleY = yScale) {
    if (!trajectory || trajectory.length < 2) return;

    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    const [startX, startY] = [scaleX(trajectory[0][0]), scaleY(trajectory[0][1])];
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
    for (const point of startPoints) {
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

  // Draw streaming trajectory (already in pixel coordinates)
  function drawStreamingTrajectory(ctx, pixelTrajectory, color, lineWidth) {
    if (!pixelTrajectory || pixelTrajectory.length < 2) return;

    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    ctx.moveTo(pixelTrajectory[0][0], pixelTrajectory[0][1]);
    for (let i = 1; i < pixelTrajectory.length; i++) {
      ctx.lineTo(pixelTrajectory[i][0], pixelTrajectory[i][1]);
    }
    ctx.stroke();

    const lastPoint = pixelTrajectory[pixelTrajectory.length - 1];
    ctx.beginPath();
    ctx.arc(lastPoint[0], lastPoint[1], endpointRadius, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
  }

  // Draw error line from ground truth endpoint to approximation endpoint
  function drawErrorLine(ctx, groundTruthEndpoint, approxEndpoint, color, lineWidth) {
    if (!groundTruthEndpoint || !approxEndpoint) return;

    const [gtX, gtY] = [
      xScale(groundTruthEndpoint[0]),
      yScale(groundTruthEndpoint[1]),
    ];
    const [apX, apY] = [xScale(approxEndpoint[0]), yScale(approxEndpoint[1])];

    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash([6, 4]);
    ctx.globalAlpha = 1.0;

    ctx.beginPath();
    ctx.moveTo(gtX, gtY);
    ctx.lineTo(apX, apY);
    ctx.stroke();

    ctx.setLineDash([]);
  }

  // Draw during streaming phase
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
      const timeIndex = Math.min(Math.floor(animationTime * numTimeSteps), numTimeSteps - 1);

      // Clip to domain range
      ctx.save();
      ctx.beginPath();
      ctx.rect(marginWidth, marginHeight, canvasWidth - 2 * marginWidth, canvasHeight - 2 * marginHeight);
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

    // Draw ground truth trajectories (streaming or complete)
    ctx.globalAlpha = groundTruthOpacity;
    if (isStreamingGroundTruth && streamingGroundTruths.length > 0) {
      for (const traj of streamingGroundTruths) {
        if (traj && traj.length > 0) {
          drawStreamingTrajectory(ctx, traj, groundTruthColor, trajectoryStrokeWidth);
        }
      }
    } else if (groundTruthTrajectories.length > 0) {
      for (const traj of groundTruthTrajectories) {
        drawTrajectoryOnCtx(ctx, traj, groundTruthColor, trajectoryStrokeWidth, true);
      }
    }
    ctx.globalAlpha = 1.0;

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

    // Draw start point markers
    drawStartPointsOnCtx(ctx);
  }

  // Draw during animation (just calls draw)
  function drawAnimationFrame() {
    draw();
  }

  // Animation loop
  function animate(timestamp) {
    if (!isInitialized || isLoading) {
      animationFrameId = requestAnimationFrame(animate);
      return;
    }

    const maxSegments = NUM_STEPS;

    if (lastAnimationTime === null) {
      lastAnimationTime = timestamp;
    }

    // Handle pause state
    if (isPaused) {
      const pauseElapsed = timestamp - (pauseStartTime ?? timestamp);
      const isEndPause = segmentIndex >= maxSegments;
      const pauseDuration = isEndPause ? END_PAUSE_DURATION : SEGMENT_PAUSE_DURATION;

      if (pauseElapsed >= pauseDuration) {
        // Pause ending
        isPaused = false;
        pauseStartTime = null;
        lastAnimationTime = timestamp;

        if (isEndPause) {
          // Loop back to start
          segmentIndex = 0;
          segmentProgress = 0;
          showErrorLines = false;
        } else {
          segmentIndex++;
          segmentProgress = 0;
        }
      } else {
        // Still in pause
        drawAnimationFrame();
        animationFrameId = requestAnimationFrame(animate);
        return;
      }
    }

    // Normal animation
    const elapsed = timestamp - lastAnimationTime;
    segmentProgress = Math.min(elapsed / SEGMENT_DURATION, 1);

    drawAnimationFrame();

    // Check if segment complete
    if (segmentProgress >= 1) {
      isPaused = true;
      pauseStartTime = timestamp;
      segmentProgress = 1;

      // Show error lines at end
      if (segmentIndex >= maxSegments - 1) {
        segmentIndex = maxSegments;
        showErrorLines = true;
      }
    }

    animationFrameId = requestAnimationFrame(animate);
  }

  function startAnimation() {
    if (animationFrameId !== null) return;
    lastAnimationTime = null;
    animationFrameId = requestAnimationFrame(animate);
  }

  function stopAnimation() {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  }

  // Handle canvas click
  function handleCanvasClick(event) {
    if (isStreamingGroundTruth || isLoading) return;

    stopAnimation();

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvasWidth / rect.width;
    const scaleY = canvasHeight / rect.height;
    const clickX = (event.clientX - rect.left) * scaleX;
    const clickY = (event.clientY - rect.top) * scaleY;

    const domainX = xScale.invert(clickX);
    const domainY = yScale.invert(clickY);
    const newPoint = [domainX, domainY];

    if (startPoints.length < maxStartPoints) {
      startPoints = [...startPoints, newPoint];
    } else {
      startPoints = [...startPoints.slice(1), newPoint];
    }

    computeAllTrajectories();
  }

  function initializeVisualization() {
    if (!canvas || !isDataValid) return;

    initializeScales();
    initializeCanvas();
    precomputeCoordinates();
    isInitialized = true;
    computeAllTrajectories();
  }

  // ===== REACTIVE EFFECTS =====

  $: if (isDataValid && canvas && !isInitialized) {
    initializeVisualization();
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
        <div class="panel-label" style="font-size: {labelFontSize}px; color: {labelColor};">
          {label}
        </div>
      {/if}
      <canvas
        bind:this={canvas}
        class="panel-canvas"
        onclick={handleCanvasClick}
        style="cursor: {isStreamingGroundTruth || isLoading ? 'wait' : 'pointer'};"
      ></canvas>
    </div>

    {#snippet footer()}
      <div class="legend">
        <div class="legend-item">
          <span class="legend-color" style="background-color: {groundTruthColor};"></span>
          <span class="legend-text" style="color: {groundTruthColor};">Ground Truth</span>
        </div>
        <div class="legend-item">
          <span class="legend-color" style="background-color: {approximationColor};"></span>
          <span class="legend-text">Approximation (8 steps)</span>
        </div>
      </div>
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

  .legend {
    display: flex;
    justify-content: center;
    gap: 24px;
    flex-wrap: wrap;
  }

  .legend-item {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .legend-color {
    width: 20px;
    height: 4px;
    border-radius: 2px;
  }

  .legend-text {
    font-size: 16px;
    color: #666;
    font-family: Helvetica, Arial, sans-serif;
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

    .legend {
      gap: 12px;
    }

    .legend-text {
      font-size: 11px;
    }
  }
</style>
