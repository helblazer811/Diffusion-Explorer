<!-- Diffeomorphism figure - visualizes how a flow matching model transforms space via an animated mesh grid

TODO:
1. Scale up the smiley face in the flow matching training so it is more symmetrical as a figure.
2. Cache the uniform grid trajectories/pull from the cache rather than running every time.
-->

<script>
  import { onDestroy } from "svelte";
  import { FlowModelClient } from "@diffusion-explorer/diffusion";
  import {
    Figure,
    TimeSlider,
    drawScatterPlot,
    drawText,
    plotMeshGrid,
    createSourceTargetScales,
    Timeline,
    createPauseClip,
    useCanvas2D,
    computeContours,
    plotContours
  } from "@diffusion-explorer/ui";
  import * as d3 from "d3";
  import { settings } from "$lib/settings";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  // Caption slot (passed as default children)
  export let children = undefined;

  // Data props (passed from page)
  export let sourceDistributionSamples = [];
  export let targetDistributionSamples = [];

  // Mesh grid styling props
  export let meshGridColor = "#666666";
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
  export let scatterPointOpacity = 0.3;
  export let scatterPointColor = settings.stylingSettings.scatterPlot.color;

  // Label styling
  export let labelFontSize = settings.stylingSettings.label.fontSize;
  export let labelFontWeight = settings.stylingSettings.label.fontWeight;
  export let labelColor = settings.stylingSettings.label.color;
  export let sourceLabelText = "Source Distribution";
  export let targetLabelText = "Target Distribution";

  // Background visibility
  export let backgroundVisible = false;

  // Contour props
  export let showContours = true;
  export let contourOpacity = 0.7;
  export let contourGridSize = 100;
  export let contourBandwidth = 15;
  export let contourLevels = 15;
  export let contourColorScale = (t) => d3.interpolateRgb("white", "orange")(t);
  export let contourNumSamples = 5000;

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  $: caption = children;

  // Canvas state - using useCanvas2D for DPR handling
  let canvas = null;
  const canvas2d = useCanvas2D(width, height);
  $: ctx = canvas && canvas2d.ctx;

  // Scales and coordinates
  let scales = null;
  let sourcePixelCoords = [];
  let targetPixelCoords = [];

  // Grid trajectory data
  // Shape: [timesteps][gridResolution][gridResolution][2]
  let allGridStates = [];
  let isLoading = true;

  // Animation state - Timeline system
  let isInitialized = false;
  let timeline = null;
  let displayTime = 0;  // Semantic time for slider display (tracks state.time)

  // Visibility-based animation control
  let figureIsActive;
  let wasPlayingBeforeHidden = false;

  // FlowModelClient instance
  let client = null;
  let activeRequestId = null;

  // Contour state
  // Shape: [timesteps][numSamples][2]
  let contourTrajectories = [];
  // Precomputed contour data array, one per timestep
  let precomputedContours = [];
  // Domain for contour rendering [xMin, xMax, yMin, yMax]
  let contourDataDomain = null;
  let contourActiveRequestId = null;

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

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

  // Generate random initial points for contour sampling
  function generateContourInitialPoints(numSamples) {
    const domain = computeDomainRange();
    const points = [];
    for (let i = 0; i < numSamples; i++) {
      const x = domain.xMin + Math.random() * (domain.xMax - domain.xMin);
      const y = domain.yMin + Math.random() * (domain.yMax - domain.yMin);
      points.push([x, y]);
    }
    return points;
  }

  // Precompute contours for each timestep
  function precomputeContoursData() {
    if (contourTrajectories.length === 0 || !scales) return;

    // Compute domain from all trajectory points
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    for (const timestep of contourTrajectories) {
      for (const [x, y] of timestep) {
        xMin = Math.min(xMin, x);
        xMax = Math.max(xMax, x);
        yMin = Math.min(yMin, y);
        yMax = Math.max(yMax, y);
      }
    }
    const padding = Math.max(xMax - xMin, yMax - yMin) * 0.1;
    contourDataDomain = [xMin - padding, xMax + padding, yMin - padding, yMax + padding];

    // Precompute contours for each timestep
    precomputedContours = contourTrajectories.map(points =>
      computeContours(points, {
        gridSize: contourGridSize,
        bandwidth: contourBandwidth,
        thresholds: contourLevels,
        domain: contourDataDomain
      })
    );
  }

  // Draw precomputed contours with horizontal interpolation
  function drawPrecomputedContours(contourData, t) {
    if (!ctx || !scales || !contourDataDomain) return;

    // Animated center position (same interpolation as mesh grid)
    const centerPixelX = scales.sourceCenterPixelX +
      t * (scales.targetCenterPixelX - scales.sourceCenterPixelX);

    // Create scale functions that account for the animated horizontal position
    const xScale = (dataX) => centerPixelX + (dataX - scales.sourceMeanX) * scales.xScaleFactor;
    const yScale = (dataY) => scales.yScale(dataY);

    plotContours(ctx, contourData, {
      colorScale: contourColorScale,
      fill: true,
      stroke: false,
      opacity: contourOpacity,
      xScale,
      yScale
    });
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

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

      activeRequestId = result.requestId;
      const trajectories = await result.promise;
      activeRequestId = null;
      // trajectories shape: [timesteps, gridResolution², 2]
      allGridStates = reshapeToGrid(trajectories, gridResolution);
      isLoading = false;
    } catch (error) {
      activeRequestId = null;
      console.error("Error sampling grid trajectories:", error);
      isLoading = false;
    }
  }

  // Sample trajectories for contour visualization
  async function sampleContourTrajectories() {
    if (!client) return;

    const initialPoints = generateContourInitialPoints(contourNumSamples);

    try {
      const result = client.sampleFromInitialPoints(
        initialPoints,
        numSteps
      );

      contourActiveRequestId = result.requestId;
      contourTrajectories = await result.promise;
      contourActiveRequestId = null;

      // Precompute contours after trajectories are loaded
      precomputeContoursData();
    } catch (error) {
      contourActiveRequestId = null;
      console.error("Error sampling contour trajectories:", error);
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
    if (showContours) {
      sampleContourTrajectories();
    }
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  // Forward clip (0→1)
  const forwardClip = {
    name: "Forward",
    reduce(t) {
      return { time: t };
    }
  };

  // Backward clip (1→0)
  const backwardClip = {
    name: "Backward",
    reduce(t) {
      return { time: 1 - t };
    }
  };

  function setupTimeline() {
    timeline = new Timeline();
    timeline.initialState = { time: 0 };

    // Total cycle: forward + pause + backward + pause
    const totalCycleDuration = 2 * animationDuration + 2 * pauseDuration;
    const forwardDuration = animationDuration / totalCycleDuration;
    const pauseNormalized = pauseDuration / totalCycleDuration;

    // Add clips in sequence with proper timing objects
    const t1 = forwardDuration;
    const t2 = forwardDuration + pauseNormalized;
    const t3 = 2 * forwardDuration + pauseNormalized;

    timeline.add(forwardClip, { start: 0, end: t1 });
    timeline.add(createPauseClip(), { start: t1, end: t2 });
    timeline.add(backwardClip, { start: t2, end: t3 });
    timeline.add(createPauseClip(), { start: t3, end: 1 });

    // Set duration in seconds
    timeline.duration = totalCycleDuration / 1000;
    timeline.looping = true;

    // Register tick callback
    timeline.onTick((_t, state) => {
      displayTime = state.time;  // Track semantic time for slider
      draw(state);
    });
  }

  // Handle seeking by display time - map to forward clip's timeline range
  function handleSeekByDisplayTime(t) {
    if (!timeline) return;
    const totalCycleDuration = 2 * animationDuration + 2 * pauseDuration;
    const forwardEnd = animationDuration / totalCycleDuration;
    timeline.seek(t * forwardEnd);
  }

  function startAnimation() {
    if (timeline) timeline.play();
  }

  function stopAnimation() {
    if (timeline) timeline.pause();
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function draw(state) {
    if (!ctx || !isInitialized) return;
    ctx.clearRect(0, 0, width, height);

    const time = state.time;

    // --- Static Background ---
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

    // --- Dynamic Foreground ---

    // Draw contours (behind mesh grid)
    if (showContours && precomputedContours.length > 0 && contourDataDomain) {
      const contourTimestepIndex = Math.min(
        Math.floor(time * (precomputedContours.length - 1)),
        precomputedContours.length - 1
      );
      drawPrecomputedContours(precomputedContours[contourTimestepIndex], time);
    }

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

    // Cancel any pending worker request to prevent orphaned promises
    if (activeRequestId && client) {
      client.stopRequest(activeRequestId);
    }

    // Cancel contour request
    if (contourActiveRequestId && client) {
      client.stopRequest(contourActiveRequestId);
    }
  });

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  // Reactive initialization
  $: if (
    !isInitialized &&
    sourceDistributionSamples.length > 0 &&
    targetDistributionSamples.length > 0 &&
    canvas
  ) {
    initializeVisualization();
    setupTimeline();
    isInitialized = true;
    draw(timeline.initialState);
    if (playingByDefault) startAnimation();
  }

  // Pause animation when figure goes off-screen
  $: if (figureIsActive !== undefined && isInitialized) {
    handleVisibilityChange($figureIsActive);
  }

  // Redraw when grid data becomes available
  $: if (isInitialized && allGridStates.length > 0 && timeline) {
    draw(timeline.state);
  }

  // Redraw when contour data becomes available
  $: if (isInitialized && precomputedContours.length > 0 && timeline) {
    draw(timeline.state);
  }
</script>

<Figure {caption} {backgroundVisible} bind:isActive={figureIsActive}>
  {#snippet children()}
    <div style="display: flex; flex-direction: column; align-items: center; width: 100%;">
      <div style="width: 100%; max-width: {width}px;">
        <canvas
          bind:this={canvas}
          use:canvas2d.bindCanvas
          style="width: 100%; height: auto; aspect-ratio: {width}/{height};"
        ></canvas>
      </div>
      <TimeSlider {timeline} {displayTime} onSeekByDisplayTime={handleSeekByDisplayTime} color="orange" />
    </div>
  {/snippet}
</Figure>
