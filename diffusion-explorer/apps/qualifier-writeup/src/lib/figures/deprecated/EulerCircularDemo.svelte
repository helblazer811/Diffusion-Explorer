<!--
  @deprecated Use EulerStepDemo.svelte instead for a simpler Euler step demonstration
  with ground truth, approximation, and error visualization.

  This component visualizes Euler's method on a circular vector field.
-->

<script>
  import { onMount, onDestroy } from 'svelte';
  import * as d3 from 'd3';
  import { Figure, TimeSlider, Slider, drawVectorField, drawTrajectories } from '@diffusion-explorer/ui';
  import { settings } from '$lib/settings';

  // ===== PROPS =====

  // Caption slot
  export let children = undefined;

  // Layout
  export let width = 600;
  export let height = 400;
  export let margin = 40;

  // Vector field
  export let gridResolutionX = 12;
  export let gridResolutionY = 8;
  export let arrowScale = 40;
  export let arrowColor = '#3b82f6';
  export let arrowOpacity = 0.7;
  export let arrowThickness = 3.0;

  // Trajectory
  export let startPoint = [2, 0];  // Start on the ellipse (a=2)
  export let numSteps = 63;
  export let trajectoryColor = settings.stylingSettings.trajectory.color;
  export let trajectoryWidth = settings.stylingSettings.trajectory.strokeWidth;
  export let pointRadius = settings.stylingSettings.trajectory.endpointRadius;

  // Animation
  export let animationDuration = 6000;
  export let playingByDefault = true;
  export let backgroundVisible = true;

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
  let stepSize = 0.1;
  let isPlaying = playingByDefault;
  let animationFrameId = null;
  let animationStartTime = null;
  let isInitialized = false;
  let wasJustResumed = false;

  // Visibility tracking
  let figureIsActive;
  let wasPlayingBeforeHidden = false;

  // Pre-computed coordinates
  let scaledTrajectory = [];      // [[x,y], ...] in pixels
  let scaledGridPositions = [];   // [[x,y], ...] in pixels
  let scaledVelocities = [];      // [[vx,vy], ...] (scaled for display)

  // ===== HELPERS =====

  // Constants
  const ellipseA = 2;
  const ellipseB = 1;
  const domainRange = { xMin: -4, xMax: 4, yMin: -2, yMax: 2 };

  // Elliptical vector field: velocity tangent to ellipse
  function createEllipticalVectorField(a, b) {
    return (x, y) => [-y * a / b, x * b / a];
  }

  const ellipticalVectorField = createEllipticalVectorField(ellipseA, ellipseB);

  // Generate trajectory using Euler's method
  function generateEulerTrajectory(startPt, step, steps, vectorField) {
    const traj = [[...startPt]];
    let [x, y] = startPt;
    for (let i = 0; i < steps; i++) {
      const [vx, vy] = vectorField(x, y);
      x = x + step * vx;
      y = y + step * vy;
      traj.push([x, y]);
    }
    return traj;
  }

  // Generate grid points and velocities for vector field
  function generateVectorFieldGrid(xRes, yRes, domain, vectorField) {
    const gridPoints = [];
    const velocities = [];
    const xStep = (domain.xMax - domain.xMin) / (xRes - 1);
    const yStep = (domain.yMax - domain.yMin) / (yRes - 1);
    for (let j = 0; j < yRes; j++) {
      for (let i = 0; i < xRes; i++) {
        const x = domain.xMin + i * xStep;
        const y = domain.yMin + j * yStep;
        gridPoints.push([x, y]);
        velocities.push(vectorField(x, y));
      }
    }
    return { gridPoints, velocities };
  }

  // Compute max velocity magnitude
  function computeMaxVelocity(velocities) {
    let maxMag = 0;
    for (const [vx, vy] of velocities) {
      const mag = Math.sqrt(vx * vx + vy * vy);
      if (mag > maxMag) maxMag = mag;
    }
    return maxMag;
  }

  // Derived data
  $: caption = children;
  $: vectorFieldData = generateVectorFieldGrid(gridResolutionX, gridResolutionY, domainRange, ellipticalVectorField);
  $: trajectory = generateEulerTrajectory(startPoint, stepSize, numSteps, ellipticalVectorField);
  $: maxVelocity = computeMaxVelocity(vectorFieldData.velocities);
  $: numSegments = trajectory.length - 1;

  // ===== INITIALIZATION =====

  function initializeScales() {
    xScale = d3.scaleLinear()
      .domain([domainRange.xMin, domainRange.xMax])
      .range([margin, width - margin]);

    yScale = d3.scaleLinear()
      .domain([domainRange.yMin, domainRange.yMax])
      .range([height - margin, margin]);
  }

  function initializeCanvas() {
    if (!canvas) return;

    dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;

    ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
  }

  function precomputeCoordinates() {
    if (!xScale || !yScale) return;

    // Scale trajectory points
    scaledTrajectory = trajectory.map(p => [xScale(p[0]), yScale(p[1])]);

    // Scale vector field grid positions
    scaledGridPositions = vectorFieldData.gridPoints.map(p => [xScale(p[0]), yScale(p[1])]);

    // Y-flip velocities for canvas coords (canvas Y increases downward)
    // Let drawVectorField handle magnitude normalization and scaling
    scaledVelocities = vectorFieldData.velocities.map(([vx, vy]) => [vx, -vy]);
  }

  function initializeVisualization() {
    if (!canvas) return;

    initializeScales();
    initializeCanvas();
    precomputeCoordinates();
    isInitialized = true;
    draw();
  }

  // ===== DRAWING =====

  function draw() {
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    // Draw vector field
    drawVectorField(ctx, scaledGridPositions, scaledVelocities, {
      arrowScale: arrowScale,
      strokeWidth: arrowThickness,
      color: arrowColor,
      opacity: arrowOpacity,
      normalizeVectors: false
    });

    // Draw trajectory with preview
    const segmentIndex = Math.floor(time * numSegments);
    drawTrajectories(ctx, [scaledTrajectory], segmentIndex, {
      strokeWidth: trajectoryWidth,
      color: trajectoryColor,
      progressOpacity: 1.0,
      pointRadius: pointRadius,
      showPreview: true,
      previewOpacity: 0.2
    });
  }

  // ===== ANIMATION =====

  function animate(currentTime) {
    if (!isPlaying) {
      animationFrameId = requestAnimationFrame(animate);
      return;
    }

    // When resuming, recalculate animationStartTime to continue from current position
    if (wasJustResumed) {
      animationStartTime = currentTime - (time * animationDuration);
      wasJustResumed = false;
    } else if (animationStartTime === null) {
      animationStartTime = currentTime;
    }

    const elapsed = currentTime - animationStartTime;
    time = Math.min(elapsed / animationDuration, 1);

    if (time >= 1) {
      // Reset animation with random step size
      animationStartTime = currentTime;
      time = 0;
      stepSize = Math.round((0.01 + Math.random() * (0.15 - 0.01)) * 100) / 100;
    }

    draw();
    animationFrameId = requestAnimationFrame(animate);
  }

  function startAnimation() {
    animationFrameId = requestAnimationFrame(animate);
  }

  function stopAnimation() {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  }

  function toggleAnimation() {
    if (!isPlaying) {
      wasJustResumed = true;
    }
    isPlaying = !isPlaying;
  }

  function handleSliderInput() {
    const now = performance.now();
    animationStartTime = now - (time * animationDuration);
  }

  function handleVisibilityChange(isActive) {
    if (!isActive && isPlaying) {
      wasPlayingBeforeHidden = true;
      isPlaying = false;
    } else if (isActive && wasPlayingBeforeHidden) {
      wasPlayingBeforeHidden = false;
      isPlaying = true;
    }
  }

  // ===== REACTIVE EFFECTS =====

  // Redraw when time changes (e.g., from slider drag while paused)
  $: if (isInitialized && time !== undefined) {
    draw();
  }

  // Recompute coordinates when trajectory changes (stepSize updates trigger this)
  $: if (isInitialized && trajectory) {
    precomputeCoordinates();
    draw();
  }

  // Handle visibility changes (pause when off-screen, resume when back)
  $: if (figureIsActive !== undefined && isInitialized) {
    handleVisibilityChange($figureIsActive);
  }

  // ===== LIFECYCLE =====

  onMount(() => {
    initializeVisualization();
    startAnimation();
  });

  onDestroy(() => {
    stopAnimation();
  });
</script>

<Figure {caption} {backgroundVisible} bind:isActive={figureIsActive}>
  {#snippet children()}
    <div style="display: flex; flex-direction: column; align-items: center; width: 100%;">
      <canvas
        bind:this={canvas}
        style="width: 100%; height: auto; max-width: {width}px; aspect-ratio: {width}/{height};"
      ></canvas>
      <TimeSlider
        bind:value={time}
        bind:isPlaying={isPlaying}
        min={0}
        max={1}
        onTogglePlay={toggleAnimation}
        onInput={handleSliderInput}
        color={trajectoryColor}
      />
      <div class="step-slider-container">
        <div class="step-slider-spacer"></div>
        <Slider
          bind:value={stepSize}
          min={0.01}
          max={0.15}
          step={0.01}
          color={trajectoryColor}
          minLabel="0.01"
          maxLabel="0.15"
          label="Step Size"
          showValue={true}
        />
        <div class="step-slider-spacer desktop-only"></div>
      </div>
    </div>
  {/snippet}
</Figure>

<style>
  .step-slider-container {
    display: flex;
    align-items: flex-start;
    width: 100%;
    max-width: 644px;
    margin-top: 20px;
  }

  .step-slider-spacer {
    width: 32px;
    margin-right: 12px;
    flex-shrink: 0;
  }

  .desktop-only {
    display: block;
  }

  @media (max-width: 600px) {
    .desktop-only {
      display: none;
    }
  }
</style>
