<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { Writable } from "svelte/store";
  import * as d3 from "d3";
  import {
    Figure,
    Timeline,
    useVisibilityHandler,
    useCanvas2D,
    drawHeatmap,
    precomputeHeatmap,
    type PrecomputedHeatmap,
  } from "@diffusion-explorer/ui";
  import { FlowModelClient } from "@diffusion-explorer/diffusion";
  import { base } from "$app/paths";
  import {
    PulsingRegionAnimation,
    type PulsingRegion,
    type PulsingRegionAnimationState,
  } from "./PulsingRegionAnimation";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  export let trajectories: number[][][] = []; // [step][sample][dim=1]
  export let width = 1100;
  export let height = 250;
  export let heatmapResolution = 500;
  export let animationDuration = 10; // Total cycle duration in seconds
  export let colorScale: (t: number) => string = d3.interpolateBlues;

  // Interactivity settings
  export let numSamplingSteps = 300; // Match pre-cached trajectory steps
  export let workerUrl = "/crown_jewel/workers/flow_model.worker.js";
  export let modelPath = "/crown_jewel/models/flow_model.json";

  // Pulsing region settings
  export let clickRadius = 0.15; // Vertical radius in domain units
  export let numClickSamples = 3; // Number of points to sample uniformly
  export let pulseTimeWindow = 0.3; // Time window width (±0.15 around click)
  export let pulseWidthPixels = 100; // Width of each pulse
  export let pulsePauseWidthPixels = 100; // Gap between pulses
  export let maxPulsingRegions = 3; // Maximum concurrent pulsing regions
  export let clickDotRadius = 6; // Radius of the orange dot at click location
  export let pulseColor = "#ff8c00"; // Orange color for pulses and click dot

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
  let figureIsActive: Writable<boolean> | undefined;
  let setupComplete = false;
  let unsubscribeVisibility: (() => void) | null = null;

  // Layout constants
  const margin = { top: 0, right: 0, bottom: 0, left: 0 };

  // Scales (set during setup)
  let xScale: d3.ScaleLinear<number, number> | null = null;
  let yScale: d3.ScaleLinear<number, number> | null = null;

  // Pulsing region state
  interface PulsingRegionState extends PulsingRegion {
    isComplete: boolean;
    backwardRequestId: string | null;
    forwardRequestId: string | null;
  }
  let pulsingRegions: PulsingRegionState[] = [];
  let pulsingAnimations: Map<string, PulsingRegionAnimation<AnimationState>> =
    new Map();
  let clickDotPosition: { x: number; y: number } | null = null;

  // FlowModelClient for dynamic sampling
  let flowModelClient: FlowModelClient | null = null;

  type AnimationState = PulsingRegionAnimationState;

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

  // Precomputed heatmap density (for GPU acceleration)
  let precomputedHeatmap: PrecomputedHeatmap | null = null;

  async function runInitialComputation() {
    const bgCtx = bgCanvas2d.ctx;
    if (!bgCtx || trajectories.length === 0) return;

    const numSteps = trajectories.length;
    const numSamples = trajectories[0].length;
    const valueDomain = computeValueDomain(trajectories);

    // Create scales
    xScale = d3.scaleLinear().domain([0, 1]).range([margin.left, margin.left + plotWidth]);
    yScale = d3.scaleLinear().domain(valueDomain).range([margin.top + plotHeight, margin.top]);

    // Draw static heatmap on background canvas (GPU-accelerated)
    const heatmapPoints = toHeatmapPoints(trajectories);
    const domain: [number, number, number, number] = [0, 1, valueDomain[0], valueDomain[1]];

    // Precompute density on GPU (falls back to CPU if unavailable)
    const startTime = performance.now();
    precomputedHeatmap = await precomputeHeatmap(heatmapPoints, {
      resolution: heatmapResolution,
      bandwidth: 5,
      domain,
    });
    const endTime = performance.now();
    console.log(`Heatmap precomputed on ${precomputedHeatmap.backend} in ${(endTime - startTime).toFixed(1)}ms`);

    // Draw using precomputed density
    drawHeatmap(bgCtx, heatmapPoints, {
      precomputed: precomputedHeatmap,
      colorScale,
      opacity: 0.9,
      bounds: { x: margin.left, y: margin.top, width: plotWidth, height: plotHeight },
    });
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  function setupTimeline() {
    timeline = new Timeline<AnimationState>();
    timeline.initialState = { pulsePhase: 0 };
    timeline.looping = true;
    timeline.duration = animationDuration;

    // Add a clip for the pulse phase (continuous loop)
    timeline.add(
      {
        name: "PulsePhase",
        reduce: (t: number) => ({ pulsePhase: (t * 2) % 1 }), // 2x speed for pulses
      },
      { start: 0, end: 1 }
    );

    timeline.onTick((_, state) => draw(state));
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function draw(state: AnimationState) {
    const ctx = fgCanvas2d.ctx;
    if (!ctx || !xScale || !yScale) return;
    ctx.clearRect(0, 0, width, height);

    // --- Draw pulsing region animations ---
    for (const animation of pulsingAnimations.values()) {
      animation.draw(state);
    }

    // --- Draw orange dot at click location ---
    if (clickDotPosition) {
      ctx.fillStyle = pulseColor;
      ctx.beginPath();
      ctx.arc(clickDotPosition.x, clickDotPosition.y, clickDotRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ----------------------------------------------------------------
  // Event Handlers
  // ----------------------------------------------------------------

  const { handleVisibilityChange } = useVisibilityHandler(() => timeline);

  function cancelAllActiveRequests() {
    // Cancel all in-progress trajectory requests
    for (const region of pulsingRegions) {
      if (region.backwardRequestId && flowModelClient) {
        flowModelClient.stopRequest(region.backwardRequestId);
      }
      if (region.forwardRequestId && flowModelClient) {
        flowModelClient.stopRequest(region.forwardRequestId);
      }
    }
  }

  function handleCanvasClick(event: MouseEvent) {
    if (!flowModelClient || !fgCanvasElement || !xScale || !yScale) return;

    // Get click position in pixel coordinates
    const rect = fgCanvasElement.getBoundingClientRect();
    const scaleX = width / rect.width;
    const scaleY = height / rect.height;
    const clickX = (event.clientX - rect.left) * scaleX;
    const clickY = (event.clientY - rect.top) * scaleY;

    // Get time and value from click position
    const t_click = xScale.invert(clickX);
    const domainY = yScale.invert(clickY);

    // Clamp t_click to valid range (avoid exact 0 or 1)
    const clampedT = Math.max(0.01, Math.min(0.99, t_click));

    // Sample multiple points in vertical radius
    const sampleYValues: number[] = [];
    for (let i = 0; i < numClickSamples; i++) {
      const offset =
        numClickSamples > 1
          ? clickRadius * (2 * i / (numClickSamples - 1) - 1)
          : 0;
      sampleYValues.push(domainY + offset);
    }

    // Start pulsing region sampling
    startPulsingRegionSampling(clampedT, domainY, sampleYValues);
  }

  function startPulsingRegionSampling(
    t_click: number,
    clickY: number,
    sampleYValues: number[]
  ) {
    if (!flowModelClient || !xScale || !yScale) return;
    const ctx = fgCanvas2d.ctx;
    if (!ctx) return;

    // Calculate steps proportional to time distance
    const backwardSteps = Math.max(10, Math.round(numSamplingSteps * t_click));
    const forwardSteps = Math.max(
      10,
      Math.round(numSamplingSteps * (1 - t_click))
    );

    // Generate stable ID for this region
    const regionId = crypto.randomUUID();

    // Initialize trajectories for each sample point
    const backwardTrajectories: number[][][] = sampleYValues.map((y) => [
      [xScale!(t_click), yScale!(y)],
    ]);
    const forwardTrajectories: number[][][] = sampleYValues.map((y) => [
      [xScale!(t_click), yScale!(y)],
    ]);

    // Initialize new region
    const newRegion: PulsingRegionState = {
      id: regionId,
      clickTime: t_click,
      clickY: clickY,
      backwardTrajectories,
      forwardTrajectories,
      isComplete: false,
      backwardRequestId: null,
      forwardRequestId: null,
    };

    // Clear all previous regions and animations (one click overwrites the old one)
    cancelAllActiveRequests();
    for (const anim of pulsingAnimations.values()) {
      anim.destroy();
    }
    pulsingAnimations.clear();
    pulsingRegions = [newRegion];

    // Store click position for drawing orange dot
    clickDotPosition = { x: xScale!(t_click), y: yScale!(clickY) };

    // Helper to find region by ID
    const findRegion = () => pulsingRegions.find((r) => r.id === regionId);

    // Create and initialize the pulsing animation
    const animation = new PulsingRegionAnimation<AnimationState>({
      region: newRegion,
      xScale: xScale!,
      pulseTimeWindow,
      pulseWidthPixels,
      pulsePauseWidthPixels,
      color: pulseColor,
      strokeWidth: 2.5,
      baseOpacity: 0.8,
    });
    animation.init(ctx);
    pulsingAnimations.set(regionId, animation);

    // Prepare initial points for batch sampling
    const initialPoints = sampleYValues.map((y) => [y]);

    // Start BACKWARD sampling (t_click → 0) with streaming
    const backwardResult = flowModelClient.sampleFromInitialPoints(
      initialPoints,
      backwardSteps,
      { t_start: t_click, t_end: 0 },
      (step: number, x_t: number[][]) => {
        const region = findRegion();
        if (!region || !xScale || !yScale) return;
        const t = t_click - (t_click * (step + 1)) / backwardSteps;
        // Prepend to each sample's backward trajectory
        for (let i = 0; i < sampleYValues.length; i++) {
          region.backwardTrajectories[i] = [
            [xScale(t), yScale(x_t[i][0])],
            ...region.backwardTrajectories[i],
          ];
        }
        // Update animation with new data
        const anim = pulsingAnimations.get(regionId);
        if (anim) anim.updateRegion(region);
        pulsingRegions = [...pulsingRegions];
      }
    );

    // Store request ID
    const region = findRegion();
    if (region) region.backwardRequestId = backwardResult.requestId;

    // Start FORWARD sampling (t_click → 1) with streaming
    const forwardResult = flowModelClient.sampleFromInitialPoints(
      initialPoints,
      forwardSteps,
      { t_start: t_click, t_end: 1 },
      (step: number, x_t: number[][]) => {
        const region = findRegion();
        if (!region || !xScale || !yScale) return;
        const t = t_click + ((1 - t_click) * (step + 1)) / forwardSteps;
        // Append to each sample's forward trajectory
        for (let i = 0; i < sampleYValues.length; i++) {
          region.forwardTrajectories[i] = [
            ...region.forwardTrajectories[i],
            [xScale(t), yScale(x_t[i][0])],
          ];
        }
        // Update animation with new data
        const anim = pulsingAnimations.get(regionId);
        if (anim) anim.updateRegion(region);
        pulsingRegions = [...pulsingRegions];
      }
    );

    if (region) region.forwardRequestId = forwardResult.requestId;
    pulsingRegions = [...pulsingRegions];

    // Mark complete when both finish
    Promise.all([backwardResult.promise, forwardResult.promise])
      .then(() => {
        const region = findRegion();
        if (region) {
          region.isComplete = true;
          region.backwardRequestId = null;
          region.forwardRequestId = null;
          pulsingRegions = [...pulsingRegions];
        }
      })
      .catch((error) => {
        console.error("Pulsing region sampling failed:", error);
        const region = findRegion();
        if (region) {
          region.backwardRequestId = null;
          region.forwardRequestId = null;
          pulsingRegions = [...pulsingRegions];
        }
      });
  }

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  async function trySetup() {
    if (setupComplete) return;

    const bgCtx = bgCanvas2d.ctx;
    const fgCtx = fgCanvas2d.ctx;
    if (!bgCtx || !fgCtx || trajectories.length === 0) return;

    setupComplete = true;

    await runInitialComputation();
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

    // Initialize FlowModelClient for user trajectory sampling
    flowModelClient = new FlowModelClient(
      `${base}${workerUrl}`,
      `${base}${modelPath}`,
      "Flow Matching",
      { dim: 1, hidden: 64 }
    );

    trySetup();
  });

  onDestroy(() => {
    timeline?.dispose();
    unsubscribeVisibility?.();
    cancelAllActiveRequests();
    // Clean up pulsing animations
    for (const anim of pulsingAnimations.values()) {
      anim.destroy();
    }
    pulsingAnimations.clear();
  });

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  $: plotWidth = width - margin.left - margin.right;
  $: plotHeight = height - margin.top - margin.bottom;

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
      <canvas
        class="fg-canvas"
        bind:this={fgCanvasElement}
        on:click={handleCanvasClick}
        style="cursor: pointer;"
      ></canvas>
    </div>
    <div class="vertical-label right-label">Target Distribution</div>
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

</style>
