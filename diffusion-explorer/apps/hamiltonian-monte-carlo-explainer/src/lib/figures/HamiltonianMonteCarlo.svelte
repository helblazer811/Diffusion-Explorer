<script lang="ts">
  import { onDestroy, type Snippet } from "svelte";
  import type { Writable } from "svelte/store";
  import * as d3 from "d3";
  import {
    Figure,
    Player,
    Timeline,
    createPauseClip,
    useCanvas2D,
    useVisibilityHandler,
  } from "@diffusion-explorer/ui";
  import { mulberry32 } from "$lib/hmc/random";
  import { computeRectKDE } from "$lib/hmc/kde";
  import type { Vec2 } from "$lib/hmc/hmc";
  import { sampleGMMBatch } from "$lib/hmc/gmm";
  import HmcChainWorker from "$lib/hmc/hmcChain.worker?worker";
  import type {
    HmcChainRequest,
    HmcChainResponse,
    HmcTarget,
  } from "$lib/hmc/hmcChain.worker";
  import { settings, heatmapColor } from "$lib/settings";

  const { colors, point, path } = settings.stylingSettings;

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
    /**
     * Selects how the HMC integrator gets ∇log π(x). Defaults to the
     * analytic GMM gradient — sub-millisecond per call. Switch to
     * `{ kind: "gmm-autodiff" }` to exercise the TensorFlow.js autodiff
     * path (much slower, but useful as a sanity check or as a template
     * for figures whose target log-density has no closed-form gradient).
     */
    target?: HmcTarget;
    caption?: Snippet;
  }

  let {
    canvasWidth = 720,
    canvasHeight = 405,
    numProposals = 150,
    leapfrogSteps = 60,
    stepSize = 0.05,
    domainRange = { xMin: -2.5, xMax: 2.5, yMin: -1.406, yMax: 1.406 },
    heatmapResolution = 480,
    heatmapBandwidth = 10,
    pathlineLength = 40,
    pathlineWidth = path.pathlineWidth,
    pathlineFalloff = 1.5,
    particleColor = colors.point,
    particleRadius = point.particleRadius,
    particleOpacity = 0.95,
    animationDuration = 180000,
    seed = 42,
    target = { kind: "gmm-analytic" } as HmcTarget,
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

  // HMC trajectory as a flat array of Vec2.
  let trajectory: Vec2[] = [];
  // Pre-rendered heatmap on an offscreen canvas.
  let heatmapCanvas: HTMLCanvasElement | null = null;

  type AnimationState = { time: number; stepIndex: number; alpha: number };

  let player: Player<AnimationState> | null = null;
  let isInitialized = $state(false);
  let chainWorker: Worker | null = null;

  const initialPos: Vec2 = [-0.7, -0.4];

  let figureIsActive: Writable<boolean> | undefined = $state(undefined);
  const { handleVisibilityChange } = useVisibilityHandler(() => player);

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  /**
   * Synchronous main-thread setup: scales + heatmap. Runs in ~250ms so the
   * figure is visually present immediately. The HMC chain itself is dispatched
   * to a worker (see `requestChainFromWorker`) so it doesn't block the page.
   */
  function runInitialComputation(): void {
    const { xMin, xMax, yMin, yMax } = domainRange;
    xScale = d3.scaleLinear().domain([xMin, xMax]).range([0, canvasWidth]);
    yScale = d3.scaleLinear().domain([yMin, yMax]).range([canvasHeight, 0]);

    const rng = mulberry32(seed);
    heatmapCanvas = buildHeatmapCanvas(rng);
  }

  function requestChainFromWorker(): void {
    chainWorker = new HmcChainWorker();
    const ownWorker = chainWorker;
    chainWorker.onmessage = (e: MessageEvent<HmcChainResponse>) => {
      // If the component was destroyed before the chain came back, drop it.
      if (chainWorker !== ownWorker) return;
      const msg = e.data;
      if (msg.type === "error") {
        console.error("[HamiltonianMonteCarlo] worker error:", msg.error);
        return;
      }
      const flat = msg.trajectory;
      const n = flat.length / 2;
      const traj: Vec2[] = new Array(n);
      for (let i = 0; i < n; i++) traj[i] = [flat[2 * i], flat[2 * i + 1]];
      trajectory = traj;

      setupTimeline();
      draw({ time: 0, stepIndex: 0, alpha: 0 });
      player?.play();
    };
    const req: HmcChainRequest = {
      type: "run",
      target,
      initialPos,
      numProposals,
      leapfrogSteps,
      stepSize,
      seed,
    };
    chainWorker.postMessage(req);
  }

  /**
   * Render the target density (3-Gaussian mixture) to an offscreen canvas
   * with a blue colormap, matching the rest of the explainer's figures.
   */
  function buildHeatmapCanvas(rng: () => number): HTMLCanvasElement {
    const { xMin, xMax, yMin, yMax } = domainRange;
    const gridW = heatmapResolution;
    const gridH = Math.round(gridW * (canvasHeight / canvasWidth));

    const samples = sampleGMMBatch(rng, 80000);
    const density = computeRectKDE(
      samples,
      [xMin, xMax, yMin, yMax],
      gridW,
      gridH,
      heatmapBandwidth,
    );

    // Separable Gaussian blur over the density grid to smooth out KDE noise.
    const blurred = gaussianBlur2D(density, gridW, gridH, 4);

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

  /**
   * Paint the heatmap + initial dot before the worker has returned a
   * trajectory, so the figure is not blank during chain compute.
   */
  function drawStaticInitialFrame(): void {
    if (!ctx || !heatmapCanvas || !xScale || !yScale) return;
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx.drawImage(heatmapCanvas, 0, 0, canvasWidth, canvasHeight);
    const px = xScale(initialPos[0]);
    const py = yScale(initialPos[1]);
    ctx.fillStyle = particleColor;
    ctx.globalAlpha = particleOpacity;
    ctx.beginPath();
    ctx.arc(px, py, particleRadius, 0, 2 * Math.PI);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function draw(state: AnimationState): void {
    if (!ctx || !heatmapCanvas || !xScale || !yScale) return;

    // --- Static background ---
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx.drawImage(heatmapCanvas, 0, 0, canvasWidth, canvasHeight);

    // --- Dynamic foreground ---
    const { stepIndex, alpha } = state;

    const a = trajectory[stepIndex];
    const b = trajectory[Math.min(stepIndex + 1, trajectory.length - 1)];
    const x = a[0] + (b[0] - a[0]) * alpha;
    const y = a[1] + (b[1] - a[1]) * alpha;
    const px = xScale(x);
    const py = yScale(y);

    drawPathline(state, px, py);

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
    chainWorker?.terminate();
    chainWorker = null;
  });

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  $effect(() => {
    if (canvas && ctx && !isInitialized) {
      isInitialized = true;
      runInitialComputation();
      // Render heatmap + initial dot immediately so the figure is visible
      // before the chain finishes computing in the worker.
      drawStaticInitialFrame();
      requestChainFromWorker();
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

  // Separable Gaussian blur on a flat row-major grid (in-place safe).
  // sigma is in pixels; kernel radius = ceil(3 * sigma).
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
    // Horizontal pass.
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
    // Vertical pass.
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
</script>

<Figure bind:isActive={figureIsActive} backgroundVisible={false} {caption}>
  <div class="canvas-wrapper" style="max-width: {canvasWidth}px;">
    <canvas
      bind:this={canvas}
      use:canvas2d.bindCanvas
      class="hmc-canvas"
    ></canvas>
  </div>
</Figure>

<style>
  .canvas-wrapper {
    width: 100%;
    margin-top: 0.75rem;
    margin-bottom: 0.75rem;
    box-sizing: border-box;
  }

  .hmc-canvas {
    width: 100%;
    height: auto;
    display: block;
    background: transparent;
  }
</style>
