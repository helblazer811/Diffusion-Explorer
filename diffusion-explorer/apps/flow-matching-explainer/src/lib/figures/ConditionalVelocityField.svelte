<script lang="ts">
  import { Figure, drawScatterPlot, drawLine, drawCircle, drawArrow, drawMathjax, createSourceTargetScales, useCanvas2D } from "@diffusion-explorer/ui";
  import { settings } from "$lib/settings";
  import type { Snippet } from "svelte";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  // Caption
  export let children: Snippet | undefined = undefined;

  // Data props
  export let sourceDistributionSamples: [number, number][] = [];
  export let targetDistributionSamples: [number, number][] = [];

  // Layout props
  export let width: number = 800;
  export let height: number = 450;
  export let marginWidth: number = 50;
  export let marginHeight: number = 20;
  export let sourceCenterX: number = settings.stylingSettings.layout.sourceCenterX;
  export let targetCenterX: number = settings.stylingSettings.layout.targetCenterX;
  export let yShiftFactor: number = -0.2;

  // Scatter plot styling
  export let pointRadius: number = settings.stylingSettings.scatterPlot.radius;
  export let pointOpacity: number = settings.stylingSettings.scatterPlot.opacity;
  export let sourcePointColor: string = settings.stylingSettings.scatterPlot.color;
  export let targetPointColor: string = settings.stylingSettings.scatterPlot.color;

  // Path line styling
  export let pathLineColor: string = "#888";
  export let pathLineOpacity: number = 0.25;
  export let pathLineWidth: number = 3;
  export let numPathLines: number = 15;

  // Selected target point styling
  export let selectedTargetColor: string = "#888";
  export let selectedTargetRadius: number = 5;

  // Intermediate point styling
  export let intermediatePointColor: string = "#f17720";
  export let intermediatePointRadius: number = 6;

  // Conditional vector styling
  export let vectorColor: string = "#f17720";
  export let vectorOpacity: number = 1.0;
  export let vectorWidth: number = 4.5;
  export let vectorScale: number = 110;
  export let t: number = 0.4;

  // Label styling
  export let labelYShiftFactor: number = 0.5;

  // Background
  export let backgroundVisible: boolean = true;

  // LaTeX label styling
  export let latexLabelOffsetY: number = settings.stylingSettings.figureLatex.latexLabelOffsetY;
  export let latexFontSize: number = settings.stylingSettings.figureLatex.fontSize;

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  type Scales = ReturnType<typeof createSourceTargetScales>;

  $: caption = children;

  // Canvas - need both bind:this (for reactivity) and action (for DPR setup)
  let canvas: HTMLCanvasElement | null = null;
  const canvas2d = useCanvas2D(width, height);
  // Tie ctx reactivity to canvas variable so it updates when action runs
  $: ctx = canvas && canvas2d.ctx;

  let scales: Scales | null = null;
  let isInitialized: boolean = false;

  // Pre-computed pixel coordinates
  let sourcePixelCoords: number[][] = [];
  let targetPixelCoords: number[][] = [];

  // Selected indices
  let selectedTargetIndex: number = 0;
  let selectedSourceIndices: number[] = [];
  let selectedPathIndex: number = 0;

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  function precomputeScatterCoords() {
    if (!scales) return;

    sourcePixelCoords = sourceDistributionSamples.map((p: [number, number]) => [
      scales.sourceCenterPixelX +
        (p[0] - scales.sourceMeanX) * scales.xScaleFactor,
      scales.yScale(p[1]),
    ]);

    targetPixelCoords = targetDistributionSamples.map((p: [number, number]) => [
      scales.targetCenterPixelX +
        (p[0] - scales.targetMeanX) * scales.xScaleFactor,
      scales.yScale(p[1]),
    ]);
  }

  function selectRandomIndices() {
    selectedTargetIndex = Math.floor(
      Math.random() * targetDistributionSamples.length
    );

    selectedSourceIndices = [];
    const sourceCount = sourceDistributionSamples.length;
    for (let i = 0; i < numPathLines && i < sourceCount; i++) {
      let idx: number;
      do {
        idx = Math.floor(Math.random() * sourceCount);
      } while (selectedSourceIndices.includes(idx));
      selectedSourceIndices.push(idx);
    }
  }

  function selectPathByAngle() {
    if (!scales || selectedSourceIndices.length === 0) return;

    const targetPoint = targetDistributionSamples[selectedTargetIndex];
    const targetPixelX =
      scales.targetCenterPixelX +
      (targetPoint[0] - scales.targetMeanX) * scales.xScaleFactor;
    const targetPixelY = scales.yScale(targetPoint[1]);

    let maxAngle = -Infinity;
    selectedPathIndex = 0;

    for (let i = 0; i < selectedSourceIndices.length; i++) {
      const sourcePoint = sourceDistributionSamples[selectedSourceIndices[i]];
      const sourcePixelX =
        scales.sourceCenterPixelX +
        (sourcePoint[0] - scales.sourceMeanX) * scales.xScaleFactor;
      const sourcePixelY = scales.yScale(sourcePoint[1]);

      const dx = sourcePixelX - targetPixelX;
      const dy = sourcePixelY - targetPixelY;
      let angle = Math.atan2(dy, dx);

      if (angle < 0) {
        angle += 2 * Math.PI;
      }

      if (angle > maxAngle) {
        maxAngle = angle;
        selectedPathIndex = i;
      }
    }
  }

  function interpDataToPixel(dataX: number, dataY: number, tVal: number, scalesObj: Scales) {
    const sourcePixelX =
      scalesObj.sourceCenterPixelX +
      (dataX - scalesObj.sourceMeanX) * scalesObj.xScaleFactor;
    const targetPixelX =
      scalesObj.targetCenterPixelX +
      (dataX - scalesObj.targetMeanX) * scalesObj.xScaleFactor;
    const pixelX = (1 - tVal) * sourcePixelX + tVal * targetPixelX;
    const pixelY = scalesObj.yScale(dataY);
    return { x: pixelX, y: pixelY };
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function runInitialComputation() {
    if (!canvas) return;
    if (
      sourceDistributionSamples.length === 0 ||
      targetDistributionSamples.length === 0
    )
      return;

    selectRandomIndices();

    scales = createSourceTargetScales(
      sourceDistributionSamples,
      targetDistributionSamples,
      {
        width,
        height,
        marginWidth,
        marginHeight,
        sourceCenterX,
        targetCenterX,
        yShiftFactor,
      }
    );

    selectPathByAngle();
    precomputeScatterCoords();
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function draw() {
    if (!ctx || !scales || !isInitialized) return;
    ctx.clearRect(0, 0, width, height);

    // Draw scatter plots (with lower opacity)
    drawScatterPlot(
      ctx,
      sourcePixelCoords,
      pointRadius,
      sourcePointColor,
      pointOpacity * 0.5
    );
    drawScatterPlot(
      ctx,
      targetPixelCoords,
      pointRadius,
      targetPointColor,
      pointOpacity * 0.5
    );

    // Get target point pixel coords
    const targetPoint = targetDistributionSamples[selectedTargetIndex];
    const targetX =
      scales.targetCenterPixelX +
      (targetPoint[0] - scales.targetMeanX) * scales.xScaleFactor;
    const targetY = scales.yScale(targetPoint[1]);

    // Draw path lines
    selectedSourceIndices.forEach((sourceIdx: number) => {
      const sourcePoint = sourceDistributionSamples[sourceIdx];
      const sourceX =
        scales.sourceCenterPixelX +
        (sourcePoint[0] - scales.sourceMeanX) * scales.xScaleFactor;
      const sourceY = scales.yScale(sourcePoint[1]);
      drawLine(
        ctx,
        sourceX,
        sourceY,
        targetX,
        targetY,
        pathLineColor,
        pathLineWidth,
        pathLineOpacity
      );
    });

    // Draw selected target point
    drawCircle(ctx, targetX, targetY, selectedTargetRadius, selectedTargetColor);

    // Draw intermediate point and vector
    const sourceIdx = selectedSourceIndices[selectedPathIndex];
    const sourcePoint = sourceDistributionSamples[sourceIdx];
    const interpDataX = (1 - t) * sourcePoint[0] + t * targetPoint[0];
    const interpDataY = (1 - t) * sourcePoint[1] + t * targetPoint[1];
    const interpPixel = interpDataToPixel(interpDataX, interpDataY, t, scales);

    drawCircle(
      ctx,
      interpPixel.x,
      interpPixel.y,
      intermediatePointRadius,
      intermediatePointColor
    );

    // Draw velocity vector
    const pixelDx = targetX - interpPixel.x;
    const pixelDy = targetY - interpPixel.y;
    const pixelMag = Math.sqrt(pixelDx * pixelDx + pixelDy * pixelDy);

    let vectorEndX: number | undefined, vectorEndY: number | undefined;
    if (pixelMag > 0.01) {
      vectorEndX = interpPixel.x + (pixelDx / pixelMag) * vectorScale;
      vectorEndY = interpPixel.y + (pixelDy / pixelMag) * vectorScale;
      ctx.save();
      ctx.strokeStyle = vectorColor;
      ctx.fillStyle = vectorColor;
      ctx.lineWidth = vectorWidth;
      ctx.globalAlpha = vectorOpacity;
      drawArrow(ctx, interpPixel.x, interpPixel.y, vectorEndX, vectorEndY, 8);
      ctx.restore();
    }

    // Draw LaTeX labels directly on canvas
    const latexColor = settings.stylingSettings.figureLatex.color;

    // p_0 and p_1 above distributions
    const yDomain = scales.yScale.domain();
    const distributionLabelY = scales.yScale(yDomain[0]) + labelYShiftFactor * 22;

    drawMathjax(
      ctx, "p_0", scales.sourceCenterPixelX, distributionLabelY,
      latexFontSize, 0, 0, { color: latexColor }
    );

    drawMathjax(
      ctx, "p_1", scales.targetCenterPixelX, distributionLabelY,
      latexFontSize, 0, 0, { color: latexColor }
    );

    // x_1 above selected target point
    drawMathjax(
      ctx, "x_1", targetX, targetY,
      latexFontSize, 0, latexLabelOffsetY, { color: latexColor }
    );

    // x above intermediate point
    drawMathjax(
      ctx, "x", interpPixel.x, interpPixel.y,
      latexFontSize, 0, latexLabelOffsetY, { color: latexColor }
    );

    // v_t(x|x_1) near vector
    if (vectorEndX !== undefined && vectorEndY !== undefined) {
      const vectorCenterX = (interpPixel.x + vectorEndX) / 2;
      const vectorCenterY = (interpPixel.y + vectorEndY) / 2;
      drawMathjax(
        ctx, "v_t(x|x_1)", vectorCenterX, vectorCenterY,
        latexFontSize, 30, -20, { color: vectorColor }
      );
    }
  }

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  $: if (
    !isInitialized &&
    sourceDistributionSamples.length > 0 &&
    targetDistributionSamples.length > 0 &&
    canvas
  ) {
    runInitialComputation();
    isInitialized = true;
    draw();
  }
</script>

<Figure {caption} {backgroundVisible}>
  {#snippet children()}
    <div style="width: 100%; max-width: {width}px;">
      <canvas
        bind:this={canvas}
        use:canvas2d.bindCanvas
        style="width: 100%; height: auto; aspect-ratio: {width}/{height};"
      ></canvas>
    </div>
  {/snippet}
</Figure>
