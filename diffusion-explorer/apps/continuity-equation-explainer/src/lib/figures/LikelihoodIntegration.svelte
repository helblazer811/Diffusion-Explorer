<!-- LikelihoodIntegration: Shows likelihood integration via step-by-step arrow animation -->

<script lang="ts">
  import { onDestroy } from "svelte";
  import type { Writable } from "svelte/store";
  import type { Clip } from "@diffusion-explorer/ui";
  import {
    Figure,
    TimelineBuilder,
    createPauseClip,
    useVisibilityHandler,
    useCanvas2D,
    createSourceTargetScales,
    drawScatterPlot,
    drawText,
    drawMathjax,
    drawPartialTrajectory,
    Katex,
  } from "@diffusion-explorer/ui";
  import { settings } from "$lib/settings";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  // Data prop (loaded from cached reverse trajectories JSON)
  export let data: {
    trajectories: number[][][]; // [sample][timestep][x,y] - timestep 0 is at target (t=1)
    sourceDistribution: number[][];
    targetDistribution: number[][];
    config: { numSamples: number; numSteps: number };
  } | null = null;

  // Which two trajectories to highlight
  export let selectedIndices: [number, number] = [5, 15];

  // Layout props
  export let width = 750;
  export let height = 375;
  export let marginWidth = 50;
  export let marginHeight = 20;

  // Source/Target layout (normalized 0-1)
  export let sourceCenterX = 0.25;
  export let targetCenterX = 0.75;
  export let yShiftFactor = -0.5;
  export let distributionScaleFactor = 0.9;

  // Scatter styling
  export let scatterRadius = settings.stylingSettings.scatterPlot.radius;
  export let scatterOpacity = settings.stylingSettings.scatterPlot.opacity;
  export let scatterColor = "#3b82f6"; // Blue, same as ReverseSampling

  // Trajectory styling
  export let trajectoryColor = "#f17720";
  export let trajectoryStrokeWidth = 3;
  export let arrowRadius = 6;

  // Label styling
  export let labelColor = "#666666";
  export let labelFontSize = 28;
  export let labelFontFamily = "Helvetica, Arial, sans-serif";
  export let latexFontSize = settings.stylingSettings.figureLatex.fontSize;

  // Animation timing (in milliseconds)
  export let msPerSegment = 240;
  export let pauseAfterSegmentMs = 150;
  export let pauseAfterTrajectoryMs = 2400;
  export let endPauseMs = 3000;
  export let playingByDefault = true;

  // Number of steps to subsample trajectories to (for visible discrete jumps)
  export let displaySteps = 10;

  // Caption slot (passed as default children)
  export let children: import("svelte").Snippet | undefined = undefined;

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  $: caption = children;

  // Canvas elements and contexts
  let scatterCanvasElement: HTMLCanvasElement | null = null;
  let trajectoryCanvasElement: HTMLCanvasElement | null = null;
  let fgCanvasElement: HTMLCanvasElement | null = null;

  const scatterCanvas = useCanvas2D(width, height);
  const trajectoryCanvas = useCanvas2D(width, height);
  const fgCanvas = useCanvas2D(width, height);

  // Animation state type - tracks step-by-step progress
  type AnimationState = {
    currentTrajectory: number;   // Which trajectory (0 or 1)
    segmentIndex: number;        // Current segment being revealed
    segmentProgress: number;     // Progress within current segment (0-1)
  };

  // Animation state
  let initialized = false;
  let timeline: ReturnType<TimelineBuilder<AnimationState>["build"]> | null = null;

  // Visibility tracking
  let figureIsActive: Writable<boolean> | undefined;
  const { handleVisibilityChange } = useVisibilityHandler(() => timeline);

  // Pre-computed data
  let scales: ReturnType<typeof createSourceTargetScales> | null = null;
  let sourcePixelCoords: number[][] = [];
  let targetPixelCoords: number[][] = [];
  let selectedTrajectoriesPixels: number[][][] = []; // [2 trajectories][steps][x,y] in PIXEL coords
  let selectedPointsTargetPixels: number[][] = []; // [2 points][x,y] - positions at target (for labels)
  let combinedMeanX = 0;

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  /**
   * Subsample a trajectory to approximately targetSteps points.
   * Ensures first and last points are always included.
   */
  function subsampleTrajectory(trajectory: number[][], targetSteps: number): number[][] {
    const originalSteps = trajectory.length;
    if (originalSteps <= targetSteps) return trajectory;

    const result: number[][] = [];
    for (let i = 0; i < targetSteps; i++) {
      const sourceIdx = Math.round((i * (originalSteps - 1)) / (targetSteps - 1));
      result.push(trajectory[sourceIdx]);
    }
    return result;
  }

  /**
   * Pre-compute trajectory data for the selected trajectories.
   * CRITICAL: Each point is transformed to pixel coords based on its own timestep.
   * This is necessary because drawPartialTrajectory applies scale functions to ALL points,
   * but each point along the trajectory corresponds to a different time position.
   */
  function precomputeTrajectories(): void {
    if (!data || data.trajectories.length === 0 || !scales) return;

    // Compute combined mean X for coordinate transformation
    const allX = [
      ...data.sourceDistribution.map((p) => p[0]),
      ...data.targetDistribution.map((p) => p[0]),
    ];
    combinedMeanX = allX.reduce((a, b) => a + b, 0) / allX.length;

    // Get, subsample, and convert to pixel coordinates
    selectedTrajectoriesPixels = selectedIndices.map((idx) => {
      const traj = data!.trajectories[idx] || data!.trajectories[0];
      const subsampled = subsampleTrajectory(traj, displaySteps);
      const numSteps = subsampled.length;

      // Convert each point to pixel coords based on its own timestep
      return subsampled.map((pt, stepIdx) => {
        // timestep 0 is at target (t=0), last step is at source (t=1)
        const t = stepIdx / (numSteps - 1);
        const centerPixelX =
          scales!.targetCenterPixelX +
          t * (scales!.sourceCenterPixelX - scales!.targetCenterPixelX);
        const pixelX = centerPixelX + (pt[0] - combinedMeanX) * scales!.xScaleFactor;
        const pixelY = scales!.yScale(pt[1]);
        return [pixelX, pixelY];
      });
    });

    // Compute starting positions (at target, t=0) for labels - use first point of pixel trajectories
    selectedPointsTargetPixels = selectedTrajectoriesPixels.map((traj) => {
      return [traj[0][0], traj[0][1]];
    });
  }

  /**
   * Pre-compute scatter plot pixel coordinates.
   */
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
        distributionScaleFactor,
      }
    );

    precomputeScatterCoords();
    precomputeTrajectories();
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  function setupTimeline(): void {
    if (selectedTrajectoriesPixels.length === 0) return;

    const numSegments = displaySteps - 1;
    const initialState: AnimationState = {
      currentTrajectory: 0,
      segmentIndex: 0,
      segmentProgress: 0,
    };

    const builder = new TimelineBuilder<AnimationState>()
      .setInitialState(initialState)
      .setLooping(true)
      .setEndPause(endPauseMs);

    // Build clips for each trajectory
    for (let traj = 0; traj < 2; traj++) {
      for (let seg = 0; seg < numSegments; seg++) {
        // Clip to reveal segment with smooth progress
        const segmentClip: Clip<AnimationState> = {
          name: `traj-${traj}-seg-${seg}`,
          reduce: (t: number) => ({
            currentTrajectory: traj,
            segmentIndex: seg,
            segmentProgress: t,
          }),
        };
        builder.add(segmentClip, { durationMs: msPerSegment });

        // Pause after segment (except for last segment of trajectory)
        if (seg < numSegments - 1) {
          builder.add(createPauseClip<AnimationState>(), { durationMs: pauseAfterSegmentMs });
        }
      }

      // Pause after trajectory completes
      builder.add(createPauseClip<AnimationState>(), { durationMs: pauseAfterTrajectoryMs });
    }

    timeline = builder.build();

    // Register tick callback
    timeline.onTick((_t, state) => {
      draw(state);
    });
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function draw(state: AnimationState): void {
    if (!initialized || !scales) return;

    // 1. Draw scatter plots on scatter canvas (static)
    const scatterCtx = scatterCanvas.ctx;
    if (scatterCtx) {
      scatterCtx.clearRect(0, 0, width, height);
      // Source distribution (left)
      drawScatterPlot(scatterCtx, sourcePixelCoords, scatterRadius, scatterColor, scatterOpacity);
      // Target distribution (right)
      drawScatterPlot(scatterCtx, targetPixelCoords, scatterRadius, scatterColor, scatterOpacity);
    }

    // 2. Draw trajectories with arrows on trajectory canvas
    const trajCtx = trajectoryCanvas.ctx;
    if (trajCtx) {
      trajCtx.clearRect(0, 0, width, height);

      const numSegments = displaySteps - 1;

      for (let i = 0; i < 2; i++) {
        const trajPixels = selectedTrajectoriesPixels[i];
        if (!trajPixels || trajPixels.length === 0) continue;

        const isActive = i === state.currentTrajectory;
        const isComplete = i < state.currentTrajectory;

        // Determine which segment to draw up to
        let segIdx: number;
        let segProgress: number;

        if (isComplete) {
          // Draw fully revealed trajectory
          segIdx = numSegments - 1;
          segProgress = 1.0;
        } else if (isActive) {
          // Draw partially revealed trajectory
          segIdx = state.segmentIndex;
          segProgress = state.segmentProgress;
        } else {
          // Don't draw yet
          continue;
        }

        // Use identity scale functions since coordinates are already in pixels
        drawPartialTrajectory(trajCtx, trajPixels, segIdx, segProgress, {
          color: trajectoryColor,
          strokeWidth: trajectoryStrokeWidth,
          pointRadius: 3,
          opacity: 1.0,
          headType: "arrow",
          arrowRadius: arrowRadius,
          xScale: (x) => x,
          yScale: (y) => y,
        });
      }
    }

    // 3. Draw labels on foreground canvas
    const ctx = fgCanvas.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);

    // Distribution labels
    const labelFont = `400 ${labelFontSize}px ${labelFontFamily}`;
    drawText(ctx, "Source Distribution", scales.sourceCenterPixelX, marginHeight / 2, {
      color: labelColor,
      font: labelFont,
    });
    drawText(ctx, "Target Distribution", scales.targetCenterPixelX, marginHeight / 2, {
      color: labelColor,
      font: labelFont,
    });

    // LaTeX labels (p_0, p_1) at the bottom of distributions
    const yDomain = scales.yScale.domain();
    const yBottom = yDomain[1];
    const latexLabelY = scales.yScale(yBottom) + 15;

    // Helper to request redraw when MathJax finishes
    const requestRedraw = () => {
      if (timeline) draw(timeline.state);
    };

    drawMathjax(
      ctx,
      "p_0",
      scales.sourceCenterPixelX,
      latexLabelY,
      latexFontSize,
      0,
      0,
      { color: labelColor },
      requestRedraw
    );

    drawMathjax(
      ctx,
      "p_1",
      scales.targetCenterPixelX,
      latexLabelY,
      latexFontSize,
      0,
      0,
      { color: labelColor },
      requestRedraw
    );

    // Point labels (x_1, x_2) above the selected points at target
    if (selectedPointsTargetPixels.length >= 2) {
      const labelOffsetY = -20;

      drawMathjax(
        ctx,
        "x_1",
        selectedPointsTargetPixels[0][0],
        selectedPointsTargetPixels[0][1] + labelOffsetY,
        latexFontSize,
        0,
        0,
        { color: trajectoryColor },
        requestRedraw
      );

      drawMathjax(
        ctx,
        "x_2",
        selectedPointsTargetPixels[1][0],
        selectedPointsTargetPixels[1][1] + labelOffsetY,
        latexFontSize,
        0,
        0,
        { color: trajectoryColor },
        requestRedraw
      );
    }
  }

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  onDestroy(() => {
    timeline?.dispose();
  });

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  // Initialize when canvases and data are ready
  $: if (
    scatterCanvasElement &&
    trajectoryCanvasElement &&
    fgCanvasElement &&
    data &&
    data.trajectories?.length > 0 &&
    !initialized
  ) {
    // Initialize Canvas2D contexts
    scatterCanvas.init(scatterCanvasElement);
    scatterCanvas.resize(width, height);
    trajectoryCanvas.init(trajectoryCanvasElement);
    trajectoryCanvas.resize(width, height);
    fgCanvas.init(fgCanvasElement);
    fgCanvas.resize(width, height);

    initializeData();
    setupTimeline();

    initialized = true;
    if (timeline) {
      draw(timeline.initialState);
      if (playingByDefault) timeline.play();
    }
  }

  // Handle visibility changes
  $: if (figureIsActive !== undefined && initialized && $figureIsActive !== undefined) {
    handleVisibilityChange($figureIsActive);
  }
</script>

<div class="likelihood-equation" style="width: 100%; max-width: {width}px;">
  <Katex
    math={"\\log p(x_t) = \\log p(x_0) - \\int_0^t \\nabla \\cdot v(x_s, s)\\, ds"}
    displayMode={true}
  />
</div>

<Figure {caption} backgroundVisible={false} bind:isActive={figureIsActive}>
  {#snippet children()}
    <div class="likelihood-wrapper" style="width: 100%; max-width: {width}px;">
      <div class="canvas-stack" style="aspect-ratio: {width} / {height};">
        <!-- Scatter canvas (bottom layer) -->
        <canvas
          class="scatter-canvas"
          bind:this={scatterCanvasElement}
          style="pointer-events: none;"
        ></canvas>
        <!-- Trajectory canvas (middle layer) -->
        <canvas
          class="trajectory-canvas"
          bind:this={trajectoryCanvasElement}
          style="pointer-events: none;"
        ></canvas>
        <!-- Foreground labels canvas (top layer) -->
        <canvas class="fg-canvas" bind:this={fgCanvasElement}></canvas>
      </div>
    </div>
  {/snippet}
</Figure>

<style>
  .likelihood-equation {
    text-align: center;
    margin: 0 auto 1rem auto;
    font-size: 1.4rem;
    color: #666666;
  }

  .likelihood-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
  }

  .canvas-stack {
    position: relative;
    border-radius: 8px;
    overflow: hidden;
    background: transparent;
    margin: 0 auto;
    width: 100%;
  }

  .canvas-stack canvas {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
  }

  .scatter-canvas {
    background: transparent;
    z-index: 1;
  }

  .trajectory-canvas {
    background: transparent;
    z-index: 2;
  }

  .fg-canvas {
    background: transparent;
    z-index: 3;
  }
</style>
