<script lang="ts">
  import { onDestroy } from "svelte";
  import type { Writable } from "svelte/store";
  import * as d3 from "d3";
  import * as tf from "@tensorflow/tfjs";
  import {
    Figure,
    Player,
    Timeline,
    createPauseClip,
    useCanvas2D,
    useVisibilityHandler,
  } from "@diffusion-explorer/ui";
  import {
    computeRectKDE,
    mulberry32,
  } from "../svgd/svgd";
  import {
    makeLemniscateLogProb,
    sampleLemniscate,
    runHMCChain,
    type Vec2,
  } from "./hmc";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  interface Props {
    canvasWidth?: number;
    canvasHeight?: number;
    numProposals?: number;
    leapfrogSteps?: number;
    stepSize?: number;
    domainRange?: { xMin: number; xMax: number; yMin: number; yMax: number };
    heatmapResolution?: number;
    heatmapBandwidth?: number;
    pathlineLength?: number;
    pathlineWidth?: number;
    pathlineFalloff?: number;
    particleColor?: string;
    particleRadius?: number;
    particleOpacity?: number;
    animationDuration?: number;
    seed?: number;
  }

  let {
    canvasWidth = 1440,
    canvasHeight = 810,
    numProposals = 150,
    leapfrogSteps = 25,
    stepSize = 0.12,
    domainRange = { xMin: -2.5, xMax: 2.5, yMin: -1.406, yMax: 1.406 },
    heatmapResolution = 960,
    heatmapBandwidth = 10,
    pathlineLength = 80,
    pathlineWidth = 2.5,
    pathlineFalloff = 1.5,
    particleColor = "#ffffff",
    particleRadius = 9,
    particleOpacity = 0.95,
    animationDuration = 12000,
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

  // HMC trajectory as a flat array of Vec2.
  let trajectory: Vec2[] = [];
  // Pre-rendered heatmap on an offscreen canvas.
  let heatmapCanvas: HTMLCanvasElement | null = null;

  type AnimationState = { time: number; stepIndex: number; alpha: number };

  let player: Player<AnimationState> | null = null;
  let isInitialized = $state(false);

  let figureIsActive: Writable<boolean> | undefined = $state(undefined);
  const { handleVisibilityChange } = useVisibilityHandler(() => player);

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  async function runInitialComputation(): Promise<void> {
    // Ensure TensorFlow.js backend is ready.
    await tf.ready();

    const { xMin, xMax, yMin, yMax } = domainRange;
    xScale = d3.scaleLinear().domain([xMin, xMax]).range([0, canvasWidth]);
    yScale = d3.scaleLinear().domain([yMin, yMax]).range([canvasHeight, 0]);

    const rng = mulberry32(seed);

    // Create the log-probability function for the lemniscate Gaussian.
    const logProbFn = makeLemniscateLogProb();

    // Run HMC starting near the lemniscate.
    const initialPos: Vec2 = [1.5, 0];
    trajectory = runHMCChain(
      initialPos,
      numProposals,
      leapfrogSteps,
      stepSize,
      logProbFn,
      rng,
    );

    // Build heatmap.
    heatmapCanvas = buildHeatmapCanvas(rng);
  }

  /**
   * Render the target density (lemniscate Gaussian) to an offscreen canvas.
   */
  function buildHeatmapCanvas(rng: () => number): HTMLCanvasElement {
    const { xMin, xMax, yMin, yMax } = domainRange;
    const gridW = heatmapResolution;
    const gridH = Math.round(gridW * (canvasHeight / canvasWidth));

    // Sample from the lemniscate Gaussian distribution.
    const samples = sampleLemniscate(rng, 8000);
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
        // Flip y for canvas coordinates.
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
      name: "HMCSteps",
      reduce(t: number) {
        const float = t * (trajectory.length - 1);
        const stepIndex = Math.min(Math.floor(float), trajectory.length - 2);
        return { time: t, stepIndex, alpha: float - stepIndex };
      },
    };

    const tl = Timeline.from<AnimationState>({
      duration: animationDuration / 1000,
      initialState: { time: 0, stepIndex: 0, alpha: 0 },
      clips: [
        { clip: segmentClip, start: 0, end: 1 },
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

    // Interpolate current position.
    const a = trajectory[stepIndex];
    const b = trajectory[Math.min(stepIndex + 1, trajectory.length - 1)];
    const x = a[0] + (b[0] - a[0]) * alpha;
    const y = a[1] + (b[1] - a[1]) * alpha;
    const px = xScale(x);
    const py = yScale(y);

    // Draw pathline trail.
    drawPathline(state, px, py);

    // Draw current particle as a white dot.
    ctx.fillStyle = particleColor;
    ctx.globalAlpha = particleOpacity;
    ctx.beginPath();
    ctx.arc(px, py, particleRadius, 0, 2 * Math.PI);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /**
   * Draw a fading tail of pathlineLength segments behind the particle.
   */
  function drawPathline(state: AnimationState, px: number, py: number): void {
    if (!ctx || !xScale || !yScale) return;
    const { stepIndex } = state;
    const start = Math.max(0, stepIndex - pathlineLength);

    ctx.save();
    ctx.lineWidth = pathlineWidth;
    ctx.strokeStyle = particleColor;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Walk from oldest to current position.
    for (let s = start; s < stepIndex; s++) {
      const p = trajectory[s];
      const q = trajectory[s + 1];
      const idxFromHead = stepIndex - s;
      const ageFrac = 1 - idxFromHead / pathlineLength;
      if (ageFrac <= 0) continue;
      ctx.globalAlpha = particleOpacity * Math.pow(ageFrac, pathlineFalloff);
      ctx.beginPath();
      ctx.moveTo(xScale(p[0]), yScale(p[1]));
      ctx.lineTo(xScale(q[0]), yScale(q[1]));
      ctx.stroke();
    }

    // Final segment to current position.
    if (stepIndex >= 0 && stepIndex < trajectory.length - 1) {
      const last = trajectory[stepIndex];
      ctx.globalAlpha = particleOpacity;
      ctx.beginPath();
      ctx.moveTo(xScale(last[0]), yScale(last[1]));
      ctx.lineTo(px, py);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }

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
      (async () => {
        await runInitialComputation();
        setupTimeline();
        // Render frame 0 immediately.
        draw({ time: 0, stepIndex: 0, alpha: 0 });
        player?.play();
      })();
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
    <h2 class="hmc-title">Hamiltonian Monte Carlo</h2>
    <canvas
      bind:this={canvas}
      use:canvas2d.bindCanvas
      class="hmc-canvas"
    ></canvas>
  </div>
</Figure>

<style>
  .canvas-wrapper {
    width: 100vw;
    margin-left: calc(50% - 50vw);
    margin-top: 0.75rem;
    margin-bottom: 0.75rem;
    padding: 0.5rem 4rem;
    box-sizing: border-box;
  }

  .hmc-title {
    color: #ffffff;
    font-size: 5.1rem;
    font-weight: 300;
    text-align: center;
    margin: 0 0 1.25rem;
    letter-spacing: 0.01em;
  }

  .hmc-canvas {
    width: 100%;
    height: auto;
    display: block;
    background: #000;
    border-radius: 6px;
  }
</style>
