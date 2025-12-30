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
  export let height = 300;
  export let marginWidth = 50;
  export let marginHeight = 20;
  export let sourceCenterX = 0.15;
  export let targetCenterX = 0.85;
  export let yShiftFactor = -0.2;

  // ===== SCATTER PLOT STYLING =====
  export let pointRadius = settings.stylingSettings.scatterPlot.radius;
  export let pointOpacity = settings.stylingSettings.scatterPlot.opacity;
  export let sourcePointColor = settings.stylingSettings.scatterPlot.color;
  export let targetPointColor = settings.stylingSettings.scatterPlot.color;

  // ===== PATH LINE STYLING (between x_0 and x_1) =====
  export let lineColor = "#888";
  export let lineOpacity = 0.25;
  export let lineWidth = 3;

  // ===== SELECTED POINT STYLING (x_0 and x_1) =====
  export let selectedPointColor = "#888";
  export let selectedPointRadius = 5;

  // ===== INTERMEDIATE POINT STYLING =====
  export let intermediatePointColor = "#f17720";
  export let intermediatePointRadius = 6;

  // ===== CONDITIONAL VECTOR STYLING (v_t) =====
  export let vectorColor = "#f17720";
  export let vectorOpacity = 1.0;
  export let vectorWidth = 2.5;
  export let vectorScale = 150;
  export let t = 0.3;

  // ===== NOISY VECTOR STYLING (v_t^\theta) =====
  export let noisyVectorColor = "#22c55e";
  export let noiseVector = [15, -90]; // [dx, dy] in pixels

  // ===== DASHED LINE STYLING =====
  export let dashedLineColor = "#ef4444";
  export let dashedLineWidth = 2;

  // ===== BACKGROUND =====
  export let backgroundVisible = true;

  // ===== FIXED POINT POSITIONS (pixel coords) =====
  export let x0Pixel = { x: 180, y: 170 };
  export let x1Pixel = { x: 620, y: 90 };

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
  let x0LabelSvg = null;
  let x1LabelSvg = null;
  let xLabelSvg = null;
  let vtLabelSvg = null;
  let vtThetaLabelSvg = null;
  let p0LabelSvg = null;
  let p1LabelSvg = null;

  function initializeCanvas() {
    if (!canvas) return;
    dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
  }

  function precomputeScatterCoords() {
    if (!scales) return;

    sourcePixelCoords = sourceDistributionSamples.map((point) => {
      const pixelX =
        scales.sourceCenterPixelX +
        (point[0] - scales.sourceMeanX) * scales.xScaleFactor;
      const pixelY = scales.yScale(point[1]);
      return [pixelX, pixelY];
    });

    targetPixelCoords = targetDistributionSamples.map((point) => {
      const pixelX =
        scales.targetCenterPixelX +
        (point[0] - scales.targetMeanX) * scales.xScaleFactor;
      const pixelY = scales.yScale(point[1]);
      return [pixelX, pixelY];
    });
  }

  function initializeData() {
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
    precomputeScatterCoords();
  }

  async function preRenderLabels() {
    const latexColor = settings.stylingSettings.figureLatex.color;
    try {
      [
        x0LabelSvg,
        x1LabelSvg,
        xLabelSvg,
        vtLabelSvg,
        vtThetaLabelSvg,
        p0LabelSvg,
        p1LabelSvg,
      ] = await Promise.all([
        latexToSvgElement("x_0", { color: latexColor }),
        latexToSvgElement("x_1", { color: latexColor }),
        latexToSvgElement("x", { color: latexColor }),
        latexToSvgElement("v_t(x_t|x_1)", { color: vectorColor }),
        latexToSvgElement("v_t^\\theta(x_t)", { color: noisyVectorColor }),
        latexToSvgElement("p_0", { color: latexColor }),
        latexToSvgElement("p_1", { color: latexColor }),
      ]);
    } catch (e) {
      console.warn("Failed to pre-render MathJax labels:", e);
    }
  }

  function updateLabelPositions() {
    if (!svgOverlay || !scales) return;
    svgOverlay.innerHTML = "";

    const labelOffsetY = -14;

    // x_0 label above source point
    if (x0LabelSvg) {
      placeMathjaxSVG(
        x0LabelSvg.cloneNode(true),
        svgOverlay,
        x0Pixel.x,
        x0Pixel.y,
        0,
        labelOffsetY,
        50,
        1.4
      );
    }

    // x_1 label above target point
    if (x1LabelSvg) {
      placeMathjaxSVG(
        x1LabelSvg.cloneNode(true),
        svgOverlay,
        x1Pixel.x,
        x1Pixel.y,
        0,
        labelOffsetY,
        50,
        1.4
      );
    }

    // Intermediate point position
    const interpX = (1 - t) * x0Pixel.x + t * x1Pixel.x;
    const interpY = (1 - t) * x0Pixel.y + t * x1Pixel.y;

    // x label above intermediate point
    if (xLabelSvg) {
      placeMathjaxSVG(
        xLabelSvg.cloneNode(true),
        svgOverlay,
        interpX,
        interpY,
        0,
        labelOffsetY,
        50,
        1.4
      );
    }

    // Vector calculations for label positioning
    const pixelDx = x1Pixel.x - interpX;
    const pixelDy = x1Pixel.y - interpY;
    const pixelMag = Math.sqrt(pixelDx * pixelDx + pixelDy * pixelDy);

    if (pixelMag > 0.01) {
      const vtEndX = interpX + (pixelDx / pixelMag) * vectorScale;
      const vtEndY = interpY + (pixelDy / pixelMag) * vectorScale;

      // v_t label near vector
      if (vtLabelSvg) {
        const vtCenterX = (interpX + vtEndX) / 2;
        const vtCenterY = (interpY + vtEndY) / 2;
        placeMathjaxSVG(
          vtLabelSvg.cloneNode(true),
          svgOverlay,
          vtCenterX,
          vtCenterY,
          0,
          35,
          50,
          1.2
        );
      }

      // v_t^theta endpoint
      const vtThetaEndX = vtEndX + noiseVector[0];
      const vtThetaEndY = vtEndY + noiseVector[1];

      // v_t^theta label near noisy vector
      if (vtThetaLabelSvg) {
        const vtThetaCenterX = (interpX + vtThetaEndX) / 2;
        const vtThetaCenterY = (interpY + vtThetaEndY) / 2;
        placeMathjaxSVG(
          vtThetaLabelSvg.cloneNode(true),
          svgOverlay,
          vtThetaCenterX,
          vtThetaCenterY,
          -10,
          -20,
          50,
          1.2
        );
      }
    }

    // Distribution labels at top
    const yDomain = scales.yScale.domain();
    const yTop = yDomain[0];
    const distributionLabelY = scales.yScale(yTop) - 5;

    if (p0LabelSvg) {
      placeMathjaxSVG(
        p0LabelSvg.cloneNode(true),
        svgOverlay,
        scales.sourceCenterPixelX,
        distributionLabelY,
        0,
        8,
        50,
        1.4
      );
    }
    if (p1LabelSvg) {
      placeMathjaxSVG(
        p1LabelSvg.cloneNode(true),
        svgOverlay,
        scales.targetCenterPixelX,
        distributionLabelY,
        0,
        8,
        50,
        1.4
      );
    }
  }

  function draw() {
    if (!ctx || !scales) return;
    ctx.clearRect(0, 0, width, height);

    // Draw scatter plots (lower opacity for context)
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

    // Draw connecting line between x0 and x1
    ctx.beginPath();
    ctx.moveTo(x0Pixel.x, x0Pixel.y);
    ctx.lineTo(x1Pixel.x, x1Pixel.y);
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = lineWidth;
    ctx.globalAlpha = lineOpacity;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Draw selected source point (x_0)
    ctx.beginPath();
    ctx.arc(x0Pixel.x, x0Pixel.y, selectedPointRadius, 0, 2 * Math.PI);
    ctx.fillStyle = selectedPointColor;
    ctx.fill();

    // Draw selected target point (x_1)
    ctx.beginPath();
    ctx.arc(x1Pixel.x, x1Pixel.y, selectedPointRadius, 0, 2 * Math.PI);
    ctx.fillStyle = selectedPointColor;
    ctx.fill();

    // Intermediate point position
    const interpX = (1 - t) * x0Pixel.x + t * x1Pixel.x;
    const interpY = (1 - t) * x0Pixel.y + t * x1Pixel.y;

    // Draw intermediate point
    ctx.beginPath();
    ctx.arc(interpX, interpY, intermediatePointRadius, 0, 2 * Math.PI);
    ctx.fillStyle = intermediatePointColor;
    ctx.fill();

    // Compute vector direction
    const pixelDx = x1Pixel.x - interpX;
    const pixelDy = x1Pixel.y - interpY;
    const pixelMag = Math.sqrt(pixelDx * pixelDx + pixelDy * pixelDy);

    if (pixelMag > 0.01) {
      // v_t vector endpoint
      const vtEndX = interpX + (pixelDx / pixelMag) * vectorScale;
      const vtEndY = interpY + (pixelDy / pixelMag) * vectorScale;

      // Draw v_t vector (orange)
      ctx.save();
      ctx.strokeStyle = vectorColor;
      ctx.fillStyle = vectorColor;
      ctx.lineWidth = vectorWidth;
      ctx.globalAlpha = vectorOpacity;
      drawArrow(ctx, interpX, interpY, vtEndX, vtEndY, 6);
      ctx.restore();

      // v_t^theta vector endpoint
      const vtThetaEndX = vtEndX + noiseVector[0];
      const vtThetaEndY = vtEndY + noiseVector[1];

      // Draw v_t^theta vector (green)
      ctx.save();
      ctx.strokeStyle = noisyVectorColor;
      ctx.fillStyle = noisyVectorColor;
      ctx.lineWidth = vectorWidth;
      ctx.globalAlpha = vectorOpacity;
      drawArrow(ctx, interpX, interpY, vtThetaEndX, vtThetaEndY, 6);
      ctx.restore();

      // Draw dashed line between vector tips (red)
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([5, 3]);
      ctx.moveTo(vtEndX, vtEndY);
      ctx.lineTo(vtThetaEndX, vtThetaEndY);
      ctx.strokeStyle = dashedLineColor;
      ctx.lineWidth = dashedLineWidth;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Update SVG overlay labels
    updateLabelPositions();
  }

  $: if (
    canvas &&
    sourceDistributionSamples.length > 0 &&
    targetDistributionSamples.length > 0 &&
    !isInitialized
  ) {
    initializeCanvas();
    initializeData();
    isInitialized = true;
    preRenderLabels().then(() => draw());
  }

  onMount(() => {
    return () => {
      // Cleanup if needed
    };
  });
</script>

<Figure {caption} {backgroundVisible} bind:isActive={figureIsActive}>
  {#snippet children()}
    <div style="position:relative;width:100%;max-width:{width}px;">
      <canvas
        bind:this={canvas}
        style="width:100%;height:auto;aspect-ratio:{width}/{height};"
      ></canvas>
      <svg
        bind:this={svgOverlay}
        style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;"
        viewBox="0 0 {width} {height}"
      ></svg>
    </div>
  {/snippet}
</Figure>
