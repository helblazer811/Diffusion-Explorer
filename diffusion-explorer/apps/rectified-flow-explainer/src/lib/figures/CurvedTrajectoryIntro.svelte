<script>
  import { onDestroy } from "svelte";
  import Figure from "$lib/components/Figure.svelte";
  import TimeSlider from "$lib/components/TimeSlider.svelte";
  import { settings } from "$lib/settings";
  import { createSourceTargetScales } from "$lib/d3_helpers";
  import { drawScatterPlot, drawText } from "$lib/plotting/plotting";
  import { drawTrajectoriesWithPreview } from "$lib/plotting/trajectories";
  import { callSamplingWorkerThreadFromInitialPoints } from "@diffusion-explorer/diffusion";

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
  export let maxTrajectories = 30;

  // In-progress clicked trajectory state
  let clickedTrajectory = null; // [[x,y], ...] in pixel coordinates being built
  let isStreamingTrajectory = false;
  let mostRecentTrajectoryIndex = -1; // Index of the most recently added trajectory
  let hasUserTapped = false; // Track if user has tapped at all

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
  $: numTimeSteps = allTimeSamples?.length || 1;
  $: numSegments = numTimeSteps - 1;

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

  // Handle canvas click - restricted to source distribution region
  function handleCanvasClick(event) {
    // Ignore clicks while sampling is in progress
    if (isStreamingTrajectory) return;
    if (!settings.samplingWorkerUrl || !settings.flowMatchingModelPath) return;
    if (!scales) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = width / rect.width;
    const scaleY = height / rect.height;
    const clickX = (event.clientX - rect.left) * scaleX;
    const clickY = (event.clientY - rect.top) * scaleY;

    // Restrict to source distribution region (left half of canvas)
    const sourceRegionMaxX = width * 0.5;
    if (clickX > sourceRegionMaxX) return;

    // Convert pixel to domain coordinates
    // Inverse of: pixelX = sourceCenterPixelX + (dataX - sourceMeanX) * xScaleFactor
    const domainX = scales.sourceMeanX + (clickX - scales.sourceCenterPixelX) / scales.xScaleFactor;
    const domainY = scales.yScale.invert(clickY);

    sampleFromPoint([domainX, domainY]);
  }

  // Sample from a clicked point using streaming
  function sampleFromPoint(point) {
    hasUserTapped = true;
    isStreamingTrajectory = true;

    // Initialize with click point scaled to t=0 position
    const initialPixelX = getPixelX(point[0], combinedMeanX, 0);
    const initialPixelY = scales.yScale(point[1]);
    clickedTrajectory = [[initialPixelX, initialPixelY]];

    // Reset and start animation
    time = 0;
    isPaused = false;
    pauseStartTime = null;
    lastTimestamp = null;
    isPlaying = true;

    // Sample with streaming
    callSamplingWorkerThreadFromInitialPoints(
      settings.samplingWorkerUrl,
      settings.flowMatchingModelPath,
      'Flow Matching',
      settings.trainingSettings.modelConfig,
      [point],
      numTimeSteps,
      // onComplete - add trajectory to the pool
      () => {
        if (clickedTrajectory && clickedTrajectory.length > 1) {
          // Add to transformed trajectories
          transformedTrajectories = [...transformedTrajectories, clickedTrajectory];
          mostRecentTrajectoryIndex = transformedTrajectories.length - 1;

          // Remove random trajectory if over cap (but not the most recent one)
          while (transformedTrajectories.length > maxTrajectories) {
            // Pick random index excluding the most recent trajectory
            let randomIdx;
            do {
              randomIdx = Math.floor(Math.random() * transformedTrajectories.length);
            } while (randomIdx === mostRecentTrajectoryIndex);

            transformedTrajectories = transformedTrajectories.filter((_, i) => i !== randomIdx);
            // Adjust mostRecentTrajectoryIndex if needed
            if (randomIdx < mostRecentTrajectoryIndex) {
              mostRecentTrajectoryIndex--;
            }
          }
        }
        clickedTrajectory = null;
        isStreamingTrajectory = false;
      },
      null,     // domainRange
      {},       // options
      // onStep - append each new point, transformed to pixel space
      (step, x_t) => {
        const t = (step + 1) / numTimeSteps;
        const pixelX = getPixelX(x_t[0][0], combinedMeanX, t);
        const pixelY = scales.yScale(x_t[0][1]);
        clickedTrajectory = [...clickedTrajectory, [pixelX, pixelY]];
      }
    );
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

    // Opacity settings
    const dimmedOpacity = settings.stylingSettings.trajectory.fullOpacity; // Lower opacity for older trajectories
    const highlightedOpacity = settings.stylingSettings.trajectory.progressOpacity; // Higher opacity for most recent

    // Before user taps: draw all trajectories with normal opacity
    // After user taps: dim older trajectories, highlight most recent
    if (!hasUserTapped) {
      // No tap yet - draw all trajectories with normal opacity
      drawTrajectoriesWithPreview(ctx, transformedTrajectories, segmentIndex, {
        strokeWidth: settings.stylingSettings.trajectory.strokeWidth,
        color: settings.stylingSettings.trajectory.color,
        progressOpacity: highlightedOpacity,
        pointRadius: settings.stylingSettings.trajectory.pointRadius,
        showPreview: false,
        previewOpacity: 0,
      });
    } else {
      // User has tapped - draw older trajectories dimmed, most recent highlighted
      const olderTrajectories = transformedTrajectories.filter((_, i) => i !== mostRecentTrajectoryIndex);
      if (olderTrajectories.length > 0) {
        drawTrajectoriesWithPreview(ctx, olderTrajectories, segmentIndex, {
          strokeWidth: settings.stylingSettings.trajectory.strokeWidth,
          color: settings.stylingSettings.trajectory.color,
          progressOpacity: dimmedOpacity,
          pointRadius: settings.stylingSettings.trajectory.pointRadius,
          showPreview: false,
          previewOpacity: 0,
        });
      }

      // Draw most recent trajectory (highlighted, no preview)
      if (mostRecentTrajectoryIndex >= 0 && mostRecentTrajectoryIndex < transformedTrajectories.length) {
        const recentTrajectory = [transformedTrajectories[mostRecentTrajectoryIndex]];
        drawTrajectoriesWithPreview(ctx, recentTrajectory, segmentIndex, {
          strokeWidth: settings.stylingSettings.trajectory.strokeWidth,
          color: settings.stylingSettings.trajectory.color,
          progressOpacity: highlightedOpacity,
          pointRadius: settings.stylingSettings.trajectory.pointRadius,
          showPreview: false,
          previewOpacity: 0,
        });
      }
    }

    // Draw in-progress clicked trajectory (highlighted, synced with animation time)
    if (clickedTrajectory && clickedTrajectory.length > 1) {
      ctx.strokeStyle = settings.stylingSettings.trajectory.color;
      ctx.lineWidth = settings.stylingSettings.trajectory.strokeWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalAlpha = highlightedOpacity;

      // Calculate how much of clicked trajectory to draw based on time
      // Use numSegments for timing to sync with pre-computed trajectories
      const targetSegmentIndex = Math.floor(time * numSegments);
      const endIdx = Math.min(targetSegmentIndex + 1, clickedTrajectory.length);

      if (endIdx >= 2) {
        ctx.beginPath();
        ctx.moveTo(clickedTrajectory[0][0], clickedTrajectory[0][1]);
        for (let i = 1; i < endIdx; i++) {
          ctx.lineTo(clickedTrajectory[i][0], clickedTrajectory[i][1]);
        }
        ctx.stroke();

        // Draw point at current position
        const lastPoint = clickedTrajectory[endIdx - 1];
        ctx.fillStyle = settings.stylingSettings.trajectory.color;
        ctx.beginPath();
        ctx.arc(lastPoint[0], lastPoint[1], settings.stylingSettings.trajectory.pointRadius, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = 1.0;
    }
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
        onclick={handleCanvasClick}
        style="cursor:pointer;width:100%;height:auto;max-width:{width}px;aspect-ratio:{width}/{height};"
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
