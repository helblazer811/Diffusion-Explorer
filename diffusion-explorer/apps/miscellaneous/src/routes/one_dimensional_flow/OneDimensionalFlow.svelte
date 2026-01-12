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
  import { FlowModelClient } from "@diffusion-explorer/diffusion";
  import { base } from "$app/paths";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  export let trajectories: number[][][] = []; // [step][sample][dim=1]
  export let width = 1100;
  export let height = 250;
  export let numDisplayedPathlines = 30;
  export let heatmapResolution = 500;
  export let animationDuration = 10; // Total cycle duration in seconds
  export let colorScale: (t: number) => string = d3.interpolatePlasma;

  // Interactivity settings
  export let maxUserTrajectories = 5;
  export let numSamplingSteps = 300; // Match pre-cached trajectory steps
  export let workerUrl = "/one_dimensional_flow/workers/flow_model.worker.js";
  export let modelPath = "/one_dimensional_flow/models/flow_model.json";

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

  // Scales and animation data (set during setup)
  let xScale: d3.ScaleLinear<number, number> | null = null;
  let yScale: d3.ScaleLinear<number, number> | null = null;
  let numSegments = 0;

  // User trajectory state - now tracks bidirectional data
  interface UserTrajectory {
    id: string;                  // Stable identifier for callback lookup
    clickTime: number;           // t_click where user clicked
    backwardPoints: number[][];  // [[pixelX, pixelY], ...] from t_click to 0
    forwardPoints: number[][];   // [[pixelX, pixelY], ...] from t_click to 1
    isComplete: boolean;
    backwardRequestId: string | null;  // Track per-trajectory request
    forwardRequestId: string | null;   // Track per-trajectory request
  }
  let userTrajectories: UserTrajectory[] = [];

  // FlowModelClient for dynamic sampling
  let flowModelClient: FlowModelClient | null = null;

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
    yScale = d3.scaleLinear().domain(valueDomain).range([margin.top + plotHeight, margin.top]);

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
    if (!ctx || !xScale || !yScale) return;
    ctx.clearRect(0, 0, width, height);

    const hasUserTrajectories = userTrajectories.length > 0;

    // Current animation time (0 to 1)
    const currentTime = numSegments > 0 ? (state.segmentIndex + 1) / numSegments : 0;

    // Opacity settings
    const normalOpacity = 1.0;
    const dimmedOpacity = 0.15;

    // --- Draw existing/pre-computed trajectories (dimmed if user has clicked) ---
    if (pathlineAnimation) {
      pathlineAnimation.draw(ctx, state, {
        progressOpacity: hasUserTrajectories ? dimmedOpacity : normalOpacity,
      });
    }

    // --- Draw user trajectories (white, higher opacity) ---
    for (const traj of userTrajectories) {
      if (traj.isComplete) {
        // Once complete, render like a normal trajectory (up to current time)
        // Combine backward and forward into one sorted trajectory
        const fullTrajectory = [...traj.backwardPoints, ...traj.forwardPoints.slice(1)];
        // Filter to only show points up to current timeline time
        const visiblePoints = fullTrajectory.filter((pt) => {
          const ptTime = xScale!.invert(pt[0]);
          return ptTime <= currentTime;
        });
        if (visiblePoints.length >= 2) {
          drawUserTrajectorySegment(ctx, visiblePoints, 1.0);
        }
      } else {
        // Still loading: show backward fully, forward up to current time
        // BACKWARD: Show all streamed points (reveals as fast as possible)
        if (traj.backwardPoints.length >= 2) {
          drawUserTrajectorySegment(ctx, traj.backwardPoints, 1.0, true); // Draw dots at both ends
        }

        // FORWARD: Only show points up to current timeline time
        if (traj.forwardPoints.length >= 2) {
          const visibleForwardPoints = traj.forwardPoints.filter((pt) => {
            const ptTime = xScale!.invert(pt[0]);
            return ptTime <= currentTime;
          });
          if (visibleForwardPoints.length >= 2) {
            drawUserTrajectorySegment(ctx, visibleForwardPoints, 1.0, true); // Draw dots at both ends
          }
        }
      }
    }

    // Draw time indicator line
    const timeX = xScale(currentTime);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(timeX, margin.top);
    ctx.lineTo(timeX, margin.top + plotHeight);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawUserTrajectorySegment(
    ctx: CanvasRenderingContext2D,
    points: number[][],
    opacity: number,
    drawBothEndpoints = false
  ) {
    if (points.length < 2) return;

    ctx.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
    ctx.lineWidth = 3.0;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i][0], points[i][1]);
    }
    ctx.stroke();

    // Draw endpoint(s)
    ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;

    if (drawBothEndpoints) {
      // Draw dot at start
      const firstPt = points[0];
      ctx.beginPath();
      ctx.arc(firstPt[0], firstPt[1], 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw dot at end
    const lastPt = points[points.length - 1];
    ctx.beginPath();
    ctx.arc(lastPt[0], lastPt[1], 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // ----------------------------------------------------------------
  // Event Handlers
  // ----------------------------------------------------------------

  const { handleVisibilityChange } = useVisibilityHandler(() => timeline);

  function cancelAllActiveRequests() {
    // Cancel all in-progress trajectory requests
    for (const traj of userTrajectories) {
      if (traj.backwardRequestId && flowModelClient) {
        flowModelClient.stopRequest(traj.backwardRequestId);
      }
      if (traj.forwardRequestId && flowModelClient) {
        flowModelClient.stopRequest(traj.forwardRequestId);
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

    // Get time and value from click position (allow anywhere)
    const t_click = xScale.invert(clickX);
    const domainY = yScale.invert(clickY);

    // Clamp t_click to valid range (avoid exact 0 or 1)
    const clampedT = Math.max(0.01, Math.min(0.99, t_click));

    // Start bidirectional sampling
    startBidirectionalSampling(clampedT, domainY);
  }

  function startBidirectionalSampling(t_click: number, clickedY: number) {
    if (!flowModelClient || !xScale || !yScale) return;

    // Calculate steps proportional to time distance
    const backwardSteps = Math.max(10, Math.round(numSamplingSteps * t_click));
    const forwardSteps = Math.max(10, Math.round(numSamplingSteps * (1 - t_click)));

    // Generate stable ID for this trajectory
    const trajId = crypto.randomUUID();

    // Initialize new trajectory entry
    const newTraj: UserTrajectory = {
      id: trajId,
      clickTime: t_click,
      backwardPoints: [[xScale(t_click), yScale(clickedY)]],
      forwardPoints: [[xScale(t_click), yScale(clickedY)]],
      isComplete: false,
      backwardRequestId: null,
      forwardRequestId: null,
    };

    // Add to trajectories, cap at max
    userTrajectories = [...userTrajectories, newTraj].slice(-maxUserTrajectories);

    // Helper to find trajectory by ID (stable across array mutations)
    const findTraj = () => userTrajectories.find(t => t.id === trajId);

    // Start BACKWARD sampling (t_click → 0) with streaming
    const backwardResult = flowModelClient.sampleFromInitialPoints(
      [[clickedY]],
      backwardSteps,
      { t_start: t_click, t_end: 0 },
      (step: number, x_t: number[][]) => {
        const traj = findTraj();
        if (!traj || !xScale || !yScale) return;
        const t = t_click - (t_click * (step + 1) / backwardSteps);
        // Prepend to backward points (building from click toward t=0)
        traj.backwardPoints = [[xScale(t), yScale(x_t[0][0])], ...traj.backwardPoints];
        userTrajectories = [...userTrajectories]; // trigger reactivity
      }
    );

    // Store request ID (find by ID since array may have shifted)
    const traj = findTraj();
    if (traj) traj.backwardRequestId = backwardResult.requestId;

    // Start FORWARD sampling (t_click → 1) with streaming
    const forwardResult = flowModelClient.sampleFromInitialPoints(
      [[clickedY]],
      forwardSteps,
      { t_start: t_click, t_end: 1 },
      (step: number, x_t: number[][]) => {
        const traj = findTraj();
        if (!traj || !xScale || !yScale) return;
        const t = t_click + ((1 - t_click) * (step + 1) / forwardSteps);
        // Append to forward points (building from click toward t=1)
        traj.forwardPoints = [...traj.forwardPoints, [xScale(t), yScale(x_t[0][0])]];
        userTrajectories = [...userTrajectories]; // trigger reactivity
      }
    );

    if (traj) traj.forwardRequestId = forwardResult.requestId;
    userTrajectories = [...userTrajectories]; // trigger reactivity for request IDs

    // Mark complete when both finish
    Promise.all([backwardResult.promise, forwardResult.promise])
      .then(() => {
        const traj = findTraj();
        if (traj) {
          traj.isComplete = true;
          traj.backwardRequestId = null;
          traj.forwardRequestId = null;
          userTrajectories = [...userTrajectories];
        }
      })
      .catch((error) => {
        console.error("Bidirectional sampling failed:", error);
        const traj = findTraj();
        if (traj) {
          traj.backwardRequestId = null;
          traj.forwardRequestId = null;
          userTrajectories = [...userTrajectories];
        }
      });
  }

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
  <div class="slider-container">
    <TimeSlider {timeline} color="#3B369F" />
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
