<script lang="ts">
  import { onDestroy } from 'svelte';
  import {
    TimelineBuilder,
    Player,
    createPauseClip,
    useCanvas2D,
    drawScatterPlot,
    drawMathjax,
    drawText,
    computeContours,
    plotContours,
    waitForPendingRenders,
    TimelineInspector,
  } from '@diffusion-explorer/ui';
  import type { Clip } from '@diffusion-explorer/ui';

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------
  const REF_WIDTH = 1600;
  const REF_HEIGHT = 780;

  let {
    width = REF_WIDTH,
    numSamples = 200,
    contourBandwidth = 10,
    contourThresholds = 5 as number | number[],
    contourFillColor = '#f17720',
    looping = true,
  }: {
    width?: number;
    numSamples?: number;
    contourBandwidth?: number;
    contourThresholds?: number | number[];
    contourFillColor?: string;
    looping?: boolean;
  } = $props();

  const k = width / REF_WIDTH;
  const height = Math.round(REF_HEIGHT * k);

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------
  let canvas: HTMLCanvasElement | null = $state(null);
  const canvas2d = useCanvas2D(width, height);
  let ctx: CanvasRenderingContext2D | null = $state(null);
  let isInitialized = $state(false);

  type ResolutionData = {
    samples: number[][][];
    contours: any[];
  };

  let resolutions: Map<number, ResolutionData> = $state(new Map());
  let sourcePixelCoords: number[][] = $state([]);
  let targetPixelCoords: number[][] = $state([]);
  let sourceSamples: number[][] = $state([]);
  let targetSamples: number[][] = $state([]);

  type AnimState = {
    mode: 'sweep' | 'fadeout';
    stepProgress: number;
    numSteps: number;           // displayed K (for label + ticks)
    sweepResolution: number;    // resolution used for distribution data (4, 8, 16, or 256)
    isDiscrete: boolean;
    timelineTickCount: number;
    showTickLabels: boolean;
    tickOpacity: number;
    showUpArrow: boolean;
  };

  // Layout constants
  const sourceCenterX = width * 0.18;
  const targetCenterX = width * 0.82;
  const vertCenter = height * 0.52;
  const scaleFactor = 80 * k;
  const timelineY = height - 70 * k;

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

  function generateGaussianSamples(n: number, rng: () => number, meanX = 0, meanY = 0, std = 1): number[][] {
    const samples: number[][] = [];
    for (let i = 0; i < n; i++) {
      const [gx, gy] = gaussianPair(rng);
      samples.push([meanX + gx * std, meanY + gy * std]);
    }
    return samples;
  }

  function dataToPixelCoords(samples: number[][], centerX: number): number[][] {
    return samples.map((p) => [
      centerX + p[0] * scaleFactor,
      vertCenter - p[1] * scaleFactor,
    ]);
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function generateAllData() {
    const rng = mulberry32(42);

    sourceSamples = generateGaussianSamples(numSamples, rng, 0, 0, 1);

    const tgt: number[][] = [];
    const modeCenters = [
      [0, 1.4],
      [-1.2, -0.7],
      [1.2, -0.7],
    ];
    const modeStd = 0.3;
    const samplesPerMode = Math.floor(numSamples / 3);
    for (let m = 0; m < 3; m++) {
      for (let i = 0; i < samplesPerMode; i++) {
        const [gx, gy] = gaussianPair(rng);
        tgt.push([modeCenters[m][0] + gx * modeStd, modeCenters[m][1] + gy * modeStd]);
      }
    }
    while (tgt.length < numSamples) {
      const [gx, gy] = gaussianPair(rng);
      tgt.push([gx * modeStd, gy * modeStd]);
    }
    targetSamples = tgt;

    sourcePixelCoords = dataToPixelCoords(sourceSamples, sourceCenterX);
    targetPixelCoords = dataToPixelCoords(targetSamples, targetCenterX);

    // Pre-compute for sweep resolutions
    const resolutionSteps = [4, 8, 16, 256];
    const map = new Map<number, ResolutionData>();

    for (const N of resolutionSteps) {
      const allSamples: number[][][] = [];
      const allContours: any[] = [];

      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const interpolated = sourceSamples.map((src, j) => {
          const tgtPt = targetSamples[j];
          return [
            src[0] * (1 - t) + tgtPt[0] * t,
            src[1] * (1 - t) + tgtPt[1] * t,
          ];
        });
        allSamples.push(interpolated);

        const contourData = computeContours(interpolated as [number, number][], {
          bandwidth: contourBandwidth,
          thresholds: contourThresholds,
        });
        allContours.push(contourData);
      }

      map.set(N, { samples: allSamples, contours: allContours });
    }

    resolutions = map;
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  let player: Player<AnimState> | null = null;

  function createSweepClip(numSteps: number, isDiscrete: boolean): Clip<AnimState> {
    return {
      name: `Sweep_${numSteps}`,
      reduce(t: number) {
        const stepProgress = isDiscrete
          ? Math.round(t * numSteps) / numSteps
          : t;
        return {
          mode: 'sweep' as const,
          stepProgress,
          numSteps,
          sweepResolution: isDiscrete ? numSteps : 256,
          isDiscrete,
          timelineTickCount: isDiscrete ? numSteps + 1 : 0,
          showTickLabels: isDiscrete && numSteps <= 16,
          tickOpacity: isDiscrete ? 1 : 0,
          showUpArrow: false,
        };
      },
    };
  }

  function createCountUpClip(startK: number, endK: number, accelerate: boolean): Clip<AnimState> {
    return {
      name: `CountUp_${startK}_${endK}`,
      reduce(t: number) {
        const easedT = accelerate ? t * t * t : t;
        const currentK = startK + Math.round(easedT * (endK - startK));
        return {
          mode: 'sweep' as const,
          stepProgress: 1,
          numSteps: currentK,
          sweepResolution: startK,
          isDiscrete: true,
          timelineTickCount: currentK + 1,
          showTickLabels: currentK <= 16,
          tickOpacity: 1,
          showUpArrow: false,
        };
      },
    };
  }

  function createCountUpWithFadeout(startK: number, endK: number): Clip<AnimState> {
    // Ticks count up the whole time, but start fading out halfway through
    const fadeStart = 0.5;
    return {
      name: `CountUpFade_${startK}_${endK}`,
      reduce(t: number) {
        const easedT = t * t * t;
        const currentK = startK + Math.round(easedT * (endK - startK));
        const opacity = t < fadeStart ? 1 : 1 - (t - fadeStart) / (1 - fadeStart);
        return {
          mode: 'sweep' as const,
          stepProgress: 1,
          numSteps: currentK,
          sweepResolution: startK,
          isDiscrete: true,
          timelineTickCount: currentK + 1,
          showTickLabels: false,
          tickOpacity: opacity,
          showUpArrow: false,
        };
      },
    };
  }

  function setupTimeline() {
    const initialState: AnimState = {
      mode: 'sweep',
      stepProgress: 0,
      numSteps: 4,
      sweepResolution: 4,
      isDiscrete: true,
      timelineTickCount: 5,
      showTickLabels: true,
      tickOpacity: 1,
      showUpArrow: false,
    };

    const builder = new TimelineBuilder<AnimState>()
      .setInitialState(initialState);

    // 1. K=4 sweep
    builder.add(createSweepClip(4, true), { durationMs: 4000 });
    // 2. Count up 4→8
    builder.add(createCountUpClip(4, 8, false), { durationMs: 2000 });
    // 3. K=8 sweep
    builder.add(createSweepClip(8, true), { durationMs: 4000 });
    // 4. Count up 8→16
    builder.add(createCountUpClip(8, 16, false), { durationMs: 2000 });
    // 5. K=16 sweep
    builder.add(createSweepClip(16, true), { durationMs: 4000 });
    // 6. Count up 16→100 (accelerating) with tick fadeout in the last portion
    builder.add(createCountUpWithFadeout(16, 100), { durationMs: 3500 });
    // 7. Continuous sweep (K=∞)
    builder.add(createSweepClip(256, false), { durationMs: 5000 });

    const timeline = builder.build();
    player = new Player(timeline, { looping, endPause: 3 });

    player.onTick((_t: number, state: Readonly<AnimState>) => {
      draw(state);
    });
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function drawTimelineAxis(state: AnimState) {
    if (!ctx) return;

    const lineWidth = 3 * k;
    const tickHeight = 18 * k;
    const markerRadius = 8 * k;
    const labelFontSize = 30 * k;
    const leftX = sourceCenterX;
    const rightX = targetCenterX;
    const y = timelineY;

    ctx.save();

    // Horizontal line
    ctx.strokeStyle = '#555';
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(leftX, y);
    ctx.lineTo(rightX, y);
    ctx.stroke();

    // Progress fill
    const fillEnd = leftX + state.stepProgress * (rightX - leftX);
    ctx.fillStyle = contourFillColor;
    ctx.globalAlpha = 0.25;
    ctx.fillRect(leftX, y - 4 * k, fillEnd - leftX, 8 * k);
    ctx.globalAlpha = 1;

    if (state.timelineTickCount > 0 && state.tickOpacity > 0) {
      // Draw ticks
      ctx.strokeStyle = '#555';
      ctx.lineWidth = lineWidth;
      ctx.globalAlpha = state.tickOpacity;
      for (let i = 0; i < state.timelineTickCount; i++) {
        const frac = i / (state.timelineTickCount - 1);
        const tx = leftX + frac * (rightX - leftX);
        ctx.beginPath();
        ctx.moveTo(tx, y - tickHeight / 2);
        ctx.lineTo(tx, y + tickHeight / 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Numbered labels (only when showTickLabels and not too many ticks)
      if (state.showTickLabels && state.timelineTickCount <= 17) {
        for (let i = 0; i < state.timelineTickCount; i++) {
          const frac = i / (state.timelineTickCount - 1);
          const tx = leftX + frac * (rightX - leftX);
          drawMathjax(ctx, `${i}`, tx, y + 45 * k, labelFontSize * 0.8, 0, 0, { color: '#555' });
        }
      }
    }

    if (state.timelineTickCount === 0) {
      // Continuous: endpoint labels
      drawMathjax(ctx, '0', leftX, y + 45 * k, labelFontSize * 0.8, 0, 0, { color: '#555' });
      drawMathjax(ctx, '\\infty', rightX, y + 45 * k, labelFontSize * 0.8, 0, 0, { color: '#555' });
    }

    // Current position marker
    const markerX = leftX + state.stepProgress * (rightX - leftX);
    ctx.beginPath();
    ctx.arc(markerX, y, markerRadius, 0, 2 * Math.PI);
    ctx.fillStyle = contourFillColor;
    ctx.fill();

    ctx.restore();
  }

  function draw(state: AnimState) {
    if (!ctx || resolutions.size === 0) return;
    ctx.clearRect(0, 0, width, height);

    const dotRadius = 5 * k;
    const labelFontSize = 34 * k;
    const headerFontSize = 48 * k;

    // --- Static Background ---
    drawScatterPlot(ctx, sourcePixelCoords, dotRadius, '#3b82f6', 0.2);
    drawScatterPlot(ctx, targetPixelCoords, dotRadius, '#3b82f6', 0.2);

    drawText(ctx, 'Source Distribution', sourceCenterX, 22 * k, {
      font: `400 ${headerFontSize}px Libre Baskerville, Georgia, serif`,
      color: '#555',
      opacity: 1.0,
      align: 'center',
      baseline: 'top',
    });
    drawText(ctx, 'Data Distribution', targetCenterX, 22 * k, {
      font: `400 ${headerFontSize}px Libre Baskerville, Georgia, serif`,
      color: '#555',
      opacity: 1.0,
      align: 'center',
      baseline: 'top',
    });

    drawMathjax(ctx, 'p(z)', sourceCenterX, 140 * k, labelFontSize, 0, 0, { color: '#555' });
    drawMathjax(ctx, 'p(x)', targetCenterX, 140 * k, labelFontSize, 0, 0, { color: '#555' });

    // --- Dynamic Foreground ---

    // Use sweepResolution for data lookup (not numSteps, which is the displayed K)
    const resData = resolutions.get(state.sweepResolution);
    if (!resData) return;

    // Compute step index
    const stepIndex = state.isDiscrete
      ? Math.round(state.stepProgress * state.sweepResolution)
      : Math.round(state.stepProgress * state.sweepResolution);
    const clampedIndex = Math.min(stepIndex, resData.samples.length - 1);

    const samples = resData.samples[clampedIndex];
    const contourData = resData.contours[clampedIndex];

    // Compute center X for the moving distribution
    const centerX = sourceCenterX + state.stepProgress * (targetCenterX - sourceCenterX);

    // Draw contours
    const xScale = (dataX: number) => centerX + dataX * scaleFactor;
    const yScale = (dataY: number) => vertCenter - dataY * scaleFactor;

    plotContours(ctx, contourData, {
      xScale,
      yScale,
      fillColor: contourFillColor,
      opacity: 0.35,
      fill: true,
      stroke: false,
    });

    // Draw intermediate scatter (orange)
    const pixelCoords = dataToPixelCoords(samples, centerX);
    drawScatterPlot(ctx, pixelCoords, dotRadius, contourFillColor, 0.4);

    // Phase label
    const phaseLabelX = width / 2;
    const phaseLabelY = timelineY - 40 * k;
    let phaseLabel: string;
    if (!state.isDiscrete && state.tickOpacity === 0) {
      phaseLabel = `K \\to \\infty`;
    } else {
      phaseLabel = `K = ${state.numSteps}`;
    }
    drawMathjax(ctx, phaseLabel, phaseLabelX, phaseLabelY, headerFontSize, 0, 0, { color: '#555' });

    // Timeline axis
    drawTimelineAxis(state);
  }

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  export function restart() {
    if (!player) return;
    player.reset();
    player.play();
  }

  export function pause() {
    player?.pause();
  }

  $effect(() => {
    if (canvas) {
      ctx = canvas2d.ctx;
      tryInitialize();
    }
  });

  async function prewarmMathjaxCache() {
    if (!ctx) return;
    const allLabels: string[] = [];

    // K labels for count-up phases (4 through 100)
    for (let i = 4; i <= 100; i++) {
      allLabels.push(`K = ${i}`);
    }
    allLabels.push(`K \\to \\infty`);

    // Tick number labels (0 through 16)
    for (let i = 0; i <= 16; i++) {
      allLabels.push(`${i}`);
    }
    allLabels.push('\\infty');
    allLabels.push('p(z)');
    allLabels.push('p(x)');

    // Trigger caching by drawing offscreen
    for (const label of allLabels) {
      drawMathjax(ctx, label, -1000, -1000, 30, 0, 0, { color: '#555' });
    }

    // Wait for all pending renders, then do a second pass to catch any stragglers
    let pending = waitForPendingRenders();
    if (pending) await pending;

    for (const label of allLabels) {
      drawMathjax(ctx, label, -1000, -1000, 30, 0, 0, { color: '#555' });
    }
    pending = waitForPendingRenders();
    if (pending) await pending;
  }

  async function tryInitialize() {
    if (isInitialized || !canvas || !ctx) return;
    generateAllData();
    setupTimeline();
    isInitialized = true;
    await prewarmMathjaxCache();
    player?.play();
  }

  onDestroy(() => {
    player?.pause();
  });
</script>

<div style="width: {width}px; max-width: 100%;">
  <canvas
    bind:this={canvas}
    use:canvas2d.bindCanvas
    style="width: 100%; height: auto; aspect-ratio: {width}/{height}; margin-top: 20px;"
  ></canvas>
  <TimelineInspector {player} />
</div>
