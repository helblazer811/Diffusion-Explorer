<script>
  import { onDestroy } from "svelte";
  import { drawScatterPlot, drawMathjax, createSourceTargetScales, useCanvas2D } from "@diffusion-explorer/ui";
  import { settings } from "$lib/settings";

  export let allTimeSamples;
  export let width = 1800;
  export let height = 800;
  export let pointColor = '#4594e3';
  export let pointRadius = 5;
  export let pointOpacity = 0.5;
  export let labelFontSize = 50;
  export let sourceCenterX = 0.25;
  export let targetCenterX = 0.75;
  export let distributionScaleFactor = 0.85;
  export let highlightColor = '#f17720';
  export let highlightRadius = 10;
  export let highlightIndex = 15;

  let canvas = null;
  const canvas2d = useCanvas2D(width, height);

  let scales = null;
  let sourcePixelCoords = [];
  let targetPixelCoords = [];
  let highlightSourcePixel = [0, 0];
  let highlightTargetPixel = [0, 0];
  let isInitialized = false;

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
      sourceCenterX, targetCenterX,
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

    const idx = highlightIndex % sourceSamples.length;
    highlightSourcePixel = sourcePixelCoords[idx];
    highlightTargetPixel = targetPixelCoords[idx];

    isInitialized = true;
    draw();
  }

  function draw() {
    if (!ctx || !scales) return;
    ctx.clearRect(0, 0, width, height);

    const requestRedraw = () => draw();

    // Labels above
    drawMathjax(ctx, "p(z)", scales.sourceCenterPixelX, 100, labelFontSize, 0, 0, { color: '#4594e3' }, requestRedraw);
    drawMathjax(ctx, "p(x)", scales.targetCenterPixelX, 100, labelFontSize, 0, 0, { color: '#f17720' }, requestRedraw);


    // Scatter plots
    drawScatterPlot(ctx, sourcePixelCoords, pointRadius, '#4594e3', pointOpacity);
    drawScatterPlot(ctx, targetPixelCoords, pointRadius, '#f17720', pointOpacity);

    // Highlight points are drawn in SVG so they appear above the lines
  }

  export function restart() { draw(); }
  export function pause() {}

  $: ctx = canvas && canvas2d.ctx;

  $: if (ctx && !isInitialized && $allTimeSamples && $allTimeSamples.length > 0) {
    runInitialComputation();
  }
</script>

<div style="position: relative; width: 100%; max-width: {width}px; margin: 0 auto; aspect-ratio: {width}/{height};">
  <canvas
    bind:this={canvas}
    use:canvas2d.bindCanvas
    style="width: 100%; height: auto; aspect-ratio: {width}/{height};"
  />
  {#if isInitialized}
    <svg
      viewBox="0 0 {width} {height}"
      style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible;"
    >
      <!-- Source annotation (below point, offset left) -->
      <line
        x1={highlightSourcePixel[0] - 60}
        y1={highlightSourcePixel[1] + 90}
        x2={highlightSourcePixel[0] - 5}
        y2={highlightSourcePixel[1] + 8}
        stroke="#333" stroke-width="2.5" />
      <rect
        x={highlightSourcePixel[0] - 250}
        y={highlightSourcePixel[1] + 95}
        width="470" height="55" rx="6"
        fill="white" fill-opacity="0.8" />
      <text
        x={highlightSourcePixel[0] - 240}
        y={highlightSourcePixel[1] + 135}
        fill="#333" font-size="46" font-family="Libre Baskerville, Georgia, serif">
        Easy to evaluate p(z)
      </text>

      <!-- Target annotation (below point, offset right) -->
      <line
        x1={highlightTargetPixel[0] + 60}
        y1={highlightTargetPixel[1] + 90}
        x2={highlightTargetPixel[0] + 5}
        y2={highlightTargetPixel[1] + 8}
        stroke="#333" stroke-width="2.5" />
      <rect
        x={highlightTargetPixel[0] - 10}
        y={highlightTargetPixel[1] + 95}
        width="420" height="55" rx="6"
        fill="white" fill-opacity="0.8" />
      <text
        x={highlightTargetPixel[0]}
        y={highlightTargetPixel[1] + 135}
        fill="#333" font-size="46" font-family="Libre Baskerville, Georgia, serif">
        Less straightforward
      </text>

      <!-- Source distribution label below scatter plot -->
      <text
        x={scales.sourceCenterPixelX}
        y={height - 30}
        fill="#4594e3" font-size="46" font-family="Libre Baskerville, Georgia, serif"
        text-anchor="middle">
        Multivariate Gaussian
      </text>

      <!-- Highlight points (drawn last so they appear above lines) -->
      <circle
        cx={highlightSourcePixel[0] - 5}
        cy={highlightSourcePixel[1] + 8}
        r={highlightRadius}
        fill="#4594e3" />
      <circle
        cx={highlightTargetPixel[0] + 5}
        cy={highlightTargetPixel[1] + 8}
        r={highlightRadius}
        fill="#f17720" />
    </svg>
  {/if}
</div>
