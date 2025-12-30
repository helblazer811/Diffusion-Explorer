<!-- Visualizes intersecting linear paths between source and target distributions with velocity vectors at intersection. -->

<script>
  import { onMount } from "svelte";
  import Figure from "$lib/components/Figure.svelte";
  import { settings } from "$lib/settings";
  import { createSourceTargetScales, dataToPixelX } from "$lib/d3_helpers";
  import { drawScatterPlot, drawArrow, drawText } from "$lib/plotting/plotting";
  import { latexToSvgElement, placeMathjaxSVG } from "$lib/plotting/mathjax";

  // Caption slot (passed as default children)
  export let children = undefined;
  $: caption = children;

  // Data props
  export let sourceDistributionSamples = [];
  export let targetDistributionSamples = [];

  // Arrow styling
  export let arrowColor = "#f17720";
  export let arrowLength = 0.4;
  export let meanVectorColor = "#22c55e";

  // Layout/Styling
  export let width = 800;
  export let height = 350;
  export let marginWidth = 50;
  export let marginHeight = 20;
  export let sourceCenterX = 0.2;
  export let targetCenterX = 0.8;
  export let pointRadius = settings.stylingSettings.scatterPlot.radius;
  export let pointOpacity = settings.stylingSettings.scatterPlot.opacity;
  export let lineColor = "#888";
  export let lineOpacity = 0.25;
  export let lineWidth = 4;
  export let sourcePointColor = settings.stylingSettings.scatterPlot.color;
  export let targetPointColor = settings.stylingSettings.scatterPlot.color;
  export let arrowWidth = 4;
  export let yShiftFactor = settings.stylingSettings.scatterPlot.yShiftFactor;

  export let labelFontSize = settings.stylingSettings.label.fontSize;
  export let labelFontWeight = settings.stylingSettings.label.fontWeight;
  export let labelColor = settings.stylingSettings.label.color;
  export let sourceLabelText = "Source Distribution";
  export let targetLabelText = "Target Distribution";

  // LaTeX label offsets
  export let topArrowLabelOffset = { x: -55, y: -45 };
  export let bottomArrowLabelOffset = { x: -55, y: 8 };
  export let meanArrowLabelOffset = { x: 10, y: -18 };

  // Hardcoded line endpoint coordinates
  export let sourcePointA = [-0.2, -0.8];
  export let sourcePointB = [-0.2, 0.5];
  export let targetPointA = [0.2, 1.6];
  export let targetPointB = [-1.1, -1.0];

  // Background visibility
  export let backgroundVisible = true;

  // LaTeX label styling
  export let latexLabelOffsetY = settings.stylingSettings.figureLatex.latexLabelOffsetY;
  export let latexSizeMultiplier = 1.4;

  // Canvas/SVG state
  let canvas;
  let ctx;
  let dpr = 1;
  let svgOverlay = null;
  let scales = null;
  let isInitialized = false;

  // Pre-computed coordinates
  let sourcePixelCoords = [];
  let targetPixelCoords = [];

  // Line endpoint pixel coords (computed once)
  let line1Coords = null; // sourcePointB -> targetPointB
  let line2Coords = null; // sourcePointA -> targetPointA
  let intersection = null;

  // Pre-rendered MathJax labels
  let xLabelSvg = null;
  let topArrowLabelSvg = null;
  let bottomArrowLabelSvg = null;
  let meanArrowLabelSvg = null;
  let x0aLabelSvg = null;
  let x0bLabelSvg = null;
  let x1aLabelSvg = null;
  let x1bLabelSvg = null;

  function normalize(v) {
    const len = Math.hypot(v.x, v.y);
    if (len < 1e-10) return { x: 0, y: 0 };
    return { x: v.x / len, y: v.y / len };
  }

  function findIntersection(l1, l2) {
    const { x1, y1, x2, y2 } = l1;
    const { x1: x3, y1: y3, x2: x4, y2: y4 } = l2;

    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(denom) < 1e-10) return null;

    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;

    return {
      x: x1 + t * (x2 - x1),
      y: y1 + t * (y2 - y1),
      t: t,
    };
  }

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

  function computeLineCoords() {
    // Line 1: sourcePointB -> targetPointB
    line1Coords = {
      x1: dataToPixelX(sourcePointB[0], true, scales),
      y1: scales.yScale(sourcePointB[1]),
      x2: dataToPixelX(targetPointB[0], false, scales),
      y2: scales.yScale(targetPointB[1]),
    };

    // Line 2: sourcePointA -> targetPointA
    line2Coords = {
      x1: dataToPixelX(sourcePointA[0], true, scales),
      y1: scales.yScale(sourcePointA[1]),
      x2: dataToPixelX(targetPointA[0], false, scales),
      y2: scales.yScale(targetPointA[1]),
    };

    intersection = findIntersection(line1Coords, line2Coords);
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
    computeLineCoords();
  }

  async function preRenderLabels() {
    const latexColor = settings.stylingSettings.figureLatex.color;
    try {
      [
        xLabelSvg,
        topArrowLabelSvg,
        bottomArrowLabelSvg,
        meanArrowLabelSvg,
        x0aLabelSvg,
        x0bLabelSvg,
        x1aLabelSvg,
        x1bLabelSvg,
      ] = await Promise.all([
        latexToSvgElement("x", { color: latexColor }),
        latexToSvgElement("v_t(x|x_0^a, x_1^a)", { color: arrowColor }),
        latexToSvgElement("v_t(x|x_0^b, x_1^b)", { color: arrowColor }),
        latexToSvgElement("v_t^\\theta(x) = \\mathbb{E}[X_1 - X_0 | x_t = x]", {
          color: meanVectorColor,
        }),
        latexToSvgElement("x_0^a", { color: latexColor }),
        latexToSvgElement("x_0^b", { color: latexColor }),
        latexToSvgElement("x_1^a", { color: latexColor }),
        latexToSvgElement("x_1^b", { color: latexColor }),
      ]);
    } catch (e) {
      console.warn("Failed to pre-render MathJax labels:", e);
    }
  }

  function updateLabelPositions() {
    if (!svgOverlay || !scales || !intersection) return;
    svgOverlay.innerHTML = "";

    // Intersection label 'x'
    if (xLabelSvg) {
      placeMathjaxSVG(
        xLabelSvg.cloneNode(true),
        svgOverlay,
        intersection.x,
        intersection.y,
        0,
        latexLabelOffsetY,
        50,
        latexSizeMultiplier
      );
    }

    // Endpoint labels
    if (x0aLabelSvg) {
      placeMathjaxSVG(
        x0aLabelSvg.cloneNode(true),
        svgOverlay,
        line2Coords.x1,
        line2Coords.y1,
        0,
        latexLabelOffsetY,
        50,
        latexSizeMultiplier
      );
    }
    if (x0bLabelSvg) {
      placeMathjaxSVG(
        x0bLabelSvg.cloneNode(true),
        svgOverlay,
        line1Coords.x1,
        line1Coords.y1,
        0,
        latexLabelOffsetY,
        50,
        latexSizeMultiplier
      );
    }
    if (x1aLabelSvg) {
      placeMathjaxSVG(
        x1aLabelSvg.cloneNode(true),
        svgOverlay,
        line2Coords.x2,
        line2Coords.y2,
        0,
        latexLabelOffsetY,
        50,
        latexSizeMultiplier
      );
    }
    if (x1bLabelSvg) {
      placeMathjaxSVG(
        x1bLabelSvg.cloneNode(true),
        svgOverlay,
        line1Coords.x2,
        line1Coords.y2,
        0,
        latexLabelOffsetY,
        50,
        latexSizeMultiplier
      );
    }

    // Arrow direction calculations
    const dir1 = normalize({
      x: line1Coords.x2 - line1Coords.x1,
      y: line1Coords.y2 - line1Coords.y1,
    });
    const dir2 = normalize({
      x: line2Coords.x2 - line2Coords.x1,
      y: line2Coords.y2 - line2Coords.y1,
    });
    const meanDir = normalize({
      x: (dir1.x + dir2.x) / 2,
      y: (dir1.y + dir2.y) / 2,
    });

    const lineLength1 = Math.hypot(
      line1Coords.x2 - line1Coords.x1,
      line1Coords.y2 - line1Coords.y1
    );
    const lineLength2 = Math.hypot(
      line2Coords.x2 - line2Coords.x1,
      line2Coords.y2 - line2Coords.y1
    );
    const arrowScale = arrowLength * Math.min(lineLength1, lineLength2);

    // Arrow endpoint positions
    const arrow1End = {
      x: intersection.x + dir1.x * arrowScale,
      y: intersection.y + dir1.y * arrowScale,
    };
    const arrow2End = {
      x: intersection.x + dir2.x * arrowScale,
      y: intersection.y + dir2.y * arrowScale,
    };
    const meanEnd = {
      x: intersection.x + meanDir.x * arrowScale,
      y: intersection.y + meanDir.y * arrowScale,
    };

    // Arrow midpoints for labels
    const arrow1Mid = {
      x: (intersection.x + arrow1End.x) / 2,
      y: (intersection.y + arrow1End.y) / 2,
    };
    const arrow2Mid = {
      x: (intersection.x + arrow2End.x) / 2,
      y: (intersection.y + arrow2End.y) / 2,
    };

    // Arrow labels
    if (topArrowLabelSvg) {
      placeMathjaxSVG(
        topArrowLabelSvg.cloneNode(true),
        svgOverlay,
        arrow2Mid.x + topArrowLabelOffset.x,
        arrow2Mid.y + topArrowLabelOffset.y,
        60,
        100,
        50,
        latexSizeMultiplier
      );
    }
    if (bottomArrowLabelSvg) {
      placeMathjaxSVG(
        bottomArrowLabelSvg.cloneNode(true),
        svgOverlay,
        arrow1Mid.x + bottomArrowLabelOffset.x,
        arrow1Mid.y + bottomArrowLabelOffset.y,
        60,
        -35,
        50,
        latexSizeMultiplier
      );
    }
    if (meanArrowLabelSvg) {
      placeMathjaxSVG(
        meanArrowLabelSvg.cloneNode(true),
        svgOverlay,
        meanEnd.x + meanArrowLabelOffset.x,
        meanEnd.y + meanArrowLabelOffset.y,
        150,
        30,
        55,
        latexSizeMultiplier
      );
    }
  }

  function draw() {
    if (!ctx || !scales) return;
    ctx.clearRect(0, 0, width, height);

    // Draw scatter plots
    drawScatterPlot(
      ctx,
      sourcePixelCoords,
      pointRadius,
      sourcePointColor,
      pointOpacity
    );
    drawScatterPlot(
      ctx,
      targetPixelCoords,
      pointRadius,
      targetPointColor,
      pointOpacity
    );

    // Draw distribution labels
    drawText(
      ctx,
      sourceLabelText,
      scales.sourceCenterPixelX,
      marginHeight / 2,
      {
        font: `${labelFontWeight} ${labelFontSize}px Helvetica, Arial, sans-serif`,
        color: labelColor,
        align: "center",
        baseline: "top",
      }
    );
    drawText(
      ctx,
      targetLabelText,
      scales.targetCenterPixelX,
      marginHeight / 2,
      {
        font: `${labelFontWeight} ${labelFontSize}px Helvetica, Arial, sans-serif`,
        color: labelColor,
        align: "center",
        baseline: "top",
      }
    );

    // Draw connecting lines
    ctx.save();
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = lineWidth;
    ctx.globalAlpha = lineOpacity;

    // Line 1: sourcePointB -> targetPointB
    ctx.beginPath();
    ctx.moveTo(line1Coords.x1, line1Coords.y1);
    ctx.lineTo(line1Coords.x2, line1Coords.y2);
    ctx.stroke();

    // Line 2: sourcePointA -> targetPointA
    ctx.beginPath();
    ctx.moveTo(line2Coords.x1, line2Coords.y1);
    ctx.lineTo(line2Coords.x2, line2Coords.y2);
    ctx.stroke();

    ctx.globalAlpha = 1;
    ctx.restore();

    // Draw endpoint circles
    ctx.fillStyle = lineColor;
    const endpoints = [
      [line1Coords.x1, line1Coords.y1],
      [line1Coords.x2, line1Coords.y2],
      [line2Coords.x1, line2Coords.y1],
      [line2Coords.x2, line2Coords.y2],
    ];
    for (const [x, y] of endpoints) {
      ctx.beginPath();
      ctx.arc(x, y, pointRadius, 0, 2 * Math.PI);
      ctx.fill();
    }

    // Draw velocity arrows at intersection
    if (intersection) {
      const dir1 = normalize({
        x: line1Coords.x2 - line1Coords.x1,
        y: line1Coords.y2 - line1Coords.y1,
      });
      const dir2 = normalize({
        x: line2Coords.x2 - line2Coords.x1,
        y: line2Coords.y2 - line2Coords.y1,
      });
      const meanDir = normalize({
        x: (dir1.x + dir2.x) / 2,
        y: (dir1.y + dir2.y) / 2,
      });

      const lineLength1 = Math.hypot(
        line1Coords.x2 - line1Coords.x1,
        line1Coords.y2 - line1Coords.y1
      );
      const lineLength2 = Math.hypot(
        line2Coords.x2 - line2Coords.x1,
        line2Coords.y2 - line2Coords.y1
      );
      const arrowScale = arrowLength * Math.min(lineLength1, lineLength2);

      // Arrow 1 (dir1 - orange)
      ctx.save();
      ctx.strokeStyle = arrowColor;
      ctx.fillStyle = arrowColor;
      ctx.lineWidth = arrowWidth;
      drawArrow(
        ctx,
        intersection.x,
        intersection.y,
        intersection.x + dir1.x * arrowScale,
        intersection.y + dir1.y * arrowScale,
        6
      );
      ctx.restore();

      // Arrow 2 (dir2 - orange)
      ctx.save();
      ctx.strokeStyle = arrowColor;
      ctx.fillStyle = arrowColor;
      ctx.lineWidth = arrowWidth;
      drawArrow(
        ctx,
        intersection.x,
        intersection.y,
        intersection.x + dir2.x * arrowScale,
        intersection.y + dir2.y * arrowScale,
        6
      );
      ctx.restore();

      // Mean arrow (green)
      ctx.save();
      ctx.strokeStyle = meanVectorColor;
      ctx.fillStyle = meanVectorColor;
      ctx.lineWidth = arrowWidth;
      drawArrow(
        ctx,
        intersection.x,
        intersection.y,
        intersection.x + meanDir.x * arrowScale,
        intersection.y + meanDir.y * arrowScale,
        6
      );
      ctx.restore();

      // Draw intersection point
      ctx.beginPath();
      ctx.arc(intersection.x, intersection.y, pointRadius, 0, 2 * Math.PI);
      ctx.fillStyle = lineColor;
      ctx.fill();
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
    return () => {};
  });
</script>

<Figure {caption} {backgroundVisible}>
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
