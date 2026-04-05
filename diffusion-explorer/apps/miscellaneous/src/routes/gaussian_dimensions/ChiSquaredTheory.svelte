<script lang="ts">
  import { onMount } from 'svelte';
  import { Figure, Katex, useCanvas2D, drawScatterPlot } from '@diffusion-explorer/ui';
  import DimensionTicker from './DimensionTicker.svelte';
  import { matchHungarian } from './hungarian';

  // ================================================================
  // Props
  // ================================================================
  export let width = 760;
  export let height = 420;
  export let D_VALUES: number[] = [64, 128, 256, 512, 1024];
  export let animState: { d: number } = { d: D_VALUES[0] };

  // ================================================================
  // State
  // ================================================================
  const canvasWidth = Math.floor(width * 0.48);
  const canvasHeight = height;
  const canvas2d = useCanvas2D(canvasWidth, canvasHeight);
  let canvas: HTMLCanvasElement | null = null;
  let isInitialized = false;

  let precomputedSamples: Map<number, { angle: number; dev: number }[]> = new Map();
  let precomputedPixels: Map<number, number[][]> = new Map();

  // Layout — match first figure's right side style
  const CX = canvasWidth / 2;
  const CY = canvasHeight * 0.42;
  const PLOT_RADIUS = Math.min(canvasWidth * 0.45, canvasHeight * 0.38);

  const MIN_RING_RADIUS = PLOT_RADIUS * 0.35;
  const MAX_RING_RADIUS = PLOT_RADIUS * 0.75;
  const SHELL_HALF_WIDTH = 18;

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

  function ringRadiusForD(d: number): number {
    const logMin = Math.log(D_VALUES[0]);
    const logMax = Math.log(D_VALUES[D_VALUES.length - 1]);
    const t = (Math.log(d) - logMin) / (logMax - logMin);
    return MIN_RING_RADIUS + t * (MAX_RING_RADIUS - MIN_RING_RADIUS);
  }

  function findBracket(d: number): { loIdx: number; hiIdx: number; t: number } {
    if (d <= D_VALUES[0]) return { loIdx: 0, hiIdx: 0, t: 0 };
    if (d >= D_VALUES[D_VALUES.length - 1]) return { loIdx: D_VALUES.length - 1, hiIdx: D_VALUES.length - 1, t: 0 };
    for (let i = 0; i < D_VALUES.length - 1; i++) {
      if (d >= D_VALUES[i] && d <= D_VALUES[i + 1]) {
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

    const rawPixels: Map<number, number[][]> = new Map();
    for (let di = 0; di < D_VALUES.length; di++) {
      const d = D_VALUES[di];
      const rr = ringRadiusForD(d);
      const samples = precomputedSamples.get(d)!;
      const devScale = Math.sqrt(d) * SHELL_HALF_WIDTH;
      const coords: number[][] = [];
      for (const s of samples) {
        const r = rr + s.dev * devScale;
        coords.push([
          CX + r * Math.cos(s.angle),
          CY - r * Math.sin(s.angle),
        ]);
      }
      rawPixels.set(d, coords);
    }

    precomputedPixels = new Map();
    precomputedPixels.set(D_VALUES[0], rawPixels.get(D_VALUES[0])!);
    for (let i = 1; i < D_VALUES.length; i++) {
      const prev = precomputedPixels.get(D_VALUES[i - 1])!;
      const curr = rawPixels.get(D_VALUES[i])!;
      precomputedPixels.set(D_VALUES[i], matchHungarian(prev, curr));
    }
  }

  // ================================================================
  // Drawing
  // ================================================================

  function draw(state: { d: number }) {
    const ctx = canvas2d.ctx;
    if (!ctx) return;

    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    const d = state.d;
    const currentRingR = ringRadiusForD(d);

    // Shell annulus (fixed pixel width)
    const innerR = Math.max(0, currentRingR - SHELL_HALF_WIDTH);
    const outerR = currentRingR + SHELL_HALF_WIDTH;

    ctx.save();
    ctx.beginPath();
    ctx.arc(CX, CY, outerR, 0, 2 * Math.PI);
    ctx.arc(CX, CY, innerR, 0, 2 * Math.PI, true);
    ctx.fillStyle = 'rgba(232, 93, 58, 0.10)';
    ctx.fill();
    ctx.restore();

    // Reference circle (mean radius)
    ctx.save();
    ctx.setLineDash([8, 5]);
    ctx.strokeStyle = '#bbb';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(CX, CY, currentRingR, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Radius line
    ctx.save();
    ctx.strokeStyle = '#999';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(CX, CY);
    ctx.lineTo(CX + currentRingR, CY);
    ctx.stroke();
    ctx.fillStyle = '#999';
    ctx.beginPath();
    ctx.arc(CX, CY, 2, 0, 2 * Math.PI);
    ctx.fill();
    ctx.restore();

    // Scatter points (interpolated between key frames)
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

  $: if (isInitialized) {
    draw(animState);
  }

  $: currentRingR = ringRadiusForD(animState.d);
</script>

<h2>Concentration of Measure via the Chi-Squared Distribution</h2>

<Figure backgroundVisible={false}>
  {#snippet children()}
    <div class="theory-layout" style="width: {width}px;">
      <div class="equations">
        <p class="eq-intro">
          If <Katex math={"x \\sim \\mathcal{N}(0, I_d)"} />, then:
        </p>

        <div class="eq-block">
          <Katex
            math={"\\|x\\|^2 = \\sum_{i=1}^d x_i^2 \\sim \\chi^2(d)"}
            displayMode={true}
            displayFontSize="1.3em"
          />
        </div>

        <p class="eq-text">
          Since <Katex math={"\\chi^2(d)"} /> has mean <Katex math={"d"} /> and variance <Katex math={"2d"} />:
        </p>

        <div class="eq-block">
          <Katex
            math={"\\|x\\| \\approx \\sqrt{d} \\,{\\color{#E85D3A}{\\pm\\, O(1)}}"}
            displayMode={true}
            displayFontSize="1.3em"
          />
        </div>

        <p class="eq-text">
          The radius grows like <Katex math={"\\sqrt{d}"} /> but the absolute fluctuation stays <Katex math={"{\\color{#E85D3A}{O(1)}}"} /> — so the shell becomes thin relative to the radius.
        </p>
      </div>

      <div class="viz" style="position: relative; width: {canvasWidth}px;">
        <canvas
          bind:this={canvas}
          width={canvasWidth}
          height={canvasHeight}
          style="width: {canvasWidth}px; height: {canvasHeight}px;"
        ></canvas>

        <!-- √d label on radius line -->
        <div
          class="sqrt-label"
          style="
            left: {CX + currentRingR / 2}px;
            top: {CY - 34}px;
          "
        >
          <Katex math={"\\sqrt{d}"} color="#666" />
        </div>

        <!-- ± O(1) label at top-right of ring -->
        <div
          class="bound-label"
          style="
            left: {CX + currentRingR * 0.7 + SHELL_HALF_WIDTH + 8}px;
            top: {CY - currentRingR * 0.7 - 12}px;
          "
        >
          <Katex math={"\\pm\\, O(1)"} color="#E85D3A" />
        </div>

        <div style="position: absolute; bottom: 15px; left: 50%; transform: translateX(-50%); width: 400px;">
          <DimensionTicker d={animState.d} dValues={D_VALUES} />
        </div>
      </div>
    </div>
  {/snippet}
</Figure>

<style>
  .theory-layout {
    display: flex;
    gap: 20px;
    align-items: center;
  }

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

  .equations {
    flex: 1;
    min-width: 0;
  }

  .eq-intro {
    font-size: 1.1rem;
    line-height: 1.6;
    margin: 0 0 0.75rem 0;
    color: #333;
  }

  .eq-block {
    margin: 0.5rem 0;
  }

  .eq-text {
    font-size: 1.05rem;
    line-height: 1.6;
    margin: 0.75rem 0;
    color: #444;
  }

  .viz {
    flex-shrink: 0;
  }
</style>
