<!-- Diffeomorphism figure - visualizes how a flow matching model transforms space via an animated mesh grid -->

<script>
  import { onMount, onDestroy } from "svelte";
  import { FlowModelClient } from "@diffusion-explorer/diffusion";
  import {
    Figure,
    TimeSlider,
    drawScatterPlot,
    drawText,
    plotMeshGrid,
    createSourceTargetScales
  } from "@diffusion-explorer/ui";
  import { settings } from "$lib/settings";

  // Caption slot (passed as default children)
  export let children = undefined;
  $: caption = children;

  // Data props (passed from page)
  export let sourceDistributionSamples = [];
  export let targetDistributionSamples = [];

  // Mesh grid styling props
  export let meshGridColor = settings.stylingSettings.trajectory.color;
  export let meshGridOpacity = 0.8;
  export let meshGridStrokeWidth = 2;

  // Layout/sizing
  export let width = 800;
  export let height = 450;
  export let marginWidth = 50;
  export let marginHeight = 20;

  // Animation
  export let animationDuration = 6000;
  export let pauseDuration = 1000;
  export let playingByDefault = true;

  // Grid sampling
  export let gridResolution = 10;
  export let numSteps = settings.samplingSettings.flowMatchingGrid.numSteps;

  // Scatter plot styling
  export let scatterPointRadius = settings.stylingSettings.scatterPlot.radius;
  export let scatterPointOpacity = settings.stylingSettings.scatterPlot.opacity;
  export let scatterPointColor = settings.stylingSettings.scatterPlot.color;

  // Label styling
  export let labelFontSize = settings.stylingSettings.label.fontSize;
  export let labelFontWeight = settings.stylingSettings.label.fontWeight;
  export let labelColor = settings.stylingSettings.label.color;
  export let sourceLabelText = "Source Distribution";
  export let targetLabelText = "Target Distribution";

  // Background visibility
  export let backgroundVisible = false;

  // Canvas state
  let canvas;
  let ctx;
  let dpr = 1;

  // Scales and coordinates
  let scales = null;
  let sourcePixelCoords = [];
  let targetPixelCoords = [];

  // Grid trajectory data
  // Shape: [timesteps][gridResolution][gridResolution][2]
  let allGridStates = [];
  let isLoading = true;

  // Animation state
  let isPlaying = playingByDefault;
  let animationFrameId = null;
  let time = 0;
  let direction = 1;
  let isPaused = false;
  let pauseStartTime = null;
  let lastTimestamp = null;
  let isInitialized = false;

  // Visibility-based animation control
  let figureIsActive;
  let wasPlayingBeforeHidden = false;

  // FlowModelClient instance
  let client = null;

  // Pause animation when figure goes off-screen
  $: if (figureIsActive !== undefined && isInitialized) {
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

  function toggleAnimation() {
    isPlaying = !isPlaying;
  }

  function handleSliderInput() {
    lastTimestamp = null;
    if (isPaused) {
      isPaused = false;
      pauseStartTime = null;
    }
  }

  // Canvas initialization
  function initializeCanvas() {
    if (!canvas) return;
    dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
  }

  // Pre-compute scatter coordinates
  function precomputeScatterCoords() {
    if (!scales) return;

    sourcePixelCoords = sourceDistributionSamples.map((p) => [
      scales.sourceCenterPixelX + (p[0] - scales.sourceMeanX) * scales.xScaleFactor,
      scales.yScale(p[1]),
    ]);

    targetPixelCoords = targetDistributionSamples.map((p) => [
      scales.targetCenterPixelX + (p[0] - scales.targetMeanX) * scales.xScaleFactor,
      scales.yScale(p[1]),
    ]);
  }

  // Reshape flat trajectory data to grid structure
  // Input: [timesteps, gridResolution², 2]
  // Output: [timesteps][gridResolution][gridResolution][2]
  function reshapeToGrid(trajectories, resolution) {
    return trajectories.map(timestep => {
      const grid = [];
      for (let i = 0; i < resolution; i++) {
        grid[i] = [];
        for (let j = 0; j < resolution; j++) {
          const sampleIdx = i * resolution + j;
          grid[i][j] = timestep[sampleIdx];
        }
      }
      return grid;
    });
  }

  // Transform grid coordinates to pixels with horizontal interpolation
  function transformGridToPixels(grid, t) {
    if (!scales) return grid;

    const centerPixelX = scales.sourceCenterPixelX +
      t * (scales.targetCenterPixelX - scales.sourceCenterPixelX);

    return grid.map(row => row.map(point => {
      const [dataX, dataY] = point;
      // Use source mean for x offset since grid starts in source region
      const pixelX = centerPixelX + (dataX - scales.sourceMeanX) * scales.xScaleFactor;
      const pixelY = scales.yScale(dataY);
      return [pixelX, pixelY];
    }));
  }

  // Compute domain range from source distribution
  function computeDomainRange() {
    if (sourceDistributionSamples.length === 0) {
      return settings.samplingSettings.flowMatchingGrid.gridDomainRange;
    }

    const xs = sourceDistributionSamples.map(p => p[0]);
    const ys = sourceDistributionSamples.map(p => p[1]);

    const padding = 0.1; // Add some padding
    const xMin = Math.min(...xs) - padding;
    const xMax = Math.max(...xs) + padding;
    const yMin = Math.min(...ys) - padding;
    const yMax = Math.max(...ys) + padding;

    return { xMin, xMax, yMin, yMax };
  }

  // Sample grid trajectories from model
  async function sampleGridTrajectories() {
    if (!client) return;

    const gridDomainRange = computeDomainRange();

    try {
      const result = client.sampleGrid(
        gridResolution,
        gridDomainRange,
        numSteps
      );

      const trajectories = await result.promise;
      // trajectories shape: [timesteps, gridResolution², 2]
      allGridStates = reshapeToGrid(trajectories, gridResolution);
      isLoading = false;
    } catch (error) {
      console.error("Error sampling grid trajectories:", error);
      isLoading = false;
    }
  }

  // Main draw function
  function draw() {
    if (!ctx || !isInitialized) return;
    ctx.clearRect(0, 0, width, height);

    // Draw text labels
    const textY = marginHeight / 2;
    drawText(ctx, sourceLabelText, scales.sourceCenterPixelX, textY, {
      font: `${labelFontWeight} ${labelFontSize}px Helvetica, Arial, sans-serif`,
      color: labelColor,
      align: "center",
      baseline: "top",
    });
    drawText(ctx, targetLabelText, scales.targetCenterPixelX, textY, {
      font: `${labelFontWeight} ${labelFontSize}px Helvetica, Arial, sans-serif`,
      color: labelColor,
      align: "center",
      baseline: "top",
    });

    // Draw scatter plots
    drawScatterPlot(ctx, sourcePixelCoords, scatterPointRadius, scatterPointColor, scatterPointOpacity);
    drawScatterPlot(ctx, targetPixelCoords, scatterPointRadius, scatterPointColor, scatterPointOpacity);

    // Draw mesh grid if data is ready
    if (allGridStates.length > 0) {
      // Get current grid state based on animation time
      const timestepIndex = Math.min(
        Math.floor(time * (allGridStates.length - 1)),
        allGridStates.length - 1
      );
      const currentGrid = allGridStates[timestepIndex];

      // Transform to pixel coordinates with horizontal interpolation
      const pixelGrid = transformGridToPixels(currentGrid, time);

      // Draw mesh grid
      plotMeshGrid(ctx, pixelGrid, {
        color: meshGridColor,
        opacity: meshGridOpacity,
        strokeWidth: meshGridStrokeWidth
      });
    } else if (isLoading) {
      // Show loading indicator
      drawText(ctx, "Loading model...", width / 2, height / 2, {
        font: "16px Helvetica, Arial, sans-serif",
        color: "#999",
        align: "center",
        baseline: "middle",
      });
    }
  }

  // Animation
  function animate(timestamp) {
    if (!isPlaying) {
      animationFrameId = null;
      return;
    }

    if (lastTimestamp === null) {
      lastTimestamp = timestamp;
    }

    const elapsed = timestamp - lastTimestamp;

    // Handle pause at endpoints
    if (isPaused && pauseStartTime !== null) {
      const pauseElapsed = timestamp - pauseStartTime;
      if (pauseElapsed >= pauseDuration) {
        isPaused = false;
        pauseStartTime = null;
        lastTimestamp = timestamp;
        direction = -direction;
      }
      animationFrameId = requestAnimationFrame(animate);
      return;
    }

    // Update time based on direction
    const deltaTime = elapsed / animationDuration;
    time += direction * deltaTime;

    // Clamp and handle endpoint pause
    if (time >= 1.0) {
      time = 1.0;
      isPaused = true;
      pauseStartTime = timestamp;
    } else if (time <= 0.0) {
      time = 0.0;
      isPaused = true;
      pauseStartTime = timestamp;
    }

    draw();
    lastTimestamp = timestamp;
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

  function initializeVisualization() {
    if (!canvas) return;
    if (sourceDistributionSamples.length === 0 || targetDistributionSamples.length === 0) return;

    // Create scales for horizontal layout
    scales = createSourceTargetScales(sourceDistributionSamples, targetDistributionSamples, {
      width,
      height,
      marginWidth,
      marginHeight,
      sourceCenterX: settings.stylingSettings.layout.sourceCenterX,
      targetCenterX: settings.stylingSettings.layout.targetCenterX,
      yShiftFactor: settings.stylingSettings.scatterPlot.yShiftFactor,
    });

    // Initialize canvas
    initializeCanvas();

    // Pre-compute scatter coordinates
    precomputeScatterCoords();

    // Create model client and start sampling
    client = new FlowModelClient(
      settings.samplingWorkerUrl,
      settings.flowMatchingModelPath,
      "Flow Matching",
      settings.trainingSettings.modelConfig
    );

    sampleGridTrajectories();
  }

  // Reactive initialization
  $: if (
    !isInitialized &&
    sourceDistributionSamples.length > 0 &&
    targetDistributionSamples.length > 0 &&
    canvas
  ) {
    initializeVisualization();
    isInitialized = true;
    draw();
    if (isPlaying) startAnimation();
  }

  // Handle play/pause changes
  $: if (isPlaying && !animationFrameId && isInitialized) {
    startAnimation();
  }

  $: if (!isPlaying && animationFrameId) {
    stopAnimation();
  }

  // Update drawing when time changes (e.g., from slider drag)
  $: if (isInitialized && time !== undefined) {
    draw();
  }

  // Redraw when grid data becomes available
  $: if (isInitialized && allGridStates.length > 0) {
    draw();
  }

  onDestroy(() => {
    stopAnimation();
  });
</script>

<Figure {caption} {backgroundVisible} bind:isActive={figureIsActive}>
  {#snippet children()}
    <div style="display: flex; flex-direction: column; align-items: center; width: 100%;">
      <div style="width: 100%; max-width: {width}px;">
        <canvas
          bind:this={canvas}
          style="width: 100%; height: auto; aspect-ratio: {width}/{height};"
        ></canvas>
      </div>
      <TimeSlider
        bind:value={time}
        bind:isPlaying
        min={0}
        max={1}
        onTogglePlay={toggleAnimation}
        onInput={handleSliderInput}
        color={meshGridColor}
      />
    </div>
  {/snippet}
</Figure>
