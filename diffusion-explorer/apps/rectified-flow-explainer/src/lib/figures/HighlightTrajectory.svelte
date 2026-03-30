<script lang="ts">
  import { onDestroy, type Snippet } from "svelte";
  import type { Writable } from "svelte/store";
  import type { FlowModelClient } from "@diffusion-explorer/diffusion";
  import {
    Figure,
    TimeSlider,
    drawScatterPlot,
    drawMathjax,
    createSourceTargetScales,
    Timeline,
    useCanvas2D,
    useVisibilityHandler,
    PathlineAnimation,
    type PathlineAnimationState,
  } from "@diffusion-explorer/ui";
  import { settings } from "$lib/settings";

  type SourceTargetScales = ReturnType<typeof createSourceTargetScales>;

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  // FlowModelClient instance (passed from parent, created with correct base path)
  export let flowMatchingClient: FlowModelClient | null = null;

  // Data props
  export let sourceDistributionSamples: [number, number][] = [];
  export let targetDistributionSamples: [number, number][] = [];
  export let allTimeSamples: number[][][] = []; // [timestep][sample][dim]

  // Animation settings
  export let animationDuration = 6000;
  export let playingByDefault = true;
  export let pauseBeforeRestart = 1000;

  // Layout
  export let width = 750;
  export let height = 350;
  export let marginWidth = 50;
  export let marginHeight = 20;

  // Trajectory settings
  export let numTrajectoriesToShow = 1;
  export let samplingSteps = 400;

  // LaTeX label styling
  export let latexLabelOffsetY =
    settings.stylingSettings.figureLatex.latexLabelOffsetY;
  export let latexFontSize = settings.stylingSettings.figureLatex.fontSize;

  // Caption slot (passed as default children)
  export let children: Snippet | undefined = undefined;

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  $: caption = children;

  // Canvas - need both bind:this (for reactivity) and action (for DPR setup)
  let canvas: HTMLCanvasElement | null = null;
  const canvas2d = useCanvas2D(width, height);
  // Tie ctx reactivity to canvas variable so it updates when action runs
  $: ctx = canvas && canvas2d.ctx;

  // Animation state type - extends PathlineAnimationState with additional fields
  type AnimationState = PathlineAnimationState & {
    time: number; // For LaTeX label positioning
    clickedSegmentIndex: number; // For in-progress clicked trajectory
  };

  // Animation state - Timeline system
  let initialized = false;
  let timeline: Timeline<AnimationState> | null = null;

  // PathlineAnimation instance
  let pathlineAnimation: PathlineAnimation<AnimationState> | null = null;

  // Cached values for clip closure
  let cachedNumTimesteps = 1;

  // Pre-computed data
  let scales: SourceTargetScales | null = null;
  let selectedTrajectoryIndices: number[] = [];
  let transformedTrajectories: number[][][] = []; // [trajectory][timestep][x,y in pixels]
  let trajectoryLengths: number[] = []; // Total path length for each trajectory
  let sourcePixelCoords: number[][] = [];
  let targetPixelCoords: number[][] = [];
  let combinedMeanX = 0;

  // In-progress clicked trajectory state
  let clickedTrajectory: number[][] | null = null; // [[x,y], ...] in pixel coordinates being built
  let isStreamingTrajectory = false;

  // Visibility tracking
  let figureIsActive: Writable<boolean>;
  const { handleVisibilityChange } = useVisibilityHandler(() => timeline);

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  // Pick trajectories (first N samples)
  function selectTrajectoryIndices() {
    if (!allTimeSamples || allTimeSamples.length === 0) return;
    selectedTrajectoryIndices = [...Array(numTrajectoriesToShow).keys()].filter(
      (i) => i < allTimeSamples[0].length
    );
  }

  function getPixelX(dataX: number, meanX: number, t: number) {
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

  // Get point at a specific progress (0-1) along a trajectory
  function getPointAtProgress(trajectoryIndex: number, progress: number) {
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

  async function setupTimeline() {
    // Cache numTimesteps for clip closure
    cachedNumTimesteps = allTimeSamples?.length || 1;

    // Create PathlineAnimation for regular trajectories
    pathlineAnimation = PathlineAnimation.fromTrajectories<AnimationState>(
      transformedTrajectories,
      {
        style: {
          color: settings.stylingSettings.trajectory.color,
          strokeWidth: settings.stylingSettings.trajectory.strokeWidth,
          pointRadius: settings.stylingSettings.trajectory.endpointRadius,
          opacity: settings.stylingSettings.trajectory.opacity,
        }
      }
    );

    // Initialize with canvas
    await pathlineAnimation.init(canvas);

    timeline = new Timeline<AnimationState>();
    timeline.initialState = {
      time: 0,
      segmentIndex: 0,
      clickedSegmentIndex: 0,
    };

    // Main animation clip - combines PathlineAnimation's segmentIndex with time and clickedSegmentIndex
    const mainClip = {
      name: "Animation",
      reduce(t: number) {
        return {
          time: t,
          segmentIndex: Math.floor(t * (pathlineAnimation?.data.numSegments ?? cachedNumTimesteps - 1)),
          clickedSegmentIndex: Math.floor(t * (samplingSteps - 1)),
        };
      },
    };

    // Add main animation clip
    timeline.add(mainClip, { start: 0, end: 1 });

    // Set timeline duration and end pause
    timeline.duration = animationDuration / 1000;
    timeline.setEndPause(pauseBeforeRestart / 1000);
    timeline.looping = true;

    // Register tick callback
    timeline.onTick((_t, state) => {
      draw(state);
    });
  }

  function startAnimation() {
    if (!timeline) return;
    timeline.play();
  }

  function stopAnimation() {
    if (timeline) timeline.pause();
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function draw(state: AnimationState) {
    if (!ctx || !initialized) return;

    const t = state.time;

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

    drawScatterPlot(
      ctx,
      targetPixelCoords,
      settings.stylingSettings.scatterPlot.radius,
      settings.stylingSettings.scatterPlot.color,
      settings.stylingSettings.scatterPlot.opacity
    );

    // --- Dynamic Foreground ---
    // Draw the single trajectory (if exists)
    if (pathlineAnimation) {
      pathlineAnimation.draw(state);
    }

    // Draw in-progress clicked trajectory
    if (clickedTrajectory && clickedTrajectory.length >= 1) {
      const endIdx = Math.min(
        state.clickedSegmentIndex + 1,
        clickedTrajectory.length
      );

      // Draw trajectory line if we have at least 2 points
      if (endIdx >= 2) {
        ctx.strokeStyle = settings.stylingSettings.trajectory.color;
        ctx.lineWidth = settings.stylingSettings.trajectory.strokeWidth;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.globalAlpha = settings.stylingSettings.trajectory.opacity;

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
      ctx.arc(
        currentPoint[0],
        currentPoint[1],
        settings.stylingSettings.trajectory.endpointRadius,
        0,
        Math.PI * 2
      );
      ctx.fill();

      // Draw LaTeX labels for in-progress trajectory
      const startPoint = clickedTrajectory[0];
      const latexColor = settings.stylingSettings.figureLatex.color;

      // Draw "x" label at start
      drawMathjax(
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
      if (t >= 0.05) {
        drawMathjax(
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
      const currentPoint = getPointAtProgress(idx, t);

      // Draw "x" label at start
      drawMathjax(
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
      if (t >= 0.05) {
        drawMathjax(
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

  // ----------------------------------------------------------------
  // Event Handlers
  // ----------------------------------------------------------------

  // Handle canvas click - restricted to source distribution region
  function handleCanvasClick(event: MouseEvent) {
    // Ignore clicks while sampling is in progress
    if (isStreamingTrajectory) return;
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
    const domainX =
      scales.sourceMeanX +
      (clickX - scales.sourceCenterPixelX) / scales.xScaleFactor;
    const domainY = scales.yScale.invert(clickY);

    sampleFromPoint([domainX, domainY]);
  }

  // Sample from a clicked point using streaming
  function sampleFromPoint(point: [number, number]) {
    isStreamingTrajectory = true;

    // Initialize with click point scaled to t=0 position
    const initialPixelX = getPixelX(point[0], combinedMeanX, 0);
    const initialPixelY = scales.yScale(point[1]);
    clickedTrajectory = [[initialPixelX, initialPixelY]];

    // Clear existing trajectories - will be replaced by user's trajectory
    transformedTrajectories = [];
    pathlineAnimation = null; // Stop drawing old trajectory

    // Reset animation state and start
    if (timeline) timeline.reset();
    startAnimation();

    // Sample with streaming
    const result = flowMatchingClient.sampleFromInitialPoints(
      [point],
      samplingSteps,
      {},
      // onStep - append each new point, transformed to pixel space
      (step: number, x_t: number[][]) => {
        const t = (step + 1) / samplingSteps;
        const pixelX = getPixelX(x_t[0][0], combinedMeanX, t);
        const pixelY = scales.yScale(x_t[0][1]);
        clickedTrajectory = [...clickedTrajectory, [pixelX, pixelY]];
      }
    );
    result.promise.then(async () => {
      if (clickedTrajectory && clickedTrajectory.length > 1) {
        // Replace with user's trajectory
        transformedTrajectories = [clickedTrajectory];
        // Recreate pathlineAnimation with new trajectory
        pathlineAnimation = PathlineAnimation.fromTrajectories<AnimationState>(
          transformedTrajectories,
          {
            style: {
              color: settings.stylingSettings.trajectory.color,
              strokeWidth: settings.stylingSettings.trajectory.strokeWidth,
              pointRadius: settings.stylingSettings.trajectory.endpointRadius,
              opacity: settings.stylingSettings.trajectory.opacity,
            }
          }
        );
        await pathlineAnimation.init(canvas);
      }
      clickedTrajectory = null;
      isStreamingTrajectory = false;
    });
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
    setupTimeline().then(() => {
      initialized = true;
      draw(timeline!.initialState);
      if (playingByDefault) startAnimation();
    });
  }

  // Handle visibility changes (separate from initialization)
  $: if (figureIsActive !== undefined && initialized) {
    handleVisibilityChange($figureIsActive);
  }
</script>

<Figure {caption} bind:isActive={figureIsActive} backgroundVisible={false}>
  {#snippet children()}
    <div
      style="display:flex;flex-direction:column;align-items:center;width:100%;"
    >
      <div style="width:100%;max-width:{width}px;">
        <canvas
          bind:this={canvas}
          use:canvas2d.bindCanvas
          onclick={handleCanvasClick}
          style="cursor:pointer;width:100%;height:auto;aspect-ratio:{width}/{height};"
        ></canvas>
      </div>
      <TimeSlider
        {timeline}
        color={settings.stylingSettings.trajectory.color}
      />
    </div>
  {/snippet}
</Figure>
