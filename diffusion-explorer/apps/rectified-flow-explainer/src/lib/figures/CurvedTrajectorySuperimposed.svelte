<script>
  import { onMount, onDestroy } from "svelte";
  import * as d3 from "d3";
  import Figure from "$lib/components/Figure.svelte";
  import TimeSlider from "$lib/components/TimeSlider.svelte";
  import { settings } from "$lib/settings";
  import { drawScatterPlot } from "$lib/canvas/plotting";
  import { drawTrajectoriesWithPreview } from "$lib/canvas/trajectories";

  // ===== PROPS =====

  // Caption slot
  export let children = undefined;

  // Data
  export let trajectories = []; // [timestep][sample][dim]
  export let targetDistribution = [];

  // Layout
  export let marginWidth = 20;
  export let marginHeight = 20;
  export let canvasWidth = 350;
  export let canvasHeight = 350;
  export let domainRange = { xMin: -1.7, xMax: 1.7, yMin: -1.7, yMax: 1.7 };

  // Target distribution styling
  export let targetColor = "#3b82f6";
  export let targetOpacity = 0.35;
  export let distributionPointRadius = 5;

  // Trajectory styling
  export let trajectoryColor = settings.stylingSettings.trajectory.color;
  export let trajectoryStrokeWidth = settings.stylingSettings.trajectory.strokeWidth;
  export let trajectoryPointRadius = settings.stylingSettings.trajectory.pointRadius;
  export let trajectoryProgressOpacity = settings.stylingSettings.trajectory.progressOpacity;
  export let trajectoryFullOpacity = settings.stylingSettings.trajectory.fullOpacity;
  export let showTrajectoryPreview = false;

  // Animation
  export let animationDuration = 5000;
  export let pauseDuration = 1000;
  export let playingByDefault = true;

  // Background
  export let backgroundVisible = true;

  // ===== DERIVED =====

  $: caption = children;
  $: isDataValid =
    trajectories?.length > 0 &&
    targetDistribution?.length > 0;
  $: numTimeSteps = isDataValid ? trajectories.length : 1;
  $: numSegments = numTimeSteps - 1;
  $: msPerSegment = numSegments > 0 ? animationDuration / numSegments : animationDuration;

  // ===== STATE =====

  // Canvas
  let canvas;
  let ctx;
  let dpr = 1;

  // Scales
  let xScale;
  let yScale;

  // Animation
  let time = 0;
  let currentSegmentIndex = 0;
  let segmentAccumulator = 0;
  let isPlaying = playingByDefault;
  let animationFrameId = null;
  let lastTimestamp = null;
  let isPaused = false;
  let pauseStartTime = null;

  // Initialization
  let isInitialized = false;

  // Pre-computed coordinates
  let scaledTargetDistribution = [];
  let scaledTrajectories = [];

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
    if (!canvas) return;

    dpr = window.devicePixelRatio || 1;
    canvas.width = canvasWidth * dpr;
    canvas.height = canvasHeight * dpr;
    ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
  }

  function transposeAndScale(traj) {
    if (!xScale || !yScale || !traj?.length) return [];
    const numSamples = traj[0]?.length || 0;
    return Array.from({ length: numSamples }, (_, i) =>
      traj.map(ts => [xScale(ts[i][0]), yScale(ts[i][1])])
    );
  }

  function precomputeCoordinates() {
    if (!xScale || !yScale) return;

    scaledTargetDistribution = targetDistribution.map(p => [xScale(p[0]), yScale(p[1])]);
    scaledTrajectories = transposeAndScale(trajectories);
  }

  function draw() {
    if (!ctx) return;

    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // Draw target distribution
    drawScatterPlot(ctx, scaledTargetDistribution, distributionPointRadius, targetColor, targetOpacity);

    // Draw trajectories
    drawTrajectoriesWithPreview(ctx, scaledTrajectories, currentSegmentIndex, {
      strokeWidth: trajectoryStrokeWidth,
      color: trajectoryColor,
      progressOpacity: trajectoryProgressOpacity,
      pointRadius: trajectoryPointRadius,
      showPreview: showTrajectoryPreview,
      previewOpacity: trajectoryFullOpacity
    });
  }

  function initializeVisualization() {
    if (!canvas || !isDataValid) return;

    initializeScales();
    initializeCanvas();
    precomputeCoordinates();
    isInitialized = true;
    draw();
  }

  function animate(ts) {
    if (!isPlaying) {
      animationFrameId = null;
      return;
    }

    if (lastTimestamp === null) lastTimestamp = ts;
    const elapsed = ts - lastTimestamp;
    lastTimestamp = ts;

    if (isPaused && pauseStartTime !== null) {
      if (ts - pauseStartTime >= pauseDuration) {
        isPaused = false;
        pauseStartTime = null;
        currentSegmentIndex = 0;
        segmentAccumulator = 0;
        time = 0;
        draw();
      }
      animationFrameId = requestAnimationFrame(animate);
      return;
    }

    segmentAccumulator += elapsed;
    while (segmentAccumulator >= msPerSegment && currentSegmentIndex < numSegments) {
      segmentAccumulator -= msPerSegment;
      currentSegmentIndex += 1;
    }

    time = numSegments > 0 ? currentSegmentIndex / numSegments : 0;
    draw();

    if (currentSegmentIndex >= numSegments) {
      isPaused = true;
      pauseStartTime = ts;
    }

    animationFrameId = requestAnimationFrame(animate);
  }

  function startAnimation() {
    if (animationFrameId !== null) return;
    lastTimestamp = null;
    animationFrameId = requestAnimationFrame(animate);
  }

  function stopAnimation() {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  }

  function togglePlayPause() {
    isPlaying = !isPlaying;
    if (!isPlaying) {
      stopAnimation();
    }
  }

  function handleSliderInput() {
    if (isPlaying) {
      isPlaying = false;
      stopAnimation();
    }
    currentSegmentIndex = Math.round(time * numSegments);
    segmentAccumulator = 0;
    draw();
  }

  // ===== REACTIVE EFFECTS =====

  $: if (isDataValid && canvas && !isInitialized) {
    initializeVisualization();
  }

  $: if (isPlaying && isInitialized && !animationFrameId) startAnimation();
  $: if (!isPlaying && animationFrameId) stopAnimation();

  // ===== LIFECYCLE =====

  onMount(() => {
    // Initialization handled by reactive statement
  });

  onDestroy(() => {
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
    }
  });
</script>

{#if isDataValid}
  <Figure {caption} {backgroundVisible}>
    {#snippet children()}
      <div style="display: flex; flex-direction: column; align-items: center; width: 100%;">
        <canvas
          bind:this={canvas}
          style="width: 100%; height: auto; max-width: {canvasWidth}px; aspect-ratio: {canvasWidth}/{canvasHeight};"
        ></canvas>
        <TimeSlider
          bind:value={time}
          {isPlaying}
          min={0}
          max={1}
          onTogglePlay={togglePlayPause}
          onInput={handleSliderInput}
          color={trajectoryColor}
        />
      </div>
    {/snippet}
  </Figure>
{:else}
  <div class="placeholder">
    <p>Loading curved trajectory visualization...</p>
  </div>
{/if}

<style>
  .placeholder {
    padding: 2rem;
    text-align: center;
    background-color: #f9f9f9;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    color: #666;
  }
</style>
