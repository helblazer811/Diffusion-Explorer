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
  let {
    width = 1720,
    height = 580,
    numStages = 4,
    numSamples = 200,
    animationDuration = 10000,
    contourBandwidth = 8,
    contourThresholds = 5 as number | number[],
    contourFillColor = '#f17720',
    highlightColor = '#3b82f6',
    highlightPointIndex = 15,
  }: {
    width?: number;
    height?: number;
    numStages?: number;
    numSamples?: number;
    animationDuration?: number;
    contourBandwidth?: number;
    contourThresholds?: number | number[];
    contourFillColor?: string;
    highlightColor?: string;
    highlightPointIndex?: number;
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

  // Animation: first reveal all stages (left to right), then animate point (right to left)
  // State keys: stage0..stageN for reveal, pointStage for which stage the point is at (N-1 to 0)
  type AnimState = Record<string, number>;

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

  function generateStageData() {
    const rng = mulberry32(42);

    const sourceSamples: number[][] = [];
    for (let i = 0; i < numSamples; i++) {
      const [gx, gy] = gaussianPair(rng);
      sourceSamples.push([gx, gy]);
    }

    const targetSamples: number[][] = [];
    const centers = [-1.5, 1.5];
    const samplesPerMode = Math.floor(numSamples / 2);
    for (let m = 0; m < 2; m++) {
      for (let i = 0; i < samplesPerMode; i++) {
        const [gx, gy] = gaussianPair(rng);
        targetSamples.push([gx * 0.35, centers[m] + gy * 0.35]);
      }
    }
    while (targetSamples.length < numSamples) {
      const [gx, gy] = gaussianPair(rng);
      targetSamples.push([gx * 0.35, gy * 0.35]);
    }

    const margin = 180;
    const usableWidth = width - 2 * margin;
    const spacing = usableWidth / (numStages - 1);
    const vertCenter = height * 0.42;
    const scaleFactor = 70;

    const allStages: StageData[] = [];

    for (let s = 0; s < numStages; s++) {
      const t = s / (numStages - 1);
      const centerX = margin + s * spacing;

      const samples = sourceSamples.map((src, i) => {
        const tgt = targetSamples[i];
        return [
          src[0] * (1 - t) + tgt[0] * t,
          src[1] * (1 - t) + tgt[1] * t,
        ];
      });

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
  timeline.setEndPause(3.0);

  function setupTimeline() {
    const initState: AnimState = {};
    for (let s = 0; s < numStages; s++) {
      initState[`stage${s}`] = 1; // always visible
    }
    // Per-stage point reveal: point0 = last stage (appears first), pointN-1 = first stage (appears last)
    for (let s = 0; s < numStages; s++) {
      initState[`point${s}`] = 0;
    }
    timeline.initialState = initState;

    // Stagger point appearances right-to-left
    const animPhase = 0.7;
    const slotDuration = animPhase / numStages;

    for (let s = 0; s < numStages; s++) {
      // s=0 → last stage (rightmost), s=N-1 → first stage (leftmost)
      const key = `point${s}`;
      const start = 0.05 + s * slotDuration;
      const end = start + slotDuration * 0.5; // quick fade-in
      timeline.add({
        name: `Point_${s}`,
        reduce(t: number) {
          return { [key]: t } as Partial<AnimState>;
        },
      }, { start, end });
    }

    timeline.add(createPauseClip(), { start: 0.05 + animPhase, end: 1.0 });

    timeline.onTick((_t: number, state: Readonly<AnimState>) => {
      draw(state);
    });
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  let lastState: AnimState = {};
  function requestRedraw() { draw(lastState); }

  function draw(state: AnimState) {
    lastState = state;
    if (!ctx || stages.length === 0) return;
    ctx.clearRect(0, 0, width, height);

    const vertCenter = height * 0.42;
    const scaleFactor = 70;

    // Draw all stages
    for (let s = 0; s < stages.length; s++) {
      const stage = stages[s];
      const opacity = state[`stage${s}`] ?? 0;
      if (opacity <= 0) continue;

      ctx.save();
      ctx.globalAlpha = opacity;

      const xScale = (dataX: number) => stage.centerX + dataX * scaleFactor;
      const yScale = (dataY: number) => vertCenter - dataY * scaleFactor;

      plotContours(ctx, stage.contours, {
        xScale, yScale,
        fillColor: contourFillColor,
        opacity: 0.08 * opacity,
        fill: true, stroke: false,
      });

      drawScatterPlot(ctx, stage.pixelCoords, 5, contourFillColor, 0.1 * opacity);

      // Labels: z_i ~ p(z_i)
      const labelY = height - 30;
      drawMathjax(ctx, `z_{${s}} \\sim p(z_{${s}})`, stage.centerX, labelY, 34, 0, 0, { color: '#333' }, requestRedraw);

      ctx.restore();

      // Draw reversed arrows (pointing right to left: f^{-1})
      if (s < stages.length - 1 && opacity >= 1) {
        const nextStage = stages[s + 1];
        // Arrow goes FROM next stage TO this stage (reverse direction)
        const arrowFromX = nextStage.centerX - 165;
        const arrowToX = stage.centerX + 165;
        const arrowY = vertCenter;

        ctx.save();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 2.5;

        drawArrow(ctx, arrowFromX, arrowY, arrowToX, arrowY, 7);

        const arrowMidX = (arrowFromX + arrowToX) / 2;
        drawMathjax(ctx, `f_{${s}}^{-1}`, arrowMidX, arrowY - 20, 34, 0, 0, { color: '#555' }, requestRedraw);

        ctx.restore();
      }
    }

    // Draw highlight points appearing one at a time, right to left
    const lastIdx = stages.length - 1;
    const ptIdx = highlightPointIndex % stages[0].pixelCoords.length;

    for (let s = 0; s < numStages; s++) {
      const opacity = state[`point${s}`] ?? 0;
      if (opacity <= 0) continue;

      // s=0 → last stage (rightmost), s=1 → second-to-last, etc.
      const stageIdx = lastIdx - s;
      const pt = stages[stageIdx].pixelCoords[ptIdx];
      const isLatest = s === numStages - 1 || (state[`point${s + 1}`] ?? 0) <= 0;

      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.beginPath();
      ctx.arc(pt[0], pt[1], isLatest ? 14 : 10, 0, Math.PI * 2);
      ctx.fillStyle = highlightColor;
      ctx.fill();
      if (isLatest) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
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
    if (isInitialized || !canvas || !ctx) return;
    generateStageData();
    setupTimeline();
    isInitialized = true;
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
