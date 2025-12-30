<script>
  import { onMount } from "svelte";
  import Figure from "$lib/components/Figure.svelte";
  import { settings } from "$lib/settings";
  import { createSourceTargetScales } from "$lib/d3_helpers";
  import { drawScatterPlot, drawArrow } from "$lib/plotting/plotting";
  import { latexToSvgElement, placeMathjaxSVG } from "$lib/plotting/mathjax";

  // ===== CAPTION =====
  export let children = undefined;
  $: caption = children;

  // ===== DATA PROPS =====
  export let sourceDistributionSamples = [];
  export let targetDistributionSamples = [];

  // ===== LAYOUT PROPS =====
  export let width = 800;
  export let height = 450;
  export let marginWidth = 50;
  export let marginHeight = 20;
  export let sourceCenterX = settings.stylingSettings.layout.sourceCenterX;
  export let targetCenterX = settings.stylingSettings.layout.targetCenterX;
  export let yShiftFactor = -0.2;

  // ===== SCATTER PLOT STYLING =====
  export let pointRadius = settings.stylingSettings.scatterPlot.radius;
  export let pointOpacity = settings.stylingSettings.scatterPlot.opacity;
  export let sourcePointColor = settings.stylingSettings.scatterPlot.color;
  export let targetPointColor = settings.stylingSettings.scatterPlot.color;

  // ===== PATH LINE STYLING =====
  export let pathLineColor = "#888";
  export let pathLineOpacity = 0.25;
  export let pathLineWidth = 3;
  export let numPathLines = 15;

  // ===== SELECTED TARGET POINT STYLING =====
  export let selectedTargetColor = "#888";
  export let selectedTargetRadius = 5;

  // ===== INTERMEDIATE POINT STYLING =====
  export let intermediatePointColor = "#f17720";
  export let intermediatePointRadius = 6;

  // ===== CONDITIONAL VECTOR STYLING =====
  export let vectorColor = "#f17720";
  export let vectorOpacity = 1.0;
  export let vectorWidth = 4.5;
  export let vectorScale = 180;
  export let t = 0.4;

  // ===== LABEL STYLING =====
  export let labelYShiftFactor = 0.5;

  // ===== BACKGROUND =====
  export let backgroundVisible = true;

  // ===== LATEX LABEL STYLING =====
  export let latexLabelOffsetY = settings.stylingSettings.figureLatex.latexLabelOffsetY;
  export let latexSizeMultiplier = settings.stylingSettings.figureLatex.sizeMultiplier;

  // ===== STATE =====
  let canvas;
  let ctx;
  let dpr = 1;
  let svgOverlay = null;
  let scales = null;
  let isInitialized = false;
  let figureIsActive;

  // Pre-computed pixel coordinates
  let sourcePixelCoords = [];
  let targetPixelCoords = [];

  // Pre-rendered MathJax labels
  let p0LabelSvg = null;
  let p1LabelSvg = null;
  let xLabelSvg = null;
  let x1LabelSvg = null;
  let vtLabelSvg = null;

  // Selected indices
  let selectedTargetIndex = 0;
  let selectedSourceIndices = [];
  let selectedPathIndex = 0;

  // ===== CANVAS INITIALIZATION =====
  function initializeCanvas() {
    if (!canvas) return;
    dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
  }

  // ===== PRE-COMPUTE COORDINATES =====
  function precomputeScatterCoords() {
    if (!scales) return;

    sourcePixelCoords = sourceDistributionSamples.map((p) => [
      scales.sourceCenterPixelX +
        (p[0] - scales.sourceMeanX) * scales.xScaleFactor,
      scales.yScale(p[1]),
    ]);

    targetPixelCoords = targetDistributionSamples.map((p) => [
      scales.targetCenterPixelX +
        (p[0] - scales.targetMeanX) * scales.xScaleFactor,
      scales.yScale(p[1]),
    ]);
  }

  // ===== PRE-RENDER MATHJAX LABELS =====
  async function preRenderLabels() {
    const latexColor = settings.stylingSettings.figureLatex.color;
    try {
      [p0LabelSvg, p1LabelSvg, xLabelSvg, x1LabelSvg, vtLabelSvg] =
        await Promise.all([
          latexToSvgElement("p_0", { color: latexColor }),
          latexToSvgElement("p_1", { color: latexColor }),
          latexToSvgElement("x", { color: latexColor }),
          latexToSvgElement("x_1", { color: latexColor }),
          latexToSvgElement("v_t(x|x_1)", { color: vectorColor }),
        ]);
    } catch (e) {
      console.warn("Failed to pre-render MathJax labels:", e);
    }
  }

  // ===== CANVAS DRAWING HELPERS =====
  function drawLine(x1, y1, x2, y2, color, lineW, opacity = 1) {
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineW;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  function drawCircle(x, y, radius, color, opacity = 1) {
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ===== SELECTION LOGIC =====
  function selectRandomIndices() {
    selectedTargetIndex = Math.floor(
      Math.random() * targetDistributionSamples.length
    );

    selectedSourceIndices = [];
    const sourceCount = sourceDistributionSamples.length;
    for (let i = 0; i < numPathLines && i < sourceCount; i++) {
      let idx;
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

  function interpDataToPixel(dataX, dataY, tVal, scalesObj) {
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

  // ===== LABEL POSITIONING =====
  function updateLabelPositions(
    targetX,
    targetY,
    interpPixel,
    vectorEndX,
    vectorEndY
  ) {
    if (!svgOverlay || !scales) return;
    svgOverlay.innerHTML = "";

    // p_0 and p_1 above distributions
    const yDomain = scales.yScale.domain();
    const distributionLabelY =
      scales.yScale(yDomain[0]) + labelYShiftFactor * 22;

    if (p0LabelSvg) {
      placeMathjaxSVG(
        p0LabelSvg.cloneNode(true),
        svgOverlay,
        scales.sourceCenterPixelX,
        distributionLabelY,
        0,
        0,
        50,
        latexSizeMultiplier
      );
    }

    if (p1LabelSvg) {
      placeMathjaxSVG(
        p1LabelSvg.cloneNode(true),
        svgOverlay,
        scales.targetCenterPixelX,
        distributionLabelY,
        0,
        0,
        50,
        latexSizeMultiplier
      );
    }

    // x_1 above selected target point
    if (x1LabelSvg) {
      placeMathjaxSVG(
        x1LabelSvg.cloneNode(true),
        svgOverlay,
        targetX,
        targetY,
        0,
        latexLabelOffsetY,
        50,
        latexSizeMultiplier
      );
    }

    // x above intermediate point
    if (xLabelSvg) {
      placeMathjaxSVG(
        xLabelSvg.cloneNode(true),
        svgOverlay,
        interpPixel.x,
        interpPixel.y,
        0,
        latexLabelOffsetY,
        50,
        latexSizeMultiplier
      );
    }

    // v_t(x|x_1) near vector
    if (vtLabelSvg && vectorEndX !== undefined && vectorEndY !== undefined) {
      const vectorCenterX = (interpPixel.x + vectorEndX) / 2;
      const vectorCenterY = (interpPixel.y + vectorEndY) / 2;
      placeMathjaxSVG(
        vtLabelSvg.cloneNode(true),
        svgOverlay,
        vectorCenterX,
        vectorCenterY,
        30,
        -20,
        50,
        latexSizeMultiplier
      );
    }
  }

  // ===== MAIN DRAW FUNCTION =====
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
    selectedSourceIndices.forEach((sourceIdx) => {
      const sourcePoint = sourceDistributionSamples[sourceIdx];
      const sourceX =
        scales.sourceCenterPixelX +
        (sourcePoint[0] - scales.sourceMeanX) * scales.xScaleFactor;
      const sourceY = scales.yScale(sourcePoint[1]);
      drawLine(
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
    drawCircle(targetX, targetY, selectedTargetRadius, selectedTargetColor);

    // Draw intermediate point and vector
    const sourceIdx = selectedSourceIndices[selectedPathIndex];
    const sourcePoint = sourceDistributionSamples[sourceIdx];
    const interpDataX = (1 - t) * sourcePoint[0] + t * targetPoint[0];
    const interpDataY = (1 - t) * sourcePoint[1] + t * targetPoint[1];
    const interpPixel = interpDataToPixel(interpDataX, interpDataY, t, scales);

    drawCircle(
      interpPixel.x,
      interpPixel.y,
      intermediatePointRadius,
      intermediatePointColor
    );

    // Draw velocity vector
    const pixelDx = targetX - interpPixel.x;
    const pixelDy = targetY - interpPixel.y;
    const pixelMag = Math.sqrt(pixelDx * pixelDx + pixelDy * pixelDy);

    let vectorEndX, vectorEndY;
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

    // Update SVG overlay labels
    updateLabelPositions(targetX, targetY, interpPixel, vectorEndX, vectorEndY);
  }

  // ===== INITIALIZATION =====
  function initializeVisualization() {
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
    initializeCanvas();
    precomputeScatterCoords();
  }

  // ===== REACTIVE INITIALIZATION =====
  $: if (
    !isInitialized &&
    sourceDistributionSamples.length > 0 &&
    targetDistributionSamples.length > 0 &&
    canvas
  ) {
    initializeVisualization();
    preRenderLabels().then(() => {
      isInitialized = true;
      draw();
    });
  }

  onMount(() => {
    return () => {
      // Cleanup if needed
    };
  });
</script>

<Figure {caption} {backgroundVisible} bind:isActive={figureIsActive}>
  {#snippet children()}
    <div class="canvas-container" style="max-width: {width}px;">
      <canvas
        bind:this={canvas}
        style="width: 100%; height: auto; aspect-ratio: {width}/{height};"
      ></canvas>
      <svg
        bind:this={svgOverlay}
        style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;"
        viewBox="0 0 {width} {height}"
      ></svg>
    </div>
  {/snippet}
</Figure>

<style>
  .canvas-container {
    position: relative;
    width: 100%;
  }
</style>
