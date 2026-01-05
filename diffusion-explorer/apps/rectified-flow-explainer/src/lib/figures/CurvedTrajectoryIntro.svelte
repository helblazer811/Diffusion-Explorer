<script lang="ts">
  import { onDestroy } from "svelte";
  import { Figure, TimeSlider, drawScatterPlot, drawText, drawTrajectories, createSourceTargetScales, Timeline, useCanvas2D } from "@diffusion-explorer/ui";
  import { settings } from "$lib/settings";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  // FlowModelClient instance (passed from parent, created with correct base path)
  export let flowMatchingClient = null;

  // Data props
  export let sourceDistributionSamples = [];
  export let targetDistributionSamples = [];
  export let allTimeSamples; // [timestep][sample][dim]

  // Animation settings
  export let animationDuration = 6000;
  export let playingByDefault = true;
  export let pauseBeforeRestart = 1000;

  // Layout
  export let width = 750;
  export let height = 375;
  export let marginWidth = 50;
  export let marginHeight = 20;

  // Trajectory settings
  export let numTrajectoriesToShow = 10;
  export let maxTrajectories = 30;
  export let maxUserTrajectories = settings.interactiveSettings.maxUserTrajectories;

  // Caption slot (passed as default children)
  export let children = undefined;

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  $: caption = children;

  // Canvas - need both bind:this (for reactivity) and action (for DPR setup)
  let canvas = null;
  const canvas2d = useCanvas2D(width, height);
  // Tie ctx reactivity to canvas variable so it updates when action runs
  $: ctx = canvas && canvas2d.ctx;

  // Animation state type
  type AnimationState = {
    segmentIndex: number;
  };

  // Animation state - Timeline system (Timeline owns Clock internally)
  let initialized = false;
  let timeline: Timeline<AnimationState> | null = null;

  // Cached numSegments for clip closure
  let cachedNumSegments = 0;

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

  // User-defined trajectory state (matches CrownJewel naming)
  let userStartPoints = []; // Array of [x, y] domain coordinates
  let userTrajectories = []; // [trajectory][timestep][x,y] in pixel coordinates
  let activeRequestId = null;
  let mostRecentTrajectoryIndices = []; // Indices of the most recently added trajectories
  let hasUserTrajectory = false; // Track if user has clicked at all

  // Derived values
  $: numTimeSteps = allTimeSamples?.length || 1;
  $: numSegments = numTimeSteps - 1;

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  // Pick trajectories (first N samples that start within bounds)
  function selectTrajectoryIndices() {
    if (!allTimeSamples || allTimeSamples.length === 0) return;

    // Filter to only include trajectories with starting points within clipping radius
    const clippingRadius = settings.stylingSettings.scatterPlot.clippingRadius;
    const validIndices = [];

    for (let i = 0; i < allTimeSamples[0].length && validIndices.length < numTrajectoriesToShow; i++) {
      const startPoint = allTimeSamples[0][i];
      const distance = Math.sqrt(startPoint[0] ** 2 + startPoint[1] ** 2);
      if (distance <= clippingRadius) {
        validIndices.push(i);
      }
    }

    selectedTrajectoryIndices = validIndices;
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

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function runInitialComputation() {
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

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  function setupTimeline() {
    // Cache numSegments for clip closure
    cachedNumSegments = numSegments;

    timeline = new Timeline<AnimationState>();
    timeline.initialState = { segmentIndex: 0 };

    // Set timeline duration in seconds (animation time, not including pause)
    timeline.duration = animationDuration / 1000;
    timeline.looping = true;
    timeline.endPauseDuration = pauseBeforeRestart / 1000;

    // Main animation clip - computes segmentIndex from normalized time
    const mainClip = {
      name: "Animation",
      duration: 1,
      reduce(t: number) {
        return {
          segmentIndex: Math.floor(t * cachedNumSegments)
        };
      }
    };

    timeline.add(mainClip, 0);

    // Register tick callback
    timeline.onTick((_, state) => draw(state));
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function draw(state: AnimationState) {
    if (!ctx || !initialized) return;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // --- Static Background ---
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
    const labelOpacity = settings.stylingSettings.label.opacity;
    const labelFont = `${labelFontWeight} ${labelFontSize}px Helvetica, Arial, sans-serif`;
    drawText(ctx, "Source Distribution", scales.sourceCenterPixelX, marginHeight / 2, { color: labelColor, font: labelFont, opacity: labelOpacity });
    drawText(ctx, "Target Distribution", scales.targetCenterPixelX, marginHeight / 2, { color: labelColor, font: labelFont, opacity: labelOpacity });

    // --- Dynamic Foreground ---
    const { segmentIndex } = state;

    // Trajectory styling from settings
    const trajectoryColor = settings.stylingSettings.trajectory.color;
    const trajectoryStrokeWidth = settings.stylingSettings.trajectory.strokeWidth;
    const trajectoryEndpointRadius = settings.stylingSettings.trajectory.endpointRadius;
    const normalOpacity = settings.stylingSettings.trajectory.progressOpacity;
    const dimmedOpacity = 0.15; // Dimmed opacity when user has clicked (matches CurvedTrajectorySuperimposed)
    const highlightOpacity = 1.0; // Full opacity for user-defined trajectories

    // Before user clicks: draw all trajectories with normal opacity
    // After user clicks (or during streaming): dim non-highlighted trajectories, highlight user-defined ones
    // Dim immediately when streaming starts (userTrajectories.length > 0)
    const shouldDimExisting = hasUserTrajectory || userTrajectories.length > 0;

    if (transformedTrajectories.length > 0) {
      if (shouldDimExisting) {
        // Separate trajectories into highlighted and non-highlighted
        const nonHighlightedTrajectories = [];
        const highlightedTrajectories = [];

        transformedTrajectories.forEach((traj, idx) => {
          if (mostRecentTrajectoryIndices.includes(idx)) {
            highlightedTrajectories.push(traj);
          } else {
            nonHighlightedTrajectories.push(traj);
          }
        });

        // Draw non-highlighted trajectories with dimmed opacity
        if (nonHighlightedTrajectories.length > 0) {
          drawTrajectories(ctx, nonHighlightedTrajectories, segmentIndex, {
            strokeWidth: trajectoryStrokeWidth,
            color: trajectoryColor,
            progressOpacity: dimmedOpacity,
            pointRadius: trajectoryEndpointRadius,
          });
        }

        // Draw highlighted (user-defined) trajectories with full opacity
        if (highlightedTrajectories.length > 0) {
          drawTrajectories(ctx, highlightedTrajectories, segmentIndex, {
            strokeWidth: trajectoryStrokeWidth,
            color: trajectoryColor,
            progressOpacity: highlightOpacity,
            pointRadius: trajectoryEndpointRadius,
          });
        }
      } else {
        // No user trajectories yet, draw all with normal opacity
        drawTrajectories(ctx, transformedTrajectories, segmentIndex, {
          strokeWidth: trajectoryStrokeWidth,
          color: trajectoryColor,
          progressOpacity: normalOpacity,
          pointRadius: trajectoryEndpointRadius,
        });
      }
    }

    // Draw in-progress user trajectories (full opacity, synced with animation time)
    if (userTrajectories.length > 0) {
      const validUserTrajectories = userTrajectories.filter(t => t && t.length >= 2);
      if (validUserTrajectories.length > 0) {
        drawTrajectories(ctx, validUserTrajectories, segmentIndex, {
          strokeWidth: trajectoryStrokeWidth,
          color: trajectoryColor,
          progressOpacity: 1.0,
          pointRadius: trajectoryEndpointRadius,
        });
      }
    }
  }

  // ----------------------------------------------------------------
  // Event Handlers
  // ----------------------------------------------------------------

  // Handle canvas click - restricted to source distribution region
  function handleCanvasClick(event) {
    if (!settings.flowModelWorkerUrl || !settings.flowMatchingModelPath) return;
    if (!scales || !canvas) return;

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

    // Cancel any in-progress request before adding new point
    if (activeRequestId) {
      flowMatchingClient.stopRequest(activeRequestId);
      activeRequestId = null;
    }

    // Add new point to the list of user start points
    userStartPoints = [...userStartPoints, [domainX, domainY]];

    // If we exceed the max, remove the oldest point
    if (userStartPoints.length > maxUserTrajectories) {
      userStartPoints = userStartPoints.slice(-maxUserTrajectories);
    }

    // Start sampling all user points
    sampleFromUserPoints();
  }

  // Sample trajectories from all user start points
  function sampleFromUserPoints() {
    if (userStartPoints.length === 0) return;

    hasUserTrajectory = true;

    // Initialize trajectories for each user point at t=0 position
    userTrajectories = userStartPoints.map(point => {
      const initialPixelX = getPixelX(point[0], combinedMeanX, 0);
      const initialPixelY = scales.yScale(point[1]);
      return [[initialPixelX, initialPixelY]];
    });

    // Reset animation and start
    if (timeline) {
      timeline.reset();
      timeline.play();
    }

    // Sample all user points with streaming
    const result = flowMatchingClient.sampleFromInitialPoints(
      userStartPoints,
      numTimeSteps,
      {},
      // onStep - append each new point for all trajectories, transformed to pixel space
      (step, x_t) => {
        const t = (step + 1) / numTimeSteps;
        userTrajectories = userTrajectories.map((traj, sampleIdx) => {
          if (sampleIdx < x_t.length) {
            const pixelX = getPixelX(x_t[sampleIdx][0], combinedMeanX, t);
            const pixelY = scales.yScale(x_t[sampleIdx][1]);
            return [...traj, [pixelX, pixelY]];
          }
          return traj;
        });
      }
    );
    activeRequestId = result.requestId;
    result.promise.then(() => {
      // Add all completed trajectories that have enough points
      const validTrajectories = userTrajectories.filter(t => t && t.length > 1);
      if (validTrajectories.length > 0) {
        // Track where the new trajectories will be added
        const startIdx = transformedTrajectories.length;
        transformedTrajectories = [...transformedTrajectories, ...validTrajectories];
        mostRecentTrajectoryIndices = validTrajectories.map((_, i) => startIdx + i);

        // Remove random trajectories if over cap (but not the most recent ones)
        while (transformedTrajectories.length > maxTrajectories) {
          // Pick random index excluding the most recent trajectories
          let randomIdx;
          do {
            randomIdx = Math.floor(Math.random() * transformedTrajectories.length);
          } while (mostRecentTrajectoryIndices.includes(randomIdx));

          transformedTrajectories = transformedTrajectories.filter((_, i) => i !== randomIdx);
          // Adjust mostRecentTrajectoryIndices
          mostRecentTrajectoryIndices = mostRecentTrajectoryIndices.map(idx =>
            randomIdx < idx ? idx - 1 : idx
          );
        }
      }
      userTrajectories = [];
      userStartPoints = [];
      activeRequestId = null;
    });
  }

  function handleVisibilityChange(isActive) {
    if (!timeline) return;
    if (!isActive && timeline.isPlaying) {
      wasPlayingBeforeHidden = true;
      timeline.pause();
    } else if (isActive && wasPlayingBeforeHidden) {
      wasPlayingBeforeHidden = false;
      timeline.play();
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
    runInitialComputation();
    setupTimeline();
    initialized = true;
    draw(timeline!.initialState);
    if (playingByDefault) timeline!.play();
  }

  // Handle visibility changes (pause when off-screen, resume when back)
  $: if (figureIsActive !== undefined && initialized) {
    handleVisibilityChange($figureIsActive);
  }
</script>

<Figure {caption} backgroundVisible={false} bind:isActive={figureIsActive}>
  {#snippet children()}
    <div
      style="display:flex;flex-direction:column;align-items:center;width:100%;"
    >
      <canvas
        bind:this={canvas}
        use:canvas2d.bindCanvas
        onclick={handleCanvasClick}
        style="cursor:pointer;width:100%;height:auto;max-width:{width}px;aspect-ratio:{width}/{height};"
      ></canvas>
      <TimeSlider
        {timeline}
        color={settings.stylingSettings.trajectory.color}
      />
    </div>
  {/snippet}
</Figure>
