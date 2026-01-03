<script>
  import { onDestroy } from "svelte";
  import * as d3 from "d3";
  import { Figure, PlayButton, MultiStateToggleButton, drawScatterPlot, Clock, Track, createPauseClip } from "@diffusion-explorer/ui";
  import { settings } from "$lib/settings";

  // ===== PROPS =====

  // Caption slot
  export let children = undefined;

  // Data - 4D array: [reflowStep][timestep][sample][dim]
  export let trajectories = [];
  export let targetDistribution = [];

  // Layout
  export let marginWidth = 20;
  export let marginHeight = 20;
  export let canvasWidth = 450;
  export let canvasHeight = 450;
  export let domainRange = { xMin: -1.7, xMax: 1.7, yMin: -1.7, yMax: 1.7 };

  // Target distribution styling
  export let targetColor = "#3b82f6";
  export let targetOpacity = 0.35;
  export let distributionPointRadius = 5;

  // Trajectory styling
  export let trajectoryColor = settings.stylingSettings.trajectory.color;
  export let trajectoryStrokeWidth = settings.stylingSettings.trajectory.strokeWidth;
  export let trajectoryProgressOpacity = settings.stylingSettings.trajectory.progressOpacity;
  export let endpointRadius = settings.stylingSettings.trajectory.endpointRadius;

  // Animation
  export let animationDuration = 5000;
  export let pauseDuration = 1000;
  export let playingByDefault = true;

  // Background
  export let backgroundVisible = true;

  // ===== DERIVED =====

  $: caption = children;

  // Generate labels dynamically based on trajectory data
  $: numReflowSteps = trajectories?.length || 0;
  $: reflowLabels = numReflowSteps > 0
    ? ["Flow Matching", ...Array.from({ length: numReflowSteps - 1 }, (_, i) => `Reflow ${i + 1}`)]
    : [];

  $: isDataValid =
    trajectories?.length > 0 &&
    trajectories[0]?.length > 0 &&
    targetDistribution?.length > 0;

  // Current step trajectories
  $: currentTrajectories = isDataValid ? trajectories[currentReflowStep] : [];
  $: numTimeSteps = currentTrajectories?.length || 1;
  $: numSegments = numTimeSteps - 1;
  $: msPerSegment = numSegments > 0 ? animationDuration / numSegments : animationDuration;

  // ===== STATE =====

  // Step selection
  let currentReflowStep = 0;

  // Canvas
  let canvas;
  let ctx;
  let dpr = 1;

  // Scales
  let xScale;
  let yScale;

  // Animation - Clock/Track system
  let time = 0;
  let currentSegmentIndex = 0;
  let isPlaying = playingByDefault;
  let clock = null;
  let track = null;

  // State object mutated by clips
  let animState = { time: 0, segmentIndex: 0 };

  // Main animation clip (maps normalized time to state)
  const mainClip = {
    name: "Animation",
    duration: 1,
    apply(t, params, state) {
      state.time = t;
      state.segmentIndex = Math.floor(t * params.numSegments);
    }
  };

  // Initialization
  let isInitialized = false;

  // Visibility tracking
  let figureIsActive;
  let wasPlayingBeforeHidden = false;

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
    scaledTrajectories = transposeAndScale(currentTrajectories);
  }

  function draw() {
    if (!ctx) return;

    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // Draw target distribution
    drawScatterPlot(ctx, scaledTargetDistribution, distributionPointRadius, targetColor, targetOpacity);

    // Draw trajectories up to current segment
    ctx.strokeStyle = trajectoryColor;
    ctx.lineWidth = trajectoryStrokeWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = trajectoryProgressOpacity;

    for (const trajectory of scaledTrajectories) {
      const endIdx = Math.min(currentSegmentIndex + 1, trajectory.length);
      if (endIdx < 2) continue;

      ctx.beginPath();
      ctx.moveTo(trajectory[0][0], trajectory[0][1]);
      for (let i = 1; i < endIdx; i++) {
        ctx.lineTo(trajectory[i][0], trajectory[i][1]);
      }
      ctx.stroke();
    }

    // Draw endpoint circles at the current position of each trajectory
    ctx.fillStyle = trajectoryColor;
    for (const trajectory of scaledTrajectories) {
      const endIdx = Math.min(currentSegmentIndex + 1, trajectory.length) - 1;
      if (endIdx < 0) continue;

      const [ex, ey] = trajectory[endIdx];
      ctx.beginPath();
      ctx.arc(ex, ey, endpointRadius, 0, 2 * Math.PI);
      ctx.fill();
    }

    ctx.globalAlpha = 1.0;
  }

  function initializeVisualization() {
    if (!canvas || !isDataValid) return;

    initializeScales();
    initializeCanvas();
    precomputeCoordinates();
    isInitialized = true;
    draw();
  }

  // Initialize animation track with main clip and pause
  function initializeAnimation() {
    track = new Track();

    // Calculate normalized durations for track
    const totalDuration = animationDuration + pauseDuration;
    const mainDuration = animationDuration / totalDuration;
    const pauseClipDuration = pauseDuration / totalDuration;

    // Add main animation clip (0 to mainDuration of track time)
    track.add({ ...mainClip, duration: mainDuration }, 0);
    // Add pause clip (mainDuration to 1)
    track.add(createPauseClip(pauseClipDuration), mainDuration);

    clock = new Clock();
  }

  function resetAnimation() {
    currentSegmentIndex = 0;
    time = 0;
    animState.time = 0;
    animState.segmentIndex = 0;
    if (track) track.reset();
  }

  function handleStepChange(newStep) {
    if (newStep === currentReflowStep) return;
    currentReflowStep = newStep;

    // Recompute scaled trajectories for the new step
    scaledTrajectories = transposeAndScale(trajectories[currentReflowStep]);

    // Reset animation
    resetAnimation();
    draw();

    // Restart animation if playing
    if (isPlaying) {
      startAnimation();
    }
  }

  function startAnimation() {
    if (!clock || !track) return;

    clock.start((dt) => {
      // Convert real time delta to normalized track time
      const totalDuration = (animationDuration + pauseDuration) / 1000;
      const normalizedDt = dt / totalDuration;

      track.update(normalizedDt, { numSegments }, animState);
      time = animState.time;
      currentSegmentIndex = animState.segmentIndex;

      // Loop when track completes
      if (track.time >= 1) {
        track.reset();
        animState.time = 0;
        animState.segmentIndex = 0;
        time = 0;
        currentSegmentIndex = 0;
      }

      draw();
    });
  }

  function stopAnimation() {
    if (clock) clock.stop();
  }

  function togglePlayPause() {
    isPlaying = !isPlaying;
    if (isPlaying) {
      startAnimation();
    } else {
      stopAnimation();
    }
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

  $: if (isDataValid && canvas && !isInitialized) {
    initializeVisualization();
    initializeAnimation();
    if (isPlaying) startAnimation();
  }

  // Handle visibility changes (pause when off-screen, resume when back)
  $: if (figureIsActive !== undefined && isInitialized) {
    handleVisibilityChange($figureIsActive);
  }

  // ===== LIFECYCLE =====

  onDestroy(() => {
    if (clock) clock.stop();
  });
</script>

{#if isDataValid}
  <Figure {caption} {backgroundVisible} bind:isActive={figureIsActive}>
    {#snippet children()}
      <div style="display: flex; flex-direction: column; align-items: center; width: 100%;">
        <div style="position: relative; width: 100%; max-width: {canvasWidth}px;">
          <PlayButton
            {isPlaying}
            onclick={togglePlayPause}
            {time}
            circleColor={trajectoryColor}
          />
          <canvas
            bind:this={canvas}
            style="width: 100%; height: auto; aspect-ratio: {canvasWidth}/{canvasHeight};"
          ></canvas>
        </div>
        <div style="margin-top: 12px;">
          <MultiStateToggleButton
            labels={reflowLabels}
            value={currentReflowStep}
            onchange={handleStepChange}
          />
        </div>
      </div>
    {/snippet}
  </Figure>
{:else}
  <div class="placeholder">
    <p>Loading recursive rectified flow visualization...</p>
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
