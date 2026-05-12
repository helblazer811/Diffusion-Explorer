<!-- Diffeomorphism: Same Gaussian → smiley flow as ProbabilityPathIntro (cached trajectories), with a uniform grid overlaid that deforms through the same flow. The grid is interpolated from the cached source-sample trajectories via inverse-distance weighting. -->

<script lang="ts">
  import { onDestroy } from "svelte";
  import * as d3 from "d3";
  import {
    Figure,
    TimeSlider,
    Timeline,
    useCanvas2D,
    useVisibilityHandler,
    createSourceTargetScales,
    computeContours,
    plotContours,
    plotMeshGrid,
    drawMathjax,
    drawScatterPlot,
    type ComputedContours,
  } from "@diffusion-explorer/ui";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  export let children = undefined;

  // Trajectory data (same shape as FlowInvertibility's data prop)
  export let data: {
    allTrajectories: number[][][]; // [sample][step][2]
    sourceDistribution: number[][];
    targetDistribution: number[][];
    config: { numSteps: number; gaussianStd: number; clipRadius: number };
  } | null = null;

  // Layout (mirrors ProbabilityPathIntro)
  export let width = 800;
  export let height = 450;
  export let marginWidth = 50;
  export let marginHeight = 30;
  export let sourceCenterX = 0.2;
  export let targetCenterX = 0.8;
  export let yShiftFactor = -1.6;
  export let distributionScaleFactor = 0.9;

  // Grid configuration (in domain coords)
  export let gridResolution = 8;
  export let gridXMin = -1.0;
  export let gridXMax = 1.0;
  export let gridYMin = -1.0;
  export let gridYMax = 1.0;

  // Number of nearest cached trajectories to use for IDW interpolation per grid corner
  export let idwNeighbors = 8;

  // Contour styling (intermediate `p_t` only — source/target are scatter plots)
  export let contourBandwidth = 14;
  export let contourThresholds = 4;
  export let intermediateContourColor = "#f17720";
  export let intermediateContourOpacity = 0.25;
  export let contourMinThreshold = 0.0005;

  // Source / target scatter styling (blue points, like FlowInvertibility)
  export let scatterColor = "#3b82f6";
  export let scatterRadius = 4;
  export let scatterOpacity = 0.35;

  // Warped grid (thick dark gray)
  export let warpedGridColor = "#374151";
  export let warpedGridOpacity = 0.95;
  export let warpedGridWidth = 3;

  // Labels
  export let latexFontSize = 22;
  export let latexLabelOffsetY = 18;

  // Animation
  export let animationDuration = 8000;
  export let animationPauseTime = 1000;
  export let playingByDefault = true;

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  let canvas: HTMLCanvasElement | null = null;
  const canvas2d = useCanvas2D(width, height);
  $: ctx = canvas && canvas2d.ctx;
  $: caption = children;

  type SourceTargetScales = {
    yScale: d3.ScaleLinear<number, number>;
    xScaleFactor: number;
    sourceCenterPixelX: number;
    targetCenterPixelX: number;
    sourceMeanX: number;
    targetMeanX: number;
  };

  let scales: SourceTargetScales | null = null;

  // Cached: contours per timestep + source/target scatter pixel coords
  let sourcePixelCoords: number[][] = [];
  let targetPixelCoords: number[][] = [];
  let intermediateContourFrames: ComputedContours[] = [];

  // gridFrames[step][i][j] = [x, y] in domain coords (built by IDW from cached trajectories)
  let gridFrames: number[][][][] = [];

  // Mean X per step (for centering the moving contour)
  let perStepMeanX: number[] = [];

  type AnimationState = {
    time: number;
    frame: number;
    centerX: number;
  };

  let timeline: Timeline<AnimationState> | null = null;

  let figureIsActive: import("svelte/store").Writable<boolean>;
  const { handleVisibilityChange } = useVisibilityHandler(() => timeline);
  let isInitialized = false;

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  function getPixelX(dataX: number, dataMeanX: number, t: number): number {
    if (!scales) return 0;
    const centerPixelX =
      scales.sourceCenterPixelX +
      t * (scales.targetCenterPixelX - scales.sourceCenterPixelX);
    return centerPixelX + (dataX - dataMeanX) * scales.xScaleFactor;
  }

  /**
   * Compute the trajectory of a query grid point by IDW-blending the displacements
   * of its K nearest cached source samples. Returns positions per step in domain coords.
   */
  function computeIdwTrajectory(
    queryStart: [number, number],
    sourceStarts: [number, number][],
    allTrajectories: number[][][],
    numSteps: number,
    K: number
  ): [number, number][] {
    const eps = 1e-6;
    // Find K nearest source samples by squared distance
    const N = sourceStarts.length;
    const dists: { idx: number; d2: number }[] = new Array(N);
    for (let i = 0; i < N; i++) {
      const dx = sourceStarts[i][0] - queryStart[0];
      const dy = sourceStarts[i][1] - queryStart[1];
      dists[i] = { idx: i, d2: dx * dx + dy * dy };
    }
    dists.sort((a, b) => a.d2 - b.d2);
    const top = dists.slice(0, K);
    const weights = top.map(({ d2 }) => 1 / Math.max(d2, eps));
    const sumW = weights.reduce((acc, w) => acc + w, 0);

    const traj: [number, number][] = [];
    for (let step = 0; step <= numSteps; step++) {
      let dx = 0;
      let dy = 0;
      for (let k = 0; k < top.length; k++) {
        const sIdx = top[k].idx;
        const w = weights[k];
        const startX = allTrajectories[sIdx][0][0];
        const startY = allTrajectories[sIdx][0][1];
        const stepIdx = Math.min(step, allTrajectories[sIdx].length - 1);
        const cx = allTrajectories[sIdx][stepIdx][0];
        const cy = allTrajectories[sIdx][stepIdx][1];
        dx += w * (cx - startX);
        dy += w * (cy - startY);
      }
      dx /= sumW;
      dy /= sumW;
      traj.push([queryStart[0] + dx, queryStart[1] + dy]);
    }
    return traj;
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function runInitialComputation() {
    if (!canvas || !data) return;
    const { allTrajectories } = data;
    if (!allTrajectories || allTrajectories.length === 0) return;

    const numSteps = data.config.numSteps;

    // Source = trajectory starting points (these have known trajectories)
    const sourceStarts: [number, number][] = allTrajectories.map(
      (traj) => [traj[0][0], traj[0][1]] as [number, number]
    );
    // Target = ground truth smiley (for visual matching with FlowInvertibility)
    const targetSamples = data.targetDistribution as [number, number][];

    // Scales — same approach as ProbabilityPathIntro
    scales = createSourceTargetScales(sourceStarts, targetSamples, {
      width,
      height,
      marginWidth,
      marginHeight,
      sourceCenterX,
      targetCenterX,
      yShiftFactor,
      distributionScaleFactor,
    });

    // Source / target scatter pixel coords — anchored at t=0 (source) and t=1
    // (target), using the same getPixelX projection the contour code used.
    sourcePixelCoords = sourceStarts.map(([x, y]) => [
      getPixelX(x, scales!.sourceMeanX, 0),
      scales!.yScale(y),
    ]);
    targetPixelCoords = targetSamples.map(([x, y]) => [
      getPixelX(x, scales!.targetMeanX, 1),
      scales!.yScale(y),
    ]);

    // Per-step intermediate contours and mean X
    intermediateContourFrames = [];
    perStepMeanX = [];
    for (let step = 0; step <= numSteps; step++) {
      const samples = allTrajectories.map((traj) => traj[Math.min(step, traj.length - 1)]);
      intermediateContourFrames.push(
        computeContours(samples, {
          bandwidth: contourBandwidth,
          thresholds: contourThresholds,
        })
      );
      perStepMeanX.push(samples.reduce((s, p) => s + p[0], 0) / samples.length);
    }

    // Build initial uniform grid in source-coordinate space, then evolve by IDW
    const N = gridResolution;
    gridFrames = [];
    for (let step = 0; step <= numSteps; step++) gridFrames.push([]);

    for (let i = 0; i < N; i++) {
      // Allocate row at each step
      for (let step = 0; step <= numSteps; step++) {
        gridFrames[step].push([]);
      }
      const x = gridXMin + (i / (N - 1)) * (gridXMax - gridXMin);
      for (let j = 0; j < N; j++) {
        const y = gridYMin + (j / (N - 1)) * (gridYMax - gridYMin);
        const traj = computeIdwTrajectory(
          [x, y],
          sourceStarts,
          allTrajectories,
          numSteps,
          idwNeighbors
        );
        for (let step = 0; step <= numSteps; step++) {
          gridFrames[step][i].push(traj[step]);
        }
      }
    }
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  function setupTimeline() {
    if (!scales || !data) return;
    const numSteps = data.config.numSteps;

    timeline = new Timeline<AnimationState>();
    timeline.initialState = {
      time: 0,
      frame: 0,
      centerX: scales.sourceCenterPixelX,
    };

    timeline.add(
      {
        name: "FlowAnimation",
        reduce(t: number) {
          return {
            time: t,
            frame: Math.min(Math.round(t * numSteps), numSteps),
            centerX:
              scales!.sourceCenterPixelX +
              t * (scales!.targetCenterPixelX - scales!.sourceCenterPixelX),
          };
        },
      },
      { start: 0, end: 1 }
    );

    timeline.duration = animationDuration / 1000;
    timeline.setEndPause(animationPauseTime / 1000);
    timeline.looping = true;

    timeline.onTick((_, state) => draw(state));
  }

  function startAnimation() {
    if (!timeline) return;
    timeline.play();
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function draw(state: AnimationState) {
    if (!ctx || !scales || gridFrames.length === 0) return;
    ctx.clearRect(0, 0, width, height);

    const { time: t, frame, centerX } = state;

    // --- Static background scatter (source + target) ---
    if (sourcePixelCoords.length) {
      drawScatterPlot(ctx, sourcePixelCoords, scatterRadius, scatterColor, scatterOpacity);
    }
    if (targetPixelCoords.length) {
      drawScatterPlot(ctx, targetPixelCoords, scatterRadius, scatterColor, scatterOpacity);
    }

    // --- Intermediate dynamic contour (orange) ---
    const interFrame = intermediateContourFrames[frame];
    const stepMeanX = perStepMeanX[frame] ?? scales.sourceMeanX;
    if (interFrame) {
      plotContours(ctx, interFrame, {
        xScale: (dataX) => getPixelX(dataX, stepMeanX, t),
        yScale: (dataY) => scales!.yScale(dataY),
        fillColor: intermediateContourColor,
        opacity: intermediateContourOpacity,
        minThreshold: contourMinThreshold,
        fill: true,
        stroke: false,
      });
    }

    // --- Warped grid (thick dark gray, translates with t) ---
    const currentGrid = gridFrames[frame] ?? gridFrames[0];
    const currentGridPx = currentGrid.map((row) =>
      row.map(([x, y]) => [getPixelX(x, stepMeanX, t), scales!.yScale(y)])
    );
    plotMeshGrid(ctx, currentGridPx, {
      color: warpedGridColor,
      opacity: warpedGridOpacity,
      strokeWidth: warpedGridWidth,
    });

    // --- p_0 / p_t / p_1 labels ---
    const yDomain = scales.yScale.domain();
    const yTop = yDomain[0];
    const mathLabelY = scales.yScale(yTop) + latexFontSize;

    drawMathjax(
      ctx,
      "p_0",
      scales.sourceCenterPixelX,
      mathLabelY,
      latexFontSize,
      0,
      latexLabelOffsetY,
      { color: scatterColor }
    );
    drawMathjax(
      ctx,
      "p_1",
      scales.targetCenterPixelX,
      mathLabelY,
      latexFontSize,
      0,
      latexLabelOffsetY,
      { color: scatterColor }
    );
    if (t >= 0.1 && t <= 0.9) {
      drawMathjax(
        ctx,
        "p_t",
        centerX,
        mathLabelY,
        latexFontSize,
        0,
        latexLabelOffsetY,
        { color: intermediateContourColor }
      );
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

  $: if (
    !isInitialized &&
    canvas &&
    data &&
    data.allTrajectories?.length > 0
  ) {
    isInitialized = true;
    runInitialComputation();
    setupTimeline();
    if (timeline) {
      draw(timeline.initialState);
      if (playingByDefault) startAnimation();
    }
  }

  $: if (figureIsActive !== undefined && isInitialized) {
    handleVisibilityChange($figureIsActive);
  }
</script>

<Figure {caption} backgroundVisible={false} bind:isActive={figureIsActive}>
  {#snippet children()}
    <div style="display: flex; flex-direction: column; align-items: center; width: 100%;">
      <div style="width: 100%; max-width: {width}px;">
        <canvas
          bind:this={canvas}
          use:canvas2d.bindCanvas
          style="width: 100%; height: auto; aspect-ratio: {width}/{height};"
        ></canvas>
      </div>
      <TimeSlider {timeline} color={intermediateContourColor} />
    </div>
  {/snippet}
</Figure>
