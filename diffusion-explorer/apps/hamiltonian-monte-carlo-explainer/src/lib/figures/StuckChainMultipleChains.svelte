<script lang="ts">
  import { onDestroy, type Snippet } from "svelte";
  import type { Writable } from "svelte/store";
  import {
    Figure,
    MultiStateToggleButton,
    Player,
    Timeline,
    useCanvas2D,
    useVisibilityHandler,
  } from "@diffusion-explorer/ui";
  import * as d3 from "d3";
  import { mulberry32, boxMuller } from "$lib/hmc/random";
  import type { Vec2 } from "$lib/hmc/random";
  import { computeRectKDE } from "$lib/hmc/kde";
  import { sampleGMMBatch, GMM_STD } from "$lib/hmc/gmm";
  import { gmmLogProb, runMetropolisHastings, type MHStep } from "$lib/hmc/mcmc";
  import { settings, heatmapColor } from "$lib/settings";

  const { colors, point, path } = settings.stylingSettings;

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  interface Props {
    canvasWidth?: number;
    canvasHeight?: number;
    domainRange?: { xMin: number; xMax: number; yMin: number; yMax: number };
    heatmapResolution?: number;
    heatmapBandwidth?: number;
    heatmapDimAlpha?: number;
    numSteps?: number;
    stepsPerSecond?: number;
    /** Proposal std in *data* units. Small → chain gets stuck near a mode. */
    proposalStd?: number;
    pointRadius?: number;
    trailDotRadius?: number;
    connectorLineWidth?: number;
    trailAlpha?: number;
    connectorAlpha?: number;
    fadeOutDuration?: number;
    seed?: number;
    caption?: Snippet;
  }

  let {
    canvasWidth = 720,
    canvasHeight = 220,
    domainRange = { xMin: -2.5, xMax: 2.5, yMin: -0.65, yMax: 0.65 },
    heatmapResolution = 480,
    heatmapBandwidth = 10,
    heatmapDimAlpha = 0.5,
    numSteps = 400,
    stepsPerSecond = 18,
    proposalStd = 0.08,
    pointRadius = point.radius,
    trailDotRadius = point.trailRadius,
    connectorLineWidth = path.connectorWidth,
    trailAlpha = 0.55,
    connectorAlpha = 0.4,
    fadeOutDuration = 0.6,
    seed = 11,
    caption,
  }: Props = $props();

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  let canvas: HTMLCanvasElement | null = $state(null);
  const canvas2d = useCanvas2D(canvasWidth, canvasHeight);
  let ctx = $derived(canvas && canvas2d.ctx);

  // Three side-by-side Gaussian modes, identical layout to GaussianRandomWalk.
  const SIDE_BY_SIDE_MEANS: Vec2[] = [
    [-1.6, 0.0],
    [0.0, 0.0],
    [1.6, 0.0],
  ];
  const SIDE_BY_SIDE_WEIGHTS: number[] = [1 / 3, 1 / 3, 1 / 3];

  // All chains share the same orange to match the rest of the explainer.
  const CHAIN_COLOR = colors.point;

  // Each "view" is a list of chains; each chain is a list of pixel-space
  // positions (one per MH iteration). Single → 1 chain, Multiple → 3 chains.
  type Chain = { x: number; y: number }[];
  let singleChains: Chain[] = [];
  let multiChains: Chain[] = [];

  let heatmapCanvas: HTMLCanvasElement | null = null;

  type AnimationState = { stepIndex: number; loopAlpha: number };

  // Two players — one timeline per view — so toggling preserves each view's
  // state and avoids re-running MH on every click.
  let singlePlayer: Player<AnimationState> | null = null;
  let multiPlayer: Player<AnimationState> | null = null;
  let mode: number = $state(0); // 0 = single, 1 = multiple
  let lastState: AnimationState = $state({ stepIndex: 0, loopAlpha: 1 });

  let isInitialized = $state(false);

  let figureIsActive: Writable<boolean> | undefined = $state(undefined);
  const { handleVisibilityChange } = useVisibilityHandler(() =>
    mode === 0 ? singlePlayer : multiPlayer,
  );

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  function dataToPixelX(x: number): number {
    const { xMin, xMax } = domainRange;
    return ((x - xMin) / (xMax - xMin)) * canvasWidth;
  }

  function dataToPixelY(y: number): number {
    const { yMin, yMax } = domainRange;
    return canvasHeight - ((y - yMin) / (yMax - yMin)) * canvasHeight;
  }

  function chainFromMHSteps(steps: MHStep[]): Chain {
    const out: Chain = new Array(steps.length + 1);
    out[0] = {
      x: dataToPixelX(steps[0].from[0]),
      y: dataToPixelY(steps[0].from[1]),
    };
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const next: Vec2 = s.accepted ? s.proposal : s.from;
      out[i + 1] = { x: dataToPixelX(next[0]), y: dataToPixelY(next[1]) };
    }
    return out;
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function runInitialComputation(): void {
    const rng = mulberry32(seed);
    heatmapCanvas = buildHeatmapCanvas(rng);

    const logProb = (x: Vec2) =>
      gmmLogProb(x, SIDE_BY_SIDE_MEANS, SIDE_BY_SIDE_WEIGHTS, GMM_STD);

    // Single chain: start at left mode, small proposal → stays stuck there.
    const singleSteps = runMetropolisHastings({
      start: [SIDE_BY_SIDE_MEANS[0][0], SIDE_BY_SIDE_MEANS[0][1]],
      numSteps,
      proposalStd,
      logProb,
      rng: mulberry32(seed + 1),
      bounds: domainRange,
    });
    singleChains = [chainFromMHSteps(singleSteps)];

    // Multiple chains: one per mode, each with its own RNG stream so they
    // don't all draw the same proposal sequence.
    multiChains = SIDE_BY_SIDE_MEANS.map((mu, k) => {
      const steps = runMetropolisHastings({
        start: [mu[0], mu[1]],
        numSteps,
        proposalStd,
        logProb,
        rng: mulberry32(seed + 100 + k),
        bounds: domainRange,
      });
      return chainFromMHSteps(steps);
    });
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  function buildPlayer(): Player<AnimationState> {
    const walkDuration = numSteps / stepsPerSecond;
    const duration = walkDuration + fadeOutDuration;

    const walkClip = {
      name: "MHWalk",
      reduce(t: number): AnimationState {
        const tt = t * duration;
        if (tt <= walkDuration) {
          const stepIndex = Math.min(
            numSteps - 1,
            Math.floor(tt * stepsPerSecond),
          );
          return { stepIndex, loopAlpha: 1 };
        }
        const fadeT = (tt - walkDuration) / fadeOutDuration;
        return {
          stepIndex: numSteps - 1,
          loopAlpha: Math.max(0, 1 - fadeT),
        };
      },
    };

    const tl = Timeline.from<AnimationState>({
      duration,
      initialState: { stepIndex: 0, loopAlpha: 1 },
      clips: [{ clip: walkClip, start: 0, end: 1 }],
    });

    return new Player(tl, { looping: true });
  }

  // Per-player previous t, used to detect a loop boundary (t wraps from
  // near-1 back to near-0). When the active player completes a loop we flip
  // the toggle to the other view automatically.
  let prevSingleT = 0;
  let prevMultiT = 0;

  function setupTimeline(): void {
    singlePlayer = buildPlayer();
    multiPlayer = buildPlayer();

    // Only the active player drives draw() and triggers auto-toggle. The
    // inactive player is paused so it doesn't burn cycles in the background.
    singlePlayer.onTick((t, state) => {
      if (mode === 0) {
        if (t < prevSingleT - 0.5) autoToggleTo(1);
        prevSingleT = t;
        lastState = state;
        draw(state);
      }
    });
    multiPlayer.onTick((t, state) => {
      if (mode === 1) {
        if (t < prevMultiT - 0.5) autoToggleTo(0);
        prevMultiT = t;
        lastState = state;
        draw(state);
      }
    });
  }

  function autoToggleTo(newMode: number): void {
    if (newMode === mode) return;
    mode = newMode;
    if (newMode === 0) {
      multiPlayer?.pause();
      singlePlayer?.reset();
      prevSingleT = 0;
      singlePlayer?.play();
    } else {
      singlePlayer?.pause();
      multiPlayer?.reset();
      prevMultiT = 0;
      multiPlayer?.play();
    }
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function drawChain(
    chain: Chain,
    color: string,
    stepIndex: number,
    loopAlpha: number,
  ): void {
    if (!ctx || chain.length === 0) return;

    // Connectors first so dots sit on top.
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = connectorLineWidth;
    ctx.lineCap = "round";
    ctx.globalAlpha = connectorAlpha * loopAlpha;
    ctx.beginPath();
    for (let i = 1; i <= stepIndex; i++) {
      const a = chain[i - 1];
      const b = chain[i];
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    ctx.restore();

    // Trail dots.
    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = trailAlpha * loopAlpha;
    for (let i = 0; i < stepIndex; i++) {
      const p = chain[i];
      ctx.beginPath();
      ctx.arc(p.x, p.y, trailDotRadius, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.restore();

    // Current walker.
    const cur = chain[Math.min(stepIndex, chain.length - 1)];
    ctx.save();
    ctx.globalAlpha = loopAlpha;
    ctx.fillStyle = color;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cur.x, cur.y, pointRadius, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function draw(state: AnimationState): void {
    if (!ctx) return;

    // --- Static background: target heatmap ---
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    if (heatmapCanvas) {
      ctx.drawImage(heatmapCanvas, 0, 0, canvasWidth, canvasHeight);
    }

    // --- Dynamic foreground ---
    const chains = mode === 0 ? singleChains : multiChains;
    for (let k = 0; k < chains.length; k++) {
      drawChain(chains[k], CHAIN_COLOR, state.stepIndex, state.loopAlpha);
    }
  }

  /**
   * Render the same 3-Gaussian-mixture target density used elsewhere in the
   * explainer so the chain animations sit over a shared visual reference.
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
  // Event Handlers
  // ----------------------------------------------------------------

  function onToggle(newMode: number): void {
    if (newMode === mode) return;
    mode = newMode;
    // Pause the leaving player; resume (and reset) the entering player so the
    // user sees the new view animate from the start.
    if (newMode === 0) {
      multiPlayer?.pause();
      singlePlayer?.reset();
      prevSingleT = 0;
      singlePlayer?.play();
    } else {
      singlePlayer?.pause();
      multiPlayer?.reset();
      prevMultiT = 0;
      multiPlayer?.play();
    }
  }

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  onDestroy(() => {
    singlePlayer?.dispose();
    multiPlayer?.dispose();
  });

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  $effect(() => {
    if (canvas && ctx && !isInitialized) {
      isInitialized = true;
      runInitialComputation();
      setupTimeline();
      draw({ stepIndex: 0, loopAlpha: 1 });
      singlePlayer?.play();
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
  <div class="figure-content" style="max-width: {canvasWidth}px;">
    <canvas
      bind:this={canvas}
      use:canvas2d.bindCanvas
      class="stuck-chain-canvas"
    ></canvas>
    <div class="toggle-wrapper">
      <MultiStateToggleButton
        labels={["Single Chain", "Multiple Chains"]}
        value={mode}
        fontSize={16}
        padding="8px 20px"
        onchange={onToggle}
      />
    </div>
  </div>
</Figure>

<style>
  .figure-content {
    width: 100%;
    margin: 0 auto;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .stuck-chain-canvas {
    width: 100%;
    height: auto;
    display: block;
    background: transparent;
  }

  .toggle-wrapper {
    margin-top: 15px;
  }
</style>
