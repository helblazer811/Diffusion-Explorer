<!-- Compares flow matching vector field (curved) vs rectified flow vector field (straighter) -->

<script>
  import { onMount, onDestroy } from 'svelte';
  import * as d3 from 'd3';
  import DoubleFigure from '$lib/components/DoubleFigure.svelte';
  import TimeSlider from '$lib/components/TimeSlider.svelte';
  import { settings } from '$lib/settings';
  import { drawVectorField } from '$lib/canvas/plotting';

  // ===== PROPS =====

  // Data
  export let flowMatchingVectorField = null;
  export let rectifiedFlowVectorField = null;

  // Layout
  export let canvasWidth = 350;
  export let canvasHeight = 350;
  export let marginWidth = 40;
  export let marginHeight = 40;
  export let gap = 30;

  // Labels
  export let leftLabel = 'Flow Matching';
  export let rightLabel = 'Rectified Flow';
  export let labelFontSize = settings.stylingSettings.label.fontSize;
  export let labelColor = settings.stylingSettings.label.color;

  // Arrow styling
  export let arrowColor = '#f17720';
  export let arrowScale = 45;
  export let arrowWidth = 2.5;
  export let arrowOpacity = 1.0;
  export let normalizeVectors = false;

  // Animation
  export let animationDuration = 8000;
  export let playingByDefault = true;
  export let animationPauseTime = 1000;

  // Callbacks & misc
  export let backgroundVisible = true;
  export let children = undefined;

  // ===== DERIVED FROM PROPS =====

  $: caption = children;
  $: isDataValid =
    flowMatchingVectorField?.velocities?.length > 0 &&
    rectifiedFlowVectorField?.velocities?.length > 0;

  // ===== STATE =====

  // Canvas
  let leftCanvas;
  let rightCanvas;
  let leftCtx;
  let rightCtx;
  let dpr = 1;

  // Scales
  let leftScales = null;
  let rightScales = null;

  // Pre-calculated grid positions (pixel coords)
  let leftGridPositions = [];
  let rightGridPositions = [];

  // Animation
  let time = 0;
  let animationFrameId = null;
  let animationStartTime = null;
  let pausedElapsedTime = 0;
  let isPlaying = playingByDefault;
  let isPausedByFigure = false;

  // Initialization
  let isInitialized = false;

  // Visibility
  let figureIsActive;
  let wasPlayingBeforeHidden = false;

  // ===== FUNCTIONS =====

  function initializeScales(vectorFieldData) {
    if (!vectorFieldData) return null;

    const { xMin, xMax, yMin, yMax } = vectorFieldData.domainRange;

    const xScale = d3.scaleLinear()
      .domain([xMin, xMax])
      .range([marginWidth, canvasWidth - marginWidth]);

    const yScale = d3.scaleLinear()
      .domain([yMin, yMax])
      .range([marginHeight, canvasHeight - marginHeight]);

    return { xScale, yScale };
  }

  function calculateGridPositions(vectorFieldData, scales) {
    if (!vectorFieldData?.gridPoints || !scales) return [];

    return vectorFieldData.gridPoints.map(point => [
      scales.xScale(point[0]),
      scales.yScale(point[1])
    ]);
  }

  function initializeCanvas() {
    dpr = window.devicePixelRatio || 1;

    if (leftCanvas) {
      leftCanvas.width = canvasWidth * dpr;
      leftCanvas.height = canvasHeight * dpr;
      leftCtx = leftCanvas.getContext('2d');
      leftCtx.scale(dpr, dpr);
    }
    if (rightCanvas) {
      rightCanvas.width = canvasWidth * dpr;
      rightCanvas.height = canvasHeight * dpr;
      rightCtx = rightCanvas.getContext('2d');
      rightCtx.scale(dpr, dpr);
    }
  }

  function draw() {
    if (!leftCtx || !rightCtx || !isDataValid) return;

    // Clear canvases
    leftCtx.clearRect(0, 0, canvasWidth, canvasHeight);
    rightCtx.clearRect(0, 0, canvasWidth, canvasHeight);

    // Map time (0-1) to time indices for each vector field
    const leftNumSteps = flowMatchingVectorField.timeSteps.length;
    const rightNumSteps = rectifiedFlowVectorField.timeSteps.length;

    const leftTimeIndex = Math.min(Math.floor(time * leftNumSteps), leftNumSteps - 1);
    const rightTimeIndex = Math.min(Math.floor(time * rightNumSteps), rightNumSteps - 1);

    const style = {
      arrowScale,
      strokeWidth: arrowWidth,
      color: arrowColor,
      opacity: arrowOpacity,
      normalizeVectors
    };

    // Draw left panel (flow matching)
    drawVectorField(
      leftCtx,
      leftGridPositions,
      flowMatchingVectorField.velocities[leftTimeIndex],
      style
    );

    // Draw right panel (rectified flow)
    drawVectorField(
      rightCtx,
      rightGridPositions,
      rectifiedFlowVectorField.velocities[rightTimeIndex],
      style
    );
  }

  function initializeVisualization() {
    if (!leftCanvas || !rightCanvas || !isDataValid) return;

    // Initialize scales for each panel
    leftScales = initializeScales(flowMatchingVectorField);
    rightScales = initializeScales(rectifiedFlowVectorField);

    // Calculate grid positions (pixel coords)
    leftGridPositions = calculateGridPositions(flowMatchingVectorField, leftScales);
    rightGridPositions = calculateGridPositions(rectifiedFlowVectorField, rightScales);

    // Initialize canvas
    initializeCanvas();

    // Initial draw
    draw();
    isInitialized = true;
  }

  function toggleAnimation() {
    isPlaying = !isPlaying;
  }

  function handleSliderInput() {
    const now = performance.now();
    animationStartTime = now - (time * animationDuration);
    pausedElapsedTime = 0;
  }

  function startAnimation() {
    let isPaused = false;
    let pauseStartTime = null;

    function animate(currentTime) {
      if (isPausedByFigure) {
        if (animationStartTime !== null && pausedElapsedTime === 0) {
          pausedElapsedTime = currentTime - animationStartTime;
        }
        animationFrameId = requestAnimationFrame(animate);
        return;
      }

      if (pausedElapsedTime > 0) {
        animationStartTime = currentTime - pausedElapsedTime;
        pausedElapsedTime = 0;
      }

      if (animationStartTime === null) {
        animationStartTime = currentTime;
      }

      const elapsed = currentTime - animationStartTime;

      if (elapsed >= animationDuration) {
        if (!isPaused) {
          isPaused = true;
          pauseStartTime = currentTime;
          time = 1;
          draw();
        }

        if (pauseStartTime && currentTime - pauseStartTime >= animationPauseTime) {
          animationStartTime = currentTime;
          isPaused = false;
          pauseStartTime = null;
          time = 0;
        }
      } else {
        time = Math.min(elapsed / animationDuration, 1);
        draw();
      }

      animationFrameId = requestAnimationFrame(animate);
    }

    animationFrameId = requestAnimationFrame(animate);
  }

  function stopAnimation() {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  }

  // ===== REACTIVE EFFECTS =====

  $: isPausedByFigure = !isPlaying;

  $: if (figureIsActive && isInitialized) {
    if (!$figureIsActive && isPlaying) {
      wasPlayingBeforeHidden = true;
      isPlaying = false;
    } else if ($figureIsActive && wasPlayingBeforeHidden) {
      wasPlayingBeforeHidden = false;
      isPlaying = true;
    }
  }

  $: if (isInitialized && time !== undefined) {
    draw();
  }

  $: if (!isInitialized && isDataValid && leftCanvas && rightCanvas) {
    initializeVisualization();
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
  <DoubleFigure {gap} {caption} {backgroundVisible} bind:isActive={figureIsActive}>
    {#snippet left()}
      <div class="panel-container" style="max-width: {canvasWidth}px;">
        <div class="panel-label" style="font-size: {labelFontSize}px; color: {labelColor};">
          {leftLabel}
        </div>
        <canvas
          bind:this={leftCanvas}
          class="panel-canvas"
        ></canvas>
      </div>
    {/snippet}

    {#snippet right()}
      <div class="panel-container" style="max-width: {canvasWidth}px;">
        <div class="panel-label" style="font-size: {labelFontSize}px; color: {labelColor};">
          {rightLabel}
        </div>
        <canvas
          bind:this={rightCanvas}
          class="panel-canvas"
        ></canvas>
      </div>
    {/snippet}

    {#snippet footer()}
      <TimeSlider
        bind:value={time}
        bind:isPlaying={isPlaying}
        min={0}
        max={1}
        onTogglePlay={toggleAnimation}
        onInput={handleSliderInput}
        color="#f17720"
      />
    {/snippet}
  </DoubleFigure>
{:else}
  <div class="placeholder">
    <p>Vector field comparison requires both flow matching and rectified flow vector field data.</p>
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
</style>
