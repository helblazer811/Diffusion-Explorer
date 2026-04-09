<script lang="ts">
  import { onDestroy } from 'svelte';
  import {
    Timeline,
    TimelineBuilder,
    drawScatterPlot,
    drawMathjax,
    computeContours,
    plotContours,
    createSourceTargetScales,
    useCanvas2D,
    mathjaxInitialized,
  } from '@diffusion-explorer/ui';
  import { settings } from '$lib/settings';

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  export let allTimeSamples: any; // Writable<number[][][]>
  export let width = 1800;
  export let height = 850;
  export let sourceCenterX = 0.25;
  export let targetCenterX = 0.75;
  export let distributionScaleFactor = 1.0;
  export let highlightIndex = 15;
  export let looping = true;
  export let endPause = 5000; // ms

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  type AnimationState = {
    dotContourOpacity: number;  // Phase 1: z dot + Gaussian contours
    dashProgress: number;       // Phase 2: dashed line mean → z
    easyCalloutOpacity: number; // Phase 3: z label + "Easy to evaluate" callout
    dimOpacity: number;         // Phase 4: white overlay on left side
    xCalloutOpacity: number;    // Phase 5: x dot + x label + right callout
  };

  const initialState: AnimationState = {
    dotContourOpacity: 0,
    dashProgress: 0,
    easyCalloutOpacity: 0,
    dimOpacity: 0,
    xCalloutOpacity: 0,
  };

  const s = width / 1800;

  let canvas: HTMLCanvasElement | null = null;
  const canvas2d = useCanvas2D(width, height);
  $: ctx = canvas && canvas2d.ctx;

  let scales: ReturnType<typeof createSourceTargetScales> | null = null;
  let sourcePixelCoords: number[][] = [];
  let targetPixelCoords: number[][] = [];
  let highlightSourcePixel = [0, 0];
  let highlightTargetPixel = [0, 0];
  let sourceMeanPixelY = 0;
  let sourceContours: any = null;
  let timeline: Timeline<AnimationState> | null = null;
  let isInitialized = false;

  // Styling
  const sourceColor = '#4594e3';
  const targetColor = '#f17720';
  const labelFontSize = Math.round(52 * s);
  const pointRadius = 5 * s;
  const highlightRadius = 13 * s;
  const annotFontSize = Math.round(44 * s);
  const annotFont = `${annotFontSize}px Libre Baskerville, Georgia, serif`;

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function runInitialComputation() {
    const samples = $allTimeSamples as number[][][];
    if (!samples?.length) return;

    const sourceSamples = samples[0];
    const targetSamples = samples[samples.length - 1];

    scales = createSourceTargetScales(sourceSamples, targetSamples, {
      width,
      height,
      marginWidth: 60,
      marginHeight: 40,
      sourceCenterX,
      targetCenterX,
      yShiftFactor: settings.stylingSettings.scatterPlot.yShiftFactor,
      distributionScaleFactor,
    });

    sourcePixelCoords = sourceSamples.map((p: number[]) => [
      scales.sourceCenterPixelX + (p[0] - scales.sourceMeanX) * scales.xScaleFactor,
      scales.yScale(p[1]),
    ]);
    targetPixelCoords = targetSamples.map((p: number[]) => [
      scales.targetCenterPixelX + (p[0] - scales.targetMeanX) * scales.xScaleFactor,
      scales.yScale(p[1]),
    ]);

    // Find z point: right of source distribution, slightly above center (high x, moderate y)
    const srcIdx = sourceSamples.reduce((bestIdx: number, p: number[], i: number) => {
      const best = sourceSamples[bestIdx];
      return (3 * p[0] - 2 * p[1] > 3 * best[0] - 2 * best[1]) ? i : bestIdx;
    }, 0);
    highlightSourcePixel = sourcePixelCoords[srcIdx];

    // Find x point: right of target distribution, slightly above center
    const tgtIdx = targetSamples.reduce((bestIdx: number, p: number[], i: number) => {
      const best = targetSamples[bestIdx];
      return (3 * p[0] - 3 * p[1] > 3 * best[0] - 3 * best[1]) ? i : bestIdx;
    }, 0);
    highlightTargetPixel = targetPixelCoords[tgtIdx];

    // Source mean in pixel space (x = center, y = mean of y values)
    const meanY = sourceSamples.reduce((sum: number, p: number[]) => sum + p[1], 0) / sourceSamples.length;
    sourceMeanPixelY = scales.yScale(meanY);

    // Pre-compute Gaussian contours in data space
    sourceContours = computeContours(sourceSamples as [number, number][], {
      bandwidth: 12,
      thresholds: 4,
    });
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  function setupTimeline() {
    const builder = new TimelineBuilder<AnimationState>()
      .setInitialState(initialState)
      .setLooping(looping)
      .setEndPause(endPause);

    // Phase 1: z dot + contours fade in
    builder.add({ name: 'DotContour', reduce(t) { return { dotContourOpacity: t }; } }, { durationMs: 900 });
    // Phase 2: dashed line grows from z point to mean
    builder.add({ name: 'Dash', reduce(t) { return { dashProgress: t }; } }, { durationMs: 1200 });
    // Phase 3: easy callout
    builder.add({ name: 'EasyCallout', reduce(t) { return { easyCalloutOpacity: t }; } }, { durationMs: 800 });
    // Pause before dimming
    builder.add({ name: 'Pause', reduce() { return null; } }, { durationMs: 1500 });
    // Phase 4: dim left side
    builder.add({ name: 'Dim', reduce(t) { return { dimOpacity: t }; } }, { durationMs: 800 });
    // Phase 5: x dot + x label + right callout
    builder.add({ name: 'XCallout', reduce(t) { return { xCalloutOpacity: t }; } }, { durationMs: 800 });

    timeline = builder.build();
    timeline.onTick((_t, state) => draw(state));
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function draw(state: AnimationState = initialState) {
    if (!ctx || !scales) return;
    ctx.clearRect(0, 0, width, height);

    const requestRedraw = () => draw(timeline?.state ?? initialState);

    // ---- Static Background ----

    // Left scatter plot (always visible)
    drawScatterPlot(ctx, sourcePixelCoords, pointRadius, sourceColor, 0.45);

    // Right scatter plot — only after dim phase
    if (state.xCalloutOpacity > 0) {
      ctx.save();
      ctx.globalAlpha = state.xCalloutOpacity;
      drawScatterPlot(ctx, targetPixelCoords, pointRadius, targetColor, 0.45);
      ctx.restore();
    }

    // Distribution labels at top
    const labelY = Math.round(72 * s);
    ctx.save();
    ctx.font = `italic ${Math.round(64 * s)}px Libre Baskerville, Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = sourceColor;
    ctx.fillText('Z', scales.sourceCenterPixelX, labelY);
    if (state.xCalloutOpacity > 0) {
      ctx.globalAlpha = state.xCalloutOpacity;
      ctx.fillStyle = targetColor;
      ctx.fillText('X', scales.targetCenterPixelX, labelY);
    }
    ctx.restore();


    // ---- Phase 1: z dot + Gaussian contours ----
    if (state.dotContourOpacity > 0) {
      const op = state.dotContourOpacity;

      // Contours
      const xScaleFn = (dataX: number) =>
        scales.sourceCenterPixelX + (dataX - scales.sourceMeanX) * scales.xScaleFactor;
      const yScaleFn = (dataY: number) => scales.yScale(dataY);

      plotContours(ctx, sourceContours, {
        xScale: xScaleFn,
        yScale: yScaleFn,
        fillColor: sourceColor,
        opacity: 0.12 * op,
        fill: true,
        stroke: true,
        strokeColor: sourceColor,
        strokeWidth: 1.5 * s,
      });

      // z dot
      ctx.save();
      ctx.globalAlpha = op;
      ctx.fillStyle = sourceColor;
      ctx.beginPath();
      ctx.arc(highlightSourcePixel[0], highlightSourcePixel[1], highlightRadius, 0, 2 * Math.PI);
      ctx.fill();
      ctx.restore();

      // z label and p(z) above dot (appear with the dot)
      ctx.save();
      ctx.globalAlpha = op;
      drawMathjax(ctx, 'p(z)', highlightSourcePixel[0], highlightSourcePixel[1], Math.round(46 * s), 0, -(highlightRadius + 14 * s), { color: sourceColor }, requestRedraw);
      ctx.restore();
    }

    // ---- Phase 2: dashed line from mean to z ----
    if (state.dashProgress > 0 && state.dotContourOpacity > 0) {
      const prog = Math.min(state.dashProgress, 1);
      const mx = scales.sourceCenterPixelX;
      const my = sourceMeanPixelY;
      const px = highlightSourcePixel[0];
      const py = highlightSourcePixel[1];
      const endX = px + prog * (mx - px);
      const endY = py + prog * (my - py);

      ctx.save();
      ctx.strokeStyle = sourceColor;
      ctx.lineWidth = 5 * s;
      ctx.setLineDash([14 * s, 8 * s]);
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(endX, endY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Small dot at mean
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = sourceColor;
      ctx.beginPath();
      ctx.arc(mx, my, 5 * s, 0, 2 * Math.PI);
      ctx.fill();
      ctx.restore();
    }

    // ---- Phase 3: easy callout — bottom center of left side ----
    if (state.easyCalloutOpacity > 0) {
      const op = state.easyCalloutOpacity;
      const boxW = 460 * s;
      const boxH = 60 * s;
      const boxX = scales.sourceCenterPixelX - boxW / 2;
      const boxY = height - boxH - 18 * s;

      ctx.save();
      ctx.globalAlpha = op;
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxW, boxH, 7 * s);
      ctx.fill();
      ctx.fillStyle = sourceColor;
      ctx.font = annotFont;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Easy to evaluate p(z)', scales.sourceCenterPixelX, boxY + boxH / 2);
      ctx.restore();
    }

    // ---- Phase 4: white overlay on left half ----
    if (state.dimOpacity > 0) {
      ctx.save();
      ctx.globalAlpha = state.dimOpacity * 0.6;
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, width / 2, height);
      ctx.restore();
    }

    // ---- Phase 5: x dot + x label + right callout ----
    if (state.xCalloutOpacity > 0) {
      const op = state.xCalloutOpacity;
      const hx = highlightTargetPixel[0];
      const hy = highlightTargetPixel[1];

      ctx.save();
      ctx.globalAlpha = op;

      // x dot
      ctx.fillStyle = targetColor;
      ctx.beginPath();
      ctx.arc(hx, hy, highlightRadius, 0, 2 * Math.PI);
      ctx.fill();
      ctx.restore();

      // x label and p(x) above dot
      ctx.save();
      ctx.globalAlpha = op;
      drawMathjax(ctx, 'p(x)', hx, hy, Math.round(46 * s), 0, -(highlightRadius + 14 * s), { color: targetColor }, requestRedraw);
      ctx.restore();

      // Callout box — bottom center of right side
      const boxW = 560 * s;
      const boxH = 60 * s;
      const boxX = scales.targetCenterPixelX - boxW / 2;
      const boxY = height - boxH - 18 * s;

      ctx.save();
      ctx.globalAlpha = op;
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxW, boxH, 7 * s);
      ctx.fill();
      ctx.fillStyle = targetColor;
      ctx.font = annotFont;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Less straightforward', scales.targetCenterPixelX, boxY + boxH / 2);
      ctx.restore();
    }
  }

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  export function restart() {
    if (timeline) { timeline.reset(); timeline.play(); }
  }
  export function pause() {
    if (timeline) timeline.pause();
  }

  onDestroy(() => { if (timeline) timeline.pause(); });

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  $: if (ctx && !isInitialized && $allTimeSamples?.length > 0) {
    runInitialComputation();
    setupTimeline();
    isInitialized = true;
    mathjaxInitialized.then(() => draw(initialState));
    timeline!.play();
  }
</script>

<div style="width: {width}px; max-width: 100%;">
  <canvas
    bind:this={canvas}
    use:canvas2d.bindCanvas
    style="width: 100%; height: auto; aspect-ratio: {width}/{height};"
  ></canvas>
</div>
