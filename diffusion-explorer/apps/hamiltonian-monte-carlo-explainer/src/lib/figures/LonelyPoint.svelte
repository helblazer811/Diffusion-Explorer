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
  import { mulberry32 } from "$lib/hmc/random";
  import type { Vec2 } from "$lib/hmc/random";
  import { computeRectKDE } from "$lib/hmc/kde";
  import { sampleGMMBatch, GMM_STD } from "$lib/hmc/gmm";
  import { settings, heatmapColor } from "$lib/settings";

  const { colors, point } = settings.stylingSettings;

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  interface Props {
    canvasWidth?: number;
    canvasHeight?: number;
    domainRange?: { xMin: number; xMax: number; yMin: number; yMax: number };
    heatmapResolution?: number;
    heatmapBandwidth?: number;
    pointPosition?: { x: number; y: number };
    pointRadius?: number;
    pointColor?: string;
    pulseMaxRadius?: number;
    pulseLineWidth?: number;
    pulsePeriod?: number;
    labelFontSize?: number;
    captionFontSize?: number;
    seed?: number;
    caption?: Snippet;
  }

  let {
    canvasWidth = 720,
    canvasHeight = 230,
    domainRange = { xMin: -2.5, xMax: 2.5, yMin: -0.35, yMax: 1.05 },
    heatmapResolution = 480,
    heatmapBandwidth = 10,
    pointPosition = { x: 0.0, y: 0.7 },
    pointRadius = point.radius,
    pointColor = colors.point,
    pulseMaxRadius = 22,
    pulseLineWidth = 2,
    pulsePeriod = 1.6,
    labelFontSize = 24,
    captionFontSize = 20,
    seed = 42,
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

  type AnimationState = { pulse: number };

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
    yScale = d3.scaleLinear().domain([yMin, yMax]).range([canvasHeight, 0]);

    const rng = mulberry32(seed);
    heatmapCanvas = buildHeatmapCanvas(rng);
  }

  // Three Gaussian modes arranged side-by-side along x, used only by this figure.
  const SIDE_BY_SIDE_MEANS: Vec2[] = [
    [-1.6, 0.15],
    [0.0, 0.15],
    [1.6, 0.15],
  ];
  const SIDE_BY_SIDE_WEIGHTS: number[] = [1 / 3, 1 / 3, 1 / 3];

  /**
   * Render the 3-Gaussian-mixture target density to an offscreen canvas
   * using a blue colormap. Low-density pixels fade to transparent so the
   * figure reads as inline ink on the page background.
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

    // Soft threshold: anything below `floor` of normalized density fades fully
    // to transparent so mode boundaries blend into the page background.
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
    // Pulsing outline ring: t in [0, 1] maps to one expanding/fading ring.
    const pulseClip = {
      name: "Pulse",
      reduce(t: number) {
        return { pulse: t };
      },
    };

    const tl = Timeline.from<AnimationState>({
      duration: pulsePeriod,
      initialState: { pulse: 0 },
      clips: [{ clip: pulseClip, start: 0, end: 1 }],
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
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx.drawImage(heatmapCanvas, 0, 0, canvasWidth, canvasHeight);

    const px = xScale(pointPosition.x);
    const py = yScale(pointPosition.y);

    // Always-on filled point.
    ctx.fillStyle = pointColor;
    ctx.beginPath();
    ctx.arc(px, py, pointRadius, 0, 2 * Math.PI);
    ctx.fill();

    // "A Lonely Point" caption above the point.
    ctx.fillStyle = "#444";
    ctx.font = `${captionFontSize}px ${getComputedStyle(canvas!).fontFamily || "sans-serif"}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("A Lonely Point", px, py - pulseMaxRadius - 4);

    // "x" label to the upper-left of the point, with a thin white outline for legibility.
    ctx.font = `italic ${labelFontSize}px serif`;
    ctx.textAlign = "right";
    ctx.textBaseline = "alphabetic";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#ffffff";
    ctx.lineJoin = "round";
    ctx.strokeText("x", px - pointRadius - 4, py - pointRadius - 2);
    ctx.fillStyle = pointColor;
    ctx.fillText("x", px - pointRadius - 4, py - pointRadius - 2);

    // --- Dynamic foreground: pulsing outline ring ---
    const t = state.pulse;
    const ringRadius = pointRadius + (pulseMaxRadius - pointRadius) * t;
    const ringAlpha = 1 - t;
    if (ringAlpha > 0) {
      ctx.save();
      ctx.globalAlpha = ringAlpha;
      ctx.strokeStyle = pointColor;
      ctx.lineWidth = pulseLineWidth;
      ctx.beginPath();
      ctx.arc(px, py, ringRadius, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.restore();
    }
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
      draw({ pulse: 0 });
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
</script>

<Figure bind:isActive={figureIsActive} backgroundVisible={false} {caption}>
  <div class="canvas-wrapper" style="max-width: {canvasWidth}px;">
    <canvas
      bind:this={canvas}
      use:canvas2d.bindCanvas
      class="lonely-point-canvas"
    ></canvas>
  </div>
</Figure>

<style>
  .canvas-wrapper {
    width: 100%;
    margin: 0 auto;
    box-sizing: border-box;
  }

  .lonely-point-canvas {
    width: 100%;
    height: auto;
    display: block;
    background: transparent;
  }
</style>
