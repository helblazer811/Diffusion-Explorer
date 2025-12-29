<script>
  import { onMount, onDestroy } from "svelte";
  import * as d3 from "d3";
  import DoubleFigure from "$lib/components/DoubleFigure.svelte";
  import TimeSlider from "$lib/components/TimeSlider.svelte";
  import { settings } from "$lib/settings";
  import { drawScatterPlot } from "$lib/canvas/plotting";
  import { drawTrajectoriesWithOpacityGradient } from "$lib/canvas/trajectories";

  // Caption slot (passed as default children)
  export let children = undefined;
  $: caption = children;

  // Data props - separate trajectories for left and right panels
  export let leftTrajectories = []; // [timestep][sample][dim] - flow matching grid
  export let rightTrajectories = []; // [timestep][sample][dim] - rectified flow grid
  export let targetDistribution = []; // The actual target distribution points

  // Data validation
  $: isDataValid =
    leftTrajectories &&
    leftTrajectories.length > 0 &&
    rightTrajectories &&
    rightTrajectories.length > 0 &&
    targetDistribution &&
    targetDistribution.length > 0;

  // Configuration props
  export let marginWidth = 20;
  export let marginHeight = 30;
  export let topPadding = 20; // Extra space below label
  export let svgWidth = 400;
  export let svgHeight = 400;
  export let trajectoryColor = settings.stylingSettings.trajectory.color;
  export let targetColor = "#3b82f6"; // Blue
  export let targetOpacity = 0.35;
  export let targetPointRadius = 5;

  // Trajectory styling (matching RectifiedFlowVisualization)
  export let showTrajectoryPreview = false; // Show full trajectory path preview
  export let trajectoryFullOpacity = settings.stylingSettings.trajectory.fullOpacity;
  export let trajectoryProgressOpacity = settings.stylingSettings.trajectory.progressOpacity;
  export let trajectoryStrokeWidth = settings.stylingSettings.trajectory.strokeWidth;
  export let trajectoryPointRadius = settings.stylingSettings.trajectory.pointRadius;
  export let alphaTimeWindow = 0.8; // Fraction (0-1) of trajectory to show with fading opacity
  export let animationDuration = 8000; // ms per full loop
  export let playingByDefault = true;
  export let pauseDuration = 1000; // ms pause at end of animation
  export let leftLabel = "Flow Matching";
  export let rightLabel = "Rectified Flow";
  export let labelFontSize = 24;
  export let labelColor = settings.stylingSettings.label.color;
  export let gap = 20;
  export let domainRange = { xMin: -1.7, xMax: 1.7, yMin: -1.7, yMax: 1.7 };

  // Callback when visualization is initialized
  export let onInitialized = undefined;

  // Background visibility
  export let backgroundVisible = true;

  // SVG references
  let leftSvgElement;
  let rightSvgElement;

  // Canvas references
  let leftCanvas;
  let rightCanvas;
  let leftCtx;
  let rightCtx;

  // DPI scaling for high-resolution displays
  let dpr = 1;

  // Scales
  let xScale;
  let yScale;

  // Animation state
  let currentSegmentIndex = 0; // Integer: 0 to numSegments
  let segmentAccumulator = 0;  // Accumulates elapsed time for sub-segment precision
  let isPlaying = playingByDefault;
  let animationFrameId = null;
  let lastTimestamp = null;
  let isPaused = false;
  let pauseStartTime = null;
  let isInitialized = false;

  // Canvas initialization state
  let pathsInitialized = false;

  // Total number of trajectories (derived from data)
  $: numTrajectories = isDataValid ? (leftTrajectories[0]?.length || 0) : 0;

  // Number of time steps and segments in the data
  $: numTimeSteps = isDataValid ? leftTrajectories.length : 1;
  $: numSegments = numTimeSteps - 1;

  // Time per segment for animation pacing
  $: msPerSegment = numSegments > 0 ? animationDuration / numSegments : animationDuration;

  // Time for slider display (0-1) - kept in sync with currentSegmentIndex
  let time = 0;

  // Visibility-based animation control
  let figureIsActive;
  let wasPlayingBeforeHidden = false;

  // Pause animation when figure goes off-screen, resume when back
  $: if (figureIsActive && pathsInitialized) {
    if (!$figureIsActive && isPlaying) {
      wasPlayingBeforeHidden = true;
      isPlaying = false;
    } else if ($figureIsActive && wasPlayingBeforeHidden) {
      wasPlayingBeforeHidden = false;
      isPlaying = true;
    }
  }

  function initializeScales() {
    if (!isDataValid) return;

    const { xMin, xMax, yMin, yMax } = domainRange;

    // Create scales with no translation
    xScale = d3
      .scaleLinear()
      .domain([xMin, xMax])
      .range([marginWidth, svgWidth - marginWidth]);

    yScale = d3
      .scaleLinear()
      .domain([yMin, yMax])
      .range([marginHeight + topPadding, svgHeight - marginHeight]);
  }

  function initializeSvg(svgElement, label) {
    if (!svgElement) return;

    const svg = d3.select(svgElement);
    svg.selectAll("*").remove();

    // Add label at top center
    const labelGroup = svg.append("g").attr("class", "label-group");
    const labelX = svgWidth / 2;
    const labelY = marginHeight / 2 + labelFontSize / 2;

    labelGroup
      .append("text")
      .attr("class", "panel-label")
      .attr("x", labelX)
      .attr("y", labelY)
      .attr("text-anchor", "middle")
      .attr("font-size", `${labelFontSize}px`)
      .attr("fill", labelColor)
      .text(label);
  }

  // Initialize canvas contexts with high-DPI support
  function initializeCanvas() {
    dpr = window.devicePixelRatio || 1;

    if (leftCanvas) {
      leftCanvas.width = svgWidth * dpr;
      leftCanvas.height = svgHeight * dpr;
      leftCtx = leftCanvas.getContext("2d");
      leftCtx.scale(dpr, dpr);
    }
    if (rightCanvas) {
      rightCanvas.width = svgWidth * dpr;
      rightCanvas.height = svgHeight * dpr;
      rightCtx = rightCanvas.getContext("2d");
      rightCtx.scale(dpr, dpr);
    }
  }

  // Draw a panel (scatter plot + trajectories)
  function drawPanel(ctx, trajectories, segmentIndex) {
    if (!ctx || !xScale || !yScale) return;

    // Clear previous frame
    ctx.clearRect(0, 0, svgWidth, svgHeight);

    // Draw target distribution scatter (behind trajectories)
    drawScatterPlot(ctx, targetDistribution, xScale, yScale, targetPointRadius, targetColor, targetOpacity);

    // Draw trajectories with opacity gradient
    drawTrajectoriesWithOpacityGradient(ctx, trajectories, segmentIndex, xScale, yScale, {
      strokeWidth: trajectoryStrokeWidth,
      color: trajectoryColor,
      progressOpacity: trajectoryProgressOpacity,
      pointRadius: trajectoryPointRadius,
      showPreview: showTrajectoryPreview,
      previewOpacity: trajectoryFullOpacity
    }, alphaTimeWindow);
  }

  function initializeVisualization() {
    if (!leftSvgElement || !rightSvgElement || !isDataValid) return;

    initializeScales();
    initializeSvg(leftSvgElement, leftLabel);
    initializeSvg(rightSvgElement, rightLabel);

    // Initialize canvas after SVG structure is ready
    requestAnimationFrame(() => {
      initializeCanvas();
      pathsInitialized = true;
      updateVisualization();
      isInitialized = true;
      onInitialized?.();
    });
  }

  function updateVisualization() {
    if (!isDataValid || !leftCtx || !rightCtx) return;

    drawPanel(leftCtx, leftTrajectories, currentSegmentIndex);
    drawPanel(rightCtx, rightTrajectories, currentSegmentIndex);
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
        updateVisualization();
      }
      animationFrameId = requestAnimationFrame(animate);
      return;
    }

    // Accumulate time and advance segments one at a time
    segmentAccumulator += elapsed;
    while (segmentAccumulator >= msPerSegment && currentSegmentIndex < numSegments) {
      segmentAccumulator -= msPerSegment;
      currentSegmentIndex += 1;
    }

    // Keep time in sync for slider display
    time = numSegments > 0 ? currentSegmentIndex / numSegments : 0;

    updateVisualization();

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
    // When user drags the slider, stop playback
    if (isPlaying) {
      isPlaying = false;
      stopAnimation();
    }
    // Convert slider time value to segment index
    currentSegmentIndex = Math.round(time * numSegments);
    segmentAccumulator = 0;
    updateVisualization();
  }

  $: if (isDataValid && leftSvgElement && rightSvgElement && !isInitialized) {
    initializeVisualization();
  }

  // Start animation once paths are initialized
  $: if (isPlaying && pathsInitialized && !animationFrameId) startAnimation();
  $: if (!isPlaying && animationFrameId) stopAnimation();

  onMount(() => {
    // Scales and animation are handled by the reactive statement
  });

  onDestroy(() => {
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
    }
  });
</script>

{#if isDataValid}
  <DoubleFigure {gap} {caption} {backgroundVisible} bind:isActive={figureIsActive}>
    {#snippet left()}
      <div class="panel-container" style="max-width: {svgWidth}px;">
        <svg
          bind:this={leftSvgElement}
          viewBox="0 0 {svgWidth} {svgHeight}"
          preserveAspectRatio="xMidYMid meet"
          style="width: 100%; height: auto;"
        >
        </svg>
        <canvas
          bind:this={leftCanvas}
          class="canvas-overlay"
        ></canvas>
      </div>
    {/snippet}

    {#snippet right()}
      <div class="panel-container" style="max-width: {svgWidth}px;">
        <svg
          bind:this={rightSvgElement}
          viewBox="0 0 {svgWidth} {svgHeight}"
          preserveAspectRatio="xMidYMid meet"
          style="width: 100%; height: auto;"
        >
        </svg>
        <canvas
          bind:this={rightCanvas}
          class="canvas-overlay"
        ></canvas>
      </div>
    {/snippet}

    {#snippet footer()}
      <TimeSlider
        bind:value={time}
        {isPlaying}
        min={0}
        max={1}
        onTogglePlay={togglePlayPause}
        onInput={handleSliderInput}
        color="#f17720"
      />
    {/snippet}
  </DoubleFigure>
{:else}
  <div class="placeholder">
    <p>
      Rectified flow superimposed visualization requires rectified flow data
      with at least 2 steps.
    </p>
  </div>
{/if}

<style>
  .panel-container {
    position: relative;
    width: 100%;
  }

  .canvas-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
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
