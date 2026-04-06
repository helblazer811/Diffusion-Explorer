<script>
  import { onDestroy } from "svelte";
  import { drawScatterPlot, drawMathjax, drawArrowHead, createSourceTargetScales, useCanvas2D } from "@diffusion-explorer/ui";
  import { settings } from "$lib/settings";

  export let allTimeSamples;
  export let width = 1800;
  export let height = 700;
  export let pointRadius = 5;
  export let pointOpacity = 0.5;
  export let labelFontSize = 50;
  export let sourceCenterX = 0.25;
  export let targetCenterX = 0.75;
  export let distributionScaleFactor = 0.85;
  export let arrowColor = '#555';
  export let arrowWidth = 4;
  export let highlightIndex = 15;
  export let highlightRadius = 12;
  export let arrowHeadRadius = 12;
  export let fLabelFontSize = 44;
  export let children = undefined;
  export let header = undefined;

  let canvas = null;
  const canvas2d = useCanvas2D(width, height);

  let scales = null;
  let sourcePixelCoords = [];
  let targetPixelCoords = [];
  let highlightSourcePt = [0, 0];
  let highlightTargetPt = [0, 0];
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
    highlightSourcePt = sourcePixelCoords[idx];
    highlightTargetPt = targetPixelCoords[idx];

    isInitialized = true;
    draw();
  }

  function draw() {
    if (!ctx || !scales) return;
    ctx.clearRect(0, 0, width, height);

    const requestRedraw = () => draw();

    // Scatter plots
    drawScatterPlot(ctx, sourcePixelCoords, pointRadius, '#4594e3', pointOpacity);
    drawScatterPlot(ctx, targetPixelCoords, pointRadius, '#f17720', pointOpacity);

    // Highlight points
    ctx.save();
    ctx.beginPath();
    ctx.arc(highlightSourcePt[0], highlightSourcePt[1], highlightRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#4594e3';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(highlightTargetPt[0], highlightTargetPt[1], highlightRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#f17720';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();

    // Curved arrow connecting source point to target point
    const sx = highlightSourcePt[0];
    const sy = highlightSourcePt[1];
    const tx = highlightTargetPt[0];
    const ty = highlightTargetPt[1];
    const mx = (sx + tx) / 2;
    const my = Math.min(sy, ty) - 80;

    ctx.save();
    ctx.strokeStyle = arrowColor;
    ctx.lineWidth = arrowWidth;
    ctx.beginPath();
    ctx.moveTo(sx + highlightRadius + 4, sy);
    ctx.quadraticCurveTo(mx, my, tx - highlightRadius - 4, ty);
    ctx.stroke();

    // Arrowhead at left side of target point
    ctx.fillStyle = arrowColor;
    const prevX = (tx - highlightRadius - 4) - ((tx - highlightRadius - 4) - mx) * 0.05;
    const prevY = ty - (ty - my) * 0.05;
    drawArrowHead(ctx, prevX, prevY, tx - highlightRadius - 4, ty, arrowHeadRadius);
    ctx.restore();

    // f(z) label above arrow
    drawMathjax(ctx, "f(z)", mx, my + 15, fLabelFontSize, 0, 0, { color: arrowColor }, requestRedraw);
  }

  export function restart() { draw(); }
  export function pause() {}

  $: ctx = canvas && canvas2d.ctx;

  $: if (ctx && !isInitialized && $allTimeSamples && $allTimeSamples.length > 0) {
    runInitialComputation();
  }
</script>

<figure style="width: 100%; max-width: {width}px; margin: 0 auto; display: flex; flex-direction: column; gap: 0.75rem;">
  {#if header}
    <div>{@render header?.()}</div>
  {/if}
  <canvas
    bind:this={canvas}
    use:canvas2d.bindCanvas
    style="width: 100%; height: auto; aspect-ratio: {width}/{height};"
  />
  {#if children}
    <figcaption style="font-size: 1.1rem; line-height: 1.5; color: #666; text-align: left;">
      {@render children?.()}
    </figcaption>
  {/if}
</figure>
