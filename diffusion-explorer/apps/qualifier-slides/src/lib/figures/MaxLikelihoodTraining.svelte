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
    height = 580,
    numStages = 4,
    numSamples = 200,
    animationDuration = 10000,
    contourBandwidth = 8,
    contourThresholds = 5 as number | number[],
    contourFillColor = '#f17720',
    highlightColor = '#3b82f6',
    highlightPointIndices = [15, 42, 78, 120, 160] as number[],
    reversed = false,
    showDatasetLabel = false,
    showImages = false,
    flowerPointIndex = 30,
    noisePointIndex = 42,
    imageSize = 120,
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
    highlightPointIndices?: number[];
    reversed?: boolean;
    showDatasetLabel?: boolean;
    showImages?: boolean;
    flowerPointIndex?: number;
    noisePointIndex?: number;
    imageSize?: number;
  } = $props();

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------
  let canvas: HTMLCanvasElement | null = $state(null);
  const canvas2d = useCanvas2D(width, height);
  let ctx: CanvasRenderingContext2D | null = $state(null);
  let isInitialized = $state(false);
  let noiseDataUrl = $state('');

  function generateNoiseDataUrl(): string {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const nctx = c.getContext('2d')!;
    const imageData = nctx.createImageData(256, 256);
    for (let i = 0; i < imageData.data.length; i += 4) {
      const v = Math.floor(Math.random() * 256);
      imageData.data[i] = v;
      imageData.data[i + 1] = v;
      imageData.data[i + 2] = v;
      imageData.data[i + 3] = 255;
    }
    nctx.putImageData(imageData, 0, 0);
    return c.toDataURL();
  }

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

    if (reversed) {
      // Reverse the data order but keep positions left-to-right
      // So complex dist is on the left and simple on the right
      const reversedStages: StageData[] = [];
      for (let s = 0; s < allStages.length; s++) {
        const srcStage = allStages[allStages.length - 1 - s];
        reversedStages.push({
          ...srcStage,
          centerX: allStages[s].centerX,
          pixelCoords: srcStage.samples.map((p) => [
            allStages[s].centerX + p[0] * scaleFactor,
            vertCenter - p[1] * scaleFactor,
          ]),
        });
      }
      stages = reversedStages;
    } else {
      stages = allStages;
    }
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
    // Per-point progress and visibility
    for (let p = 0; p < highlightPointIndices.length; p++) {
      initState[`pt${p}Progress`] = 0;
      initState[`pt${p}Visible`] = 0;
    }
    timeline.initialState = initState;

    const numSegments = numStages - 1;

    // All points fade in together
    for (let p = 0; p < highlightPointIndices.length; p++) {
      timeline.add({
        name: `Pt${p}FadeIn`,
        reduce(t: number) {
          return { [`pt${p}Visible`]: t } as Partial<AnimState>;
        },
      }, { start: 0.02, end: 0.08 });
    }

    // Move-pause-move-pause pattern: each segment gets a move phase and a pause
    const movePhaseStart = 0.08;
    const movePhaseEnd = 0.85;
    const totalMoveDuration = movePhaseEnd - movePhaseStart;
    const moveFraction = 0.5; // fraction of each slot spent moving (rest is pause)
    const slotDuration = totalMoveDuration / numSegments;

    for (let seg = 0; seg < numSegments; seg++) {
      const slotStart = movePhaseStart + seg * slotDuration;
      const moveEnd = slotStart + slotDuration * moveFraction;
      const segValue = seg; // progress value at start of this segment

      for (let p = 0; p < highlightPointIndices.length; p++) {
        timeline.add({
          name: `Pt${p}Seg${seg}`,
          reduce(t: number) {
            return { [`pt${p}Progress`]: segValue + t } as Partial<AnimState>;
          },
        }, { start: slotStart, end: moveEnd });
      }
    }

    timeline.add(createPauseClip(), { start: movePhaseEnd, end: 1.0 });

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

      // Labels
      const labelY = height - 30;
      if (reversed) {
        if (s === 0) drawMathjax(ctx, `p(x)`, stage.centerX, labelY, 34, 0, 0, { color: '#333' }, requestRedraw);
        else if (s === stages.length - 1) drawMathjax(ctx, `p(z)`, stage.centerX, labelY, 34, 0, 0, { color: '#333' }, requestRedraw);
      } else {
        if (s === 0) drawMathjax(ctx, `p(z)`, stage.centerX, labelY, 34, 0, 0, { color: '#333' }, requestRedraw);
        else if (s === stages.length - 1) drawMathjax(ctx, `p(x)`, stage.centerX, labelY, 34, 0, 0, { color: '#333' }, requestRedraw);
      }

      ctx.restore();

      // Draw arrows between stages
      if (s < stages.length - 1 && opacity >= 1) {
        const nextStage = stages[s + 1];
        const arrowY = vertCenter;

        ctx.save();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 2.5;

        if (reversed) {
          // Arrow left to right: f^{-1}
          const arrowFromX = stage.centerX + 165;
          const arrowToX = nextStage.centerX - 165;
          drawArrow(ctx, arrowFromX, arrowY, arrowToX, arrowY, 7);
          const arrowMidX = (arrowFromX + arrowToX) / 2;
          drawMathjax(ctx, `f_{${s}}^{-1}`, arrowMidX, arrowY - 20, 34, 0, 0, { color: '#555' }, requestRedraw);
        } else {
          // Arrow right to left: f^{-1}
          const arrowFromX = nextStage.centerX - 165;
          const arrowToX = stage.centerX + 165;
          drawArrow(ctx, arrowFromX, arrowY, arrowToX, arrowY, 7);
          const arrowMidX = (arrowFromX + arrowToX) / 2;
          drawMathjax(ctx, `f_{${s}}^{-1}`, arrowMidX, arrowY - 20, 34, 0, 0, { color: '#555' }, requestRedraw);
        }

        ctx.restore();
      }
    }

    // Draw highlight points moving continuously between stages
    if (stages.length > 0) {
      const lastIdx = stages.length - 1;
      const totalPts = stages[0].pixelCoords.length;

      for (let p = 0; p < highlightPointIndices.length; p++) {
        const ptVisible = state[`pt${p}Visible`] ?? 0;
        const ptProgress = state[`pt${p}Progress`] ?? 0;
        if (ptVisible <= 0) continue;

        const ptIdx = highlightPointIndices[p] % totalPts;
        const segIdx = Math.min(Math.floor(ptProgress), numStages - 2);
        const segT = ptProgress - segIdx;

        let fromStageIdx: number, toStageIdx: number;
        if (reversed) {
          fromStageIdx = segIdx;
          toStageIdx = segIdx + 1;
        } else {
          fromStageIdx = lastIdx - segIdx;
          toStageIdx = lastIdx - segIdx - 1;
        }

        const fromPt = stages[fromStageIdx].pixelCoords[ptIdx];
        const toPt = stages[toStageIdx].pixelCoords[ptIdx];

        const x = fromPt[0] + (toPt[0] - fromPt[0]) * segT;
        const y = fromPt[1] + (toPt[1] - fromPt[1]) * segT;

        ctx.save();
        ctx.globalAlpha = ptVisible;
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.fillStyle = highlightColor;
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }

      // Dataset label on the first stage (data side)
      if (showDatasetLabel) {
        const dataStageIdx = reversed ? 0 : lastIdx;
        const dataStage = stages[dataStageIdx];
        drawMathjax(ctx, `\\mathcal{D}`, dataStage.centerX, height * 0.08, 44, 0, 0, { color: highlightColor }, requestRedraw);
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
    if (showImages) noiseDataUrl = generateNoiseDataUrl();
    generateStageData();
    setupTimeline();
    isInitialized = true;
  }

  onDestroy(() => {
    timeline.pause();
  });
</script>

<div style="width: {width}px; position: relative;">
  <canvas
    bind:this={canvas}
    use:canvas2d.bindCanvas
    style="width: 100%; height: auto; aspect-ratio: {width}/{height};"
  ></canvas>

  {#if showImages && isInitialized && stages.length > 0}
    {@const dataStageIdx = reversed ? 0 : stages.length - 1}
    {@const noiseStageIdx = reversed ? stages.length - 1 : 0}
    {@const ptIdx = highlightPointIndices[0] % stages[dataStageIdx].pixelCoords.length}
    {@const dataPt = stages[dataStageIdx].pixelCoords[ptIdx]}
    {@const noisePt = stages[noiseStageIdx].pixelCoords[ptIdx]}
    {@const flowerImgX = dataPt[0] - imageSize - 80}
    {@const flowerImgY = dataPt[1] - imageSize - 40}
    {@const noiseImgX = noisePt[0] + 60}
    {@const noiseImgY = noisePt[1] - imageSize - 30}

    <!-- Connecting lines -->
    <svg
      viewBox="0 0 {width} {height}"
      style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 5;"
    >
      <line
        x1={dataPt[0]} y1={dataPt[1]}
        x2={flowerImgX + imageSize / 2} y2={flowerImgY + imageSize}
        stroke="#666" stroke-width="2.5" opacity="0.6"
      />
      <line
        x1={noisePt[0]} y1={noisePt[1]}
        x2={noiseImgX + imageSize / 2} y2={noiseImgY + imageSize}
        stroke="#666" stroke-width="2.5" opacity="0.6"
      />
    </svg>

    <!-- Flower image (HTML overlay) -->
    <img
      src="{base}/flower_samples/image_00001.jpg"
      alt=""
      style="
        position: absolute;
        left: {flowerImgX / width * 100}%;
        top: {flowerImgY / height * 100}%;
        width: {imageSize / width * 100}%;
        height: {imageSize / height * 100}%;
        object-fit: cover;
        border-radius: 4px;
        box-shadow: 0 1px 4px rgba(0,0,0,0.2);
        z-index: 6;
        pointer-events: none;
      "
    />

    <!-- Noise image (HTML overlay) -->
    {#if noiseDataUrl}
      <img
        src={noiseDataUrl}
        alt=""
        style="
          position: absolute;
          left: {noiseImgX / width * 100}%;
          top: {noiseImgY / height * 100}%;
          width: {imageSize / width * 100}%;
          height: {imageSize / height * 100}%;
          object-fit: cover;
          border-radius: 4px;
          box-shadow: 0 1px 4px rgba(0,0,0,0.2);
          z-index: 6;
          pointer-events: none;
        "
      />
    {/if}
  {/if}
</div>
