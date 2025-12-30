<script>
  import { onDestroy } from "svelte";
  import Figure from "$lib/components/Figure.svelte";
  import TimeSlider from "$lib/components/TimeSlider.svelte";
  import { settings } from "$lib/settings";
  import { createSourceTargetScales } from "$lib/d3_helpers";
  import { drawScatterPlot, drawText } from "$lib/plotting/plotting";
  import { drawTrajectoriesWithPreview } from "$lib/plotting/trajectories";

  export let sourceDistributionSamples = [];
  export let targetDistributionSamples = [];
  export let allTimeSamples; // [timestep][sample][dim]
  export let animationDuration = 6000;
  export let playingByDefault = true;
  export let pauseBeforeRestart = 1000;
  export let width = 750;
  export let height = 375;
  export let marginWidth = 50;
  export let marginHeight = 20;
  export let numTrajectoriesToShow = 10;

  // Caption slot (passed as default children)
  export let children = undefined;
  $: caption = children;

  // Canvas state
  let canvas;
  let ctx;
  let dpr = 1;

  // Animation state
  let time = 0;
  let isPlaying = playingByDefault;
  let animationFrameId = null;
  let lastTimestamp = null;
  let isPaused = false;
  let pauseStartTime = null;
  let initialized = false;

  // Visibility tracking
  let figureIsActive;
  let wasPlayingBeforeHidden = false;

  // Pre-computed data (computed once on mount/data change)
  let scales = null;
  let transformedTrajectories = []; // [trajectory][timestep][x,y in pixels]
  let sourcePixelCoords = []; // [point][x,y] in pixel space
  let targetPixelCoords = []; // [point][x,y] in pixel space
  let selectedTrajectoryIndices = [];
  let combinedMeanX = 0;

  // Derived values
  $: numSegments = allTimeSamples?.length - 1 || 0;

  // Pick trajectories (first N samples)
  function selectTrajectoryIndices() {
    if (!allTimeSamples || allTimeSamples.length === 0) return;
    selectedTrajectoryIndices = [...Array(numTrajectoriesToShow).keys()].filter(
      (i) => i < allTimeSamples[0].length
    );
  }

  function getPixelX(dataX, meanX, t) {
    const centerPixelX =
      scales.sourceCenterPixelX +
      t * (scales.targetCenterPixelX - scales.sourceCenterPixelX);
    return centerPixelX + (dataX - meanX) * scales.xScaleFactor;
  }

  // Pre-compute all trajectory pixel coordinates
  function precomputeTrajectories() {
    if (!allTimeSamples || allTimeSamples.length === 0 || !scales) return;

    const allX = [
      ...sourceDistributionSamples.map((p) => p[0]),
      ...targetDistributionSamples.map((p) => p[0]),
    ];
    combinedMeanX = allX.reduce((a, b) => a + b, 0) / allX.length;

    transformedTrajectories = selectedTrajectoryIndices.map((sampleIdx) => {
      return allTimeSamples.map((timestep, tIdx) => {
        const point = timestep[sampleIdx];
        const t = tIdx / (allTimeSamples.length - 1);
        const pixelX = getPixelX(point[0], combinedMeanX, t);
        const pixelY = scales.yScale(point[1]);
        return [pixelX, pixelY];
      });
    });
  }

  // Pre-compute scatter plot pixel coordinates
  function precomputeScatterCoords() {
    if (!scales) return;

    sourcePixelCoords = sourceDistributionSamples.map((point) => {
      const pixelX =
        scales.sourceCenterPixelX +
        (point[0] - scales.sourceMeanX) * scales.xScaleFactor;
      const pixelY = scales.yScale(point[1]);
      return [pixelX, pixelY];
    });

    targetPixelCoords = targetDistributionSamples.map((point) => {
      const pixelX =
        scales.targetCenterPixelX +
        (point[0] - scales.targetMeanX) * scales.xScaleFactor;
      const pixelY = scales.yScale(point[1]);
      return [pixelX, pixelY];
    });
  }

  // Initialize canvas
  function initializeCanvas() {
    if (!canvas) return;

    dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;

    ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
  }

  // Initialize scales and pre-compute all data
  function initializeData() {
    scales = createSourceTargetScales(
      sourceDistributionSamples,
      targetDistributionSamples,
      {
        width,
        height,
        marginWidth,
        marginHeight,
        sourceCenterX: settings.stylingSettings.layout.sourceCenterX,
        targetCenterX: settings.stylingSettings.layout.targetCenterX,
        yShiftFactor: settings.stylingSettings.scatterPlot.yShiftFactor,
      }
    );

    selectTrajectoryIndices();
    precomputeScatterCoords();
    precomputeTrajectories();
  }

  // Main draw function
  function draw() {
    if (!ctx || !initialized) return;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Draw source scatter (left)
    drawScatterPlot(
      ctx,
      sourcePixelCoords,
      settings.stylingSettings.scatterPlot.radius,
      settings.stylingSettings.scatterPlot.color,
      settings.stylingSettings.scatterPlot.opacity
    );

    // Draw target scatter (right)
    drawScatterPlot(
      ctx,
      targetPixelCoords,
      settings.stylingSettings.scatterPlot.radius,
      settings.stylingSettings.scatterPlot.color,
      settings.stylingSettings.scatterPlot.opacity
    );

    // Draw distribution labels
    const labelColor = settings.stylingSettings.label.color;
    const labelFontSize = settings.stylingSettings.label.fontSize;
    const labelFontWeight = settings.stylingSettings.label.fontWeight;
    const labelFont = `${labelFontWeight} ${labelFontSize}px Helvetica, Arial, sans-serif`;
    drawText(ctx, "Source Distribution", scales.sourceCenterPixelX, marginHeight / 2, { color: labelColor, font: labelFont });
    drawText(ctx, "Target Distribution", scales.targetCenterPixelX, marginHeight / 2, { color: labelColor, font: labelFont });

    // Calculate current segment index from normalized time
    const segmentIndex = Math.floor(time * numSegments);

    // Draw trajectories with preview
    drawTrajectoriesWithPreview(ctx, transformedTrajectories, segmentIndex, {
      strokeWidth: settings.stylingSettings.trajectory.strokeWidth,
      color: settings.stylingSettings.trajectory.color,
      progressOpacity: settings.stylingSettings.trajectory.progressOpacity,
      pointRadius: settings.stylingSettings.trajectory.pointRadius,
      showPreview: true,
      previewOpacity: settings.stylingSettings.trajectory.fullOpacity,
    });
  }

  // Animation functions
  function animate(ts) {
    if (!isPlaying) {
      animationFrameId = null;
      return;
    }
    if (lastTimestamp === null) lastTimestamp = ts;
    const elapsed = ts - lastTimestamp;

    if (isPaused && pauseStartTime !== null) {
      if (ts - pauseStartTime >= pauseBeforeRestart) {
        isPaused = false;
        pauseStartTime = null;
        lastTimestamp = null;
        time = 0;
        draw();
      }
      animationFrameId = requestAnimationFrame(animate);
      return;
    }

    time += elapsed / animationDuration;
    if (time >= 1) {
      time = 1;
      draw();
      isPaused = true;
      pauseStartTime = ts;
    } else {
      draw();
    }
    lastTimestamp = ts;
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

  function toggleAnimation() {
    isPlaying = !isPlaying;
    if (!isPlaying) {
      stopAnimation();
    }
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

  // Initialize when canvas and data are ready
  $: if (
    canvas &&
    allTimeSamples &&
    allTimeSamples.length > 0 &&
    sourceDistributionSamples.length > 0 &&
    targetDistributionSamples.length > 0 &&
    !initialized
  ) {
    initializeCanvas();
    initializeData();
    initialized = true;
    draw();
    if (isPlaying) startAnimation();
  }

  // Animation control
  $: if (isPlaying && initialized && !animationFrameId) startAnimation();
  $: if (!isPlaying && animationFrameId) stopAnimation();

  // Handle visibility changes (pause when off-screen, resume when back)
  $: if (figureIsActive !== undefined && initialized) {
    handleVisibilityChange($figureIsActive);
  }

  // Redraw when time changes (e.g., slider drag)
  $: if (initialized && time !== undefined) draw();

  onDestroy(() => stopAnimation());
</script>

<Figure {caption} backgroundVisible={false} bind:isActive={figureIsActive}>
  {#snippet children()}
    <div
      style="display:flex;flex-direction:column;align-items:center;width:100%;"
    >
      <canvas
        bind:this={canvas}
        style="width:100%;height:auto;max-width:{width}px;aspect-ratio:{width}/{height};"
      ></canvas>
      <TimeSlider
        bind:value={time}
        bind:isPlaying
        min={0}
        max={1}
        onTogglePlay={toggleAnimation}
        color="#f17720"
      />
    </div>
  {/snippet}
</Figure>
