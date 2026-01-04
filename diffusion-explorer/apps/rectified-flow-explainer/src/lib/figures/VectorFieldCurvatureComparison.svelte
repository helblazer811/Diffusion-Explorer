<!-- Compares flow matching vector field (curved) vs rectified flow vector field (straighter) -->

<script lang="ts">
  import { onDestroy } from 'svelte';
  import * as d3 from 'd3';
  import { DoubleFigure, TimeSlider, drawVectorField, Timeline, useCanvas2D } from '@diffusion-explorer/ui';
  import { settings } from '$lib/settings';

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

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

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  $: caption = children;
  $: isDataValid =
    flowMatchingVectorField?.velocities?.length > 0 &&
    rectifiedFlowVectorField?.velocities?.length > 0;

  // Canvas - need both bind:this (for reactivity) and action (for DPR setup)
  let leftCanvas = null;
  let rightCanvas = null;
  const leftCanvas2d = useCanvas2D(canvasWidth, canvasHeight);
  const rightCanvas2d = useCanvas2D(canvasWidth, canvasHeight);
  // Tie ctx reactivity to canvas variables so it updates when action runs
  $: leftCtx = leftCanvas && leftCanvas2d.ctx;
  $: rightCtx = rightCanvas && rightCanvas2d.ctx;

  // Animation state type
  type AnimationState = {
    time: number;  // WARNING: Using time in draw() is an antipattern. Prefer derived state.
  };

  // Scales
  let leftScales = null;
  let rightScales = null;

  // Pre-calculated grid positions (pixel coords)
  let leftGridPositions = [];
  let rightGridPositions = [];

  // Animation - Timeline system
  let timeline: Timeline<AnimationState> | null = null;

  // Initialization
  let isInitialized = false;

  // Visibility
  let figureIsActive;
  let wasPlayingBeforeHidden = false;

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

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

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function runInitialComputation() {
    if (!leftCanvas || !rightCanvas || !isDataValid) return;

    // Initialize scales for each panel
    leftScales = initializeScales(flowMatchingVectorField);
    rightScales = initializeScales(rectifiedFlowVectorField);

    // Calculate grid positions (pixel coords)
    leftGridPositions = calculateGridPositions(flowMatchingVectorField, leftScales);
    rightGridPositions = calculateGridPositions(rectifiedFlowVectorField, rightScales);

    isInitialized = true;
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  // Main animation clip (reducer pattern)
  const mainClip = {
    name: "Animation",
    duration: 1,
    reduce(t: number) {
      return { time: t };
    }
  };

  function setupTimeline() {
    timeline = new Timeline<AnimationState>();
    timeline.initialState = { time: 0 };

    // Add main animation clip
    timeline.add(mainClip, 0);

    // Set timeline duration and end pause
    timeline.duration = animationDuration / 1000;
    timeline.setEndPause(animationPauseTime / 1000);
    timeline.looping = true;

    // Register tick callback
    timeline.onTick((_t, state) => {
      draw(state);
    });
  }

  function startAnimation() {
    if (!timeline) return;
    timeline.play();
  }

  function stopAnimation() {
    if (timeline) timeline.pause();
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function draw(state: AnimationState) {
    if (!leftCtx || !rightCtx || !isDataValid) return;

    const t = state.time;

    // Clear canvases
    leftCtx.clearRect(0, 0, canvasWidth, canvasHeight);
    rightCtx.clearRect(0, 0, canvasWidth, canvasHeight);

    // --- Dynamic Foreground ---
    // (No static background - vector fields are time-dependent)

    // Map time (0-1) to time indices for each vector field
    // timeIndex computed here because numSteps is external reactive data
    const leftNumSteps = flowMatchingVectorField.timeSteps.length;
    const rightNumSteps = rectifiedFlowVectorField.timeSteps.length;

    const leftTimeIndex = Math.min(Math.floor(t * leftNumSteps), leftNumSteps - 1);
    const rightTimeIndex = Math.min(Math.floor(t * rightNumSteps), rightNumSteps - 1);

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

  // ----------------------------------------------------------------
  // Event Handlers
  // ----------------------------------------------------------------

  function handleVisibilityChange(isActive) {
    if (!timeline) return;
    if (!isActive && timeline.isPlaying) {
      wasPlayingBeforeHidden = true;
      stopAnimation();
    } else if (isActive && wasPlayingBeforeHidden) {
      wasPlayingBeforeHidden = false;
      startAnimation();
    }
  }

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  onDestroy(() => {
    if (timeline) timeline.pause();
  });

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  $: if (!isInitialized && isDataValid && leftCanvas && rightCanvas) {
    runInitialComputation();
    setupTimeline();
    draw(timeline!.initialState);
    if (playingByDefault) startAnimation();
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
          use:rightCanvas2d.bindCanvas
          class="panel-canvas"
        ></canvas>
      </div>
    {/snippet}

    {#snippet footer()}
      <TimeSlider {timeline} color="#f17720" />
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
