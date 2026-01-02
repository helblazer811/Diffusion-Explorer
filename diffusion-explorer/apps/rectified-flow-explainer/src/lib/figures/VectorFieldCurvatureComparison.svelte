<!-- Compares flow matching vector field (curved) vs rectified flow vector field (straighter) -->

<script>
  import { onDestroy } from 'svelte';
  import * as d3 from 'd3';
  import { DoubleFigure, TimeSlider, drawVectorField, Clock, Track, createPauseClip } from '@diffusion-explorer/ui';
  import { settings } from '$lib/settings';

  // ===== PROPS =====

  // Data
  export let flowMatchingVectorField = null;
  export let rectifiedFlowVectorField = null;

  // Layout
  export let canvasWidth = 400;
  export let canvasHeight = 400;
  export let marginWidth = 50;
  export let marginHeight = 50;
  export let gap = 20;

  // Labels
  export let leftLabel = 'Flow Matching';
  export let rightLabel = 'Rectified Flow';
  export let labelFontSize = settings.stylingSettings.label.fontSize;
  export let labelColor = settings.stylingSettings.label.color;
  export let labelOpacity = settings.stylingSettings.label.opacity;

  // Arrow styling
  export let arrowColor = '#f17720';
  export let arrowScale = 30;
  export let arrowWidth = 2.5;
  export let arrowOpacity = 1.0;
  export let normalizeVectors = true;
  export let centerQuiver = true;
  export let showArrowHeads = false;

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

  // Animation - Clock/Track system
  let time = 0;
  let isPlaying = playingByDefault;
  let clock = null;
  let track = null;

  // State object mutated by clips
  let animState = { time: 0 };

  // Main animation clip (maps normalized time to state.time)
  const mainClip = {
    name: "Animation",
    duration: 1,
    apply(t, params, state) {
      state.time = t;
    }
  };

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
      normalizeVectors,
      centerQuiver,
      showArrowHeads
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

  // Initialize animation track with main clip and pause
  function initializeAnimation() {
    track = new Track();

    // Calculate normalized durations for track
    const totalDuration = animationDuration + animationPauseTime;
    const mainDuration = animationDuration / totalDuration;
    const pauseClipDuration = animationPauseTime / totalDuration;

    // Add main animation clip (0 to mainDuration of track time)
    track.add({ ...mainClip, duration: mainDuration }, 0);
    // Add pause clip (mainDuration to 1)
    track.add(createPauseClip(pauseClipDuration), mainDuration);

    clock = new Clock();
  }

  function startAnimation() {
    if (!clock || !track) return;

    clock.start((dt) => {
      // Convert real time delta to normalized track time
      const totalDuration = (animationDuration + animationPauseTime) / 1000;
      const normalizedDt = dt / totalDuration;

      track.update(normalizedDt, {}, animState);
      time = animState.time;

      // Loop when track completes
      if (track.time >= 1) {
        track.reset();
        animState.time = 0;
        time = 0;
      }

      draw();
    });
  }

  function stopAnimation() {
    if (clock) clock.stop();
  }

  function toggleAnimation() {
    isPlaying = !isPlaying;
    if (isPlaying) {
      startAnimation();
    } else {
      stopAnimation();
    }
  }

  function handleSliderInput() {
    if (isPlaying) {
      isPlaying = false;
      stopAnimation();
    }
    animState.time = time;
    draw();
  }

  function handleVisibilityChange(isActive) {
    if (!isActive && isPlaying) {
      wasPlayingBeforeHidden = true;
      isPlaying = false;
      stopAnimation();
    } else if (isActive && wasPlayingBeforeHidden) {
      wasPlayingBeforeHidden = false;
      isPlaying = true;
      startAnimation();
    }
  }

  // ===== REACTIVE EFFECTS =====

  $: if (!isInitialized && isDataValid && leftCanvas && rightCanvas) {
    initializeVisualization();
    initializeAnimation();
    if (isPlaying) startAnimation();
  }

  // Handle visibility changes (pause when off-screen, resume when back)
  $: if (figureIsActive !== undefined && isInitialized) {
    handleVisibilityChange($figureIsActive);
  }

  // Redraw when time changes (e.g., slider drag)
  $: if (isInitialized && time !== undefined) {
    draw();
  }

  // ===== LIFECYCLE =====

  onDestroy(() => {
    if (clock) clock.stop();
  });
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
          class="panel-canvas"
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

  @media (max-width: 600px) {
    .panel-label {
      font-size: 18px !important;
    }
  }

  @media (max-width: 400px) {
    .panel-label {
      font-size: 16px !important;
    }
  }
</style>
