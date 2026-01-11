<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { Writable } from "svelte/store";
  import * as d3 from "d3";
  import {
    Figure,
    TimeSlider,
    Timeline,
    PathlineAnimation,
    useVisibilityHandler,
    useCanvas2D,
    drawHeatmap,
    selectTrajectoriesWithMask,
    type PathlineAnimationState,
  } from "@diffusion-explorer/ui";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  export let trajectories: number[][][] = []; // [step][sample][dim=1]
  export let width = 900;
  export let height = 250;
  export let numDisplayedPathlines = 30;
  export let heatmapResolution = 300;
  export let animationDuration = 5; // Total cycle duration in seconds
  export let colorScale: (t: number) => string = d3.interpolatePlasma;

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  // Background canvas (static heatmap)
  let bgCanvasElement: HTMLCanvasElement | null = null;
  const bgCanvas2d = useCanvas2D(width, height);

  // Foreground canvas (animated pathlines)
  let fgCanvasElement: HTMLCanvasElement | null = null;
  const fgCanvas2d = useCanvas2D(width, height);

  let timeline: Timeline<AnimationState> | null = null;
  let pathlineAnimation: PathlineAnimation<AnimationState> | null = null;
  let figureIsActive: Writable<boolean> | undefined;
  let setupComplete = false;
  let unsubscribeVisibility: (() => void) | null = null;

  // Layout constants
  const margin = { top: 0, right: 0, bottom: 0, left: 0 };
  $: plotWidth = width - margin.left - margin.right;
  $: plotHeight = height - margin.top - margin.bottom;

  // Scales and animation data (set during setup)
  let xScale: d3.ScaleLinear<number, number> | null = null;
  let numSegments = 0;

  type AnimationState = PathlineAnimationState;

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  function computeValueDomain(trajectories: number[][][]): [number, number] {
    let min = Infinity;
    let max = -Infinity;
    for (const step of trajectories) {
      for (const sample of step) {
        const val = sample[0];
        if (val < min) min = val;
        if (val > max) max = val;
      }
    }
    const padding = (max - min) * 0.05;
    return [min - padding, max + padding];
  }

  function transposeToPathlines(
    trajectories: number[][][],
    numSteps: number,
    numSamples: number
  ): number[][][] {
    const pathlines: number[][][] = [];
    for (let s = 0; s < numSamples; s++) {
      const pathline: number[][] = [];
      for (let t = 0; t < numSteps; t++) {
        const time = t / (numSteps - 1);
        const value = trajectories[t][s][0];
        pathline.push([time, value]);
      }
      pathlines.push(pathline);
    }
    return pathlines;
  }

  
  function toHeatmapPoints(trajectories: number[][][]): number[][] {
    const points: number[][] = [];
    const numSteps = trajectories.length;
    for (let t = 0; t < numSteps; t++) {
      const time = t / (numSteps - 1);
      for (const sample of trajectories[t]) {
        points.push([time, sample[0]]);
      }
    }
    return points;
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function runInitialComputation() {
    const bgCtx = bgCanvas2d.ctx;
    if (!bgCtx || trajectories.length === 0) return;

    const numSteps = trajectories.length;
    const numSamples = trajectories[0].length;
    const valueDomain = computeValueDomain(trajectories);

    // Create scales
    xScale = d3.scaleLinear().domain([0, 1]).range([margin.left, margin.left + plotWidth]);
    const yScale = d3.scaleLinear().domain(valueDomain).range([margin.top + plotHeight, margin.top]);

    // Draw static heatmap on background canvas
    const heatmapPoints = toHeatmapPoints(trajectories);
    drawHeatmap(bgCtx, heatmapPoints, {
      resolution: heatmapResolution,
      bandwidth: 5,
      domain: [0, 1, valueDomain[0], valueDomain[1]],
      colorScale,
      opacity: 0.9,
      bounds: { x: margin.left, y: margin.top, width: plotWidth, height: plotHeight },
    });

    // Prepare pathlines in pixel coordinates
    const allPathlines = transposeToPathlines(trajectories, numSteps, numSamples);
    const selectedPathlines = selectTrajectoriesWithMask(allPathlines, {
      domainMin: [0, valueDomain[0]],
      domainMax: [1, valueDomain[1]],
      density: 1.0,
      maxCount: numDisplayedPathlines,
    });
    const pixelPathlines = selectedPathlines.map((pathline) =>
      pathline.map(([time, value]) => [xScale!(time), yScale(value)])
    );

    // Create pathline animation
    pathlineAnimation = PathlineAnimation.fromTrajectories<AnimationState>(pixelPathlines, {
      style: {
        strokeWidth: 2.5,
        color: "#ffffff",
        progressOpacity: 1.0,
        pointRadius: 3,
      },
    });

    numSegments = pathlineAnimation.data.numSegments;
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  function setupTimeline() {
    if (!pathlineAnimation) return;

    timeline = new Timeline<AnimationState>();
    timeline.initialState = { segmentIndex: 0 };
    timeline.looping = true;
    timeline.duration = animationDuration;

    timeline.add(pathlineAnimation.clip, { start: 0, end: 1 });
    timeline.setEndPause(1); // Pause 1 second at end before looping

    timeline.onTick((_, state) => draw(state));
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function draw(state: AnimationState) {
    const ctx = fgCanvas2d.ctx;
    if (!ctx || !xScale) return;
    ctx.clearRect(0, 0, width, height);

    // --- Dynamic Foreground ---
    // Draw pathlines
    if (pathlineAnimation) {
      pathlineAnimation.draw(ctx, state);
    }

    // Draw time indicator line (dots are at segmentIndex + 1, so add 1)
    const time = numSegments > 0 ? (state.segmentIndex + 1) / numSegments : 0;
    const timeX = xScale(time);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(timeX, margin.top);
    ctx.lineTo(timeX, margin.top + plotHeight);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ----------------------------------------------------------------
  // Event Handlers
  // ----------------------------------------------------------------

  const { handleVisibilityChange } = useVisibilityHandler(() => timeline);

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  function trySetup() {
    if (setupComplete) return;

    const bgCtx = bgCanvas2d.ctx;
    const fgCtx = fgCanvas2d.ctx;
    if (!bgCtx || !fgCtx || trajectories.length === 0) return;

    setupComplete = true;

    runInitialComputation();
    setupTimeline();

    if (timeline) {
      draw(timeline.initialState);
      timeline.play();
    }
  }

  onMount(() => {
    if (bgCanvasElement) {
      bgCanvas2d.init(bgCanvasElement);
      bgCanvas2d.resize(width, height);
    }
    if (fgCanvasElement) {
      fgCanvas2d.init(fgCanvasElement);
      fgCanvas2d.resize(width, height);
    }
    trySetup();
  });

  onDestroy(() => {
    timeline?.dispose();
    unsubscribeVisibility?.();
  });

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------
  $: if (trajectories.length > 0 && !setupComplete) {
    trySetup();
  }

  $: if (figureIsActive && !unsubscribeVisibility) {
    unsubscribeVisibility = figureIsActive.subscribe((active: boolean) => {
      handleVisibilityChange(active);
    });
  }
</script>

<Figure bind:isActive={figureIsActive} backgroundVisible={false}>
  <div class="plot-container">
    <div class="vertical-label left-label">Source Distribution</div>
    <div class="canvas-stack" style="width: {width}px; height: {height}px;">
      <canvas class="bg-canvas" bind:this={bgCanvasElement}></canvas>
      <canvas class="fg-canvas" bind:this={fgCanvasElement}></canvas>
    </div>
    <div class="vertical-label right-label">Target Distribution</div>
  </div>
  <div class="slider-container">
    <TimeSlider {timeline} color="#6A3779" />
  </div>
</Figure>

<style>
  :global(.figure-content) {
    flex-direction: column;
  }

  .plot-container {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    width: 100%;
    padding: 24px 24px 0 24px;
    box-sizing: border-box;
  }

  .vertical-label {
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    font-weight: 300;
    font-size: 24px;
    color: #555;
    writing-mode: vertical-rl;
    text-orientation: mixed;
    white-space: nowrap;
  }

  .left-label {
    transform: rotate(180deg);
  }

  .right-label {
    /* Already oriented correctly with vertical-rl */
  }

  .canvas-stack {
    position: relative;
    border-radius: 8px;
    overflow: hidden;
    background: transparent;
  }

  .canvas-stack canvas {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
  }

  .bg-canvas {
    background: transparent;
  }

  .fg-canvas {
    background: transparent;
  }

  .slider-container {
    width: 100%;
    max-width: 900px;
    margin-top: 16px;
    padding-bottom: 24px;
  }
</style>
