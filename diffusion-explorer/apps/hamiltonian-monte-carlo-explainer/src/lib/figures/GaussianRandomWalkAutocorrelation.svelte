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
  import { mulberry32 } from "$lib/hmc/random";
  import type { Vec2 } from "$lib/hmc/random";
  import { computeRectKDE } from "$lib/hmc/kde";
  import {
    GMM_MEANS,
    GMM_WEIGHTS,
    GMM_STD,
    sampleGMMBatch,
  } from "$lib/hmc/gmm";
  import { gmmLogProb, runMetropolisHastings } from "$lib/hmc/mcmc";
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
    heatmapDimAlpha?: number;
    numSteps?: number;
    stepsPerSecond?: number;
    proposalStd?: number;
    maxLag?: number;
    pointRadius?: number;
    trailDotRadius?: number;
    trailAlpha?: number;
    pointColor?: string;
    fadeOutDuration?: number;
    seed?: number;
    caption?: Snippet;
  }

  let {
    canvasWidth = 800,
    canvasHeight = 360,
    domainRange = { xMin: -1.6, xMax: 1.6, yMin: -1.1, yMax: 1.4 },
    heatmapResolution = 360,
    heatmapBandwidth = 8,
    heatmapDimAlpha = 0.5,
    numSteps = 400,
    stepsPerSecond = 30,
    proposalStd = 0.18,
    maxLag = 50,
    pointRadius = point.radius,
    trailDotRadius = point.trailRadius,
    trailAlpha = 0.7,
    pointColor = colors.point,
    fadeOutDuration = 0.6,
    seed = 13,
    caption,
  }: Props = $props();

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  let canvas: HTMLCanvasElement | null = $state(null);
  const canvas2d = useCanvas2D(canvasWidth, canvasHeight);
  let ctx = $derived(canvas && canvas2d.ctx);

  // Layout: split into LHS scatter region and RHS plot region.
  const padding = 16;
  const gap = 24;
  const leftWidth = Math.floor((canvasWidth - 3 * padding - gap) * 0.5);
  const rightWidth = canvasWidth - leftWidth - 3 * padding - gap;

  // LHS rect (scatter).
  const leftX = padding;
  const leftY = padding;
  const leftHeight = canvasHeight - 2 * padding;

  // RHS rect (ACF plot frame, including axis margins).
  const rightX = leftX + leftWidth + gap;
  const rightY = padding;
  const rightHeight = canvasHeight - 2 * padding;

  // Plot inner area (inside axis margins).
  const axisMarginLeft = 44;
  const axisMarginBottom = 36;
  const axisMarginTop = 14;
  const axisMarginRight = 12;
  const plotInnerX = rightX + axisMarginLeft;
  const plotInnerY = rightY + axisMarginTop;
  const plotInnerW = rightWidth - axisMarginLeft - axisMarginRight;
  const plotInnerH = rightHeight - axisMarginTop - axisMarginBottom;

  // ACF y-domain.
  const acfYMin = -0.2;
  const acfYMax = 1.0;

  let chainPixels: { x: number; y: number }[] = [];
  let chainXs: number[] = []; // data-coord x of each accepted state, used for ACF
  let heatmapCanvas: HTMLCanvasElement | null = null;

  type AnimationState = { stepIndex: number; loopAlpha: number };

  let player: Player<AnimationState> | null = null;
  let isInitialized = $state(false);

  let figureIsActive: Writable<boolean> | undefined = $state(undefined);
  const { handleVisibilityChange } = useVisibilityHandler(() => player);

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  function dataToPixelX(x: number): number {
    const { xMin, xMax } = domainRange;
    return leftX + ((x - xMin) / (xMax - xMin)) * leftWidth;
  }

  function dataToPixelY(y: number): number {
    const { yMin, yMax } = domainRange;
    return leftY + leftHeight - ((y - yMin) / (yMax - yMin)) * leftHeight;
  }

  function lagToPixelX(lag: number): number {
    return plotInnerX + (lag / maxLag) * plotInnerW;
  }

  function acfToPixelY(rho: number): number {
    return (
      plotInnerY +
      plotInnerH -
      ((rho - acfYMin) / (acfYMax - acfYMin)) * plotInnerH
    );
  }

  /**
   * Sample autocorrelation function at lags 0..maxLag, computed on the
   * x-coordinate of the chain. Standard biased estimator divided by the
   * full-sample variance — slightly biased toward zero at large lags but
   * stable when n is small, which matches what we want as the chain grows.
   */
  function computeACF(samples: number[], lags: number): number[] {
    const out = new Array(lags + 1).fill(0);
    out[0] = 1;
    const n = samples.length;
    if (n < 4) return out;

    let mean = 0;
    for (let i = 0; i < n; i++) mean += samples[i];
    mean /= n;

    let variance = 0;
    for (let i = 0; i < n; i++) {
      const d = samples[i] - mean;
      variance += d * d;
    }
    variance /= n;
    if (variance === 0) return out;

    for (let k = 1; k <= lags; k++) {
      if (k >= n) {
        out[k] = 0;
        continue;
      }
      let acc = 0;
      for (let t = 0; t < n - k; t++) {
        acc += (samples[t] - mean) * (samples[t + k] - mean);
      }
      acc /= n;
      out[k] = acc / variance;
    }
    return out;
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function runInitialComputation(): void {
    const rng = mulberry32(seed);
    heatmapCanvas = buildHeatmapCanvas(rng);

    // Random-walk Metropolis-Hastings on the canonical triangle GMM.
    const steps = runMetropolisHastings({
      start: [0, 0],
      numSteps,
      proposalStd,
      logProb: (x: Vec2) => gmmLogProb(x, GMM_MEANS, GMM_WEIGHTS, GMM_STD),
      rng,
    });

    // Reconstruct chain states (one entry per step: position after the step).
    chainPixels = new Array(steps.length);
    chainXs = new Array(steps.length);
    let cur: Vec2 = [0, 0];
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const next: Vec2 = s.accepted ? s.proposal : s.from;
      cur = next;
      chainPixels[i] = { x: dataToPixelX(cur[0]), y: dataToPixelY(cur[1]) };
      chainXs[i] = cur[0];
    }
  }

  function buildHeatmapCanvas(rng: () => number): HTMLCanvasElement {
    const { xMin, xMax, yMin, yMax } = domainRange;
    const gridW = heatmapResolution;
    const gridH = Math.round(gridW * (leftHeight / leftWidth));

    const samples = sampleGMMBatch(
      rng,
      40000,
      GMM_MEANS,
      GMM_WEIGHTS,
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
  // Animations
  // ----------------------------------------------------------------

  function setupTimeline(): void {
    const walkDuration = numSteps / stepsPerSecond;
    const duration = walkDuration + fadeOutDuration;

    const walkClip = {
      name: "GaussianRandomWalkAutocorrelation",
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

  function drawAxes(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.strokeStyle = "#374151";
    ctx.fillStyle = "#374151";
    ctx.lineWidth = 1;
    ctx.font = "11px sans-serif";

    // Y axis
    ctx.beginPath();
    ctx.moveTo(plotInnerX, plotInnerY);
    ctx.lineTo(plotInnerX, plotInnerY + plotInnerH);
    ctx.stroke();

    // X axis (drawn at ρ=0 so the negative region sits below the baseline).
    const baselineY = acfToPixelY(0);
    ctx.beginPath();
    ctx.moveTo(plotInnerX, baselineY);
    ctx.lineTo(plotInnerX + plotInnerW, baselineY);
    ctx.stroke();

    // Y ticks + labels
    const yTicks = [0.0, 0.25, 0.5, 0.75, 1.0];
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const yv of yTicks) {
      const py = acfToPixelY(yv);
      ctx.beginPath();
      ctx.moveTo(plotInnerX - 4, py);
      ctx.lineTo(plotInnerX, py);
      ctx.stroke();
      ctx.fillText(yv.toFixed(2), plotInnerX - 7, py);
    }

    // X ticks + labels
    const xStep = maxLag <= 20 ? 5 : 10;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let lag = 0; lag <= maxLag; lag += xStep) {
      const px = lagToPixelX(lag);
      ctx.beginPath();
      ctx.moveTo(px, baselineY);
      ctx.lineTo(px, baselineY + 4);
      ctx.stroke();
      ctx.fillText(String(lag), px, baselineY + 6);
    }

    // Axis titles
    ctx.fillStyle = "#111827";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(
      "Lag k",
      plotInnerX + plotInnerW / 2,
      rightY + rightHeight - 4,
    );

    ctx.save();
    ctx.translate(rightX + 12, plotInnerY + plotInnerH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Autocorrelation ρ(k)", 0, 0);
    ctx.restore();

    ctx.restore();
  }

  function draw(state: AnimationState): void {
    if (!ctx || chainPixels.length === 0) return;

    // --- Static background ---
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // LHS: heatmap of the target distribution, dimmed.
    if (heatmapCanvas) {
      ctx.drawImage(
        heatmapCanvas,
        leftX,
        leftY,
        leftWidth,
        leftHeight,
      );
    }
    ctx.save();
    ctx.fillStyle = `rgba(255, 255, 255, ${heatmapDimAlpha})`;
    ctx.fillRect(leftX, leftY, leftWidth, leftHeight);
    ctx.restore();

    // RHS: axes + reference lines.
    drawAxes(ctx);

    // --- Dynamic foreground ---
    const { stepIndex, loopAlpha } = state;

    // LHS trail dots.
    ctx.save();
    ctx.fillStyle = "#4b5563";
    ctx.globalAlpha = trailAlpha * loopAlpha;
    for (let i = 0; i < stepIndex; i++) {
      const p = chainPixels[i];
      ctx.beginPath();
      ctx.arc(p.x, p.y, trailDotRadius, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.restore();

    // LHS current walker.
    const cur = chainPixels[stepIndex];
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

    // RHS: live ACF computed on samples seen so far.
    const visibleXs = chainXs.slice(0, stepIndex + 1);
    const acf = computeACF(visibleXs, maxLag);

    ctx.save();
    ctx.globalAlpha = loopAlpha;
    ctx.strokeStyle = pointColor;
    ctx.fillStyle = pointColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let lag = 0; lag <= maxLag; lag++) {
      const px = lagToPixelX(lag);
      const py = acfToPixelY(acf[lag]);
      if (lag === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Dots at integer lags (subsampled if maxLag is large).
    const dotStride = maxLag > 30 ? 2 : 1;
    for (let lag = 0; lag <= maxLag; lag += dotStride) {
      const px = lagToPixelX(lag);
      const py = acfToPixelY(acf[lag]);
      ctx.beginPath();
      ctx.arc(px, py, 2, 0, 2 * Math.PI);
      ctx.fill();
    }
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
      class="grw-acf-canvas"
    ></canvas>
  </div>
</Figure>

<style>
  .canvas-wrapper {
    width: 100%;
    margin: 0 auto;
    box-sizing: border-box;
  }

  .grw-acf-canvas {
    width: 100%;
    height: auto;
    display: block;
    background: transparent;
  }
</style>
