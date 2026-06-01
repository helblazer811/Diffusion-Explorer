<script lang="ts">
  import { onDestroy } from "svelte";
  import type { Writable } from "svelte/store";
  import * as d3 from "d3";
  import {
    Figure,
    Player,
    Timeline,
    useCanvas2D,
    useVisibilityHandler,
  } from "@diffusion-explorer/ui";
  import { mulberry32, boxMuller, type Vec2 } from "$lib/hmc/random";
  import { computeRectKDE } from "$lib/hmc/kde";
  import {
    sampleGMMBatch,
    gmmLogProbAt,
    GMM_MEANS,
    GMM_WEIGHTS,
    GMM_STD,
  } from "$lib/hmc/gmm";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  interface Props {
    canvasWidth?: number;
    canvasHeight?: number;
    domainRange?: { xMin: number; xMax: number; yMin: number; yMax: number };
    heatmapResolution?: number;
    heatmapBandwidth?: number;
    proposalStd?: number;
    stepsPerLoop?: number;
    numLoops?: number;
    loopFadeSteps?: number;
    stepDuration?: number;
    chainColor?: string;
    sampleColor?: string;
    sampleAlpha?: number;
    pointRadius?: number;
    trailLength?: number;
    seed?: number;
  }

  let {
    canvasWidth = 720,
    canvasHeight = 405,
    domainRange = { xMin: -2.5, xMax: 2.5, yMin: -1.406, yMax: 1.406 },
    heatmapResolution = 480,
    heatmapBandwidth = 10,
    proposalStd = 0.18,
    stepsPerLoop = 280,
    numLoops = 4,
    loopFadeSteps = 36,
    stepDuration = 0.04,
    chainColor = "#1e3a8a",
    sampleColor = "#1e3a8a",
    sampleAlpha = 0.18,
    pointRadius = 5,
    trailLength = 10,
    seed = 11,
  }: Props = $props();

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  let canvas: HTMLCanvasElement | null = $state(null);
  const canvas2d = useCanvas2D(canvasWidth, canvasHeight);
  let ctx = $derived(canvas && canvas2d.ctx);

  let xScale: d3.ScaleLinear<number, number> | undefined;
  let yScale: d3.ScaleLinear<number, number> | undefined;

  let heatmapCanvas: HTMLCanvasElement | null = null;

  type ChainLoop = { states: Vec2[]; startSeed: number };
  let loops: ChainLoop[] = [];

  type AnimationState = {
    loopIndex: number;
    stepIndex: number;
    phaseAlpha: number;
    mode: "run" | "fade";
  };

  let player: Player<AnimationState> | null = null;
  let isInitialized = $state(false);

  let figureIsActive: Writable<boolean> | undefined = $state(undefined);
  const { handleVisibilityChange } = useVisibilityHandler(() => player);

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  function pickStart(rng: () => number): Vec2 {
    const { xMin, xMax, yMin, yMax } = domainRange;
    // Sample uniformly across the domain so different loops start near
    // different modes. Pull in slightly from the edges so no chain spawns
    // in dead-zero density and stalls.
    const padX = (xMax - xMin) * 0.12;
    const padY = (yMax - yMin) * 0.12;
    return [
      xMin + padX + rng() * (xMax - xMin - 2 * padX),
      yMin + padY + rng() * (yMax - yMin - 2 * padY),
    ];
  }

  function greedyStep(cur: Vec2, rng: () => number): Vec2 {
    const [z1, z2] = boxMuller(rng);
    const proposal: Vec2 = [
      cur[0] + proposalStd * z1,
      cur[1] + proposalStd * z2,
    ];
    return gmmLogProbAt(proposal, GMM_MEANS, GMM_WEIGHTS, GMM_STD) >
      gmmLogProbAt(cur, GMM_MEANS, GMM_WEIGHTS, GMM_STD)
      ? proposal
      : cur;
  }

  function runGreedyChain(start: Vec2, chainSeed: number): ChainLoop {
    const rng = mulberry32(chainSeed);
    const states: Vec2[] = new Array(stepsPerLoop);
    states[0] = [start[0], start[1]];
    for (let i = 1; i < stepsPerLoop; i++) {
      states[i] = greedyStep(states[i - 1], rng);
    }
    return { states, startSeed: chainSeed };
  }

  function dataToPx(p: Vec2): { x: number; y: number } {
    return { x: xScale!(p[0]), y: yScale!(p[1]) };
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function runInitialComputation(): void {
    const { xMin, xMax, yMin, yMax } = domainRange;
    xScale = d3.scaleLinear().domain([xMin, xMax]).range([0, canvasWidth]);
    yScale = d3.scaleLinear().domain([yMin, yMax]).range([canvasHeight, 0]);

    const startRng = mulberry32(seed);
    heatmapCanvas = buildHeatmapCanvas(startRng);

    loops = new Array(numLoops);
    for (let l = 0; l < numLoops; l++) {
      const start = pickStart(startRng);
      // Distinct seed per loop so the proposal noise differs across loops.
      loops[l] = runGreedyChain(start, seed + 101 * (l + 1));
    }
  }

  /**
   * Render the 3-Gaussian-mixture target density to an offscreen canvas
   * with a blue colormap, matching LonelyPoint and the rest of the explainer.
   */
  function buildHeatmapCanvas(rng: () => number): HTMLCanvasElement {
    const { xMin, xMax, yMin, yMax } = domainRange;
    const gridW = heatmapResolution;
    const gridH = Math.round(gridW * (canvasHeight / canvasWidth));

    const samples = sampleGMMBatch(rng, 60000);
    const density = computeRectKDE(
      samples,
      [xMin, xMax, yMin, yMax],
      gridW,
      gridH,
      heatmapBandwidth,
    );
    const blurred = gaussianBlur2D(density, gridW, gridH, 3);

    let max = 0;
    for (let i = 0; i < blurred.length; i++) if (blurred[i] > max) max = blurred[i];
    const invMax = max > 0 ? 1 / max : 0;

    const offscreen = document.createElement("canvas");
    offscreen.width = gridW;
    offscreen.height = gridH;
    const offCtx = offscreen.getContext("2d")!;
    const img = offCtx.createImageData(gridW, gridH);

    for (let gy = 0; gy < gridH; gy++) {
      for (let gx = 0; gx < gridW; gx++) {
        const v = blurred[gy * gridW + gx] * invMax;
        const t = Math.pow(v, 0.85);
        const c = d3.color(d3.interpolateBlues(0.15 + 0.85 * t))?.rgb() ?? d3.rgb(255, 255, 255);
        const idx = ((gridH - 1 - gy) * gridW + gx) * 4;
        img.data[idx] = c.r;
        img.data[idx + 1] = c.g;
        img.data[idx + 2] = c.b;
        img.data[idx + 3] = Math.round(255 * Math.min(1, t * 1.4));
      }
    }
    offCtx.putImageData(img, 0, 0);
    return offscreen;
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  function setupTimeline(): void {
    const totalSteps = numLoops * stepsPerLoop;
    const duration = totalSteps * stepDuration;

    const chainClip = {
      name: "GreedyChain",
      reduce(t: number): AnimationState {
        const float = t * totalSteps;
        const globalStep = Math.min(Math.floor(float), totalSteps - 1);
        const loopIndex = Math.min(
          numLoops - 1,
          Math.floor(globalStep / stepsPerLoop),
        );
        const stepIndex = globalStep - loopIndex * stepsPerLoop;
        const stepsRemaining = stepsPerLoop - 1 - stepIndex;
        if (stepsRemaining < loopFadeSteps) {
          const fadeFrac = (loopFadeSteps - stepsRemaining) / loopFadeSteps;
          return {
            loopIndex,
            stepIndex,
            phaseAlpha: Math.max(0, 1 - fadeFrac),
            mode: "fade",
          };
        }
        return { loopIndex, stepIndex, phaseAlpha: 1, mode: "run" };
      },
    };

    const tl = Timeline.from<AnimationState>({
      duration,
      initialState: { loopIndex: 0, stepIndex: 0, phaseAlpha: 1, mode: "run" },
      clips: [{ clip: chainClip, start: 0, end: 1 }],
    });

    player = new Player(tl, { looping: true });
    player.onTick((_t, state) => draw(state));
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function draw(state: AnimationState): void {
    if (!ctx || !heatmapCanvas || !xScale || !yScale || loops.length === 0) return;

    // --- Static background ---
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx.drawImage(heatmapCanvas, 0, 0, canvasWidth, canvasHeight);

    // --- Dynamic foreground ---
    const { loopIndex, stepIndex, phaseAlpha } = state;
    const loop = loops[loopIndex];
    if (!loop) return;

    // Accumulated samples for the current loop (faded near loop end).
    ctx.save();
    ctx.fillStyle = sampleColor;
    ctx.globalAlpha = sampleAlpha * phaseAlpha;
    for (let i = 0; i <= stepIndex; i++) {
      const { x, y } = dataToPx(loop.states[i]);
      ctx.beginPath();
      ctx.arc(x, y, 2.2, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.restore();

    // Last `trailLength` chain segments as a polyline for visual life.
    const trailStart = Math.max(0, stepIndex - trailLength);
    if (stepIndex > trailStart) {
      ctx.save();
      ctx.strokeStyle = chainColor;
      ctx.lineWidth = 1.5;
      ctx.lineCap = "round";
      ctx.globalAlpha = 0.35 * phaseAlpha;
      ctx.beginPath();
      const start = dataToPx(loop.states[trailStart]);
      ctx.moveTo(start.x, start.y);
      for (let i = trailStart + 1; i <= stepIndex; i++) {
        const p = dataToPx(loop.states[i]);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
      ctx.restore();
    }

    // Current point with white stroke for legibility over heatmap + scatter.
    const cur = dataToPx(loop.states[stepIndex]);
    ctx.save();
    ctx.globalAlpha = phaseAlpha;
    ctx.fillStyle = chainColor;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cur.x, cur.y, pointRadius, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // Separable Gaussian blur on a flat row-major grid.
  function gaussianBlur2D(
    src: Float32Array | number[],
    w: number,
    h: number,
    sigma: number,
  ): Float32Array {
    const r = Math.max(1, Math.ceil(3 * sigma));
    const kernel = new Float32Array(2 * r + 1);
    const inv2s2 = 1 / (2 * sigma * sigma);
    let ksum = 0;
    for (let i = -r; i <= r; i++) {
      const v = Math.exp(-i * i * inv2s2);
      kernel[i + r] = v;
      ksum += v;
    }
    for (let i = 0; i < kernel.length; i++) kernel[i] /= ksum;

    const tmp = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let k = -r; k <= r; k++) {
          const xx = Math.min(w - 1, Math.max(0, x + k));
          acc += src[row + xx] * kernel[k + r];
        }
        tmp[row + x] = acc;
      }
    }
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let k = -r; k <= r; k++) {
          const yy = Math.min(h - 1, Math.max(0, y + k));
          acc += tmp[yy * w + x] * kernel[k + r];
        }
        out[y * w + x] = acc;
      }
    }
    return out;
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
      runInitialComputation();
      setupTimeline();
      draw({ loopIndex: 0, stepIndex: 0, phaseAlpha: 1, mode: "run" });
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
    <canvas
      bind:this={canvas}
      use:canvas2d.bindCanvas
      class="greedy-acceptance-canvas"
    ></canvas>
  </div>
</Figure>

<style>
  .canvas-wrapper {
    width: 100%;
    margin: 0 auto;
    box-sizing: border-box;
  }

  .greedy-acceptance-canvas {
    width: 100%;
    height: auto;
    display: block;
    background: transparent;
  }
</style>
