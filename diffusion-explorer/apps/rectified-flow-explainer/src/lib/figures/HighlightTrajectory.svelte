<script>
  import { onDestroy } from "svelte";
  import { Figure, TimeSlider, drawScatterPlot, drawMathjaxOnCanvas, drawTrajectoriesWithPreview, createSourceTargetScales } from "@diffusion-explorer/ui";
  import { settings } from "$lib/settings";
  import { FlowModelClient } from "@diffusion-explorer/diffusion";

  // Create sampling client
  const flowMatchingClient = new FlowModelClient(
    settings.samplingWorkerUrl,
    settings.flowMatchingModelPath,
    "Flow Matching",
    settings.trainingSettings.modelConfig
  );

  export let sourceDistributionSamples = [];
  export let targetDistributionSamples = [];
  export let allTimeSamples; // [timestep][sample][dim]
  export let animationDuration = 6000;
  export let playingByDefault = true;
  export let pauseBeforeRestart = 1000;
  export let width = 750;
  export let height = 350;
  export let marginWidth = 50;
  export let marginHeight = 20;
  export let numTrajectoriesToShow = 1;
  export let samplingSteps = 200;

  // In-progress clicked trajectory state
  let clickedTrajectory = null; // [[x,y], ...] in pixel coordinates being built
  let isStreamingTrajectory = false;

  // LaTeX label styling
  export let latexLabelOffsetY = settings.stylingSettings.figureLatex.latexLabelOffsetY;
  export let latexFontSize = settings.stylingSettings.figureLatex.fontSize;

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

  // Pre-computed data
  let scales = null;
  let selectedTrajectoryIndices = [];
  let transformedTrajectories = []; // [trajectory][timestep][x,y in pixels]
  let trajectoryLengths = []; // Total path length for each trajectory
  let sourcePixelCoords = [];
  let targetPixelCoords = [];
  let combinedMeanX = 0;

  // Visibility tracking
  let figureIsActive;
  let wasPlayingBeforeHidden = false;

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

  // Pre-compute trajectory pixel coordinates
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

    // Calculate path lengths for each trajectory
    trajectoryLengths = transformedTrajectories.map((traj) => {
      let length = 0;
      for (let i = 1; i < traj.length; i++) {
        const dx = traj[i][0] - traj[i - 1][0];
        const dy = traj[i][1] - traj[i - 1][1];
        length += Math.sqrt(dx * dx + dy * dy);
      }
      return length;
    });
  }

  // Pre-compute scatter coordinates
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
    const domainX = scales.sourceMeanX + (clickX - scales.sourceCenterPixelX) / scales.xScaleFactor;
    const domainY = scales.yScale.invert(clickY);

    sampleFromPoint([domainX, domainY]);
  }

  // Sample from a clicked point using streaming
  function sampleFromPoint(point) {
    isStreamingTrajectory = true;

    // Initialize with click point scaled to t=0 position
    const initialPixelX = getPixelX(point[0], combinedMeanX, 0);
    const initialPixelY = scales.yScale(point[1]);
    clickedTrajectory = [[initialPixelX, initialPixelY]];

    // Clear existing trajectories - will be replaced by user's trajectory
    transformedTrajectories = [];

    // Reset and start animation
    time = 0;
    isPaused = false;
    pauseStartTime = null;
    lastTimestamp = null;
    isPlaying = true;

    // Sample with streaming
    const result = flowMatchingClient.sampleFromInitialPoints(
      [point],
      samplingSteps,
      {},
      // onStep - append each new point, transformed to pixel space
      (step, x_t) => {
        const t = (step + 1) / samplingSteps;
        const pixelX = getPixelX(x_t[0][0], combinedMeanX, t);
        const pixelY = scales.yScale(x_t[0][1]);
        clickedTrajectory = [...clickedTrajectory, [pixelX, pixelY]];
      }
    );
    result.promise.then(() => {
      if (clickedTrajectory && clickedTrajectory.length > 1) {
        // Replace with user's trajectory
        transformedTrajectories = [clickedTrajectory];
      }
      clickedTrajectory = null;
      isStreamingTrajectory = false;
    });
  }

  // Initialize scales and pre-compute data
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

  // Get point at a specific progress (0-1) along a trajectory
  function getPointAtProgress(trajectoryIndex, progress) {
    const traj = transformedTrajectories[trajectoryIndex];
    const totalLength = trajectoryLengths[trajectoryIndex];
    const targetLength = progress * totalLength;

    let accumulatedLength = 0;
    for (let i = 1; i < traj.length; i++) {
      const dx = traj[i][0] - traj[i - 1][0];
      const dy = traj[i][1] - traj[i - 1][1];
      const segmentLength = Math.sqrt(dx * dx + dy * dy);

      if (accumulatedLength + segmentLength >= targetLength) {
        const t = (targetLength - accumulatedLength) / segmentLength;
        return [traj[i - 1][0] + t * dx, traj[i - 1][1] + t * dy];
      }
      accumulatedLength += segmentLength;
    }
    return traj[traj.length - 1];
  }

  // Main draw function
  async function draw() {
    if (!ctx || !initialized) return;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Draw scatter plots
    drawScatterPlot(
      ctx,
      sourcePixelCoords,
      settings.stylingSettings.scatterPlot.radius,
      settings.stylingSettings.scatterPlot.color,
      settings.stylingSettings.scatterPlot.opacity
    );

    drawScatterPlot(
      ctx,
      targetPixelCoords,
      settings.stylingSettings.scatterPlot.radius,
      settings.stylingSettings.scatterPlot.color,
      settings.stylingSettings.scatterPlot.opacity
    );

    // Draw the single trajectory (if exists)
    if (transformedTrajectories.length > 0) {
      const numTimesteps = transformedTrajectories[0].length;
      const segmentIndex = Math.floor(time * (numTimesteps - 1));

      drawTrajectoriesWithPreview(ctx, transformedTrajectories, segmentIndex, {
        strokeWidth: settings.stylingSettings.trajectory.strokeWidth,
        color: settings.stylingSettings.trajectory.color,
        progressOpacity: settings.stylingSettings.trajectory.progressOpacity,
        pointRadius: settings.stylingSettings.trajectory.endpointRadius,
        showPreview: false,
        previewOpacity: 0,
      });
    }

    // Draw in-progress clicked trajectory
    if (clickedTrajectory && clickedTrajectory.length >= 1) {
      const targetSegmentIndex = Math.floor(time * (samplingSteps - 1));
      const endIdx = Math.min(targetSegmentIndex + 1, clickedTrajectory.length);

      // Draw trajectory line if we have at least 2 points
      if (endIdx >= 2) {
        ctx.strokeStyle = settings.stylingSettings.trajectory.color;
        ctx.lineWidth = settings.stylingSettings.trajectory.strokeWidth;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.globalAlpha = settings.stylingSettings.trajectory.progressOpacity;

        ctx.beginPath();
        ctx.moveTo(clickedTrajectory[0][0], clickedTrajectory[0][1]);
        for (let i = 1; i < endIdx; i++) {
          ctx.lineTo(clickedTrajectory[i][0], clickedTrajectory[i][1]);
        }
        ctx.stroke();
        ctx.globalAlpha = 1.0;
      }

      // Draw point at current position
      const currentPoint = clickedTrajectory[Math.max(0, endIdx - 1)];
      ctx.fillStyle = settings.stylingSettings.trajectory.color;
      ctx.beginPath();
      ctx.arc(currentPoint[0], currentPoint[1], settings.stylingSettings.trajectory.endpointRadius, 0, Math.PI * 2);
      ctx.fill();

      // Draw LaTeX labels for in-progress trajectory
      const startPoint = clickedTrajectory[0];
      const latexColor = settings.stylingSettings.figureLatex.color;

      // Draw "x" label at start
      await drawMathjaxOnCanvas(
        ctx,
        "x",
        startPoint[0],
        startPoint[1],
        latexFontSize,
        0,
        latexLabelOffsetY,
        { color: latexColor }
      );

      // Draw "ψ_t(x)" label at current position (after initial movement)
      if (time >= 0.05) {
        await drawMathjaxOnCanvas(
          ctx,
          "\\psi_t(x)",
          currentPoint[0],
          currentPoint[1],
          latexFontSize,
          0,
          latexLabelOffsetY,
          { color: latexColor }
        );
      }
    }

    // Draw LaTeX labels directly on canvas
    const latexColor = settings.stylingSettings.figureLatex.color;
    for (let idx = 0; idx < transformedTrajectories.length; idx++) {
      const traj = transformedTrajectories[idx];
      const startPoint = traj[0];
      const currentPoint = getPointAtProgress(idx, time);

      // Draw "x" label at start
      await drawMathjaxOnCanvas(
        ctx,
        "x",
        startPoint[0],
        startPoint[1],
        latexFontSize,
        0,
        latexLabelOffsetY,
        { color: latexColor }
      );

      // Draw "ψ_t(x)" label at current position (after initial movement)
      if (time >= 0.05) {
        await drawMathjaxOnCanvas(
          ctx,
          "\\psi_t(x)",
          currentPoint[0],
          currentPoint[1],
          latexFontSize,
          0,
          latexLabelOffsetY,
          { color: latexColor }
        );
      }
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
    if (playingByDefault) startAnimation();
  }

  // Handle visibility changes (separate from initialization)
  $: if (figureIsActive !== undefined && initialized) {
    handleVisibilityChange($figureIsActive);
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

  // Animation control
  $: if (isPlaying && initialized && !animationFrameId) startAnimation();
  $: if (!isPlaying && animationFrameId) stopAnimation();

  // Redraw when time changes (e.g., slider drag)
  $: if (initialized && time !== undefined) draw();

  onDestroy(() => stopAnimation());
</script>

<Figure {caption} bind:isActive={figureIsActive} backgroundVisible={false}>
  {#snippet children()}
    <div
      style="display:flex;flex-direction:column;align-items:center;width:100%;"
    >
      <div style="width:100%;max-width:{width}px;">
        <canvas
          bind:this={canvas}
          onclick={handleCanvasClick}
          style="cursor:pointer;width:100%;height:auto;aspect-ratio:{width}/{height};"
        ></canvas>
      </div>
      <TimeSlider
        bind:value={time}
        bind:isPlaying
        min={0}
        max={1}
        onTogglePlay={toggleAnimation}
        color={settings.stylingSettings.trajectory.color}
      />
    </div>
  {/snippet}
</Figure>
