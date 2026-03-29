<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { base } from '$app/paths';
  import {
    Timeline,
    useCanvas2D,
    drawScatterPlot,
    drawArrow,
    drawMathjax,
    createPauseClip,
    computeContours,
    plotContours,
  } from '@diffusion-explorer/ui';

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------
  let {
    width = 1720,
    height = 500,
    numSamples = 200,
    animationDuration = 6000,
    contourBandwidth = 8,
    contourThresholds = 5 as number | number[],
    contourFillColor = '#f17720',
  }: {
    width?: number;
    height?: number;
    numSamples?: number;
    animationDuration?: number;
    contourBandwidth?: number;
    contourThresholds?: number | number[];
    contourFillColor?: string;
  } = $props();

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------
  let canvas: HTMLCanvasElement | null = $state(null);
  const canvas2d = useCanvas2D(width, height);
  let ctx: CanvasRenderingContext2D | null = $state(null);
  let isInitialized = $state(false);

  type StageData = {
    samples: number[][];
    pixelCoords: number[][];
    centerX: number;
    contours: any;
  };

  let stages: StageData[] = $state([]);

  // Animation state: opacity for source, arrow, target
  type AnimState = { source: number; arrow: number; target: number };

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  function mulberry32(seed: number) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function gaussianPair(rng: () => number): [number, number] {
    const u1 = rng();
    const u2 = rng();
    const r = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-10)));
    const theta = 2 * Math.PI * u2;
    return [r * Math.cos(theta), r * Math.sin(theta)];
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  let targetDistribution: number[][] = $state([]);

  function generateStageData() {
    if (targetDistribution.length === 0) return;
    const rng = mulberry32(42);
    const vertCenter = height * 0.35;
    const scaleFactor = 70;
    const sourceCenterX = width * 0.3;
    const targetCenterX = width * 0.7;

    // Source: Standard Gaussian
    const sourceSamples: number[][] = [];
    for (let i = 0; i < numSamples; i++) {
      const [gx, gy] = gaussianPair(rng);
      sourceSamples.push([gx, gy]);
    }

    // Target: smiley face (flip y so it's right-side up)
    const targetSamples = targetDistribution.slice(0, numSamples).map(p => [p[0], -p[1]]);

    const allStages: StageData[] = [];

    for (const [samples, centerX] of [[sourceSamples, sourceCenterX], [targetSamples, targetCenterX]] as [number[][], number][]) {
      const pixelCoords = samples.map((p) => [
        centerX + p[0] * scaleFactor,
        vertCenter - p[1] * scaleFactor,
      ]);

      const contours = computeContours(samples as [number, number][], {
        bandwidth: contourBandwidth,
        thresholds: contourThresholds,
      });

      allStages.push({ samples, pixelCoords, centerX, contours });
    }

    stages = allStages;
  }

  // ----------------------------------------------------------------
  // Animation
  // ----------------------------------------------------------------

  const timeline = new Timeline<AnimState>();
  timeline.duration = animationDuration / 1000;
  timeline.looping = true;
  timeline.setEndPause(5.0);
  timeline.initialState = { source: 0, arrow: 0, target: 0 };

  function setupTimeline() {
    // Source fades in, then arrow, then target
    timeline.add({
      name: 'Source',
      reduce(t: number) { return { source: t }; },
    }, { start: 0, end: 0.25 });

    timeline.add({
      name: 'Arrow',
      reduce(t: number) { return { arrow: t }; },
    }, { start: 0.25, end: 0.35 });

    timeline.add({
      name: 'Target',
      reduce(t: number) { return { target: t }; },
    }, { start: 0.35, end: 0.6 });

    timeline.add(createPauseClip(), { start: 0.6, end: 1.0 });

    timeline.onTick((_t: number, state: Readonly<AnimState>) => {
      draw(state);
    });
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  let lastState: AnimState = { source: 0, arrow: 0, target: 0 };

  function requestRedraw() {
    draw(lastState);
  }

  function draw(state: AnimState) {
    lastState = state;
    if (!ctx || stages.length < 2) return;
    ctx.clearRect(0, 0, width, height);

    const vertCenter = height * 0.35;
    const scaleFactor = 70;

    // Draw source (z)
    const source = stages[0];
    if (state.source > 0) {
      const opacity = state.source;
      ctx.save();
      ctx.globalAlpha = opacity;

      const xScale = (dataX: number) => source.centerX + dataX * scaleFactor;
      const yScale = (dataY: number) => vertCenter - dataY * scaleFactor;

      plotContours(ctx, source.contours, {
        xScale, yScale,
        fillColor: contourFillColor,
        opacity: 0.2 * opacity,
        fill: true, stroke: false,
      });

      drawScatterPlot(ctx, source.pixelCoords, 5, contourFillColor, 0.4 * opacity);
      drawMathjax(ctx, 'p(z)', source.centerX, height - 60, 34, 0, 0, { color: '#333' }, requestRedraw);

      ctx.restore();
    }

    // Draw arrow
    if (state.arrow > 0) {
      const arrowFromX = source.centerX + 200;
      const arrowToX = stages[1].centerX - 200;
      const arrowY = vertCenter;

      ctx.save();
      ctx.globalAlpha = state.arrow;
      ctx.strokeStyle = '#555';
      ctx.lineWidth = 2.5;

      drawArrow(ctx, arrowFromX, arrowY, arrowToX, arrowY, 7);
      const arrowMidX = (arrowFromX + arrowToX) / 2;
      drawMathjax(ctx, 'f', arrowMidX, arrowY - 20, 34, 0, 0, { color: '#555' }, requestRedraw);

      ctx.restore();
    }

    // Draw target (x)
    const target = stages[1];
    if (state.target > 0) {
      const opacity = state.target;
      ctx.save();
      ctx.globalAlpha = opacity;

      const xScale = (dataX: number) => target.centerX + dataX * scaleFactor;
      const yScale = (dataY: number) => vertCenter - dataY * scaleFactor;

      plotContours(ctx, target.contours, {
        xScale, yScale,
        fillColor: contourFillColor,
        opacity: 0.2 * opacity,
        fill: true, stroke: false,
      });

      drawScatterPlot(ctx, target.pixelCoords, 5, contourFillColor, 0.4 * opacity);
      drawMathjax(ctx, 'p(x)', target.centerX, height - 60, 34, 0, 0, { color: '#333' }, requestRedraw);

      ctx.restore();
    }
  }

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  export function restart() {
    timeline.reset();
    timeline.play();
  }

  export function pause() {
    timeline.pause();
  }

  $effect(() => {
    if (canvas) {
      ctx = canvas2d.ctx;
      tryInitialize();
    }
  });

  function tryInitialize() {
    if (isInitialized || !canvas || !ctx || targetDistribution.length === 0) return;
    generateStageData();
    setupTimeline();
    isInitialized = true;
  }

  onMount(async () => {
    try {
      const res = await fetch(`${base}/rf_data/smiley_face.json`);
      if (res.ok) {
        const data = await res.json();
        targetDistribution = data.points || [];
        tryInitialize();
      }
    } catch (e) {
      console.warn('Failed to load smiley face data:', e);
    }
  });

  onDestroy(() => {
    timeline.pause();
  });
</script>

<div style="width: {width}px;">
  <canvas
    bind:this={canvas}
    use:canvas2d.bindCanvas
    style="width: 100%; height: auto; aspect-ratio: {width}/{height};"
  ></canvas>
</div>
