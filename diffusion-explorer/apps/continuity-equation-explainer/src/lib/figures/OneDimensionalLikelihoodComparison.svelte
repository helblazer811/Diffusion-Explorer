<!--
  OneDimensionalLikelihoodComparison

  A 1D flow model visualization that animates trajectories from a 3-mode target distribution
  back to a Gaussian source, with an SVG sidecar that draws likelihood bars (one per highlighted
  trajectory) once the trajectories reach the source side. Drives both the trajectory animation
  and the bar reveal off a single Tempus timeline.
-->
<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { Writable } from "svelte/store";
  import * as d3 from "d3";
  import { Player,
    Figure,
    TimeSlider,
    Timeline,
    PathlineAnimation,
    useVisibilityHandler,
    useCanvas2D,
    drawHeatmap,
    precomputeHeatmap,
    selectTrajectoriesWithMask,
    type PathlineAnimationState,
    type PrecomputedHeatmap,
  } from "@diffusion-explorer/ui";
  import { FlowModelClient } from "@diffusion-explorer/diffusion";
  import { base } from "$app/paths";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  export let trajectories: number[][][] = []; // [step][sample][dim=1]
  export let width = 1100;
  export let height = 250;
  export let numDisplayedPathlines = 1;
  export let heatmapResolution = 500;
  export let animationDuration = 10; // Total cycle duration in seconds
  export let colorScale: (t: number) => string = d3.interpolateBlues;
  export let pathlineColor = "#f17720";
  export let pathlineStrokeWidth = 3;
  export let pathlinePointRadius = 4;
  export let interactive = true;
  /** When true, render the target distribution on the left and source on the right (flipped horizontally). */
  export let flipTimeAxis = false;
  /** Show or hide the bottom TimeSlider control. */
  export let showTimeSlider = true;
  /** Seconds to hold the final frame before looping. */
  export let endPauseDurationSeconds = 1;
  /** Duration of the bar/callout reveal animation, in seconds. Plays during the end pause. */
  export let barRevealDurationSeconds = 1.4;
  /** When true, after the trajectories reach the right edge, draw a likelihood bar for each one with an animated callout. */
  export let showLikelihoodBars = false;
  /** Width (px) of the SVG sidecar that hosts the likelihood bars + callout, sitting to the right of the canvas. */
  export let likelihoodPanelWidth = 170;
  /** Pixel length for the longer of the two bars (the smaller is scaled proportionally). */
  export let likelihoodBarMaxLength = 70;
  /** Color for likelihood bars and callout lines. */
  export let likelihoodAccentColor = "#f17720";
  /**
   * Optional: target-side y-values to spawn highlighted trajectories from. Each value triggers a
   * reverse model integration from (y, t=1) → (?, t=0). Requires the FlowModelClient (so the
   * model worker is loaded even when interactive={false}). When omitted, the figure picks
   * highlighted trajectories from the cached data.
   */
  export let highlightedTargetYs: number[] | null = null;

  // Interactivity settings
  export let maxUserTrajectories = 5;
  export let numSamplingSteps = 300; // Match pre-cached trajectory steps
  export let workerUrl = "/one_dimensional_flow/workers/flow_model.worker.js";
  export let modelPath = "/one_dimensional_flow/models/flow_model.json";

  // Optional caption slot (rendered inside Figure's caption)
  export let children: import("svelte").Snippet | undefined = undefined;
  $: caption = children;

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  // Background canvas (static heatmap)
  let bgCanvasElement: HTMLCanvasElement | null = null;
  const bgCanvas2d = useCanvas2D(width, height);

  // Foreground canvas (animated pathlines)
  let fgCanvasElement: HTMLCanvasElement | null = null;
  const fgCanvas2d = useCanvas2D(width, height);

  let player: Player<AnimationState> | null = null;
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

  type LikelihoodAnnotation = {
    xSource: number; // domain x at the source endpoint (right edge in flipped mode)
    xTarget: number; // domain x at the target endpoint (left edge in flipped mode)
    logPSource: number;
    logPTarget: number; // exact log-likelihood under the model at x_target
    probTarget: number; // exp(logPTarget) for bar lengths
  };
  let likelihoodAnnotations: LikelihoodAnnotation[] = [];
  /** Reactive 0→1 reveal progress for the SVG bars + callout. Updated on every Tempus tick. */
  let revealProgress = 0;
  /** Wall-clock timestamp (ms) at which the timeline first entered its end-pause this cycle.
   * Reset on loop restart so the bars re-emerge once per loop. */
  let revealStartWallClock: number | null = null;

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

  // Precomputed heatmap density (for GPU acceleration)
  let precomputedHeatmap: PrecomputedHeatmap | null = null;

  /**
   * Reverse-integrate the flow from each target y-value: starting at (y, t=1) and walking the
   * model backward to t=0. Returns pathlines in display order (display_t=0 corresponds to the
   * target side, display_t=1 to the source side).
   */
  async function sampleHighlightedTrajectoriesFromModel(
    targetYs: number[]
  ): Promise<number[][][]> {
    if (!flowModelClient) return [];

    const promises = targetYs.map((y) => {
      // Pre-fill with the initial point at display_t=0 (target).
      const points: [number, number][] = [[0, y]];
      const result = flowModelClient!.sampleFromInitialPoints(
        [[y]],
        numSamplingSteps,
        { t_start: 1, t_end: 0 },
        (step: number, x_t: number[][]) => {
          // step counts 0 → numSamplingSteps-1 as we walk original t: 1 → 0,
          // i.e. display_t: 0 → 1.
          const displayT = (step + 1) / numSamplingSteps;
          points.push([displayT, x_t[0][0]]);
        }
      );
      return result.promise.then(() => points as number[][]);
    });

    return Promise.all(promises);
  }

  async function runInitialComputation() {
    const bgCtx = bgCanvas2d.ctx;
    if (!bgCtx || trajectories.length === 0) return;

    // When flipping the time axis, reverse the temporal order so target→source reads left-to-right.
    // Use a local variable so we don't mutate the prop.
    const orientedTrajectories = flipTimeAxis ? [...trajectories].reverse() : trajectories;

    const numSteps = orientedTrajectories.length;
    const numSamples = orientedTrajectories[0].length;
    const valueDomain = computeValueDomain(orientedTrajectories);

    // Create scales
    xScale = d3.scaleLinear().domain([0, 1]).range([margin.left, margin.left + plotWidth]);
    yScale = d3.scaleLinear().domain(valueDomain).range([margin.top + plotHeight, margin.top]);

    // Draw static heatmap on background canvas (GPU-accelerated)
    const heatmapPoints = toHeatmapPoints(orientedTrajectories);
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

    // Prepare pathlines in pixel coordinates
    const allPathlines = transposeToPathlines(orientedTrajectories, numSteps, numSamples);

    // Choose which pathlines to highlight: either spawn them via the model from specific
    // target y-values, or pick the closest cached trajectories.
    let selectedPathlines: number[][][];
    if (
      highlightedTargetYs &&
      highlightedTargetYs.length > 0 &&
      flowModelClient
    ) {
      selectedPathlines = await sampleHighlightedTrajectoriesFromModel(highlightedTargetYs);
    } else {
      selectedPathlines = selectTrajectoriesWithMask(allPathlines, {
        domainMin: [0, valueDomain[0]],
        domainMax: [1, valueDomain[1]],
        density: 1.0,
        maxCount: numDisplayedPathlines,
      });
    }

    const pixelPathlines = selectedPathlines.map((pathline) =>
      pathline.map(([time, value]) => [xScale!(time), yScale(value)])
    );

    // Create pathline animation
    pathlineAnimation = PathlineAnimation.fromTrajectories<AnimationState>(pixelPathlines, {
      style: {
        strokeWidth: pathlineStrokeWidth,
        color: pathlineColor,
        opacity: 1.0,
        pointRadius: pathlinePointRadius,
      },
    });

    numSegments = pathlineAnimation.data.numSegments;

    // Compute exact likelihood (under the model) for each highlighted trajectory.
    // For 1D flows, log p_target(x_target) = log p_source(x_source) - log|dψ_target/dx_source|.
    // Estimate the Jacobian by finite-differencing nearest-neighbor (x_source, x_target) pairs
    // drawn from all cached trajectories.
    if (showLikelihoodBars && selectedPathlines.length > 0) {
      // Build a list of (x_source, x_target) pairs from every cached trajectory,
      // sorted by x_source for fast nearest-neighbor lookup.
      const allEndpoints = allPathlines
        .map((p) => ({
          xSource: p[p.length - 1][1],
          xTarget: p[0][1],
        }))
        .sort((a, b) => a.xSource - b.xSource);
      const xSourcesSorted = allEndpoints.map((e) => e.xSource);

      likelihoodAnnotations = selectedPathlines.map((pathline) => {
        const xTarget = pathline[0][1];
        const xSource = pathline[pathline.length - 1][1];

        // Nearest neighbor in source space (excluding self)
        let bestIdx = -1;
        let bestDist = Infinity;
        for (let i = 0; i < allEndpoints.length; i++) {
          const dxs = allEndpoints[i].xSource - xSource;
          if (Math.abs(dxs) < 1e-9) continue; // skip self / duplicates
          const dist = Math.abs(dxs);
          if (dist < bestDist) {
            bestDist = dist;
            bestIdx = i;
          }
        }

        // Standard Gaussian source PDF (the 1D source is N(0,1))
        const logPSource = -0.5 * Math.log(2 * Math.PI) - 0.5 * xSource * xSource;

        let logPTarget = logPSource;
        if (bestIdx >= 0) {
          const dxs = allEndpoints[bestIdx].xSource - xSource;
          const dxt = allEndpoints[bestIdx].xTarget - xTarget;
          const J = dxt / dxs; // dψ_target / dx_source ≈ Δx_target / Δx_source
          if (Number.isFinite(J) && J !== 0) {
            logPTarget = logPSource - Math.log(Math.abs(J));
          }
        }

        return {
          xSource,
          xTarget,
          logPSource,
          logPTarget,
          probTarget: Math.exp(logPTarget),
        };
      });

      void xSourcesSorted; // (kept above for clarity; nearest-neighbor loop above is used directly)
    }
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  async function setupTimeline() {
    if (!pathlineAnimation || !fgCanvasElement) return;

    // Initialize animation with the foreground canvas
    await pathlineAnimation.init(fgCanvasElement);

    const tl = Timeline.from<AnimationState>({
      duration: animationDuration,
      initialState: { segmentIndex: 0 },
      clips: [
        { clip: pathlineAnimation.clip, ...{ start: 0, end: 1 } },
      ],
    });
    player = new Player(tl, { looping: true, endPause: endPauseDurationSeconds });
    player.onTick((_, state) => draw(state));


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
      pathlineAnimation.draw(state, {
        opacity: hasUserTrajectories ? dimmedOpacity : normalOpacity,
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

    // --- Drive the reactive reveal progress for the SVG bars + callout ---
    // The reveal starts only AFTER the trajectories have fully reached the destination
    // (i.e., once the timeline enters its end pause). We use real wall-clock time during the
    // pause rather than the timeline's normalized time, which is held at 1 throughout.
    if (showLikelihoodBars) {
      const isPaused = currentTime >= 1;
      if (isPaused) {
        if (revealStartWallClock === null) revealStartWallClock = performance.now();
        const elapsed = (performance.now() - revealStartWallClock) / 1000;
        revealProgress = Math.max(0, Math.min(1, elapsed / barRevealDurationSeconds));
      } else {
        // Not at the end yet — keep bars hidden and reset the wall-clock anchor for next loop.
        revealStartWallClock = null;
        revealProgress = 0;
      }
    }
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

  const { handleVisibilityChange } = useVisibilityHandler(() => player);

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

  async function trySetup() {
    if (setupComplete) return;

    const bgCtx = bgCanvas2d.ctx;
    const fgCtx = fgCanvas2d.ctx;
    if (!bgCtx || !fgCtx || trajectories.length === 0) return;

    setupComplete = true;

    await runInitialComputation();
    await setupTimeline();

    if (player) {
      draw(player!.timeline.initialState);
      player.play();
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

    // Initialize FlowModelClient when interactive OR when we need to spawn highlighted trajectories from specific target y-values
    const needsModel = interactive || (highlightedTargetYs && highlightedTargetYs.length > 0);
    if (needsModel) flowModelClient = new FlowModelClient(
      `${base}${workerUrl}`,
      `${base}${modelPath}`,
      "Flow Matching",
      { dim: 1, hidden: 64 }
    );

    trySetup();
  });

  onDestroy(() => {
    player?.dispose();
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

<Figure {caption} bind:isActive={figureIsActive} backgroundVisible={false}>
  {@const groupWidth = width + (showLikelihoodBars ? 8 + likelihoodPanelWidth : 0)}
  <div class="plot-stack" style="max-width: {groupWidth}px;">
    <div class="canvas-row">
      <div class="canvas-column" style="width: {width}px;">
        <div class="horizontal-labels">
          <span class="end-label">{flipTimeAxis ? "Target" : "Source"}</span>
          <span class="end-label">{flipTimeAxis ? "Source" : "Target"}</span>
        </div>
        <div class="canvas-stack" style="width: {width}px; height: {height}px;">
          <canvas class="bg-canvas" bind:this={bgCanvasElement}></canvas>
          <canvas
            class="fg-canvas"
            bind:this={fgCanvasElement}
            on:click={interactive ? handleCanvasClick : undefined}
            style="cursor: {interactive ? 'pointer' : 'default'};"
          ></canvas>
        </div>
      </div>
      {#if showLikelihoodBars && likelihoodAnnotations.length > 0 && yScale}
        {@const ease = (t: number) => 1 - Math.pow(1 - t, 3)}
        {@const eased = ease(revealProgress)}
        {@const maxProb = Math.max(...likelihoodAnnotations.map((a) => a.probTarget), 1e-12)}
        {@const barTipsX = likelihoodAnnotations.map(
          (a) => 14 + (a.probTarget / maxProb) * likelihoodBarMaxLength * eased
        )}
        {@const barYs = likelihoodAnnotations.map((a) => yScale(a.xSource))}
        <svg
          class="likelihood-svg"
          width={likelihoodPanelWidth}
          height={height}
          viewBox="0 0 {likelihoodPanelWidth} {height}"
        >
          <!-- bars -->
          {#each likelihoodAnnotations as a, i}
            <line
              x1={6}
              y1={barYs[i]}
              x2={barTipsX[i]}
              y2={barYs[i]}
              stroke={likelihoodAccentColor}
              stroke-width="9"
              stroke-linecap="round"
              opacity={eased}
            />
            <text
              x={barTipsX[i] + 6}
              y={barYs[i]}
              fill={likelihoodAccentColor}
              font-family="'Helvetica Neue', Helvetica, Arial, sans-serif"
              font-size="13"
              dominant-baseline="middle"
              opacity={eased}
            >
              p ≈ {a.probTarget.toFixed(3)}
            </text>
          {/each}

        </svg>
      {/if}
    </div>
  </div>
  {#if showTimeSlider}
    <div class="slider-container">
      <TimeSlider timeline={player} color={pathlineColor} />
    </div>
  {/if}
</Figure>

<style>
  :global(.figure-content) {
    flex-direction: column;
  }

  .plot-stack {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    padding: 24px 0 0 0;
    box-sizing: border-box;
    margin: 0 auto;
  }

  .canvas-row {
    display: flex;
    flex-direction: row;
    align-items: stretch;
    justify-content: center;
    gap: 8px;
  }


  .canvas-column {
    display: flex;
    flex-direction: column;
  }

  .horizontal-labels {
    display: flex;
    justify-content: space-between;
    width: 100%;
    margin-bottom: 8px;
  }

  .end-label {
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    font-weight: 300;
    font-size: 22px;
    color: #555;
    white-space: nowrap;
  }

  .likelihood-svg {
    flex-shrink: 0;
    align-self: flex-end; /* align bottom of svg with bottom of canvas, since labels add height to canvas-column */
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
