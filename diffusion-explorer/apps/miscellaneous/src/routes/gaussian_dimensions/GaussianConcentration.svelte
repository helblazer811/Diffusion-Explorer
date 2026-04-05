<script lang="ts">
  import { onMount } from 'svelte';
  import { Figure, Katex, useCanvas2D, drawScatterPlot, drawText } from '@diffusion-explorer/ui';
  import DimensionTicker from './DimensionTicker.svelte';
  import { matchHungarian } from './hungarian';

  // ================================================================
  // Props
  // ================================================================
  export let width = 760;
  export let height = 450;
  export let D_VALUES: number[] = [16, 32, 64, 128, 256, 512, 1024];
  export let animState: { d: number } = { d: D_VALUES[0] };

  // ================================================================
  // State
  // ================================================================
  const canvas2d = useCanvas2D(width, height);
  let canvas: HTMLCanvasElement | null = null;
  let isInitialized = false;

  // Pre-computed data
  let precomputedSamples: Map<number, { angle: number; dev: number }[]> = new Map();
  let precomputedPixels: Map<number, number[][]> = new Map();
  let leftPlotPixelCoords: number[][] = [];

  // Layout constants
  const LEFT_CX = width * 0.22;
  const LEFT_CY = height * 0.45;
  const RIGHT_CX = width * 0.75;
  const RIGHT_CY = height * 0.45;
  const PLOT_RADIUS = Math.min(width * 0.20, height * 0.38);

  const MIN_RING_RADIUS = PLOT_RADIUS * 0.35;
  const MAX_RING_RADIUS = PLOT_RADIUS * 0.75;
  const SHELL_HALF_WIDTH_MAX = 18;
  const SHELL_HALF_WIDTH_MIN = 4;

  const NUM_SAMPLES = 400;
  const DOT_RADIUS = 3;
  const DOT_OPACITY = 0.45;

  // ================================================================
  // Helpers
  // ================================================================

  function standardNormal(): number {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  /** Map dimension to shell half-width — thinner at high d */
  function shellHalfWidthForD(d: number): number {
    const logMin = Math.log(D_VALUES[0]);
    const logMax = Math.log(D_VALUES[D_VALUES.length - 1]);
    const t = Math.min(1, Math.max(0, (Math.log(d) - logMin) / (logMax - logMin)));
    return SHELL_HALF_WIDTH_MAX * (1 - t) + SHELL_HALF_WIDTH_MIN * t;
  }

  /** Map dimension to ring radius via log interpolation */
  function ringRadiusForD(d: number): number {
    const logMin = Math.log(D_VALUES[0]);
    const logMax = Math.log(D_VALUES[D_VALUES.length - 1]);
    const t = (Math.log(d) - logMin) / (logMax - logMin);
    return MIN_RING_RADIUS + t * (MAX_RING_RADIUS - MIN_RING_RADIUS);
  }

  /** Find bracketing key dimensions and interpolation factor */
  function findBracket(d: number): { loIdx: number; hiIdx: number; t: number } {
    if (d <= D_VALUES[0]) return { loIdx: 0, hiIdx: 0, t: 0 };
    if (d >= D_VALUES[D_VALUES.length - 1]) return { loIdx: D_VALUES.length - 1, hiIdx: D_VALUES.length - 1, t: 0 };
    for (let i = 0; i < D_VALUES.length - 1; i++) {
      if (d >= D_VALUES[i] && d <= D_VALUES[i + 1]) {
        // Interpolate on log scale
        const t = (Math.log(d) - Math.log(D_VALUES[i])) / (Math.log(D_VALUES[i + 1]) - Math.log(D_VALUES[i]));
        return { loIdx: i, hiIdx: i + 1, t };
      }
    }
    return { loIdx: 0, hiIdx: 0, t: 0 };
  }

  // ================================================================
  // Setup
  // ================================================================

  function runInitialComputation() {
    // Precompute raw samples for each key dimension
    precomputedSamples = new Map();
    for (const d of D_VALUES) {
      const samples: { angle: number; dev: number }[] = [];
      for (let i = 0; i < NUM_SAMPLES; i++) {
        const x = Array.from({ length: d }, () => standardNormal());
        const angle = Math.atan2(x[0], x[1]);
        const norm = Math.sqrt(x.reduce((sum, xi) => sum + xi * xi, 0));
        const dev = (norm - Math.sqrt(d)) / Math.sqrt(d);
        samples.push({ angle, dev });
      }
      precomputedSamples.set(d, samples);
    }

    // Compute pixel coords for each key dimension
    const rawPixels: Map<number, number[][]> = new Map();
    for (let di = 0; di < D_VALUES.length; di++) {
      const d = D_VALUES[di];
      const rr = ringRadiusForD(d);
      const samples = precomputedSamples.get(d)!;
      const devScale = Math.sqrt(d) * shellHalfWidthForD(d);
      const coords: number[][] = [];
      for (const s of samples) {
        const r = rr + s.dev * devScale;
        coords.push([
          RIGHT_CX + r * Math.cos(s.angle),
          RIGHT_CY - r * Math.sin(s.angle),
        ]);
      }
      rawPixels.set(d, coords);
    }

    // Hungarian matching between consecutive key dims
    precomputedPixels = new Map();
    precomputedPixels.set(D_VALUES[0], rawPixels.get(D_VALUES[0])!);
    for (let i = 1; i < D_VALUES.length; i++) {
      const prev = precomputedPixels.get(D_VALUES[i - 1])!;
      const curr = rawPixels.get(D_VALUES[i])!;
      precomputedPixels.set(D_VALUES[i], matchHungarian(prev, curr));
    }

    // Left plot: simple 2D Gaussian scatter
    const LEFT_SCALE = PLOT_RADIUS / 2.5;
    leftPlotPixelCoords = [];
    for (let i = 0; i < NUM_SAMPLES; i++) {
      leftPlotPixelCoords.push([
        LEFT_CX + standardNormal() * LEFT_SCALE,
        LEFT_CY - standardNormal() * LEFT_SCALE,
      ]);
    }
  }

  // ================================================================
  // Drawing
  // ================================================================

  function draw(state: { d: number }) {
    const ctx = canvas2d.ctx;
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    const d = state.d;
    const currentRingR = ringRadiusForD(d);
    const currentShellHW = shellHalfWidthForD(d);

    // Right plot: shell annulus (thins with increasing dimension)
    const innerR = Math.max(0, currentRingR - currentShellHW);
    const outerR = currentRingR + currentShellHW;

    ctx.save();
    ctx.beginPath();
    ctx.arc(RIGHT_CX, RIGHT_CY, outerR, 0, 2 * Math.PI);
    ctx.arc(RIGHT_CX, RIGHT_CY, innerR, 0, 2 * Math.PI, true);
    ctx.fillStyle = 'rgba(232, 93, 58, 0.10)';
    ctx.fill();
    ctx.restore();

    // Reference circle (mean radius)
    ctx.save();
    ctx.setLineDash([8, 5]);
    ctx.strokeStyle = '#bbb';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(RIGHT_CX, RIGHT_CY, currentRingR, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Radius line
    ctx.save();
    ctx.strokeStyle = '#999';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(RIGHT_CX, RIGHT_CY);
    ctx.lineTo(RIGHT_CX + currentRingR, RIGHT_CY);
    ctx.stroke();
    ctx.fillStyle = '#999';
    ctx.beginPath();
    ctx.arc(RIGHT_CX, RIGHT_CY, 2, 0, 2 * Math.PI);
    ctx.fill();
    ctx.restore();

    // Left plot: filled disk at √2 radius
    const LEFT_SCALE = PLOT_RADIUS / 2.5;
    const sqrt2Radius = Math.sqrt(2) * LEFT_SCALE;
    ctx.save();
    ctx.beginPath();
    ctx.arc(LEFT_CX, LEFT_CY, sqrt2Radius, 0, 2 * Math.PI);
    ctx.fillStyle = 'rgba(232, 93, 58, 0.06)';
    ctx.fill();
    ctx.restore();

    // Left plot: static 2D Gaussian scatter
    drawScatterPlot(ctx, leftPlotPixelCoords, DOT_RADIUS, '#E85D3A', DOT_OPACITY);

    // Left label
    drawText(ctx, '2D Gaussian', LEFT_CX, LEFT_CY - PLOT_RADIUS - 20, {
      font: "600 24px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      color: '#333',
      align: 'center',
      baseline: 'bottom',
    });

    // Right plot: interpolated scatter between key frames
    const { loIdx, hiIdx, t } = findBracket(d);
    const loCoords = precomputedPixels.get(D_VALUES[loIdx])!;
    const hiCoords = precomputedPixels.get(D_VALUES[hiIdx])!;

    if (t > 0 && loIdx !== hiIdx) {
      const blended: number[][] = [];
      for (let i = 0; i < NUM_SAMPLES; i++) {
        blended.push([
          loCoords[i][0] * (1 - t) + hiCoords[i][0] * t,
          loCoords[i][1] * (1 - t) + hiCoords[i][1] * t,
        ]);
      }
      drawScatterPlot(ctx, blended, DOT_RADIUS, '#E85D3A', DOT_OPACITY);
    } else {
      drawScatterPlot(ctx, loCoords, DOT_RADIUS, '#E85D3A', DOT_OPACITY);
    }

    // Right title
    drawText(ctx, 'High Dimensional Gaussian', RIGHT_CX, RIGHT_CY - PLOT_RADIUS - 20, {
      font: "600 24px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      color: '#333',
      align: 'center',
      baseline: 'bottom',
    });
  }

  // ================================================================
  // Lifecycle
  // ================================================================

  onMount(() => {
    if (canvas) {
      canvas2d.init(canvas);
      runInitialComputation();
      isInitialized = true;
      draw(animState);
    }
  });

  // ================================================================
  // Reactive
  // ================================================================

  $: if (isInitialized) {
    draw(animState);
  }

  $: currentRingR = ringRadiusForD(animState.d);
  $: currentShellHW = shellHalfWidthForD(animState.d);
</script>

<h2>Gaussian in High Dimensions</h2>

<Figure backgroundVisible={false}>
  {#snippet children()}
    <div style="position: relative; width: {width}px; height: {height}px;">
      <canvas
        bind:this={canvas}
        width={width}
        height={height}
        style="width: {width}px; height: {height}px;"
      ></canvas>

      <!-- √d label overlaid on radius line -->
      <div
        class="sqrt-label"
        style="
          left: {RIGHT_CX + currentRingR / 2}px;
          top: {RIGHT_CY - 34}px;
        "
      >
        <Katex math={"\\sqrt{d}"} color="#666" />
      </div>

      <!-- ± O(1) label at top-right of the ring -->
      <div
        class="bound-label"
        style="
          left: {RIGHT_CX + currentRingR * 0.7 + currentShellHW + 8}px;
          top: {RIGHT_CY - currentRingR * 0.7 - 12}px;
        "
      >
        <Katex math={"\\pm\\, O(1)"} color="#E85D3A" />
      </div>

      <div style="position: absolute; bottom: 15px; left: {RIGHT_CX - 220}px; width: 440px;">
        <DimensionTicker d={animState.d} dValues={D_VALUES} />
      </div>
    </div>
  {/snippet}
  {#snippet caption()}
    As dimension <i>d</i> increases, the radius grows like &radic;d but the absolute fluctuation stays O(1) — so the shell becomes thin relative to the radius.
  {/snippet}
</Figure>

<style>
  .sqrt-label {
    position: absolute;
    transform: translateX(-50%);
    pointer-events: none;
    font-size: 1.2em;
    background: rgba(255, 255, 255, 0.75);
    padding: 0 4px;
    border-radius: 3px;
  }

  .bound-label {
    position: absolute;
    pointer-events: none;
    font-size: 1.1em;
  }
</style>
