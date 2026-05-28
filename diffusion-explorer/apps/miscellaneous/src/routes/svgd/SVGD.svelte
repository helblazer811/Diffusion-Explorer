<script lang="ts">
  import { onDestroy } from "svelte";
  import type { Writable } from "svelte/store";
  import * as d3 from "d3";
  import {
    Figure,
    Player,
    Timeline,
    createPauseClip,
    drawScatterPlot,
    useCanvas2D,
    useVisibilityHandler,
  } from "@diffusion-explorer/ui";
  import {
    computeRectKDE,
    gmmLogProbGrad,
    mulberry32,
    resampleTrajectoriesByArclength,
    ringMixtureLogProbGrad,
    runSVGD,
    sampleGMM,
    sampleRingMixture,
    sampleUniform2D,
    zigzagRings,
    type RingComponent,
    type Vec2,
  } from "./svgd";

  type TargetType = "rings" | "gaussians";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  interface Props {
    canvasWidth?: number;
    canvasHeight?: number;
    numParticles?: number;
    numSteps?: number;
    stepSize?: number;
    /** Which target distribution to use: ring annuli or point Gaussians. */
    targetType?: TargetType;
    /** Number of components in the zig-zag (rings or Gaussians). */
    numRings?: number;
    /** Radius of each ring (the high-density circle). Ignored for `gaussians`. */
    ringRadius?: number;
    /** Radial std of each ring (larger → thicker ring, smaller inner hole). Ignored for `gaussians`. */
    ringSigma?: number;
    /** Std of each point Gaussian. Ignored for `rings`. */
    gaussianStd?: number;
    /** Vertical offset for the zig-zag (components sit at y = ±ringOffsetY). */
    ringOffsetY?: number;
    /** X range over which the component centers are evenly spaced. */
    ringXRange?: [number, number];
    domainRange?: { xMin: number; xMax: number; yMin: number; yMax: number };
    /** Heatmap grid width (cells). Height is derived to match canvas aspect. */
    heatmapResolution?: number;
    /** KDE bandwidth in grid cells. */
    heatmapBandwidth?: number;
    particleColor?: string;
    particleRadius?: number;
    particleOpacity?: number;
    /** Show fading polyline trails behind each particle. */
    showPathlines?: boolean;
    /** Number of resampled steps included in each particle's tail. */
    pathlineLength?: number;
    /** Stroke width of the pathlines, in pixels. */
    pathlineWidth?: number;
    /** Exponent controlling alpha falloff along the tail (1 = linear, higher = sharper). */
    pathlineFalloff?: number;
    animationDuration?: number;
    /** Normalized time at which the initial pause ends and SVGD begins. */
    pauseEnd?: number;
    /** Normalized time at which SVGD ends and the final pause begins. */
    pauseStart?: number;
    seed?: number;
  }

  let {
    canvasWidth = 1440,
    canvasHeight = 810,
    numParticles = 200,
    numSteps = 2000,
    stepSize = 0.03,
    targetType = "gaussians",
    numRings = 6,
    ringRadius = 0.6,
    ringSigma = 0.03,
    gaussianStd = 0.32,
    ringOffsetY = 1.15,
    ringXRange = [-2.6, 2.6],
    // 16:9 domain so x/y data units stay isotropic in the wide canvas
    // (yRange = 4.5 units; xRange = 4.5 · 16/9 = 8.0). Wider than the
    // ring layout so the outer KDE bloom of the leftmost/rightmost rings
    // has visible breathing room from the canvas edges. Initial particles
    // are sampled uniformly over this rectangle.
    domainRange = { xMin: -4.0, xMax: 4.0, yMin: -2.25, yMax: 2.25 },
    heatmapResolution = 960,
    heatmapBandwidth = 12,
    particleColor = "#ffffff",
    particleRadius = 7.5,
    particleOpacity = 0.95,
    showPathlines = false,
    pathlineLength = 80,
    pathlineWidth = 2.5,
    pathlineFalloff = 1.2,
    animationDuration = 10000,
    pauseEnd = 0.06,
    pauseStart = 0.7,
    seed = 42,
  }: Props = $props();

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  let canvas: HTMLCanvasElement | null = $state(null);
  const canvas2d = useCanvas2D(canvasWidth, canvasHeight);
  let ctx = $derived(canvas && canvas2d.ctx);

  let xScale: d3.ScaleLinear<number, number> | undefined;
  let yScale: d3.ScaleLinear<number, number> | undefined;

  // Zig-zag layout, populated in `runInitialComputation`. Only one of these
  // is actually used at a time depending on `targetType`.
  let ringComponents: RingComponent[] = [];
  let gaussianMeans: Vec2[] = [];
  let gaussianWeights: number[] = [];

  // trajectories[step][particle][2]
  let trajectories: number[][][] = [];
  // Pre-rendered heatmap on an offscreen canvas — drawn once, blitted each frame.
  let heatmapCanvas: HTMLCanvasElement | null = null;

  type AnimationState = { time: number; stepIndex: number; alpha: number };

  let player: Player<AnimationState> | null = null;
  let isInitialized = $state(false);

  let figureIsActive: Writable<boolean> | undefined = $state(undefined);
  const { handleVisibilityChange } = useVisibilityHandler(() => player);

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function runInitialComputation(): void {
    const { xMin, xMax, yMin, yMax } = domainRange;
    xScale = d3.scaleLinear().domain([xMin, xMax]).range([0, canvasWidth]);
    // Flip y so increasing data-y maps upward on screen.
    yScale = d3.scaleLinear().domain([yMin, yMax]).range([canvasHeight, 0]);

    // Build the target. Both layouts share the same zig-zag of centers.
    ringComponents = zigzagRings(numRings, ringXRange, ringOffsetY, ringRadius, ringSigma);
    gaussianMeans = ringComponents.map((c) => c.center);
    gaussianWeights = gaussianMeans.map(() => 1 / gaussianMeans.length);

    const logProbGrad =
      targetType === "rings"
        ? (x: number[]) => ringMixtureLogProbGrad(x, ringComponents)
        : (x: number[]) => gmmLogProbGrad(x, gaussianMeans, gaussianWeights, gaussianStd);

    const rng = mulberry32(seed);

    const initialParticles = sampleUniform2D(
      rng,
      [xMin, xMax],
      [yMin, yMax],
      numParticles,
    );

    const rawTrajectories = runSVGD(initialParticles, {
      numSteps,
      stepSize,
      logProbGrad,
    });
    // Reparametrize each particle's path by arclength so playback steps
    // at constant spatial speed — kills the SVGD "huge jump then crawl"
    // pacing and makes convergence look smooth.
    trajectories = resampleTrajectoriesByArclength(rawTrajectories, numSteps);

    heatmapCanvas = buildHeatmapCanvas(rng);
  }

  /**
   * Render the target density to an offscreen canvas. Grid aspect matches
   * the visible canvas aspect so cells are isotropic in pixel space (and,
   * because the data domain is also 16:9, isotropic in data space too).
   */
  function buildHeatmapCanvas(rng: () => number): HTMLCanvasElement {
    const { xMin, xMax, yMin, yMax } = domainRange;
    const gridW = heatmapResolution;
    const gridH = Math.round(gridW * (canvasHeight / canvasWidth));

    const samples =
      targetType === "rings"
        ? sampleRingMixture(rng, ringComponents, 8000)
        : sampleGMM(rng, gaussianMeans, gaussianWeights, gaussianStd, 8000);
    const density = computeRectKDE(
      samples,
      [xMin, xMax, yMin, yMax],
      gridW,
      gridH,
      heatmapBandwidth,
    );

    let max = 0;
    for (let i = 0; i < density.length; i++) if (density[i] > max) max = density[i];
    const invMax = max > 0 ? 1 / max : 0;

    const offscreen = document.createElement("canvas");
    offscreen.width = gridW;
    offscreen.height = gridH;
    const offCtx = offscreen.getContext("2d")!;
    const img = offCtx.createImageData(gridW, gridH);

    for (let gy = 0; gy < gridH; gy++) {
      for (let gx = 0; gx < gridW; gx++) {
        const v = density[gy * gridW + gx] * invMax;
        const c = d3.color(d3.interpolateInferno(v))?.rgb() ?? d3.rgb(0, 0, 0);
        // Flip y for canvas coordinates (grid y increases up, canvas y down).
        const idx = ((gridH - 1 - gy) * gridW + gx) * 4;
        img.data[idx] = c.r;
        img.data[idx + 1] = c.g;
        img.data[idx + 2] = c.b;
        img.data[idx + 3] = 255;
      }
    }
    offCtx.putImageData(img, 0, 0);
    return offscreen;
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  function setupTimeline(): void {
    const segmentClip = {
      name: "SVGDSteps",
      reduce(t: number) {
        const float = t * (numSteps - 1);
        const stepIndex = Math.min(Math.floor(float), numSteps - 2);
        return { time: t, stepIndex, alpha: float - stepIndex };
      },
    };

    const tl = Timeline.from<AnimationState>({
      duration: animationDuration / 1000,
      initialState: { time: 0, stepIndex: 0, alpha: 0 },
      clips: [
        // Hold particles at step 0 for a beat before SVGD starts.
        { clip: createPauseClip<AnimationState>(), start: 0, end: pauseEnd },
        { clip: segmentClip, start: pauseEnd, end: pauseStart },
        // Hold the converged result at the end.
        { clip: createPauseClip<AnimationState>(), start: pauseStart, end: 1 },
      ],
    });

    player = new Player(tl, { looping: true });
    player.onTick((_t, state) => draw(state));
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function draw(state: AnimationState): void {
    if (!ctx || !heatmapCanvas || !xScale || !yScale) return;

    // --- Static background ---
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.drawImage(heatmapCanvas, 0, 0, canvasWidth, canvasHeight);

    // --- Dynamic foreground ---
    const { stepIndex, alpha } = state;
    const a = trajectories[stepIndex];
    const b = trajectories[Math.min(stepIndex + 1, trajectories.length - 1)];
    const numParticles = a.length;

    // Current interpolated pixel position per particle.
    const pixelCoords: number[][] = new Array(numParticles);
    for (let i = 0; i < numParticles; i++) {
      const x = a[i][0] + (b[i][0] - a[i][0]) * alpha;
      const y = a[i][1] + (b[i][1] - a[i][1]) * alpha;
      pixelCoords[i] = [xScale(x), yScale(y)];
    }

    if (showPathlines) drawPathlines(state, pixelCoords);

    drawScatterPlot(ctx, pixelCoords, particleRadius, particleColor, particleOpacity, {
      color: "#9ca3af",
      width: 1.25,
      opacity: 0.6,
    });
  }

  /**
   * Draw a fading tail of `pathlineLength` segments behind each particle.
   * Segment alpha rises from 0 at the oldest segment to particleOpacity
   * at the segment touching the current particle position, falling off
   * as `(i / pathlineLength) ** pathlineFalloff`.
   */
  function drawPathlines(state: AnimationState, pixelCoords: number[][]): void {
    if (!ctx || !xScale || !yScale) return;
    const { stepIndex } = state;
    const start = Math.max(0, stepIndex - pathlineLength);

    ctx.save();
    ctx.lineWidth = pathlineWidth;
    ctx.strokeStyle = particleColor;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (let i = 0; i < pixelCoords.length; i++) {
      // Walk from oldest to (stepIndex - 1), then close with current px.
      for (let s = start; s < stepIndex; s++) {
        const p = trajectories[s][i];
        const q = trajectories[s + 1][i];
        const idxFromHead = stepIndex - s; // 1 = newest segment, larger = older
        const ageFrac = 1 - idxFromHead / pathlineLength;
        if (ageFrac <= 0) continue;
        ctx.globalAlpha = particleOpacity * Math.pow(ageFrac, pathlineFalloff);
        ctx.beginPath();
        ctx.moveTo(xScale(p[0]), yScale(p[1]));
        ctx.lineTo(xScale(q[0]), yScale(q[1]));
        ctx.stroke();
      }
      // Final segment to the current sub-step interpolated position.
      if (stepIndex >= 0 && stepIndex < trajectories.length - 1) {
        const last = trajectories[stepIndex][i];
        ctx.globalAlpha = particleOpacity;
        ctx.beginPath();
        ctx.moveTo(xScale(last[0]), yScale(last[1]));
        ctx.lineTo(pixelCoords[i][0], pixelCoords[i][1]);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ----------------------------------------------------------------
  // Event Handlers
  // ----------------------------------------------------------------

  // (None — figure auto-loops.)

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  onDestroy(() => {
    player?.dispose();
  });

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  $effect(() => {
    if (canvas && ctx && !isInitialized) {
      isInitialized = true;
      runInitialComputation();
      setupTimeline();
      // Render frame 0 immediately so the figure is not blank pre-tick.
      draw({ time: 0, stepIndex: 0, alpha: 0 });
      player?.play();
    }
  });

  $effect(() => {
    if (figureIsActive && isInitialized) {
      const unsubscribe = figureIsActive.subscribe((active: boolean) => {
        handleVisibilityChange(active);
      });
      return unsubscribe;
    }
  });
</script>

<Figure bind:isActive={figureIsActive} backgroundVisible={false}>
  <div class="canvas-wrapper" style="max-width: {canvasWidth}px;">
    <h2 class="svgd-title">Stein Variational Gradient Descent</h2>
    <canvas
      bind:this={canvas}
      use:canvas2d.bindCanvas
      class="svgd-canvas"
    ></canvas>
  </div>
</Figure>

<style>
  .canvas-wrapper {
    /* Break out of the PageContainer's narrow max-width so the canvas can
       use the full viewport width (capped at canvasWidth via inline style). */
    width: 100vw;
    margin-left: calc(50% - 50vw);
    margin-top: 0.75rem;
    margin-bottom: 0.75rem;
    padding: 0.5rem 4rem;
    box-sizing: border-box;
  }

  .svgd-title {
    color: #ffffff;
    font-size: 5.1rem;
    font-weight: 300;
    text-align: center;
    margin: 0 0 1.25rem;
    letter-spacing: 0.01em;
  }

  .svgd-canvas {
    width: 100%;
    height: auto;
    display: block;
    background: #000;
    border-radius: 6px;
  }
</style>
