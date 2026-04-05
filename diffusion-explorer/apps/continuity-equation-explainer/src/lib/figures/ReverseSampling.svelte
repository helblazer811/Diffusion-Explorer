<!-- ReverseSampling: Shows trajectories from target distribution (t=1) back to source distribution (t=0) -->

<script lang="ts">
  import { onDestroy } from "svelte";
  import {
    Figure,
    TimeSlider,
    drawScatterPlot,
    drawText,
    createSourceTargetScales,
    Timeline,
    createPauseClip,
    useCanvas2D,
    PathlineAnimation,
    type PathlineAnimationState,
    useVisibilityHandler,
  } from "@diffusion-explorer/ui";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  // Data prop (loaded from cached trajectories JSON)
  export let data: {
    trajectories: number[][][]; // [sample][timestep][x,y] - timestep 0 is at target (t=1)
    sourceDistribution: number[][];
    targetDistribution: number[][];
    config: { numSamples: number; numSteps: number };
  } | null = null;

  // Layout props
  export let width = 750;
  export let height = 375;
  export let marginWidth = 50;
  export let marginHeight = 20;

  // Source/Target layout (normalized 0-1)
  export let sourceCenterX = 0.25;
  export let targetCenterX = 0.75;
  export let yShiftFactor = -0.5;

  // Scatter styling
  export let scatterRadius = 5;
  export let scatterOpacity = 0.25;
  export let scatterColor = "#3b82f6";

  // Trajectory styling
  export let trajectoryColor = "#f17720";
  export let trajectoryStrokeWidth = 3;
  export let trajectoryPointRadius = 3;
  export let trajectoryOpacity = 0.8;

  // Label styling
  export let labelColor = "#666";
  export let labelFontSize = 28;
  export let labelFontWeight = 400;

  // Trajectory filtering
  export let numTrajectories = 5; // Number of trajectories to display

  // Animation props
  export let animationDuration = 6000;
  export let playingByDefault = true;
  export let pauseBeforeRestart = 1000;

  // Caption slot (passed as default children)
  export let children = undefined;

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  $: caption = children;

  // Canvas state - using useCanvas2D for DPR handling
  let canvas: HTMLCanvasElement | null = null;
  const canvas2d = useCanvas2D(width, height);
  $: ctx = canvas && canvas2d.ctx;

  // Animation state type - extends PathlineAnimationState
  type AnimationState = PathlineAnimationState;

  // Animation state - Timeline system
  let initialized = false;
  let timeline: Timeline<AnimationState> | null = null;

  // PathlineAnimation instance
  let pathlineAnimation: PathlineAnimation<AnimationState> | null = null;

  // Visibility tracking
  let figureIsActive: import("svelte/store").Writable<boolean>;
  const { handleVisibilityChange } = useVisibilityHandler(() => timeline);

  // Pre-computed data
  let scales: ReturnType<typeof createSourceTargetScales> | null = null;
  let transformedTrajectories: number[][][] = []; // [trajectory][timestep][x,y in pixels]
  let sourcePixelCoords: number[][] = []; // [point][x,y] in pixel space
  let targetPixelCoords: number[][] = []; // [point][x,y] in pixel space
  let combinedMeanX = 0;

  // Derived values
  $: numTimeSteps = data?.trajectories?.[0]?.length || 1;

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  // Compute pixel X for a given data point at time t
  // For reverse sampling, t=0 means at target (right), t=1 means at source (left)
  function getPixelX(dataX: number, meanX: number, t: number): number {
    if (!scales) return 0;
    // Reverse direction: t=0 -> target (right), t=1 -> source (left)
    const centerPixelX =
      scales.targetCenterPixelX +
      t * (scales.sourceCenterPixelX - scales.targetCenterPixelX);
    return centerPixelX + (dataX - meanX) * scales.xScaleFactor;
  }

  // Pre-compute all trajectory pixel coordinates
  function precomputeTrajectories(): void {
    if (!data || data.trajectories.length === 0 || !scales) return;

    const allX = [
      ...data.sourceDistribution.map((p) => p[0]),
      ...data.targetDistribution.map((p) => p[0]),
    ];
    combinedMeanX = allX.reduce((a, b) => a + b, 0) / allX.length;

    // Limit trajectories to numTrajectories
    const trajectoriesToShow = data.trajectories.slice(0, numTrajectories);
    const numSamples = trajectoriesToShow.length;
    const numSteps = trajectoriesToShow[0]?.length || 0;

    transformedTrajectories = Array.from({ length: numSamples }, (_, sampleIdx) => {
      return trajectoriesToShow[sampleIdx].map((point, tIdx) => {
        const t = tIdx / (numSteps - 1);
        const pixelX = getPixelX(point[0], combinedMeanX, t);
        const pixelY = scales!.yScale(point[1]);
        return [pixelX, pixelY];
      });
    });
  }

  // Pre-compute scatter plot pixel coordinates
  function precomputeScatterCoords(): void {
    if (!scales || !data) return;

    sourcePixelCoords = data.sourceDistribution.map((point) => {
      const pixelX =
        scales!.sourceCenterPixelX +
        (point[0] - scales!.sourceMeanX) * scales!.xScaleFactor;
      const pixelY = scales!.yScale(point[1]);
      return [pixelX, pixelY];
    });

    targetPixelCoords = data.targetDistribution.map((point) => {
      const pixelX =
        scales!.targetCenterPixelX +
        (point[0] - scales!.targetMeanX) * scales!.xScaleFactor;
      const pixelY = scales!.yScale(point[1]);
      return [pixelX, pixelY];
    });
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  // Initialize scales and pre-compute all data
  function initializeData(): void {
    if (!data) return;

    scales = createSourceTargetScales(
      data.sourceDistribution as [number, number][],
      data.targetDistribution as [number, number][],
      {
        width,
        height,
        marginWidth,
        marginHeight,
        sourceCenterX,
        targetCenterX,
        yShiftFactor,
      }
    );

    precomputeScatterCoords();
    precomputeTrajectories();
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  async function setupTimeline(): Promise<void> {
    if (transformedTrajectories.length === 0) return;

    // Create PathlineAnimation for trajectories
    pathlineAnimation = PathlineAnimation.fromTrajectories<AnimationState>(
      transformedTrajectories,
      {
        style: {
          color: trajectoryColor,
          strokeWidth: trajectoryStrokeWidth,
          pointRadius: trajectoryPointRadius,
          opacity: trajectoryOpacity,
        },
      }
    );

    // Initialize with canvas
    await pathlineAnimation.init(canvas!);

    timeline = new Timeline<AnimationState>();
    timeline.initialState = { segmentIndex: 0 };

    // Total cycle: forward + pause (then loops back to start)
    const totalCycleDuration = animationDuration + pauseBeforeRestart;
    const forwardNorm = animationDuration / totalCycleDuration;

    // Add clips in sequence with explicit start/end
    timeline.add(pathlineAnimation.clip, { start: 0, end: forwardNorm });
    timeline.add(createPauseClip(), { start: forwardNorm, end: 1 });

    // Set duration in seconds
    timeline.duration = totalCycleDuration / 1000;
    timeline.looping = true;

    // Register tick callback
    timeline.onTick((_t, state) => {
      draw(state);
    });
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function draw(state: AnimationState): void {
    if (!ctx || !initialized || !pathlineAnimation || !scales) return;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // --- Static Background ---
    // Draw source scatter (left)
    drawScatterPlot(ctx, sourcePixelCoords, scatterRadius, scatterColor, scatterOpacity);

    // Draw target scatter (right)
    drawScatterPlot(ctx, targetPixelCoords, scatterRadius, scatterColor, scatterOpacity);

    // Draw distribution labels
    const labelFont = `${labelFontWeight} ${labelFontSize}px Helvetica, Arial, sans-serif`;
    drawText(ctx, "Source Distribution", scales.sourceCenterPixelX, marginHeight / 2, {
      color: labelColor,
      font: labelFont,
    });
    drawText(ctx, "Target Distribution", scales.targetCenterPixelX, marginHeight / 2, {
      color: labelColor,
      font: labelFont,
    });

    // --- Dynamic Foreground ---
    pathlineAnimation.draw(state);
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
  $: if (canvas && data && data.trajectories?.length > 0 && !initialized) {
    initializeData();
    setupTimeline().then(() => {
      initialized = true;
      if (timeline) {
        draw(timeline.initialState);
        if (playingByDefault) timeline.play();
      }
    });
  }

  // Handle visibility changes
  $: if (figureIsActive !== undefined && initialized) {
    handleVisibilityChange($figureIsActive);
  }
</script>

<Figure {caption} backgroundVisible={false} bind:isActive={figureIsActive}>
  {#snippet children()}
    <div style="display:flex;flex-direction:column;align-items:center;width:100%;">
      <canvas
        bind:this={canvas}
        use:canvas2d.bindCanvas
        style="width:100%;height:auto;max-width:{width}px;aspect-ratio:{width}/{height};"
      ></canvas>
      <TimeSlider
        {timeline}
        minLabel="t=1"
        maxLabel="t=0"
        color={trajectoryColor}
      />
    </div>
  {/snippet}
</Figure>
