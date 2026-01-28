<script lang="ts">
  import { onDestroy } from "svelte";
  import {
    Figure,
    TimeSlider,
    drawScatterPlot,
    drawText,
    drawTrajectories,
    computeContours,
    plotContours,
    Timeline,
    useCanvas2D,
    useVisibilityHandler,
    createPauseClip,
    type TrajectoryStyleOptions
  } from "@diffusion-explorer/ui";
  import MiniDistributionButton from "./MiniDistributionButton.svelte";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  type SourceType = 'gaussian' | 'uniform' | 'ring';

  interface SourceData {
    sourceDistribution: number[][];
    miniDistribution: number[][];
    trajectories: number[][][];
  }

  // Caption slot (passed as default children)
  export let children = undefined;

  // Data props (from parent +page.svelte)
  export let targetDistribution: number[][] = [];
  export let sourceDistribution: number[][] = [];
  export let trajectories: number[][][] = [];  // [numSteps+1, numSamples, 2]
  export let activeSourceType: SourceType = 'gaussian';
  export let allSourceData: Record<SourceType, SourceData> = {
    gaussian: { sourceDistribution: [], miniDistribution: [], trajectories: [] },
    uniform: { sourceDistribution: [], miniDistribution: [], trajectories: [] },
    ring: { sourceDistribution: [], miniDistribution: [], trajectories: [] }
  };
  export let onSourceChange: (type: SourceType) => void = () => {};

  // Layout props (matching ProbabilityPath)
  export let width = 900;
  export let height = 500;
  export let marginWidth = 40;
  export let marginHeight = 50;

  // Styling props (matching CurvedTrajectoryIntro settings)
  export let sourcePointColor = "#3b82f6";
  export let targetPointColor = "#3b82f6";
  export let trajectoryColor = "#f17720";
  export let pointRadius = 6;
  export let pointOpacity = 0.25;
  export let trajectoryStrokeWidth = 3;
  export let trajectoryOpacity = 0.8;
  export let trajectoryEndpointRadius = 3;

  // Animation timing
  export let animationDuration = 8000;
  export let timing = {
    pauseStart: 0.875,
  };

  // Number of trajectories to display
  export let numTrajectories = 0;

  // Contour plot options for current distribution (matching ProbabilityPath settings)
  export let showContours = true;
  export let contourBandwidth = 6;
  export let contourThresholds = 4;
  export let contourOpacity = 0.2;
  export let contourFillColor = "#f17720";
  export let contourBlendMode: GlobalCompositeOperation | undefined = undefined;

  // Intermediate scatter plot options
  export let showIntermediateScatter = true;
  export let intermediatePointColor = "#f17720";
  export let intermediatePointOpacity = 0.7;

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  // Canvas - need both bind:this (for reactivity) and action (for DPR setup)
  let canvas: HTMLCanvasElement | null = null;
  const canvas2d = useCanvas2D(width, height);
  // Tie ctx reactivity to canvas variable so it updates when action runs
  $: ctx = canvas && canvas2d.ctx;
  $: caption = children;

  // Coordinate transformation state
  let sourceRegion = { x: 0, y: 0, width: 0, height: 0 };
  let targetRegion = { x: 0, y: 0, width: 0, height: 0 };
  const dataBounds = { xMin: -2, xMax: 2, yMin: -1.8, yMax: 1.8 };

  // Pre-computed pixel coordinates
  let sourcePixelCoords: number[][] = [];
  let targetPixelCoords: number[][] = [];
  let trajectoriesPixelCoords: number[][][] = [];

  // Animation state type
  type AnimationState = {
    time: number;
    segmentIndex: number;
  };

  // Animation state - Timeline system
  let timeline: Timeline<AnimationState> | null = null;
  let cachedNumSteps = 1;

  // Visibility-based animation control
  let figureIsActive;
  const { handleVisibilityChange } = useVisibilityHandler(() => timeline);
  let isInitialized = false;

  // Derived state
  $: numSteps = trajectories.length > 0 ? trajectories.length - 1 : 1;

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  // Clipping radius for point visibility
  const CLIPPING_RADIUS = 3.0;

  function isPointInBounds(x: number, y: number): boolean {
    const distance = Math.sqrt(x * x + y * y);
    return distance <= CLIPPING_RADIUS;
  }

  // Layout positioning (matching ProbabilityPath pattern)
  const sourceCenterX = 0.2;  // Source distribution centered at 20% of width
  const targetCenterX = 0.8;  // Target distribution centered at 80% of width
  const distributionScaleFactor = 0.45;  // Each distribution ~320px wide, fits side by side
  const yShiftFactor = 0.0;  // No vertical shift

  function computeRegions() {
    const yShift = height * yShiftFactor;
    const plotHeight = height - 2 * marginHeight - yShift;
    const distributionWidth = width * distributionScaleFactor;

    sourceRegion = {
      x: width * sourceCenterX - distributionWidth / 2,
      y: marginHeight + yShift,
      width: distributionWidth,
      height: plotHeight
    };

    targetRegion = {
      x: width * targetCenterX - distributionWidth / 2,
      y: marginHeight + yShift,
      width: distributionWidth,
      height: plotHeight
    };
  }

  function dataToSourcePixel(dataX: number, dataY: number): [number, number] {
    const xRange = dataBounds.xMax - dataBounds.xMin;
    const yRange = dataBounds.yMax - dataBounds.yMin;
    const px = sourceRegion.x + ((dataX - dataBounds.xMin) / xRange) * sourceRegion.width;
    // Standard y-axis: lower data values at top, higher at bottom
    const py = sourceRegion.y + ((dataY - dataBounds.yMin) / yRange) * sourceRegion.height;
    return [px, py];
  }

  function dataToTargetPixel(dataX: number, dataY: number): [number, number] {
    const xRange = dataBounds.xMax - dataBounds.xMin;
    const yRange = dataBounds.yMax - dataBounds.yMin;
    const px = targetRegion.x + ((dataX - dataBounds.xMin) / xRange) * targetRegion.width;
    // Standard y-axis: lower data values at top, higher at bottom
    const py = targetRegion.y + ((dataY - dataBounds.yMin) / yRange) * targetRegion.height;
    return [px, py];
  }

  function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }

  // Get pixel coordinates for a data point at time t (interpolating between source and target regions)
  function dataToPixelAtTime(dataX: number, dataY: number, t: number): [number, number] {
    const [srcPx, srcPy] = dataToSourcePixel(dataX, dataY);
    const [tgtPx, tgtPy] = dataToTargetPixel(dataX, dataY);
    return [lerp(srcPx, tgtPx, t), lerp(srcPy, tgtPy, t)];
  }

  // Store selected trajectory indices for consistency
  let selectedTrajectoryIndices: number[] = [];

  function selectTrajectoryIndices() {
    if (trajectories.length === 0) return;

    const numSamples = trajectories[0].length;

    // Find all valid indices (starting points within bounds)
    const validIndices: number[] = [];
    for (let i = 0; i < numSamples; i++) {
      const [startX, startY] = trajectories[0][i];
      if (isPointInBounds(startX, startY)) {
        validIndices.push(i);
      }
    }

    // Randomly select up to numTrajectories indices
    if (validIndices.length <= numTrajectories) {
      selectedTrajectoryIndices = validIndices;
    } else {
      // Shuffle and take first numTrajectories
      const shuffled = [...validIndices];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      selectedTrajectoryIndices = shuffled.slice(0, numTrajectories);
    }
  }

  function computeTrajectoryPixelCoords() {
    if (trajectories.length === 0 || sourceDistribution.length === 0) return;

    const numTimeSteps = trajectories.length;

    trajectoriesPixelCoords = [];

    for (const sampleIdx of selectedTrajectoryIndices) {
      const sampleTrajectory: number[][] = [];

      for (let timeIdx = 0; timeIdx < numTimeSteps; timeIdx++) {
        const t = timeIdx / (numTimeSteps - 1);
        const [dataX, dataY] = trajectories[timeIdx][sampleIdx];

        const [srcPx, srcPy] = dataToSourcePixel(dataX, dataY);
        const [tgtPx, tgtPy] = dataToTargetPixel(dataX, dataY);

        const px = lerp(srcPx, tgtPx, t);
        const py = lerp(srcPy, tgtPy, t);

        sampleTrajectory.push([px, py]);
      }

      trajectoriesPixelCoords.push(sampleTrajectory);
    }
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function runInitialComputation() {
    if (!canvas) return;
    if (targetDistribution.length === 0 || sourceDistribution.length === 0) return;
    if (trajectories.length === 0) return;

    computeRegions();
    // Filter source points to those within clipping bounds
    sourcePixelCoords = sourceDistribution
      .filter(([x, y]) => isPointInBounds(x, y))
      .map(([x, y]) => dataToSourcePixel(x, y));
    targetPixelCoords = targetDistribution.map(([x, y]) => dataToTargetPixel(x, y));
    selectTrajectoryIndices();
    computeTrajectoryPixelCoords();
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  function setupTimeline() {
    cachedNumSteps = trajectories.length > 0 ? trajectories.length - 1 : 1;

    timeline = new Timeline<AnimationState>();
    timeline.initialState = { time: 0, segmentIndex: 0 };

    const mainClip = {
      name: "FlowAnimation",
      reduce(t: number) {
        return {
          time: t,
          segmentIndex: Math.round(t * cachedNumSteps)
        };
      }
    };

    timeline.add(mainClip, { start: 0, end: timing.pauseStart });
    timeline.add(createPauseClip(), { start: timing.pauseStart, end: 1 });

    timeline.duration = animationDuration / 1000;
    timeline.looping = true;

    timeline.onTick((_t, state) => {
      draw(state);
    });
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function draw(state: AnimationState) {
    if (!ctx || !isInitialized) return;
    ctx.clearRect(0, 0, width, height);

    // --- Static Background ---
    drawText(ctx, "Source Distribution", sourceRegion.x + sourceRegion.width / 2, 10, {
      font: "400 32px Helvetica, Arial, sans-serif",
      color: "#5e5e5e",
      opacity: 0.9,
      align: "center",
      baseline: "top"
    });

    drawText(ctx, "Target Distribution", targetRegion.x + targetRegion.width / 2, 10, {
      font: "400 32px Helvetica, Arial, sans-serif",
      color: "#5e5e5e",
      opacity: 0.9,
      align: "center",
      baseline: "top"
    });

    drawScatterPlot(ctx, sourcePixelCoords, pointRadius, sourcePointColor, pointOpacity);
    drawScatterPlot(ctx, targetPixelCoords, pointRadius, targetPointColor, pointOpacity);

    // --- Dynamic Foreground ---

    // Draw contours and scatter for current distribution
    if (trajectories.length > 0) {
      const currentSamples = trajectories[state.segmentIndex];
      if (currentSamples && currentSamples.length > 0) {
        const t = state.time;

        // Create scale functions for contour plotting that interpolate position based on time
        const xScale = (dataX: number) => dataToPixelAtTime(dataX, 0, t)[0];
        const yScale = (dataY: number) => dataToPixelAtTime(0, dataY, t)[1];

        // Draw contours (behind scatter)
        if (showContours) {
          const contourData = computeContours(currentSamples, {
            bandwidth: contourBandwidth,
            thresholds: contourThresholds,
          });

          plotContours(ctx, contourData, {
            xScale,
            yScale,
            fillColor: contourFillColor,
            opacity: contourOpacity,
            blendMode: contourBlendMode,
            fill: true,
            stroke: false,
          });
        }

        // Draw intermediate scatter points
        if (showIntermediateScatter) {
          const intermediatePixelCoords = currentSamples.map(([dataX, dataY]) =>
            dataToPixelAtTime(dataX, dataY, t)
          );
          drawScatterPlot(ctx, intermediatePixelCoords, pointRadius, intermediatePointColor, intermediatePointOpacity);
        }
      }
    }

    // Draw trajectories
    if (trajectoriesPixelCoords.length > 0) {
      const style: TrajectoryStyleOptions = {
        color: trajectoryColor,
        strokeWidth: trajectoryStrokeWidth,
        opacity: trajectoryOpacity,
        pointRadius: trajectoryEndpointRadius,
        showPreview: false
      };

      drawTrajectories(ctx, trajectoriesPixelCoords, state.segmentIndex, style);
    }
  }

  // ----------------------------------------------------------------
  // Event Handlers
  // ----------------------------------------------------------------

  function handleSourceTypeChange(type: SourceType) {
    if (type === activeSourceType) return;
    if (timeline) {
      timeline.pause();
      timeline.seek(0);
    }
    onSourceChange(type);
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

  // Initialize visualization when all data is ready
  $: if (
    !isInitialized &&
    targetDistribution.length > 0 &&
    sourceDistribution.length > 0 &&
    trajectories.length > 0 &&
    canvas
  ) {
    runInitialComputation();
    setupTimeline();
    isInitialized = true;
    draw(timeline!.initialState);
    timeline?.play();
  }

  // React to source type changes (recompute trajectories)
  $: if (isInitialized && sourceDistribution.length > 0 && trajectories.length > 0) {
    // Filter source points to those within clipping bounds
    sourcePixelCoords = sourceDistribution
      .filter(([x, y]) => isPointInBounds(x, y))
      .map(([x, y]) => dataToSourcePixel(x, y));
    selectTrajectoryIndices();
    computeTrajectoryPixelCoords();
    cachedNumSteps = trajectories.length > 0 ? trajectories.length - 1 : 1;
    if (timeline) {
      timeline.seek(0);
      draw(timeline.initialState);
      timeline.play();
    }
  }

  // Handle visibility changes
  $: if (figureIsActive !== undefined && isInitialized) {
    handleVisibilityChange($figureIsActive);
  }
</script>

<Figure {caption} backgroundVisible={false} bind:isActive={figureIsActive}>
  {#snippet children()}
    <div class="main-content">
      <div class="source-buttons">
        <MiniDistributionButton
          data={allSourceData.gaussian.miniDistribution}
          active={activeSourceType === 'gaussian'}
          onclick={() => handleSourceTypeChange('gaussian')}
          label="Gaussian"
        />
        <MiniDistributionButton
          data={allSourceData.uniform.miniDistribution}
          active={activeSourceType === 'uniform'}
          onclick={() => handleSourceTypeChange('uniform')}
          label="Uniform"
        />
        <MiniDistributionButton
          data={allSourceData.ring.miniDistribution}
          active={activeSourceType === 'ring'}
          onclick={() => handleSourceTypeChange('ring')}
          label="Ring"
        />
      </div>
      <div class="canvas-and-controls">
        <div class="canvas-container" style="max-width: {width}px;">
          <canvas
            bind:this={canvas}
            use:canvas2d.bindCanvas
            style="width: 100%; height: auto; aspect-ratio: {width}/{height};"
          ></canvas>
        </div>
        <div class="controls">
          <TimeSlider {timeline} color={trajectoryColor} />
        </div>
      </div>
    </div>
  {/snippet}
</Figure>

<style>
  .main-content {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .canvas-and-controls {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
  }

  .canvas-container {
    position: relative;
    width: 100%;
  }

  .controls {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }

  .source-buttons {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding-bottom: 72px;
  }
</style>
