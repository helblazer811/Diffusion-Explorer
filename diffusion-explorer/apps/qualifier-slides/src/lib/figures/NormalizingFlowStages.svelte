<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
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
  const REF_WIDTH = 1720;
  const REF_HEIGHT = 580;

  let {
    width = REF_WIDTH,
    numStages = 5,
    numSamples = 200,
    animationDuration = 8000,
    contourBandwidth = 8,
    contourThresholds = 5 as number | number[],
    contourFillColor = '#f17720',
    showLabels = false,
    looping = true,
    static: isStatic = false,
  }: {
    width?: number;
    numStages?: number;
    numSamples?: number;
    animationDuration?: number;
    contourBandwidth?: number;
    contourThresholds?: number | number[];
    contourFillColor?: string;
    showLabels?: boolean;
    looping?: boolean;
    static?: boolean;
  } = $props();

  // Derive height and uniform scale factor from width
  const k = width / REF_WIDTH;
  const height = Math.round(REF_HEIGHT * k);

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------
  let canvas: HTMLCanvasElement | null = $state(null);
  const canvas2d = useCanvas2D(width, height);
  let ctx: CanvasRenderingContext2D | null = $state(null);
  let isInitialized = $state(false);

  // Per-stage data: samples in data coords and pixel coords
  type StageData = {
    samples: number[][];       // [sample][x,y] in data space
    pixelCoords: number[][];   // [sample][x,y] in pixel space
    centerX: number;           // pixel center X for this stage
    contours: any;             // pre-computed ComputedContours
  };

  let stages: StageData[] = $state([]);

  // Animation state: opacity per stage + per arrow
  type AnimState = Record<string, number>;

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  // Seeded RNG
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

  function generateGaussianSamples(n: number, rng: () => number, meanX = 0, meanY = 0, std = 1): number[][] {
    const samples: number[][] = [];
    for (let i = 0; i < n; i++) {
      const [gx, gy] = gaussianPair(rng);
      samples.push([meanX + gx * std, meanY + gy * std]);
    }
    return samples;
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function generateStageData() {
    const rng = mulberry32(42);

    // Stage 0: Standard Gaussian
    const sourceSamples = generateGaussianSamples(numSamples, rng, 0, 0, 1);

    // Stage K (final): 2 vertically spaced Gaussians
    const targetSamples: number[][] = [];
    const centers = [-1.5, 1.5]; // vertical centers
    const samplesPerMode = Math.floor(numSamples / 2);
    for (let m = 0; m < 2; m++) {
      for (let i = 0; i < samplesPerMode; i++) {
        const [gx, gy] = gaussianPair(rng);
        targetSamples.push([gx * 0.35, centers[m] + gy * 0.35]);
      }
    }
    // Fill remaining
    while (targetSamples.length < numSamples) {
      const [gx, gy] = gaussianPair(rng);
      targetSamples.push([gx * 0.35, gy * 0.35]);
    }

    // Layout: evenly spaced centers (all pixel values scale with k)
    const margin = 180 * k;
    const usableWidth = width - 2 * margin;
    const spacing = usableWidth / (numStages - 1);
    const vertCenter = height * 0.42;
    const scaleFactor = 70 * k; // data units to pixel units

    // Generate intermediate stages via linear interpolation
    const allStages: StageData[] = [];

    for (let s = 0; s < numStages; s++) {
      const t = s / (numStages - 1);
      const centerX = margin + s * spacing;

      // Interpolate samples
      const samples = sourceSamples.map((src, i) => {
        const tgt = targetSamples[i];
        return [
          src[0] * (1 - t) + tgt[0] * t,
          src[1] * (1 - t) + tgt[1] * t,
        ];
      });

      // Convert to pixel coords
      const pixelCoords = samples.map((p) => [
        centerX + p[0] * scaleFactor,
        vertCenter - p[1] * scaleFactor, // flip y
      ]);

      // Pre-compute contours
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
  timeline.looping = looping;
  timeline.setEndPause(5.0);

  function setupTimeline() {
    const initState: AnimState = {};
    for (let s = 0; s < numStages; s++) {
      initState[`stage${s}`] = isStatic ? 1 : 0;
    }
    timeline.initialState = initState;

    if (isStatic) {
      // Just draw the final state immediately, no animation
      timeline.onTick((_t: number, state: Readonly<AnimState>) => {
        draw(state);
      });
      return;
    }

    const animPhase = 0.85;
    const slotDuration = animPhase / numStages;

    for (let s = 0; s < numStages; s++) {
      const stageKey = `stage${s}`;
      const stageStart = s * slotDuration;
      const stageEnd = stageStart + slotDuration;
      timeline.add({
        name: `Stage_${s}`,
        reduce(t: number) {
          return { [stageKey]: t } as Partial<AnimState>;
        },
      }, { start: stageStart, end: stageEnd });
    }

    timeline.add(createPauseClip(), { start: animPhase, end: 1.0 });

    timeline.onTick((_t: number, state: Readonly<AnimState>) => {
      draw(state);
    });
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function draw(state: AnimState) {
    if (!ctx || stages.length === 0) return;
    ctx.clearRect(0, 0, width, height);

    const vertCenter = height * 0.42;
    const scaleFactor = 70 * k;
    const dotRadius = 5 * k;
    const arrowGap = 165 * k;
    const arrowHeadSize = 7 * k;
    const arrowLineWidth = 2.5 * k;
    const fontSize = 34 * k;
    const labelBottomOffset = 30 * k;
    const arrowLabelOffset = 20 * k;

    for (let s = 0; s < stages.length; s++) {
      const stage = stages[s];
      const opacity = state[`stage${s}`] ?? 0;
      if (opacity <= 0) continue;

      ctx.save();
      ctx.globalAlpha = opacity;

      // Draw contours
      const xScale = (dataX: number) => stage.centerX + dataX * scaleFactor;
      const yScale = (dataY: number) => vertCenter - dataY * scaleFactor;

      plotContours(ctx, stage.contours, {
        xScale,
        yScale,
        fillColor: contourFillColor,
        opacity: 0.3 * opacity,
        fill: true,
        stroke: false,
      });

      // Draw scatter (same color as contour)
      drawScatterPlot(ctx, stage.pixelCoords, dotRadius, contourFillColor, 0.4 * opacity);

      // Distribution labels below each stage
      if (showLabels) {
        const labelY = height - labelBottomOffset;
        if (s === 0) {
          drawMathjax(ctx, `p(z)`, stage.centerX, labelY, fontSize, 0, 0, { color: '#333' });
        } else if (s === stages.length - 1) {
          drawMathjax(ctx, `p(x)`, stage.centerX, labelY, fontSize, 0, 0, { color: '#333' });
        } else {
          drawMathjax(ctx, `p(z_{${s}})`, stage.centerX, labelY, fontSize, 0, 0, { color: '#333' });
        }
      }

      ctx.restore();

      // Draw arrow to next stage (visible once this stage is fully revealed)
      if (s < stages.length - 1 && opacity >= 1) {
        const nextStage = stages[s + 1];
        const arrowFromX = stage.centerX + arrowGap;
        const arrowToX = nextStage.centerX - arrowGap;
        const arrowY = vertCenter;

        ctx.save();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#555';
        ctx.lineWidth = arrowLineWidth;

        drawArrow(ctx, arrowFromX, arrowY, arrowToX, arrowY, arrowHeadSize);

        // Label above arrow: f_i
        const arrowMidX = (arrowFromX + arrowToX) / 2;
        drawMathjax(ctx, `f_{${s}}`, arrowMidX, arrowY - arrowLabelOffset, fontSize, 0, 0, { color: '#555' });

        ctx.restore();
      }
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
    if (isInitialized || !canvas || !ctx) return;
    generateStageData();
    setupTimeline();
    isInitialized = true;
    timeline.play();
  }

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
