<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import * as d3 from 'd3';
  import { evaluateGMM, computeGradientDescentPath } from './gaussian-mixture.js';

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------
  let {
    totalWidth = 800,
    gap = 16,
    contourColor = '#FF3B59',
    dotColor = '#6CE99D',
    bgColor = '#0F0E13',
    xMin = -10,
    xMax = 10,
    yMin = -10,
    yMax = 10,
    resolution = 200,
    numContourLevels = 7,
    animDuration = 16,
  }: {
    totalWidth?: number;
    gap?: number;
    contourColor?: string;
    dotColor?: string;
    bgColor?: string;
    xMin?: number;
    xMax?: number;
    yMin?: number;
    yMax?: number;
    resolution?: number;
    numContourLevels?: number;
    animDuration?: number;
  } = $props();

  const canvasW = Math.floor((totalWidth - gap) / 2);
  const canvasH = Math.floor(canvasW * 0.85);

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------
  let profileCanvas: HTMLCanvasElement | null = $state(null);
  let topDownCanvas: HTMLCanvasElement | null = $state(null);
  let animFrameId = 0;
  let startTime = 0;

  // 3 runs: different start points → different minima, different digits
  type RunData = {
    gradPath: number[][];
    energyOverTime: number[];
    maxEnergy: number;
    minEnergy: number;
    cleanDigit: Float32Array;
    noiseField: Float32Array;
    digit: string;
  };

  const RUN_CONFIGS = [
    { startX: 7, startY: -7, digit: '3' },
    { startX: -8, startY: 7, digit: '7' },
    { startX: 8, startY: 6, digit: '5' },
  ];

  let runs: RunData[] = [];
  let currentRun = 0;

  // Cached static backgrounds (offscreen canvases, drawn once)
  let profileBg: HTMLCanvasElement | null = null;
  let topDownBg: HTMLCanvasElement | null = null;

  // MNIST digit rendering
  const DIGIT_SIZE = 28;
  const THUMB_SIZE = 64;
  let digitCanvas: HTMLCanvasElement | null = null;

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------
  function energy(x: number, y: number): number {
    const p = evaluateGMM(x, y);
    return p > 1e-10 ? -Math.log(p) : -Math.log(1e-10);
  }

  /** Create a binarized digit on a 28x28 grid */
  function makeDigitData(char: string): { clean: Float32Array; noise: Float32Array } {
    const c = document.createElement('canvas');
    c.width = DIGIT_SIZE;
    c.height = DIGIT_SIZE;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, DIGIT_SIZE, DIGIT_SIZE);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(char, DIGIT_SIZE / 2, DIGIT_SIZE / 2 + 1);

    const imgData = ctx.getImageData(0, 0, DIGIT_SIZE, DIGIT_SIZE);
    const clean = new Float32Array(DIGIT_SIZE * DIGIT_SIZE);
    const noise = new Float32Array(DIGIT_SIZE * DIGIT_SIZE);
    for (let i = 0; i < DIGIT_SIZE * DIGIT_SIZE; i++) {
      clean[i] = imgData.data[i * 4] > 128 ? 1 : 0;
      noise[i] = Math.random();
    }
    return { clean, noise };
  }

  function initRuns() {
    digitCanvas = document.createElement('canvas');
    digitCanvas.width = DIGIT_SIZE;
    digitCanvas.height = DIGIT_SIZE;

    runs = RUN_CONFIGS.map(({ startX, startY, digit }) => {
      const gradPath = computeGradientDescentPath(startX, startY, 100, 0.04);
      const energyOverTime: number[] = [];
      let maxEnergy = 0;
      let minEnergy = Infinity;
      for (const [x, y] of gradPath) {
        const e = energy(x, y);
        energyOverTime.push(e);
        if (e > maxEnergy) maxEnergy = e;
        if (e < minEnergy) minEnergy = e;
      }
      const { clean, noise } = makeDigitData(digit);
      return { gradPath, energyOverTime, maxEnergy, minEnergy, cleanDigit: clean, noiseField: noise, digit };
    });
  }

  /** Render digit at given noise level (1 = full noise, 0 = clean), binarized */
  function renderDigitAtNoise(run: RunData, noiseLevel: number): HTMLCanvasElement {
    const ctx = digitCanvas!.getContext('2d')!;
    const imgData = ctx.createImageData(DIGIT_SIZE, DIGIT_SIZE);
    const bgRgb = parseColor(bgColor);
    for (let i = 0; i < DIGIT_SIZE * DIGIT_SIZE; i++) {
      const clean = run.cleanDigit[i];
      const noisy = clean + (run.noiseField[i] - 0.5) * 2 * noiseLevel;
      const fgRgb = parseColor('#D5D1E9');
      if (noisy > 0.5) {
        imgData.data[i * 4] = fgRgb[0];
        imgData.data[i * 4 + 1] = fgRgb[1];
        imgData.data[i * 4 + 2] = fgRgb[2];
      } else {
        imgData.data[i * 4] = bgRgb[0];
        imgData.data[i * 4 + 1] = bgRgb[1];
        imgData.data[i * 4 + 2] = bgRgb[2];
      }
      imgData.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
    return digitCanvas!;
  }

  /** Draw the digit thumbnail at (cx, cy), optionally with a dashed line from (fromX, fromY) */
  function drawDigitThumbnail(
    ctx: CanvasRenderingContext2D,
    digit: HTMLCanvasElement,
    cx: number, cy: number,
    fromX?: number, fromY?: number,
  ) {
    const half = THUMB_SIZE / 2;

    // Optional dashed line from dot to thumbnail
    if (fromX !== undefined && fromY !== undefined) {
      ctx.strokeStyle = '#888';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(fromX, fromY);
      ctx.lineTo(cx, cy);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw thumbnail with nearest-neighbor (pixelated)
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(digit, cx - half, cy - half, THUMB_SIZE, THUMB_SIZE);
    ctx.imageSmoothingEnabled = true;

  }


  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------
  function getProfileLayout() {
    const margin = { top: 80, right: 20, bottom: 44, left: 44 };
    return { margin, plotW: canvasW - margin.left - margin.right, plotH: canvasH - margin.top - margin.bottom };
  }

  function getTopDownLayout() {
    const margin = { top: 80, right: 20, bottom: 44, left: 44 };
    return { margin, plotW: canvasW - margin.left - margin.right, plotH: canvasH - margin.top - margin.bottom };
  }

  /** Draw static profile background (axes, labels) to offscreen canvas at internal res */
  function drawProfileBackground() {
    if (!profileCanvas) return;
    const dpr = window.devicePixelRatio || 2;

    profileCanvas.width = canvasW * dpr;
    profileCanvas.height = canvasH * dpr;
    profileCanvas.style.width = `${canvasW}px`;
    profileCanvas.style.height = `${canvasH}px`;

    profileBg = document.createElement('canvas');
    profileBg.width = canvasW * dpr;
    profileBg.height = canvasH * dpr;
    const ctx = profileBg.getContext('2d')!;
    ctx.scale(dpr, dpr);

    const w = canvasW;
    const h = canvasH;

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, h);

    const { margin, plotW, plotH } = getProfileLayout(w, h);

    // ENERGY label
    ctx.save();
    ctx.fillStyle = '#aaaaaa';
    ctx.font = '100 18px "Roboto Mono", monospace';
    ctx.textAlign = 'center';
    ctx.translate(20, margin.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('ENERGY', 0, 0);
    ctx.restore();

    // TIME label
    ctx.fillStyle = '#aaaaaa';
    ctx.font = '100 18px "Roboto Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('TIME', margin.left + plotW / 2, h - 10);

    // X axis
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(margin.left, margin.top + plotH);
    ctx.lineTo(margin.left + plotW, margin.top + plotH);
    ctx.stroke();
  }

  /** Draw static top-down background (contours, labels) to offscreen canvas */
  function drawTopDownBackground() {
    if (!topDownCanvas) return;
    const dpr = window.devicePixelRatio || 2;

    topDownCanvas.width = canvasW * dpr;
    topDownCanvas.height = canvasH * dpr;
    topDownCanvas.style.width = `${canvasW}px`;
    topDownCanvas.style.height = `${canvasH}px`;

    topDownBg = document.createElement('canvas');
    topDownBg.width = canvasW * dpr;
    topDownBg.height = canvasH * dpr;
    const ctx = topDownBg.getContext('2d')!;
    ctx.scale(dpr, dpr);

    const w = canvasW;
    const h = canvasH;

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, h);

    const { margin, plotW, plotH } = getTopDownLayout();

    // Axis labels
    ctx.fillStyle = '#aaaaaa';
    ctx.font = '100 18px "Roboto Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('X', margin.left + plotW / 2, h - 10);

    ctx.save();
    ctx.translate(20, margin.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Y', 0, 0);
    ctx.restore();

    // Evaluate on grid
    const gridRes = resolution;
    const values = new Float64Array(gridRes * gridRes);
    for (let j = 0; j < gridRes; j++) {
      for (let i = 0; i < gridRes; i++) {
        const x = xMin + (i / (gridRes - 1)) * (xMax - xMin);
        const y = yMin + (j / (gridRes - 1)) * (yMax - yMin);
        values[j * gridRes + i] = evaluateGMM(x, y);
      }
    }

    // Thresholds
    let maxVal = 0;
    for (let i = 0; i < values.length; i++) {
      if (values[i] > maxVal) maxVal = values[i];
    }
    const minThreshold = maxVal * 0.02;
    const thresholds: number[] = [];
    for (let i = 0; i < numContourLevels; i++) {
      thresholds.push(minThreshold + (i / (numContourLevels - 1)) * (maxVal - minThreshold));
    }

    const contourData = d3.contours()
      .size([gridRes, gridRes])
      .thresholds(thresholds)(Array.from(values));

    const path = d3.geoPath()
      .context(ctx)
      .projection(d3.geoTransform({
        point(gx: number, gy: number) {
          this.stream.point(
            margin.left + (gx / gridRes) * plotW,
            margin.top + (gy / gridRes) * plotH,
          );
        },
      }));

    ctx.strokeStyle = contourColor;
    ctx.lineWidth = 1.5;
    for (const feature of contourData) {
      ctx.beginPath();
      path(feature);
      ctx.stroke();
    }

  }

  /** Map gradient path point to top-down canvas pixel coords */
  function pathToTopDown(px: number, py: number): [number, number] {
    const w = canvasW;
    const h = canvasH;
    const { margin, plotW, plotH } = getTopDownLayout();
    const cx = margin.left + ((px - xMin) / (xMax - xMin)) * plotW;
    const cy = margin.top + ((py - yMin) / (yMax - yMin)) * plotH;
    return [cx, cy];
  }

  function animate() {
    animFrameId = requestAnimationFrame(animate);

    if (runs.length === 0) return;

    const cycleDuration = animDuration + 1; // animation + 1s pause
    const totalLoopTime = cycleDuration * runs.length;
    const globalElapsed = (performance.now() / 1000 - startTime) % totalLoopTime;

    currentRun = Math.min(Math.floor(globalElapsed / cycleDuration), runs.length - 1);
    const run = runs[currentRun];

    const elapsed = globalElapsed - currentRun * cycleDuration;
    const t = Math.min(elapsed / animDuration, 1);
    const easedT = 1 - Math.pow(1 - t, 2); // ease-out
    const numSteps = run.gradPath.length;
    const rawIdx = easedT * (numSteps - 1);
    const pathIdx = Math.min(Math.floor(rawIdx), numSteps - 1);
    const frac = rawIdx - pathIdx;

    // Noise level tied to energy: 1 at max energy, 0 at min energy
    const curEnergy = pathIdx < numSteps - 1
      ? run.energyOverTime[pathIdx] + frac * (run.energyOverTime[pathIdx + 1] - run.energyOverTime[pathIdx])
      : run.energyOverTime[pathIdx];
    const noiseLevel = 1 - t;

    // --- Left: energy over time ---
    if (profileCanvas && profileBg) {
      const ctx = profileCanvas.getContext('2d')!;
      const dpr = window.devicePixelRatio || 2;
      const w = canvasW;
      const h = canvasH;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(profileBg, 0, 0);
      ctx.scale(dpr, dpr);

      const { margin, plotW, plotH } = getProfileLayout(w, h);
      const ePad = (run.maxEnergy - run.minEnergy) * 0.1;
      const eMin = run.minEnergy - ePad;
      const eMax = run.maxEnergy + ePad;

      // Draw energy curve up to current step
      ctx.beginPath();
      ctx.strokeStyle = dotColor;
      ctx.lineWidth = 2;
      for (let i = 0; i <= pathIdx; i++) {
        const e = run.energyOverTime[i];
        const px = margin.left + (i / (numSteps - 1)) * plotW;
        const py = margin.top + plotH - ((e - eMin) / (eMax - eMin)) * plotH;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();

      // Interpolated position between steps
      const curE = pathIdx < numSteps - 1
        ? run.energyOverTime[pathIdx] + frac * (run.energyOverTime[pathIdx + 1] - run.energyOverTime[pathIdx])
        : run.energyOverTime[pathIdx];
      const dotPx = margin.left + (rawIdx / (numSteps - 1)) * plotW;
      const dotPy = margin.top + plotH - ((curE - eMin) / (eMax - eMin)) * plotH;

      const thumbY = THUMB_SIZE / 2 - 4;

      ctx.strokeStyle = '#555';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(dotPx, thumbY);
      ctx.lineTo(dotPx, margin.top + plotH);
      ctx.stroke();
      ctx.setLineDash([]);

      // Green dot
      ctx.beginPath();
      ctx.arc(dotPx, dotPy, 12, 0, Math.PI * 2);
      ctx.strokeStyle = dotColor;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(dotPx, dotPy, 4, 0, Math.PI * 2);
      ctx.fillStyle = dotColor;
      ctx.fill();

      // MNIST digit thumbnail at fixed height, x follows dot
      const digit = renderDigitAtNoise(run, noiseLevel);
      drawDigitThumbnail(ctx, digit, dotPx, thumbY);

      ctx.restore();
    }

    // --- Right: top-down with moving dot and trail ---
    if (topDownCanvas && topDownBg) {
      const ctx = topDownCanvas.getContext('2d')!;
      const dpr = window.devicePixelRatio || 2;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(topDownBg, 0, 0);
      ctx.scale(dpr, dpr);

      // Draw trail
      if (pathIdx >= 1) {
        ctx.beginPath();
        ctx.strokeStyle = dotColor;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 1;
        const [sx, sy] = pathToTopDown(run.gradPath[0][0], run.gradPath[0][1]);
        ctx.moveTo(sx, sy);
        const step = Math.max(1, Math.floor(pathIdx / 150));
        for (let i = step; i <= pathIdx; i += step) {
          const [cx, cy] = pathToTopDown(run.gradPath[i][0], run.gradPath[i][1]);
          ctx.lineTo(cx, cy);
        }
        // Ensure we draw to the exact current point
        const [endX, endY] = pathToTopDown(run.gradPath[pathIdx][0], run.gradPath[pathIdx][1]);
        ctx.lineTo(endX, endY);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Draw dot at current position
      const [dotX, dotY] = pathToTopDown(run.gradPath[pathIdx][0], run.gradPath[pathIdx][1]);

      ctx.beginPath();
      ctx.arc(dotX, dotY, 5, 0, Math.PI * 2);
      ctx.fillStyle = dotColor;
      ctx.fill();

      // MNIST digit thumbnail at fixed height, x follows dot
      const { margin: tdMargin } = getTopDownLayout(canvasW, canvasH);
      const digit = renderDigitAtNoise(run, noiseLevel);
      const thumbY = THUMB_SIZE / 2 - 4;
      drawDigitThumbnail(ctx, digit, dotX, thumbY, dotX, dotY);

      ctx.restore();
    }
  }

  function parseColor(hex: string): [number, number, number] {
    const h = hex.replace('#', '');
    return [
      parseInt(h.substring(0, 2), 16),
      parseInt(h.substring(2, 4), 16),
      parseInt(h.substring(4, 6), 16),
    ];
  }

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------
  onMount(() => {
    initRuns();
    drawProfileBackground();
    drawTopDownBackground();
    startTime = performance.now() / 1000;
    animate();
  });

  onDestroy(() => {
    cancelAnimationFrame(animFrameId);
  });
</script>

<div class="wrapper" style="width: {totalWidth}px; max-width: 100%;">
  <h1 class="title">Energy Based Models</h1>
  <div class="canvases" style="gap: {gap}px;">
    <div class="canvas-container">
      <canvas bind:this={profileCanvas}></canvas>
    </div>
    <div class="canvas-container">
      <canvas bind:this={topDownCanvas}></canvas>
    </div>
  </div>
</div>

<style>
  .wrapper {
    position: relative;
  }

  .title {
    margin: 0 0 12px 0;
    font-family: 'Roboto Mono', monospace;
    color: #FF3B59;
    font-size: 1.8rem;
    font-weight: 300;
    letter-spacing: 0.05em;
    text-align: center;
  }

  .canvases {
    display: flex;
  }

  .canvas-container {
    position: relative;
    border-radius: 12px;
    overflow: hidden;
  }
</style>
