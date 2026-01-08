<script>
  import { onDestroy } from "svelte";
  import { Figure, TimeSlider, drawScatterPlot, drawText, drawTrajectories, createSourceTargetScales, Timeline, createPauseClip, useCanvas2D } from "@diffusion-explorer/ui";
  import { FlowModelClient } from "@diffusion-explorer/diffusion";
  import { settings } from "$lib/settings";
  import { base } from "$app/paths";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  // FlowModelClient instance (passed from parent or created internally)
  export let flowMatchingClient = null;

  // Data props
  export let sourceDistributionSamples = [];
  export let targetDistributionSamples = [];

  // Animation
  export let animationDuration = 6000;
  export let playingByDefault = true;
  export let pauseBeforeRestart = 1000;

  // Layout
  export let width = 750;
  export let height = 375;
  export let marginWidth = 50;
  export let marginHeight = 20;

  // Sampling
  export let numTrajectorySamples = null; // Use settings if not provided

  // Caption slot (passed as default children)
  export let children = undefined;

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  $: caption = children;

  // Effective number of samples
  $: effectiveNumSamples = numTrajectorySamples ?? settings.samplingSettings.reverseSampling.numSamples;

  // Canvas state - using useCanvas2D for DPR handling
  let canvas = null;
  const canvas2d = useCanvas2D(width, height);
  $: ctx = canvas && canvas2d.ctx;

  // Animation state - Timeline system
  let initialized = false;
  let isLoading = true;
  let loadingMessage = "Loading...";
  let timeline = null;

  // Visibility tracking
  let figureIsActive;
  let wasPlayingBeforeHidden = false;

  // Pre-computed data
  let scales = null;
  let transformedTrajectories = []; // [trajectory][timestep][x,y in pixels]
  let sourcePixelCoords = []; // [point][x,y] in pixel space
  let targetPixelCoords = []; // [point][x,y] in pixel space
  let combinedMeanX = 0;

  // Raw trajectory data (in domain coordinates)
  let allTimeSamples = null; // [timestep][sample][dim]

  // Derived values
  $: numTimeSteps = allTimeSamples?.length || 1;
  $: numSegments = numTimeSteps - 1;

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  // Helper to get random subset of indices
  function getRandomSubsetIndices(totalLength, subsetSize) {
    const indices = Array.from({ length: totalLength }, (_, i) => i);
    // Shuffle using Fisher-Yates
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    return indices.slice(0, Math.min(subsetSize, totalLength));
  }

  // Compute pixel X for a given data point at time t
  // For reverse sampling, t=0 means at target (right), t=1 means at source (left)
  function getPixelX(dataX, meanX, t) {
    // Reverse direction: t=0 -> target (right), t=1 -> source (left)
    const centerPixelX =
      scales.targetCenterPixelX +
      t * (scales.sourceCenterPixelX - scales.targetCenterPixelX);
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

    const numSamples = allTimeSamples[0]?.length || 0;
    transformedTrajectories = Array.from({ length: numSamples }, (_, sampleIdx) => {
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

  // Download data as JSON for caching
  function downloadAsJson(data, filename) {
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

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

    precomputeScatterCoords();
    precomputeTrajectories();
  }

  // Load cached trajectories or sample fresh
  async function loadOrSampleTrajectories() {
    loadingMessage = "Checking cache...";

    // Try loading from cache if path is set
    if (settings.cachedReverseSamplingTrajectoriesPath) {
      try {
        const cachePath = `${base}/${settings.cachedReverseSamplingTrajectoriesPath}`;
        loadingMessage = "Loading cached trajectories...";
        const response = await fetch(cachePath);
        if (response.ok) {
          const data = await response.json();
          console.log("Loaded reverse sampling trajectories from cache");
          return { trajectories: data.trajectories, fromCache: true };
        }
      } catch (e) {
        console.log("Cache not found, sampling fresh trajectories");
      }
    }

    // Sample fresh trajectories
    loadingMessage = "Sampling trajectories...";

    // Create or use provided client
    let client = flowMatchingClient;
    if (!client && settings.flowMatchingModelPath) {
      client = new FlowModelClient(
        `${base}${settings.samplingWorkerUrl}`,
        `${base}${settings.flowMatchingModelPath}`,
        'Flow Matching',
        settings.trainingSettings.modelConfig
      );
    }

    if (!client) {
      console.error("No flow matching client available");
      return { trajectories: null, fromCache: false };
    }

    // Get random subset of target distribution points
    const subsetIndices = getRandomSubsetIndices(
      targetDistributionSamples.length,
      effectiveNumSamples
    );
    const startPoints = subsetIndices.map(i => targetDistributionSamples[i]);

    // Sample with reverse=true (target to source)
    const numSteps = settings.samplingSettings.reverseSampling.numSteps;
    const { promise } = client.sampleFromInitialPoints(
      startPoints,
      numSteps,
      { reverse: true }
    );

    const trajectories = await promise;

    return { trajectories, fromCache: false };
  }

  // Load trajectories when distributions are ready
  async function initializeTrajectories() {
    if (targetDistributionSamples.length === 0) return;

    isLoading = true;
    try {
      const { trajectories } = await loadOrSampleTrajectories();
      if (trajectories) {
        allTimeSamples = trajectories;
      }
    } catch (error) {
      console.error("Error loading trajectories:", error);
    }
    isLoading = false;
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  // Forward clip (0→1)
  const forwardClip = {
    name: "Forward",
    duration: 1,
    reduce(t) {
      return { time: t };
    }
  };

  function setupTimeline() {
    timeline = new Timeline();
    timeline.initialState = { time: 0 };

    // Total cycle: forward + pause (then loops back to start)
    const totalCycleDuration = animationDuration + pauseBeforeRestart;
    const forwardDuration = animationDuration / totalCycleDuration;
    const pauseNormalized = pauseBeforeRestart / totalCycleDuration;

    // Add clips in sequence
    timeline.add({ ...forwardClip, duration: forwardDuration }, 0);
    timeline.add(createPauseClip(pauseNormalized), forwardDuration);

    // Set duration in seconds
    timeline.duration = totalCycleDuration / 1000;
    timeline.looping = true;

    // Register tick callback
    timeline.onTick((_t, state) => {
      draw(state);
    });
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
    if (!ctx || !initialized) return;

    const time = state.time;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // --- Static Background ---
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

    // --- Dynamic Foreground ---
    // Calculate current segment index from normalized time
    const segmentIndex = Math.floor(time * numSegments);

    // Trajectory styling from settings
    const trajectoryColor = settings.stylingSettings.trajectory.color;
    const trajectoryStrokeWidth = settings.stylingSettings.trajectory.strokeWidth;
    const trajectoryEndpointRadius = settings.stylingSettings.trajectory.endpointRadius ?? settings.stylingSettings.trajectory.pointRadius ?? 3;
    const normalOpacity = settings.stylingSettings.trajectory.progressOpacity;

    if (transformedTrajectories.length > 0) {
      drawTrajectories(ctx, transformedTrajectories, segmentIndex, {
        strokeWidth: trajectoryStrokeWidth,
        color: trajectoryColor,
        progressOpacity: normalOpacity,
        pointRadius: trajectoryEndpointRadius,
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
  });

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  // Initialize when canvas and data are ready
  $: if (
    canvas &&
    allTimeSamples &&
    allTimeSamples.length > 0 &&
    sourceDistributionSamples.length > 0 &&
    targetDistributionSamples.length > 0 &&
    !initialized
  ) {
    initializeData();
    setupTimeline();
    initialized = true;
    draw(timeline.initialState);
    if (playingByDefault) startAnimation();
  }

  // Load trajectories when target distribution becomes available
  $: if (targetDistributionSamples.length > 0 && !allTimeSamples) {
    initializeTrajectories();
  }

  // Handle visibility changes
  $: if (figureIsActive !== undefined && initialized) {
    handleVisibilityChange($figureIsActive);
  }
</script>

<Figure {caption} backgroundVisible={false} bind:isActive={figureIsActive}>
  {#snippet children()}
    <div
      style="display:flex;flex-direction:column;align-items:center;width:100%;"
    >
      {#if isLoading}
        <div style="width:100%;max-width:{width}px;aspect-ratio:{width}/{height};display:flex;align-items:center;justify-content:center;background:#f5f5f5;border-radius:8px;">
          <span style="color:#666;font-size:14px;">{loadingMessage}</span>
        </div>
      {:else}
        <canvas
          bind:this={canvas}
          use:canvas2d.bindCanvas
          style="width:100%;height:auto;max-width:{width}px;aspect-ratio:{width}/{height};"
        ></canvas>
      {/if}
      <TimeSlider
        {timeline}
        minLabel="t=1"
        maxLabel="t=0"
        color={settings.stylingSettings.trajectory.color}
      />
    </div>
  {/snippet}
</Figure>
