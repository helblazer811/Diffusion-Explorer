<!-- Compares Euler sampler trajectories between Flow Matching and Rectified Flow with varying step counts -->

<script>
  import { onMount, onDestroy } from "svelte";
  import * as d3 from "d3";
  import {
    DoubleFigure,
    drawScatterPlot,
    Slider,
    progressivelyAnimateTrajectories,
  } from "@diffusion-explorer/ui";
  import { settings } from "$lib/settings";
  import { callSamplingWorkerThreadFromInitialPoints } from "@diffusion-explorer/diffusion";

  // ===== PROPS =====

  // Data
  export let targetDistribution = [];

  // Layout
  export let canvasWidth = 400;
  export let canvasHeight = 400;
  export let marginWidth = 10;
  export let marginHeight = 10;
  export let gap = 20;
  export let domainRange = { xMin: -1.7, xMax: 1.7, yMin: -1.5, yMax: 1.7 };

  // Labels
  export let leftLabel = "Flow Matching";
  export let rightLabel = "Rectified Flow";
  export let labelFontSize = settings.stylingSettings.label.fontSize;
  export let labelColor = settings.stylingSettings.label.color;

  // Subtitles
  export let leftSubtitle = "High Error with Few Steps";
  export let rightSubtitle = "Low Error with Few Steps";
  export let subtitleFontSize = 26;
  export let subtitleColor = settings.stylingSettings.label.color;

  // Target distribution styling
  export let targetColor = "#3b82f6";
  export let targetOpacity = 0.2;
  export let targetPointRadius = 7;

  // Trajectory styling
  export let groundTruthColor = "#22c55e";
  export let groundTruthOpacity = 0.8;
  export let approximationColor = "#f17720";
  export let approximationOpacity = 0.8;
  export let errorColor = "#dc2626"; // Red for error line
  export let trajectoryStrokeWidth = 3;
  export let endpointRadius =
    settings.stylingSettings.trajectory.endpointRadius;

  // Starting points (supports multiple)
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

  const stepValues = [1, 2, 4, 8, 16];
  const defaultStepIndex = 2; // Default to 4 steps (index into stepValues)
  const groundTruthSteps = 64;

  // ===== DERIVED FROM PROPS =====

  $: caption = children;
  $: isDataValid = targetDistribution?.length > 0;

  // ===== STATE =====

  // Canvas
  let leftCanvas;
  let rightCanvas;
  let leftCtx;
  let rightCtx;
  let dpr = 1;

  // Scales
  let xScale;
  let yScale;

  // Pre-computed pixel coordinates
  let scaledTargetDistribution = [];

  // Current slider index
  let currentStepIndex = defaultStepIndex;

  // Starting points (domain coordinates) - supports multiple
  let startPoints = [...defaultStartPoints];

  // Pre-computed trajectories for all step counts
  // Format: { steps: [traj1, traj2, ...] } where each traj is [[x,y], ...]
  let flowMatchingTrajectories = {};
  let rectifiedFlowTrajectories = {};
  let flowMatchingGroundTruths = []; // Array of trajectories
  let rectifiedFlowGroundTruths = [];

  // Loading state
  let isLoading = true;

  // Initialization
  let isInitialized = false;

  // Animation controllers for approximation trajectories (encapsulate animation state)
  let leftAnimationController = null;
  let rightAnimationController = null;

  // Animation timing config
  const animationConfig = {
    segmentDuration: 600,
    segmentPauseDuration: 400,
    endPauseDuration: 2500,
    loop: true,
  };

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

  function initializeCanvas() {
    dpr = window.devicePixelRatio || 1;

    if (leftCanvas) {
      leftCanvas.width = canvasWidth * dpr;
      leftCanvas.height = canvasHeight * dpr;
      leftCtx = leftCanvas.getContext("2d");
      leftCtx.scale(dpr, dpr);
    }
    if (rightCanvas) {
      rightCanvas.width = canvasWidth * dpr;
      rightCanvas.height = canvasHeight * dpr;
      rightCtx = rightCanvas.getContext("2d");
      rightCtx.scale(dpr, dpr);
    }
  }

  function precomputeCoordinates() {
    if (!xScale || !yScale) return;

    scaledTargetDistribution = targetDistribution.map((p) => [
      xScale(p[0]),
      yScale(p[1]),
    ]);
  }

  // Sample trajectories for multiple points from a model using Euler scheduler
  // Returns array of trajectories, one per point
  async function sampleTrajectoriesBatch(
    modelPath,
    trainingObjective,
    points,
    numSteps
  ) {
    return new Promise((resolve) => {
      callSamplingWorkerThreadFromInitialPoints(
        settings.samplingWorkerUrl,
        modelPath,
        trainingObjective,
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
        { scheduler: "euler" } // Use basic Euler for this comparison figure
      );
    });
  }

  // Compute all trajectories for all start points
  async function computeAllTrajectories() {
    isLoading = true;

    // Load ground truth trajectories for both models in parallel
    const [fmGroundTruths, rfGroundTruths] = await Promise.all([
      sampleTrajectoriesBatch(settings.flowMatchingModelPath, "Flow Matching", startPoints, groundTruthSteps),
      sampleTrajectoriesBatch(settings.rectifiedFlowModelPath, "Flow Matching", startPoints, groundTruthSteps)
    ]);

    flowMatchingGroundTruths = fmGroundTruths;
    rectifiedFlowGroundTruths = rfGroundTruths;

    // Now compute approximation trajectories for all step counts
    flowMatchingTrajectories = {};
    rectifiedFlowTrajectories = {};

    const currentSteps = stepValues[currentStepIndex];

    // Load current step count first
    const [fmApprox, rfApprox] = await Promise.all([
      sampleTrajectoriesBatch(settings.flowMatchingModelPath, "Flow Matching", startPoints, currentSteps),
      sampleTrajectoriesBatch(settings.rectifiedFlowModelPath, "Flow Matching", startPoints, currentSteps)
    ]);

    flowMatchingTrajectories[currentSteps] = fmApprox;
    rectifiedFlowTrajectories[currentSteps] = rfApprox;

    // Start animation
    isLoading = false;
    createAnimationControllers();
    startApproxAnimation();

    // Load remaining step counts in background
    for (const steps of stepValues) {
      if (steps === currentSteps) continue;

      const [fmSteps, rfSteps] = await Promise.all([
        sampleTrajectoriesBatch(settings.flowMatchingModelPath, "Flow Matching", startPoints, steps),
        sampleTrajectoriesBatch(settings.rectifiedFlowModelPath, "Flow Matching", startPoints, steps)
      ]);

      flowMatchingTrajectories[steps] = fmSteps;
      rectifiedFlowTrajectories[steps] = rfSteps;
    }
  }

  // Draw a full trajectory path (respects ctx.globalAlpha set by caller)
  function drawTrajectory(
    ctx,
    trajectory,
    color,
    lineWidth,
    showEndpoint = true
  ) {
    if (!trajectory || trajectory.length < 2) return;

    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    const [startX, startY] = [
      xScale(trajectory[0][0]),
      yScale(trajectory[0][1]),
    ];
    ctx.moveTo(startX, startY);

    for (let i = 1; i < trajectory.length; i++) {
      const [x, y] = [xScale(trajectory[i][0]), yScale(trajectory[i][1])];
      ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Draw endpoint marker
    if (showEndpoint) {
      const lastPoint = trajectory[trajectory.length - 1];
      const [endX, endY] = [xScale(lastPoint[0]), yScale(lastPoint[1])];
      ctx.beginPath();
      ctx.arc(endX, endY, endpointRadius, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
    }
  }

  // Draw start point markers for all start points
  function drawStartPoints(ctx) {
    for (const point of startPoints) {
      const [x, y] = [xScale(point[0]), yScale(point[1])];

      // Outer ring
      ctx.beginPath();
      ctx.arc(x, y, startPointRadius + 2, 0, 2 * Math.PI);
      ctx.strokeStyle = groundTruthColor;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Inner fill
      ctx.beginPath();
      ctx.arc(x, y, startPointRadius, 0, 2 * Math.PI);
      ctx.fillStyle = groundTruthColor;
      ctx.globalAlpha = 0.7;
      ctx.fill();
      ctx.globalAlpha = 1.0;
    }
  }

  // Draw error line (dashed) from ground truth endpoint to approximation endpoint
  function drawErrorLine(
    ctx,
    groundTruthEndpoint,
    approxEndpoint,
    color,
    lineWidth
  ) {
    if (!groundTruthEndpoint || !approxEndpoint) return;

    const [gtX, gtY] = [
      xScale(groundTruthEndpoint[0]),
      yScale(groundTruthEndpoint[1]),
    ];
    const [apX, apY] = [xScale(approxEndpoint[0]), yScale(approxEndpoint[1])];

    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash([6, 4]); // Dashed line
    ctx.globalAlpha = 1.0;

    ctx.beginPath();
    ctx.moveTo(gtX, gtY);
    ctx.lineTo(apX, apY);
    ctx.stroke();

    ctx.setLineDash([]); // Reset to solid line
  }

  // Background drawing functions for animation controllers
  function drawLeftBackground() {
    if (!leftCtx) return;
    leftCtx.clearRect(0, 0, canvasWidth, canvasHeight);

    // Draw target distribution
    drawScatterPlot(
      leftCtx,
      scaledTargetDistribution,
      targetPointRadius,
      targetColor,
      targetOpacity
    );

    // Draw ground truth trajectories
    leftCtx.globalAlpha = groundTruthOpacity;
    for (const traj of flowMatchingGroundTruths) {
      drawTrajectory(
        leftCtx,
        traj,
        groundTruthColor,
        trajectoryStrokeWidth,
        true
      );
    }
    leftCtx.globalAlpha = 1.0;

    // Draw start point markers
    drawStartPoints(leftCtx);
  }

  function drawRightBackground() {
    if (!rightCtx) return;
    rightCtx.clearRect(0, 0, canvasWidth, canvasHeight);

    // Draw target distribution
    drawScatterPlot(
      rightCtx,
      scaledTargetDistribution,
      targetPointRadius,
      targetColor,
      targetOpacity
    );

    // Draw ground truth trajectories
    rightCtx.globalAlpha = groundTruthOpacity;
    for (const traj of rectifiedFlowGroundTruths) {
      drawTrajectory(
        rightCtx,
        traj,
        groundTruthColor,
        trajectoryStrokeWidth,
        true
      );
    }
    rightCtx.globalAlpha = 1.0;

    // Draw start point markers
    drawStartPoints(rightCtx);
  }

  // Draw error lines for left panel (called during end pause)
  function drawLeftErrorLines() {
    if (!leftCtx) return;
    const currentSteps = stepValues[currentStepIndex];
    const leftApprox = flowMatchingTrajectories[currentSteps] || [];

    for (let i = 0; i < Math.min(flowMatchingGroundTruths.length, leftApprox.length); i++) {
      const gtTraj = flowMatchingGroundTruths[i];
      const apTraj = leftApprox[i];
      if (gtTraj && gtTraj.length > 0 && apTraj && apTraj.length > 0) {
        const gtEndpoint = gtTraj[gtTraj.length - 1];
        const apEndpoint = apTraj[apTraj.length - 1];
        drawErrorLine(leftCtx, gtEndpoint, apEndpoint, errorColor, 2);
      }
    }
  }

  // Draw error lines for right panel (called during end pause)
  function drawRightErrorLines() {
    if (!rightCtx) return;
    const currentSteps = stepValues[currentStepIndex];
    const rightApprox = rectifiedFlowTrajectories[currentSteps] || [];

    for (let i = 0; i < Math.min(rectifiedFlowGroundTruths.length, rightApprox.length); i++) {
      const gtTraj = rectifiedFlowGroundTruths[i];
      const apTraj = rightApprox[i];
      if (gtTraj && gtTraj.length > 0 && apTraj && apTraj.length > 0) {
        const gtEndpoint = gtTraj[gtTraj.length - 1];
        const apEndpoint = apTraj[apTraj.length - 1];
        drawErrorLine(rightCtx, gtEndpoint, apEndpoint, errorColor, 2);
      }
    }
  }

  // Create and start animation controllers for both panels
  function createAnimationControllers() {
    const currentSteps = stepValues[currentStepIndex];
    const leftApprox = flowMatchingTrajectories[currentSteps] || [];
    const rightApprox = rectifiedFlowTrajectories[currentSteps] || [];

    // Convert to pixel coordinates
    const leftApproxPixel = leftApprox.map((traj) =>
      traj.map((p) => [xScale(p[0]), yScale(p[1])])
    );
    const rightApproxPixel = rightApprox.map((traj) =>
      traj.map((p) => [xScale(p[0]), yScale(p[1])])
    );

    const baseOptions = {
      ...animationConfig,
      strokeWidth: trajectoryStrokeWidth + 0.5,
      pointRadius: endpointRadius,
      color: approximationColor,
      opacity: approximationOpacity,
    };

    leftAnimationController = progressivelyAnimateTrajectories(
      leftCtx,
      leftApproxPixel,
      { ...baseOptions, onEndPause: drawLeftErrorLines },
      drawLeftBackground
    );

    rightAnimationController = progressivelyAnimateTrajectories(
      rightCtx,
      rightApproxPixel,
      { ...baseOptions, onEndPause: drawRightErrorLines },
      drawRightBackground
    );
  }

  function startApproxAnimation() {
    leftAnimationController?.start();
    rightAnimationController?.start();
  }

  function stopApproxAnimation() {
    leftAnimationController?.stop();
    rightAnimationController?.stop();
  }

  function resetApproxAnimation() {
    stopApproxAnimation();
    leftAnimationController?.reset();
    rightAnimationController?.reset();
    // Recreate controllers to pick up any trajectory changes
    createAnimationControllers();
    startApproxAnimation();
  }

  // Draw only start points and target distribution (for immediate feedback)
  function drawInitialState() {
    if (!leftCtx || !rightCtx) return;

    // Clear both canvases
    leftCtx.clearRect(0, 0, canvasWidth, canvasHeight);
    rightCtx.clearRect(0, 0, canvasWidth, canvasHeight);

    // Draw target distribution on both
    drawScatterPlot(leftCtx, scaledTargetDistribution, targetPointRadius, targetColor, targetOpacity);
    drawScatterPlot(rightCtx, scaledTargetDistribution, targetPointRadius, targetColor, targetOpacity);

    // Draw start points on both
    drawStartPoints(leftCtx);
    drawStartPoints(rightCtx);
  }

  // Handle canvas click - convert to domain coordinates and add/replace start point
  function handleCanvasClick(event, side) {
    // Stop animation
    stopApproxAnimation();

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
    const newPoint = [domainX, domainY];

    // Add new point if under max, otherwise replace oldest
    if (startPoints.length < maxStartPoints) {
      startPoints = [...startPoints, newPoint];
    } else {
      // Replace oldest point (shift and push)
      startPoints = [...startPoints.slice(1), newPoint];
    }

    // Immediately draw start points for visual feedback
    drawInitialState();

    computeAllTrajectories();
  }

  function handleSliderChange() {
    resetApproxAnimation();
  }

  function initializeVisualization() {
    if (!leftCanvas || !rightCanvas || !isDataValid) return;

    initializeScales();
    initializeCanvas();
    precomputeCoordinates();
    isInitialized = true;
    computeAllTrajectories();
  }

  // ===== REACTIVE EFFECTS =====

  $: if (isDataValid && leftCanvas && rightCanvas && !isInitialized) {
    initializeVisualization();
  }

  $: currentSteps = stepValues[currentStepIndex];

  // Generate ticks for slider (log scale positions)
  $: sliderTicks = stepValues.map((step, i) => ({
    position: i / (stepValues.length - 1),
    label: String(step),
  }));

  // ===== LIFECYCLE =====

  onMount(() => {
    // Initialization handled by reactive statement
  });

  onDestroy(() => {
    stopApproxAnimation();
  });
</script>

{#if isDataValid}
  <DoubleFigure {gap} {caption} {backgroundVisible}>
    {#snippet left()}
      <div class="panel-container" style="max-width: {canvasWidth}px;">
        <div
          class="panel-label"
          style="font-size: {labelFontSize}px; color: {labelColor};"
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
          style="font-size: {labelFontSize}px; color: {labelColor};"
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
          class="panel-canvas"
          onclick={(e) => handleCanvasClick(e, "right")}
          style="cursor: pointer;"
        ></canvas>
      </div>
    {/snippet}

    {#snippet footer()}
      <div class="footer-container">
        <div class="legend">
          <div class="legend-item">
            <span
              class="legend-color"
              style="background-color: {groundTruthColor};"
            ></span>
            <span class="legend-text">Ground Truth</span>
          </div>
          <div class="legend-item">
            <span
              class="legend-color"
              style="background-color: {approximationColor};"
            ></span>
            <span class="legend-text"
              >Approximation ({currentSteps}
              {currentSteps === 1 ? "step" : "steps"})</span
            >
          </div>
          <div class="legend-item">
            <span
              class="legend-color"
              style="background: repeating-linear-gradient(90deg, {errorColor} 0px, {errorColor} 4px, transparent 4px, transparent 7px);"
            ></span>
            <span class="legend-text">Error</span>
          </div>
        </div>
        <Slider
          bind:value={currentStepIndex}
          min={0}
          max={stepValues.length - 1}
          step={1}
          disabled={isLoading}
          color={approximationColor}
          ticks={sliderTicks}
          activeTickIndex={currentStepIndex}
          showTickMarks={true}
          showLabel={false}
          onInput={handleSliderChange}
        />
        <div class="slider-label-below">Number of Euler Steps</div>
      </div>
    {/snippet}
  </DoubleFigure>
{:else}
  <div class="placeholder">
    <p>Euler step comparison requires target distribution data.</p>
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

  .panel-canvas {
    width: 100%;
    height: auto;
    display: block;
  }

  .footer-container {
    width: 100%;
  }

  .slider-label-below {
    text-align: center;
    font-size: 16px;
    font-family: Helvetica, Arial, sans-serif;
    color: #7b7b7b;
    margin-top: 8px;
  }

  .legend {
    display: flex;
    justify-content: center;
    gap: 24px;
    margin-bottom: 16px;
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
    font-size: 18px;
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

    .panel-subtitle {
      font-size: 13px !important;
    }

    .legend {
      gap: 12px;
    }

    .legend-text {
      font-size: 11px;
    }
  }

  @media (max-width: 400px) {
    .panel-subtitle {
      font-size: 11px !important;
    }
  }

  @media (max-width: 400px) {
    .panel-label {
      font-size: 16px !important;
    }
  }
</style>
