<script>
  import { Figure, drawScatterPlot, drawArrow, drawMathjax, createSourceTargetScales, useCanvas2D } from "@diffusion-explorer/ui";
  import { settings } from "$lib/settings";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  // Caption
  export let children = undefined;

  // Data props
  export let sourceDistributionSamples = [];
  export let targetDistributionSamples = [];

  // Layout props
  export let width = 800;
  export let height = 450;
  export let marginWidth = 50;
  export let marginHeight = 20;
  export let sourceCenterX = settings.stylingSettings.layout.sourceCenterX;
  export let targetCenterX = settings.stylingSettings.layout.targetCenterX;
  export let yShiftFactor = -0.2;

  // Scatter plot styling
  export let pointRadius = settings.stylingSettings.scatterPlot.radius;
  export let pointOpacity = settings.stylingSettings.scatterPlot.opacity;
  export let sourcePointColor = settings.stylingSettings.scatterPlot.color;
  export let targetPointColor = settings.stylingSettings.scatterPlot.color;

  // Path line styling (between x_0 and x_1)
  export let lineColor = "#888";
  export let lineOpacity = 0.25;
  export let lineWidth = 3;

  // Selected point styling (x_0 and x_1)
  export let selectedPointColor = "#888";
  export let selectedPointRadius = 5;

  // Intermediate point styling
  export let intermediatePointColor = "#f17720";
  export let intermediatePointRadius = 6;

  // Conditional vector styling (v_t)
  export let vectorColor = "#f17720";
  export let vectorOpacity = 1.0;
  export let vectorWidth = 2.5;
  export let vectorScale = 150;
  export let t = 0.3;

  // Noisy vector styling (v_t^\theta)
  export let noisyVectorColor = "#22c55e";
  export let noiseVector = [15, -90]; // [dx, dy] in pixels

  // Dashed line styling
  export let dashedLineColor = "#ef4444";
  export let dashedLineWidth = 2;

  // Background
  export let backgroundVisible = true;

  // LaTeX label styling
  export let latexLabelOffsetY = settings.stylingSettings.figureLatex.latexLabelOffsetY;
  export let latexFontSize = settings.stylingSettings.figureLatex.fontSize;

  // Fixed point positions (pixel coords)
  export let x0Pixel = { x: 180, y: 170 };
  export let x1Pixel = { x: 540, y: 130 };

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  $: caption = children;

  // Canvas - need both bind:this (for reactivity) and action (for DPR setup)
  let canvas = null;
  const canvas2d = useCanvas2D(width, height);
  // Tie ctx reactivity to canvas variable so it updates when action runs
  $: ctx = canvas && canvas2d.ctx;

  let scales = null;
  let isInitialized = false;

  // Pre-computed pixel coordinates
  let sourcePixelCoords = [];
  let targetPixelCoords = [];

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

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

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function runInitialComputation() {
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

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

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

      // v_t label near vector
      const vtCenterX = (interpX + vtEndX) / 2;
      const vtCenterY = (interpY + vtEndY) / 2;
      drawMathjax(
        ctx, "v_t(x_t|x_1)", vtCenterX, vtCenterY,
        latexFontSize, 10, 45, { color: vectorColor }
      );

      // v_t^theta label near noisy vector
      const vtThetaCenterX = (interpX + vtThetaEndX) / 2;
      const vtThetaCenterY = (interpY + vtThetaEndY) / 2;
      drawMathjax(
        ctx, "v_t^\\theta(x_t)", vtThetaCenterX, vtThetaCenterY,
        latexFontSize, -10, -20, { color: noisyVectorColor }
      );
    }

    // Draw LaTeX labels directly on canvas
    const latexColor = settings.stylingSettings.figureLatex.color;

    // x_0 label above source point
    drawMathjax(
      ctx, "x_0", x0Pixel.x, x0Pixel.y,
      latexFontSize, 0, latexLabelOffsetY, { color: latexColor }
    );

    // x_1 label above target point
    drawMathjax(
      ctx, "x_1", x1Pixel.x, x1Pixel.y,
      latexFontSize, 0, latexLabelOffsetY, { color: latexColor }
    );

    // x label above intermediate point
    drawMathjax(
      ctx, "x", interpX, interpY,
      latexFontSize, 0, latexLabelOffsetY, { color: latexColor }
    );

    // Distribution labels at top
    const yDomain = scales.yScale.domain();
    const yTop = yDomain[0];
    const distributionLabelY = scales.yScale(yTop) - 5;

    drawMathjax(
      ctx, "p_0", scales.sourceCenterPixelX, distributionLabelY,
      latexFontSize, 0, 8, { color: latexColor }
    );

    drawMathjax(
      ctx, "p_1", scales.targetCenterPixelX, distributionLabelY,
      latexFontSize, 0, 8, { color: latexColor }
    );
  }

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  $: if (
    canvas &&
    sourceDistributionSamples.length > 0 &&
    targetDistributionSamples.length > 0 &&
    !isInitialized
  ) {
    runInitialComputation();
    isInitialized = true;
    draw();
  }
</script>

<Figure {caption} {backgroundVisible}>
  {#snippet children()}
    <div style="width:100%;max-width:{width}px;">
      <canvas
        bind:this={canvas}
        use:canvas2d.bindCanvas
        style="width:100%;height:auto;aspect-ratio:{width}/{height};"
      ></canvas>
    </div>
  {/snippet}
</Figure>
