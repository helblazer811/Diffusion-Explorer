<script lang="ts">
  import { onDestroy, type Snippet } from "svelte";
  import type { Writable } from "svelte/store";
  import {
    Figure,
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
    proposalSigmaX?: number;
    proposalSigmaY?: number;
    pointRadius?: number;
    trailDotRadius?: number;
    connectorLineWidth?: number;
    trailAlpha?: number;
    connectorAlpha?: number;
    pointColor?: string;
    trailColor?: string;
    fadeOutDuration?: number;
    seed?: number;
    caption?: Snippet;
  }

  let {
    canvasWidth = 720,
    canvasHeight = 200,
    domainRange = { xMin: -2.5, xMax: 2.5, yMin: -0.6, yMax: 0.65 },
    heatmapResolution = 480,
    heatmapBandwidth = 10,
    heatmapDimAlpha = 0.5,
    numSteps = 400,
    stepsPerSecond = 18,
    proposalSigmaX = 24,
    proposalSigmaY = 10,
    pointRadius = point.radius,
    trailDotRadius = point.trailRadius,
    connectorLineWidth = path.connectorWidth,
    trailAlpha = 0.55,
    connectorAlpha = 0.4,
    pointColor = colors.point,
    trailColor = colors.point,
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

  const cx = canvasWidth / 2;
  const cy = canvasHeight / 2;

  // Walk positions in pixel space, fully precomputed.
  let chain: { x: number; y: number }[] = [];

  let heatmapCanvas: HTMLCanvasElement | null = null;

  // Three Gaussian modes arranged side-by-side along x — same as LonelyPoint.
  const SIDE_BY_SIDE_MEANS: Vec2[] = [
    [-1.6, 0.0],
    [0.0, 0.0],
    [1.6, 0.0],
  ];
  const SIDE_BY_SIDE_WEIGHTS: number[] = [1 / 3, 1 / 3, 1 / 3];

  type AnimationState = { stepIndex: number; loopAlpha: number };

  let player: Player<AnimationState> | null = null;
  let isInitialized = $state(false);

  let figureIsActive: Writable<boolean> | undefined = $state(undefined);
  const { handleVisibilityChange } = useVisibilityHandler(() => player);

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function runInitialComputation(): void {
    const rng = mulberry32(seed);
    heatmapCanvas = buildHeatmapCanvas(rng);
    chain = new Array(numSteps);
    chain[0] = { x: cx, y: cy };

    // Walk extents — wider along x to match the side-by-side modes.
    const xHalfRange = canvasWidth * 0.42;
    const yHalfRange = canvasHeight * 0.32;

    for (let i = 1; i < numSteps; i++) {
      const prev = chain[i - 1];

      // Anisotropic Gaussian proposal: σ_x > σ_y so the walk is flat along x.
      // Reject-and-resample until it lands inside an axis-aligned bounding box.
      let nx = prev.x;
      let ny = prev.y;
      let attempts = 0;
      while (attempts < 32) {
        const [z1, z2] = boxMuller(rng);
        nx = prev.x + proposalSigmaX * z1;
        ny = prev.y + proposalSigmaY * z2;
        if (
          Math.abs(nx - cx) <= xHalfRange &&
          Math.abs(ny - cy) <= yHalfRange
        )
          break;
        attempts++;
      }
      if (attempts === 32) {
        nx = cx + Math.max(-xHalfRange, Math.min(xHalfRange, nx - cx));
        ny = cy + Math.max(-yHalfRange, Math.min(yHalfRange, ny - cy));
      }

      chain[i] = { x: nx, y: ny };
    }
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  function setupTimeline(): void {
    const walkDuration = numSteps / stepsPerSecond;
    const duration = walkDuration + fadeOutDuration;

    const walkClip = {
      name: "GaussianRandomWalk",
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

    player = new Player(tl, { looping: true });
    player.onTick((_t, state) => draw(state));
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function draw(state: AnimationState): void {
    if (!ctx || chain.length === 0) return;

    // --- Static background: target heatmap ---
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    if (heatmapCanvas) {
      ctx.drawImage(heatmapCanvas, 0, 0, canvasWidth, canvasHeight);
    }

    // --- Dynamic foreground ---
    const { stepIndex, loopAlpha } = state;

    // Accumulated trail dots — previous samples in orange with lower opacity.
    ctx.save();
    ctx.fillStyle = trailColor;
    ctx.globalAlpha = trailAlpha * loopAlpha;
    for (let i = 0; i < stepIndex; i++) {
      const p = chain[i];
      ctx.beginPath();
      ctx.arc(p.x, p.y, trailDotRadius, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.restore();

    // Current walker.
    const cur = chain[stepIndex];
    ctx.save();
    ctx.globalAlpha = loopAlpha;
    ctx.fillStyle = pointColor;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cur.x, cur.y, pointRadius, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Render the same 3-Gaussian-mixture target density as LonelyPoint into an
   * offscreen canvas. The walk is drawn over a dimmed copy of this so the
   * heatmap reads as faint background context without competing for ink.
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
      draw({ stepIndex: 0, loopAlpha: 1 });
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
      class="gaussian-random-walk-canvas"
    ></canvas>
  </div>
</Figure>

<style>
  .canvas-wrapper {
    width: 100%;
    margin: 0 auto;
    box-sizing: border-box;
  }

  .gaussian-random-walk-canvas {
    width: 100%;
    height: auto;
    display: block;
    background: transparent;
  }
</style>
