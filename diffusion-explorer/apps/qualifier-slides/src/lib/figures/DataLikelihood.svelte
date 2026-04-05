<script>
  import { onDestroy } from 'svelte';
  import {
    useCanvas2D,
    drawScatterPlot,
    drawMathjax,
    createSourceTargetScales,
    computeContours,
    plotContours,
  } from '@diffusion-explorer/ui';
  import { settings } from '$lib/settings';

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------
  export let width = 1800;
  export let height = 700;
  export let allTimeSamples;
  export let contourColor = '#f17720';
  export let highlightColor = '#f17720';
  export let highlightRadius = 14;
  export let highlightIndex = 15;
  export let distributionScaleFactor = 0.85;

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------
  let canvas = null;
  const canvas2d = useCanvas2D(width, height);
  let ctx = null;
  let isInitialized = false;

  let sourcePixelCoords = [];
  let targetPixelCoords = [];
  let sourceContours = null;
  let targetContours = null;
  let scales = null;
  let highlightSourcePixel = [0, 0];
  let highlightTargetPixel = [0, 0];

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------
  function runInitialComputation() {
    if (!canvas) return;
    const samples = $allTimeSamples;
    if (!samples || samples.length === 0) return;

    const sourceSamples = samples[0];
    const targetSamples = samples[samples.length - 1];
    if (!sourceSamples || !targetSamples) return;

    scales = createSourceTargetScales(sourceSamples, targetSamples, {
      width, height,
      marginWidth: 50, marginHeight: 20,
      sourceCenterX: 0.25, targetCenterX: 0.75,
      yShiftFactor: settings.stylingSettings.scatterPlot.yShiftFactor,
      distributionScaleFactor,
    });

    sourcePixelCoords = sourceSamples.map(p => [
      scales.sourceCenterPixelX + (p[0] - scales.sourceMeanX) * scales.xScaleFactor,
      scales.yScale(p[1]),
    ]);
    targetPixelCoords = targetSamples.map(p => [
      scales.targetCenterPixelX + (p[0] - scales.targetMeanX) * scales.xScaleFactor,
      scales.yScale(p[1]),
    ]);

    // Compute contours
    sourceContours = computeContours(sourceSamples, {
      bandwidth: 10, thresholds: 5,
    });
    targetContours = computeContours(targetSamples, {
      bandwidth: 10, thresholds: 5,
    });

    const idx = highlightIndex % sourceSamples.length;
    highlightSourcePixel = sourcePixelCoords[idx];
    highlightTargetPixel = targetPixelCoords[idx];

    isInitialized = true;
    draw();
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------
  function requestRedraw() { draw(); }

  function draw() {
    if (!ctx || !scales || !isInitialized) return;
    ctx.clearRect(0, 0, width, height);

    // Source contours + scatter
    const sxScale = (x) => scales.sourceCenterPixelX + (x - scales.sourceMeanX) * scales.xScaleFactor;
    const syScale = (y) => scales.yScale(y);

    if (sourceContours) {
      plotContours(ctx, sourceContours, {
        xScale: sxScale, yScale: syScale,
        fillColor: contourColor, opacity: 0.12,
        fill: true, stroke: false,
      });
    }
    drawScatterPlot(ctx, sourcePixelCoords, 5, contourColor, 0.15);

    // Target contours + scatter
    const txScale = (x) => scales.targetCenterPixelX + (x - scales.targetMeanX) * scales.xScaleFactor;

    if (targetContours) {
      plotContours(ctx, targetContours, {
        xScale: txScale, yScale: syScale,
        fillColor: contourColor, opacity: 0.12,
        fill: true, stroke: false,
      });
    }
    drawScatterPlot(ctx, targetPixelCoords, 5, contourColor, 0.15);

    // Highlight points
    for (const pt of [highlightSourcePixel, highlightTargetPixel]) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(pt[0], pt[1], highlightRadius, 0, Math.PI * 2);
      ctx.fillStyle = highlightColor;
      ctx.globalAlpha = 1;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }

    // Labels
    const labelY = height - 25;
    drawMathjax(ctx, 'p(z)', scales.sourceCenterPixelX, labelY, 50, 0, 0, { color: '#333' }, requestRedraw);
    drawMathjax(ctx, 'p(x)', scales.targetCenterPixelX, labelY, 50, 0, 0, { color: '#333' }, requestRedraw);
  }

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------
  export function restart() { draw(); }
  export function pause() {}

  $: ctx = canvas && canvas2d.ctx;

  $: if (ctx && !isInitialized && $allTimeSamples && $allTimeSamples.length > 0) {
    runInitialComputation();
  }
</script>

<div style="position: relative; width: {width}px; height: {height}px; margin: 0 auto;">
  <canvas
    bind:this={canvas}
    use:canvas2d.bindCanvas
    width={width}
    height={height}
    style="position: absolute; top: 0; left: 0;"
  />
  <!-- SVG overlay for arrow annotations -->
  {#if isInitialized}
    <svg
      viewBox="0 0 {width} {height}"
      style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible;"
    >
      <defs>
        <marker id="arrow-source" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 Z" fill="#22c55e" />
        </marker>
        <marker id="arrow-target" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 Z" fill="#e74c3c" />
        </marker>
      </defs>

      <!-- Source annotation: "Easy to evaluate" -->
      <line
        x1={highlightSourcePixel[0] - 70}
        y1={highlightSourcePixel[1] - 115}
        x2={highlightSourcePixel[0]}
        y2={highlightSourcePixel[1] - highlightRadius - 4}
        stroke="#22c55e" stroke-width="3" marker-end="url(#arrow-source)" />
      <text
        x={highlightSourcePixel[0] - 240}
        y={highlightSourcePixel[1] - 130}
        fill="#22c55e" font-size="36" font-family="Libre Baskerville, Georgia, serif">
        Easy to evaluate p(z)
      </text>

      <!-- Target annotation: "Less straightforward" -->
      <line
        x1={highlightTargetPixel[0] + 60}
        y1={highlightTargetPixel[1] - 115}
        x2={highlightTargetPixel[0]}
        y2={highlightTargetPixel[1] - highlightRadius - 4}
        stroke="#e74c3c" stroke-width="3" marker-end="url(#arrow-target)" />
      <text
        x={highlightTargetPixel[0] + 40}
        y={highlightTargetPixel[1] - 130}
        fill="#e74c3c" font-size="36" font-family="Libre Baskerville, Georgia, serif">
        Less straightforward
      </text>
    </svg>
  {/if}
</div>
