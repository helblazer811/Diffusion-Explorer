<script lang="ts">
  import { onDestroy, type Snippet } from "svelte";
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
  import { sampleGMMBatch, gmmLogProbAt, GMM_STD } from "$lib/hmc/gmm";
  import { settings, heatmapColor } from "$lib/settings";

  const { colors, point } = settings.stylingSettings;

  // Two side-by-side Gaussian modes — the chain starts on the left and
  // greedily climbs into the left mode, leaving the right mode unsampled.
  const SIDE_BY_SIDE_MEANS: Vec2[] = [
    [-1.2, 0.0],
    [1.2, 0.0],
  ];
  const SIDE_BY_SIDE_WEIGHTS: number[] = [0.5, 0.5];

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
    maxSteps?: number;
    convergenceWindow?: number;
    convergenceThreshold?: number;
    convergenceTailSteps?: number;
    stepDuration?: number;
    holdDuration?: number;
    chainColor?: string;
    sampleColor?: string;
    sampleAlpha?: number;
    pointRadius?: number;
    seed?: number;
    caption?: Snippet;
  }

  let {
    canvasWidth = 720,
    canvasHeight = 220,
    domainRange = { xMin: -2.5, xMax: 2.5, yMin: -0.65, yMax: 0.65 },
    heatmapResolution = 480,
    heatmapBandwidth = 10,
    proposalStd = 0.08,
    maxSteps = 1200,
    convergenceWindow = 40,
    convergenceThreshold = 0.01,
    convergenceTailSteps = 12,
    stepDuration = 0.04,
    holdDuration = 1.2,
    chainColor = colors.point,
    sampleColor = colors.point,
    sampleAlpha = 0.55,
    pointRadius = point.radius,
    seed = 11,
    caption,
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

  let chainStates: Vec2[] = [];

  type AnimationState = {
    stepIndex: number;
    mode: "run" | "hold";
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
    // Start on the far left, with a small jitter so reseeding still varies
    // the entry path slightly. The chain greedily climbs into the left mode.
    const padX = (xMax - xMin) * 0.04;
    const xJitter = (xMax - xMin) * 0.03;
    const yJitter = (yMax - yMin) * 0.25;
    const cy = (yMin + yMax) / 2;
    return [
      xMin + padX + rng() * xJitter,
      cy + (rng() - 0.5) * yJitter,
    ];
  }

  function greedyStep(cur: Vec2, rng: () => number): Vec2 {
    const [z1, z2] = boxMuller(rng);
    const proposal: Vec2 = [
      cur[0] + proposalStd * z1,
      cur[1] + proposalStd * z2,
    ];
    return gmmLogProbAt(proposal, SIDE_BY_SIDE_MEANS, SIDE_BY_SIDE_WEIGHTS, GMM_STD) >
      gmmLogProbAt(cur, SIDE_BY_SIDE_MEANS, SIDE_BY_SIDE_WEIGHTS, GMM_STD)
      ? proposal
      : cur;
  }

  /**
   * Generate the chain until it has "converged" — i.e. the point has barely
   * moved over the last `convergenceWindow` accepted-or-not steps — then
   * append `convergenceTailSteps` more frames so the held state is visible
   * before the timeline pauses on it.
   */
  function runGreedyChainUntilConverged(start: Vec2, chainSeed: number): Vec2[] {
    const rng = mulberry32(chainSeed);
    const states: Vec2[] = [[start[0], start[1]]];
    let convergedAt = -1;
    for (let i = 1; i < maxSteps; i++) {
      const next = greedyStep(states[i - 1], rng);
      states.push(next);
      if (i >= convergenceWindow) {
        const a = states[i - convergenceWindow];
        const b = states[i];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        if (Math.hypot(dx, dy) < convergenceThreshold) {
          convergedAt = i;
          break;
        }
      }
    }
    if (convergedAt < 0) return states;
    // Pad with stationary frames so the "stopped" state lingers on screen.
    const last = states[states.length - 1];
    for (let i = 0; i < convergenceTailSteps; i++) {
      states.push([last[0], last[1]]);
    }
    return states;
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

    const start = pickStart(startRng);
    chainStates = runGreedyChainUntilConverged(start, seed + 101);
  }

  /**
   * Render the 3-Gaussian-mixture target density to an offscreen canvas
   * with a blue colormap, matching LonelyPoint and the rest of the explainer.
   */
  function buildHeatmapCanvas(rng: () => number): HTMLCanvasElement {
    const { xMin, xMax, yMin, yMax } = domainRange;
    const gridW = heatmapResolution;
    const gridH = Math.round(gridW * (canvasHeight / canvasWidth));

    const samples = sampleGMMBatch(
      rng,
      60000,
      SIDE_BY_SIDE_MEANS,
      SIDE_BY_SIDE_WEIGHTS,
      GMM_STD,
    );
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

    // Floor-clip low-density values so the heatmap only colors the high-prob
    // mode regions. Without this, the long Gaussian tails fill the canvas
    // vertically and read as a stretched band rather than three round modes.
    const floor = 0.18;
    for (let gy = 0; gy < gridH; gy++) {
      for (let gx = 0; gx < gridW; gx++) {
        const v = blurred[gy * gridW + gx] * invMax;
        const vClipped = Math.max(0, (v - floor) / (1 - floor));
        const t = Math.pow(vClipped, 0.85);
        const c = heatmapColor(t);
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
    const totalSteps = chainStates.length;
    const runDuration = totalSteps * stepDuration;
    const duration = runDuration + holdDuration;
    const runFrac = runDuration / duration;

    const chainClip = {
      name: "GreedyChain",
      reduce(t: number): AnimationState {
        if (t >= runFrac) {
          return { stepIndex: totalSteps - 1, mode: "hold" };
        }
        const localT = t / runFrac;
        const stepIndex = Math.min(
          totalSteps - 1,
          Math.floor(localT * totalSteps),
        );
        return { stepIndex, mode: "run" };
      },
    };

    const tl = Timeline.from<AnimationState>({
      duration,
      initialState: { stepIndex: 0, mode: "run" },
      clips: [{ clip: chainClip, start: 0, end: 1 }],
    });

    player = new Player(tl, { looping: true });
    player.onTick((_t, state) => draw(state));
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function draw(state: AnimationState): void {
    if (!ctx || !heatmapCanvas || !xScale || !yScale || chainStates.length === 0) return;

    // --- Static background ---
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx.drawImage(heatmapCanvas, 0, 0, canvasWidth, canvasHeight);

    // --- Dynamic foreground ---
    const { stepIndex } = state;

    // Polyline connecting every visited state so the path is fully visible.
    if (stepIndex > 0) {
      ctx.save();
      ctx.strokeStyle = chainColor;
      ctx.lineWidth = 1.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      const start = dataToPx(chainStates[0]);
      ctx.moveTo(start.x, start.y);
      for (let i = 1; i <= stepIndex; i++) {
        const p = dataToPx(chainStates[i]);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
      ctx.restore();
    }

    // Visited samples as small dots. Skip rejected (== previous) states so
    // stacked translucent fills don't make some points read darker.
    ctx.save();
    ctx.fillStyle = sampleColor;
    ctx.globalAlpha = sampleAlpha;
    for (let i = 0; i <= stepIndex; i++) {
      if (i > 0) {
        const prev = chainStates[i - 1];
        const cur = chainStates[i];
        if (prev[0] === cur[0] && prev[1] === cur[1]) continue;
      }
      const { x, y } = dataToPx(chainStates[i]);
      ctx.beginPath();
      ctx.arc(x, y, pointRadius, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.restore();

    // Current point with white stroke for legibility over heatmap + scatter.
    const cur = dataToPx(chainStates[stepIndex]);
    ctx.save();
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
      draw({ stepIndex: 0, mode: "run" });
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

<Figure bind:isActive={figureIsActive} backgroundVisible={false} {caption}>
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
