<!-- Compares Euler sampler trajectories between Flow Matching and Rectified Flow with varying step counts -->

<script>
  import { onMount, onDestroy } from "svelte";
  import * as d3 from "d3";
  import { DoubleFigure, drawScatterPlot, Slider } from "@diffusion-explorer/ui";
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
  export let domainRange = { xMin: -1.7, xMax: 1.7, yMin: -1.7, yMax: 1.7 };

  // Labels
  export let leftLabel = "Flow Matching";
  export let rightLabel = "Rectified Flow";
  export let labelFontSize = settings.stylingSettings.label.fontSize;
  export let labelColor = settings.stylingSettings.label.color;

  // Target distribution styling
  export let targetColor = "#3b82f6";
  export let targetOpacity = 0.2;
  export let targetPointRadius = 5;

  // Trajectory styling
  export let groundTruthColor = "#888888";
  export let approximationColor = "#f17720";
  export let trajectoryStrokeWidth = settings.stylingSettings.trajectory.strokeWidth;
  export let endpointRadius = settings.stylingSettings.trajectory.endpointRadius;

  // Starting point
  export let defaultStartPoint = [0.0, 0.0];

  // Callbacks & misc
  export let backgroundVisible = true;
  export let children = undefined;

  // ===== CONSTANTS =====

  const stepValues = [1, 2, 4, 8, 16, 32, 64, 128, 256];
  const groundTruthSteps = 512;

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
  let currentStepIndex = 4; // Default to 16 steps

  // Starting point (domain coordinates)
  let startPoint = [...defaultStartPoint];

  // Pre-computed trajectories for all step counts
  // Format: { steps: [[x,y], [x,y], ...] } - domain coordinates
  let flowMatchingTrajectories = {};
  let rectifiedFlowTrajectories = {};
  let flowMatchingGroundTruth = null;
  let rectifiedFlowGroundTruth = null;

  // Loading state
  let isLoading = true;
  let loadingProgress = 0;

  // Initialization
  let isInitialized = false;

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

  // Sample a trajectory from a model
  async function sampleTrajectory(modelPath, trainingObjective, point, numSteps) {
    return new Promise((resolve) => {
      callSamplingWorkerThreadFromInitialPoints(
        settings.samplingWorkerUrl,
        modelPath,
        trainingObjective,
        settings.trainingSettings.modelConfig,
        [point],
        numSteps,
        (allSamples) => {
          // allSamples format: [timestep][sample][dim]
          // Extract single trajectory: [[x,y], [x,y], ...]
          const trajectory = allSamples.map(ts => [ts[0][0], ts[0][1]]);
          resolve(trajectory);
        },
        settings.trainingSettings.domainRange
      );
    });
  }

  // Compute all trajectories for the current start point
  async function computeAllTrajectories() {
    isLoading = true;
    loadingProgress = 0;

    const totalSamples = 2 + stepValues.length * 2; // 2 ground truths + all step variations
    let completedSamples = 0;

    function updateProgress() {
      completedSamples++;
      loadingProgress = completedSamples / totalSamples;
    }

    // Compute ground truth (512 steps) for both models
    flowMatchingGroundTruth = await sampleTrajectory(
      settings.flowMatchingModelPath,
      "Flow Matching",
      startPoint,
      groundTruthSteps
    );
    updateProgress();

    rectifiedFlowGroundTruth = await sampleTrajectory(
      settings.rectifiedFlowModelPath,
      "Flow Matching", // Rectified flow uses same sampling objective
      startPoint,
      groundTruthSteps
    );
    updateProgress();

    // Pre-compute trajectories for all step values
    flowMatchingTrajectories = {};
    rectifiedFlowTrajectories = {};

    for (const steps of stepValues) {
      flowMatchingTrajectories[steps] = await sampleTrajectory(
        settings.flowMatchingModelPath,
        "Flow Matching",
        startPoint,
        steps
      );
      updateProgress();

      rectifiedFlowTrajectories[steps] = await sampleTrajectory(
        settings.rectifiedFlowModelPath,
        "Flow Matching",
        startPoint,
        steps
      );
      updateProgress();
    }

    isLoading = false;
    draw();
  }

  // Draw a full trajectory path
  function drawTrajectory(ctx, trajectory, color, lineWidth, showEndpoint = true) {
    if (!trajectory || trajectory.length < 2) return;

    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = 1.0;

    ctx.beginPath();
    const [startX, startY] = [xScale(trajectory[0][0]), yScale(trajectory[0][1])];
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

  // Draw start point marker
  function drawStartPoint(ctx) {
    const [x, y] = [xScale(startPoint[0]), yScale(startPoint[1])];

    // Outer ring
    ctx.beginPath();
    ctx.arc(x, y, endpointRadius + 2, 0, 2 * Math.PI);
    ctx.strokeStyle = "#10b981"; // Green
    ctx.lineWidth = 2;
    ctx.stroke();

    // Inner fill
    ctx.beginPath();
    ctx.arc(x, y, endpointRadius, 0, 2 * Math.PI);
    ctx.fillStyle = "#10b981";
    ctx.globalAlpha = 0.7;
    ctx.fill();
    ctx.globalAlpha = 1.0;
  }

  // Main draw function for a panel
  function drawPanel(ctx, groundTruth, approximation) {
    if (!ctx) return;

    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // 1. Draw target distribution (low opacity)
    drawScatterPlot(
      ctx,
      scaledTargetDistribution,
      targetPointRadius,
      targetColor,
      targetOpacity
    );

    // 2. Draw ground truth trajectory (gray, behind)
    if (groundTruth) {
      drawTrajectory(ctx, groundTruth, groundTruthColor, trajectoryStrokeWidth, true);
    }

    // 3. Draw approximation trajectory (orange, on top)
    if (approximation) {
      drawTrajectory(ctx, approximation, approximationColor, trajectoryStrokeWidth + 0.5, true);
    }

    // 4. Draw start point marker (on top of everything)
    drawStartPoint(ctx);
  }

  // Draw both panels
  function draw() {
    if (!leftCtx || !rightCtx || isLoading) return;

    const currentSteps = stepValues[currentStepIndex];
    const leftApprox = flowMatchingTrajectories[currentSteps];
    const rightApprox = rectifiedFlowTrajectories[currentSteps];

    drawPanel(leftCtx, flowMatchingGroundTruth, leftApprox);
    drawPanel(rightCtx, rectifiedFlowGroundTruth, rightApprox);
  }

  // Handle canvas click - convert to domain coordinates and resample
  function handleCanvasClick(event) {
    if (isLoading) return;

    const canvas = leftCanvas; // Use left canvas for coordinate mapping
    const rect = canvas.getBoundingClientRect();

    const scaleX = canvasWidth / rect.width;
    const scaleY = canvasHeight / rect.height;
    const clickX = (event.clientX - rect.left) * scaleX;
    const clickY = (event.clientY - rect.top) * scaleY;

    // Convert to domain coordinates
    const domainX = xScale.invert(clickX);
    const domainY = yScale.invert(clickY);

    startPoint = [domainX, domainY];
    computeAllTrajectories();
  }

  function handleSliderChange() {
    draw();
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
    label: String(step)
  }));

  // ===== LIFECYCLE =====

  onMount(() => {
    // Initialization handled by reactive statement
  });

  onDestroy(() => {
    // Cleanup if needed
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
        <canvas
          bind:this={leftCanvas}
          class="panel-canvas"
          onclick={handleCanvasClick}
          style="cursor: {isLoading ? 'wait' : 'crosshair'};"
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
        <canvas
          bind:this={rightCanvas}
          class="panel-canvas"
          onclick={handleCanvasClick}
          style="cursor: {isLoading ? 'wait' : 'crosshair'};"
        ></canvas>
      </div>
    {/snippet}

    {#snippet footer()}
      <div class="footer-container">
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
        {#if isLoading}
          <div class="loading-indicator">
            <div class="loading-bar" style="width: {loadingProgress * 100}%"></div>
          </div>
        {/if}
        <div class="legend">
          <div class="legend-item">
            <span class="legend-color" style="background-color: {groundTruthColor};"></span>
            <span class="legend-text">Ground Truth ({groundTruthSteps} steps)</span>
          </div>
          <div class="legend-item">
            <span class="legend-color" style="background-color: {approximationColor};"></span>
            <span class="legend-text">Approximation ({currentSteps} {currentSteps === 1 ? 'step' : 'steps'})</span>
          </div>
        </div>
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
    padding-bottom: 8px;
    font-weight: 500;
  }

  .panel-canvas {
    width: 100%;
    height: auto;
    display: block;
  }

  .footer-container {
    width: 100%;
    padding: 16px 0 8px;
  }

  .slider-label-below {
    text-align: center;
    font-size: 16px;
    font-family: Helvetica, Arial, sans-serif;
    color: #7b7b7b;
    margin-top: 8px;
  }

  .loading-indicator {
    width: 100%;
    max-width: 600px;
    margin: 8px auto 0;
    height: 4px;
    background: #e0e0e0;
    border-radius: 2px;
    overflow: hidden;
  }

  .loading-bar {
    height: 100%;
    background: #f17720;
    border-radius: 2px;
    transition: width 0.1s ease;
  }

  .legend {
    display: flex;
    justify-content: center;
    gap: 24px;
    margin-top: 16px;
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
    font-size: 13px;
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

    .slider-container {
      padding: 12px 10px 4px;
    }
  }

  @media (max-width: 400px) {
    .panel-label {
      font-size: 16px !important;
    }
  }
</style>
