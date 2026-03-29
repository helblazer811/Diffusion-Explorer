<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { base } from '$app/paths';
  import {
    Timeline,
    useCanvas2D,
    drawScatterPlot,
    drawText,
    drawMathjax,
    createSourceTargetScales,
    createPauseClip,
    ContourRenderer,
    createLinearColorScale,
    parseContourColor,
    computeContours,
    plotContours,
  } from '@diffusion-explorer/ui';
  import type { ColorScaleFn } from '@diffusion-explorer/ui';
  import { generateClippedGaussianSamples, clipSamplesToRadius } from '@diffusion-explorer/diffusion';

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------
  let {
    width = 1720,
    height = 700,
    animationDuration = 8000,
    contourGridSize = 80,
    contourBandwidth = 14,
    contourThresholds = 3 as number | number[],
    contourFillColor = '#f17720',
    contourBlendMode = 'multiply' as string | undefined,
  }: {
    width?: number;
    height?: number;
    animationDuration?: number;
    contourGridSize?: number;
    contourBandwidth?: number;
    contourThresholds?: number | number[];
    contourFillColor?: string;
    contourBlendMode?: string | undefined;
  } = $props();

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------
  let canvas: HTMLCanvasElement | null = $state(null);
  const canvas2d = useCanvas2D(width, height);
  let ctx: CanvasRenderingContext2D | null = $state(null);

  let scales: ReturnType<typeof createSourceTargetScales> | null = $state(null);
  let sourcePixelCoords: number[][] = $state([]);
  let targetPixelCoords: number[][] = $state([]);

  let sourceDistribution: number[][] = $state([]);
  let targetDistribution: number[][] = $state([]);
  let allTimeSamples: number[][][] = $state([]);

  let isInitialized = $state(false);

  // GPU contour rendering
  let contourRenderer: ContourRenderer | null = null;
  let contourCanvas: HTMLCanvasElement | null = null;
  let contoursReady = $state(false);
  let useGPUContours = true;
  let contourDataDomain: { xMin: number; xMax: number; yMin: number; yMax: number } | null = null;

  type AnimationState = {
    time: number;
    currentStep: number;
  };

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  function getPixelX(dataX: number, dataMeanX: number, t: number): number {
    if (!scales) return 0;
    const centerPixelX =
      scales.sourceCenterPixelX +
      t * (scales.targetCenterPixelX - scales.sourceCenterPixelX);
    return centerPixelX + (dataX - dataMeanX) * scales.xScaleFactor;
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function runInitialComputation() {
    if (!canvas || sourceDistribution.length === 0 || targetDistribution.length === 0) return;

    scales = createSourceTargetScales(
      sourceDistribution as [number, number][],
      targetDistribution as [number, number][],
      {
        width,
        height,
        marginWidth: 50,
        marginHeight: 30,
        sourceCenterX: 0.2,
        targetCenterX: 0.8,
        yShiftFactor: -0.8,
        distributionScaleFactor: 0.6,
      }
    );

    sourcePixelCoords = sourceDistribution.map((p) => [
      scales!.sourceCenterPixelX + (p[0] - scales!.sourceMeanX) * scales!.xScaleFactor,
      scales!.yScale(p[1]),
    ]);

    targetPixelCoords = targetDistribution.map((p) => [
      scales!.targetCenterPixelX + (p[0] - scales!.targetMeanX) * scales!.xScaleFactor,
      scales!.yScale(p[1]),
    ]);
  }

  async function initGPUContours() {
    if (!scales || allTimeSamples.length === 0) return;

    try {
      // Compute domain from all samples
      let xMin = Infinity, xMax = -Infinity;
      let yMin = Infinity, yMax = -Infinity;
      for (const samples of allTimeSamples) {
        for (const [x, y] of samples) {
          if (x < xMin) xMin = x;
          if (x > xMax) xMax = x;
          if (y < yMin) yMin = y;
          if (y > yMax) yMax = y;
        }
      }
      const xPad = (xMax - xMin) * 0.1;
      const yPad = (yMax - yMin) * 0.1;
      contourDataDomain = {
        xMin: xMin - xPad, xMax: xMax + xPad,
        yMin: yMin - yPad, yMax: yMax + yPad,
      };

      const dataWidth = contourDataDomain.xMax - contourDataDomain.xMin;
      const dataHeight = contourDataDomain.yMax - contourDataDomain.yMin;
      const pixelWidth = dataWidth * scales.xScaleFactor;
      const yTop = scales.yScale(contourDataDomain.yMax);
      const yBottom = scales.yScale(contourDataDomain.yMin);
      const pixelHeight = Math.abs(yBottom - yTop);
      const contourPixelSize = Math.max(pixelWidth, pixelHeight);

      const dpr = window.devicePixelRatio || 1;
      contourCanvas = document.createElement('canvas');
      contourCanvas.width = Math.ceil(contourPixelSize * dpr);
      contourCanvas.height = Math.ceil(contourPixelSize * dpr);

      const baseColor = parseContourColor(contourFillColor);
      const colorScale = createLinearColorScale(
        [baseColor[0], baseColor[1], baseColor[2], 0.0],
        [baseColor[0], baseColor[1], baseColor[2], 1.0]
      );

      contourRenderer = await ContourRenderer.create({
        canvas: contourCanvas,
        gridSize: contourGridSize,
        bandwidth: contourBandwidth,
        thresholds: contourThresholds,
        opacity: 1.0,
        colorScale,
        dpr,
        preferGPU: true,
      });

      // Queue all frames
      for (let i = 0; i < allTimeSamples.length; i++) {
        const samples = allTimeSamples[i];
        const points = new Float32Array(samples.length * 2);
        for (let j = 0; j < samples.length; j++) {
          points[j * 2] = samples[j][0];
          points[j * 2 + 1] = samples[j][1];
        }
        contourRenderer.setPointsForFrame(i, points, contourDataDomain);
      }

      await contourRenderer.computeAllFrames();
      contoursReady = true;
    } catch (e) {
      console.warn('[FlowProbabilityPath] GPU contour init failed, falling back to CPU:', e);
      useGPUContours = false;
      contourRenderer = null;
      contourCanvas = null;
      contourDataDomain = null;
    }
  }

  // ----------------------------------------------------------------
  // Animation
  // ----------------------------------------------------------------

  const timeline = new Timeline<AnimationState>();
  timeline.duration = animationDuration / 1000;
  timeline.looping = true;
  timeline.setEndPause(1.5);
  timeline.initialState = { time: 0, currentStep: 0 };

  let cachedNumSteps = 1;

  function setupTimeline() {
    cachedNumSteps = allTimeSamples.length || 1;

    timeline.add({
      name: 'MainAnimation',
      reduce(t: number) {
        return {
          time: t,
          currentStep: Math.round(t * (cachedNumSteps - 1)),
        };
      },
    }, { start: 0, end: 0.87 });

    timeline.add(createPauseClip(), { start: 0.87, end: 1.0 });

    timeline.onTick((_t: number, state: Readonly<AnimationState>) => {
      draw(state);
    });
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function draw(state: AnimationState) {
    if (!ctx || !scales || !isInitialized) return;
    ctx.clearRect(0, 0, width, height);

    // --- Static Background ---
    drawScatterPlot(ctx, sourcePixelCoords, 5, '#3b82f6', 0.25);
    drawScatterPlot(ctx, targetPixelCoords, 5, '#3b82f6', 0.25);

    // Labels
    drawText(ctx, 'Noise Distribution', scales.sourceCenterPixelX, 25, {
      font: '600 54px Libre Baskerville, Georgia, serif',
      color: '#333',
      opacity: 1.0,
      align: 'center',
      baseline: 'top',
    });
    drawText(ctx, 'Data Distribution', scales.targetCenterPixelX, 25, {
      font: '600 54px Libre Baskerville, Georgia, serif',
      color: '#333',
      opacity: 1.0,
      align: 'center',
      baseline: 'top',
    });

    // LaTeX labels
    drawMathjax(ctx, 'p(z)', scales.sourceCenterPixelX, 150, 36, 0, 0, { color: '#333' });
    drawMathjax(ctx, 'p(x)', scales.targetCenterPixelX, 150, 36, 0, 0, { color: '#333' });

    // --- Dynamic Foreground ---
    const t = state.time;

    if (allTimeSamples.length > 0) {
      const samples = allTimeSamples[state.currentStep];
      if (samples && samples.length > 0) {
        const meanX = samples.reduce((s, p) => s + p[0], 0) / samples.length;

        // Draw contours
        if (contoursReady && contourRenderer && contourCanvas && contourDataDomain) {
          // GPU path: draw pre-computed frame
          contourRenderer.drawFrame(state.currentStep);

          const centerPixelX = scales.sourceCenterPixelX +
            t * (scales.targetCenterPixelX - scales.sourceCenterPixelX);

          const dataWidth = contourDataDomain.xMax - contourDataDomain.xMin;
          const leftOffset = (contourDataDomain.xMin - meanX) * scales.xScaleFactor;
          const destX = centerPixelX + leftOffset;
          const destWidth = dataWidth * scales.xScaleFactor;
          const destY = scales.yScale(contourDataDomain.yMax);
          const destHeight = scales.yScale(contourDataDomain.yMin) - destY;

          ctx.save();
          if (contourBlendMode) {
            ctx.globalCompositeOperation = contourBlendMode;
          }
          ctx.translate(destX, destY + destHeight);
          ctx.scale(1, -1);
          ctx.drawImage(
            contourCanvas,
            0, 0, contourCanvas.width, contourCanvas.height,
            0, 0, destWidth, destHeight
          );
          ctx.restore();
        } else {
          // CPU fallback
          const xScaleForContour = (dataX: number) => getPixelX(dataX, meanX, t);
          const yScaleForContour = (dataY: number) => scales!.yScale(dataY);

          const contourData = computeContours(samples as [number, number][], {
            bandwidth: contourBandwidth,
            thresholds: contourThresholds,
            gridSize: contourGridSize,
          });

          plotContours(ctx, contourData, {
            xScale: xScaleForContour,
            yScale: yScaleForContour,
            fillColor: contourFillColor,
            opacity: 0.5,
            blendMode: contourBlendMode,
            fill: true,
            stroke: false,
          });
        }

        // Draw intermediate scatter
        const coords = samples.map((p) => [
          getPixelX(p[0], meanX, t),
          scales!.yScale(p[1]),
        ]);
        drawScatterPlot(ctx, coords, 5, '#f17720', 0.5);
      }
    }

    // p_t label following the intermediate distribution
    if (t >= 0.05 && t <= 0.95) {
      const centerX = scales.sourceCenterPixelX + t * (scales.targetCenterPixelX - scales.sourceCenterPixelX);
      drawMathjax(ctx, 'p_t', centerX, 150, 36, 0, 0, { color: '#f17720' });
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
    if (isInitialized || !canvas || !ctx ||
        sourceDistribution.length === 0 || targetDistribution.length === 0 ||
        allTimeSamples.length === 0) return;
    runInitialComputation();
    setupTimeline();
    isInitialized = true;

    // Init GPU contours async (don't block initial render)
    initGPUContours().then(() => {
      if (contoursReady) {
        draw(timeline.state);
      }
    });
  }

  onMount(async () => {
    try {
      const [targetRes, trajRes] = await Promise.all([
        fetch(`${base}/rf_data/smiley_face.json`),
        fetch(`${base}/rf_cached_samples/flow_matching_trajectories.json`),
      ]);

      if (targetRes.ok) {
        const data = await targetRes.json();
        targetDistribution = data.points || [];
      }
      if (trajRes.ok) {
        allTimeSamples = await trajRes.json();
      }

      sourceDistribution = clipSamplesToRadius(generateClippedGaussianSamples(300), 2.0);

      tryInitialize();
    } catch (e) {
      console.warn('Failed to load data:', e);
    }
  });

  onDestroy(() => {
    timeline.pause();
    if (contourRenderer) {
      contourRenderer.destroy();
      contourRenderer = null;
    }
    contourCanvas = null;
    contoursReady = false;
    contourDataDomain = null;
  });
</script>

<div style="width: {width}px;">
  <canvas
    bind:this={canvas}
    use:canvas2d.bindCanvas
    style="width: 100%; height: auto; aspect-ratio: {width}/{height};"
  ></canvas>
</div>
