<script>
  import { onMount } from 'svelte';
  import * as d3 from 'd3';
  import Figure from '$lib/components/Figure.svelte';
  import TimeSlider from '$lib/components/TimeSlider.svelte';
  import { plotKatexInSVG } from '@diffusion-explorer/ui';
  import { settings } from '$lib/settings';
  import {
    plotSourceTargetScatter,
    createSourceTargetScales
  } from '$lib/d3_helpers';

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
  export let sourceCenterX = 0.25;
  export let targetCenterX = 0.75;
  export let yShiftFactor = -0.2;

  // ===== SCATTER PLOT STYLING =====
  export let pointRadius = settings.stylingSettings.scatterPlot.radius;
  export let pointOpacity = settings.stylingSettings.scatterPlot.opacity;
  export let sourcePointColor = settings.stylingSettings.scatterPlot.color;
  export let targetPointColor = settings.stylingSettings.scatterPlot.color;

  // ===== PATH LINE STYLING (between x_0 and x_1) =====
  export let lineColor = '#888';
  export let lineOpacity = 0.25;
  export let lineWidth = 3;

  // ===== SELECTED POINT STYLING (x_0 and x_1) =====
  export let selectedPointColor = '#888';
  export let selectedPointRadius = 5;

  // ===== INTERMEDIATE POINT STYLING =====
  export let intermediatePointColor = '#f17720';
  export let intermediatePointRadius = 6;

  // ===== CONDITIONAL VECTOR STYLING (v_t) =====
  export let vectorColor = '#f17720';
  export let vectorOpacity = 1.0;
  export let vectorWidth = 2.5;
  export let vectorScale = 150;
  export let t = 0.3;

  // ===== NOISY VECTOR STYLING (v_t^\theta) =====
  export let noisyVectorColor = '#22c55e';
  export let noiseVector = [15, -90]; // [dx, dy] in pixels

  // ===== DASHED LINE STYLING =====
  export let dashedLineColor = '#ef4444';
  export let dashedLineWidth = 2;

  // ===== LABEL STYLING =====
  export let labelFontSize = 18;
  export let labelColor = settings.stylingSettings.figureLatex.color;
  export let labelYShiftFactor = -1.5;
  export let katexLabelOffset = 32;

  // ===== BACKGROUND =====
  export let backgroundVisible = true;

  // ===== KATEX OUTLINE STYLING =====
  export let katexOutline = settings.stylingSettings.figureLatex.outline;
  export let katexOutlineColor = settings.stylingSettings.figureLatex.outlineColor;
  export let katexOutlineWidth = settings.stylingSettings.figureLatex.outlineWidth;
  export let katexOutlineOpacity = settings.stylingSettings.figureLatex.outlineOpacity;

  // ===== FIXED POINT POSITIONS (pixel coords) =====
  export let x0Pixel = { x: 180, y: 170 };
  export let x1Pixel = { x: 620, y: 90 };

  // Vertical spacing between point and label
  const labelAbovePointOffset = -5;

  // ===== STATE =====
  let svgElement;
  let scales = null;
  let isInitialized = false;
  let figureIsActive;

  function initializeLayers() {
    const svg = d3.select(svgElement);
    svg.selectAll('*').remove();

    // Create arrow markers for vectors
    const defs = svg.append('defs');

    // Orange arrow for v_t
    defs.append('marker')
      .attr('id', 'conditional-flow-arrow')
      .attr('viewBox', '0 0 10 10')
      .attr('refX', 8)
      .attr('refY', 5)
      .attr('markerWidth', 5)
      .attr('markerHeight', 5)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M 0 0 L 10 5 L 0 10 z')
      .attr('fill', vectorColor);

    // Green arrow for v_t^\theta
    defs.append('marker')
      .attr('id', 'noisy-flow-arrow')
      .attr('viewBox', '0 0 10 10')
      .attr('refX', 8)
      .attr('refY', 5)
      .attr('markerWidth', 5)
      .attr('markerHeight', 5)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M 0 0 L 10 5 L 0 10 z')
      .attr('fill', noisyVectorColor);

    svg.append('g').attr('id', 'pathLines');
    svg.append('g').attr('id', 'sourceScatter');
    svg.append('g').attr('id', 'targetScatter');
    svg.append('g').attr('id', 'selectedElements');
    svg.append('g').attr('id', 'vectors');
    svg.append('g').attr('id', 'dashedLine');
    svg.append('g').attr('id', 'labels');
  }

  function plotPathLine() {
    const svg = d3.select(svgElement);
    const pathGroup = svg.select('#pathLines');
    pathGroup.selectAll('*').remove();

    pathGroup.append('line')
      .attr('x1', x0Pixel.x)
      .attr('y1', x0Pixel.y)
      .attr('x2', x1Pixel.x)
      .attr('y2', x1Pixel.y)
      .attr('stroke', lineColor)
      .attr('stroke-width', lineWidth)
      .attr('stroke-opacity', lineOpacity);
  }

  function plotSelectedPoints() {
    const svg = d3.select(svgElement);
    const selectedGroup = svg.select('#selectedElements');
    const labelGroup = svg.select('#labels');

    // Draw selected source point (x_0)
    selectedGroup.append('circle')
      .attr('cx', x0Pixel.x)
      .attr('cy', x0Pixel.y)
      .attr('r', selectedPointRadius)
      .attr('fill', selectedPointColor);

    // Add x_0 label above source point (centered)
    plotKatexInSVG(
      labelGroup,
      'x_0',
      x0Pixel.x,
      x0Pixel.y,
      {
        fontSize: labelFontSize,
        bg: false,
        color: labelColor,
        anchor: 'bottom-center',
        offsetY: labelAbovePointOffset,
        outline: katexOutline,
        outlineColor: katexOutlineColor,
        outlineWidth: katexOutlineWidth,
        outlineOpacity: katexOutlineOpacity,
      }
    );

    // Draw selected target point (x_1)
    selectedGroup.append('circle')
      .attr('cx', x1Pixel.x)
      .attr('cy', x1Pixel.y)
      .attr('r', selectedPointRadius)
      .attr('fill', selectedPointColor);

    // Add x_1 label above target point (centered)
    plotKatexInSVG(
      labelGroup,
      'x_1',
      x1Pixel.x,
      x1Pixel.y,
      {
        fontSize: labelFontSize,
        bg: false,
        color: labelColor,
        anchor: 'bottom-center',
        offsetY: labelAbovePointOffset,
        outline: katexOutline,
        outlineColor: katexOutlineColor,
        outlineWidth: katexOutlineWidth,
        outlineOpacity: katexOutlineOpacity,
      }
    );
  }

  function plotIntermediatePointAndVectors() {
    const svg = d3.select(svgElement);
    const selectedGroup = svg.select('#selectedElements');
    const vectorGroup = svg.select('#vectors');
    const dashedLineGroup = svg.select('#dashedLine');
    const labelGroup = svg.select('#labels');

    // Interpolate directly in pixel space
    const interpX = (1 - t) * x0Pixel.x + t * x1Pixel.x;
    const interpY = (1 - t) * x0Pixel.y + t * x1Pixel.y;

    // Compute vector direction in PIXEL space (from interp toward target)
    const pixelDx = x1Pixel.x - interpX;
    const pixelDy = x1Pixel.y - interpY;
    const pixelMag = Math.sqrt(pixelDx * pixelDx + pixelDy * pixelDy);

    // Draw intermediate point
    selectedGroup.append('circle')
      .attr('cx', interpX)
      .attr('cy', interpY)
      .attr('r', intermediatePointRadius)
      .attr('fill', intermediatePointColor);

    // Add x label above intermediate point (centered)
    plotKatexInSVG(
      labelGroup,
      'x',
      interpX,
      interpY,
      {
        fontSize: labelFontSize,
        bg: false,
        color: labelColor,
        anchor: 'bottom-center',
        offsetY: labelAbovePointOffset,
        outline: katexOutline,
        outlineColor: katexOutlineColor,
        outlineWidth: katexOutlineWidth,
        outlineOpacity: katexOutlineOpacity,
      }
    );

    // Draw vectors (if magnitude is significant)
    if (pixelMag > 0.01) {
      // Scale to desired pixel length for v_t
      const vtEndX = interpX + (pixelDx / pixelMag) * vectorScale;
      const vtEndY = interpY + (pixelDy / pixelMag) * vectorScale;

      // Draw v_t(x_t|x_1) vector
      vectorGroup.append('line')
        .attr('x1', interpX)
        .attr('y1', interpY)
        .attr('x2', vtEndX)
        .attr('y2', vtEndY)
        .attr('stroke', vectorColor)
        .attr('stroke-width', vectorWidth)
        .attr('stroke-opacity', vectorOpacity)
        .attr('marker-end', 'url(#conditional-flow-arrow)');

      // Add v_t(x_t|x_1) label above center of vector
      const vtCenterX = (interpX + vtEndX) / 2;
      const vtCenterY = (interpY + vtEndY) / 2;
      plotKatexInSVG(
        labelGroup,
        'v_t(x_t|x_1)',
        vtCenterX - 30,
        vtCenterY - katexLabelOffset + 33,
        {
          fontSize: labelFontSize - 2,
          bg: false,
          color: vectorColor,
          outline: katexOutline,
          outlineColor: katexOutlineColor,
          outlineWidth: katexOutlineWidth,
          outlineOpacity: katexOutlineOpacity,
        }
      );

      // Compute v_t^\theta endpoint by adding noise vector in pixel coords
      const vtThetaEndX = vtEndX + noiseVector[0];
      const vtThetaEndY = vtEndY + noiseVector[1];

      // Draw v_t^\theta(x_t) vector
      vectorGroup.append('line')
        .attr('x1', interpX)
        .attr('y1', interpY)
        .attr('x2', vtThetaEndX)
        .attr('y2', vtThetaEndY)
        .attr('stroke', noisyVectorColor)
        .attr('stroke-width', vectorWidth)
        .attr('stroke-opacity', vectorOpacity)
        .attr('marker-end', 'url(#noisy-flow-arrow)');

      // Add v_t^\theta(x_t) label above center of noisy vector
      const vtThetaCenterX = (interpX + vtThetaEndX) / 2;
      const vtThetaCenterY = (interpY + vtThetaEndY) / 2;
      plotKatexInSVG(
        labelGroup,
        'v_t^\\theta(x_t)',
        vtThetaCenterX - 50,
        vtThetaCenterY - katexLabelOffset - 10,
        {
          fontSize: labelFontSize - 2,
          bg: false,
          color: noisyVectorColor,
          outline: katexOutline,
          outlineColor: katexOutlineColor,
          outlineWidth: katexOutlineWidth,
          outlineOpacity: katexOutlineOpacity,
        }
      );

      // Draw red dashed line between v_t tip and v_t^\theta tip
      dashedLineGroup.append('line')
        .attr('x1', vtEndX)
        .attr('y1', vtEndY)
        .attr('x2', vtThetaEndX)
        .attr('y2', vtThetaEndY)
        .attr('stroke', dashedLineColor)
        .attr('stroke-width', dashedLineWidth)
        .attr('stroke-dasharray', '5,3');
    }
  }

  function initializeVisualization() {
    if (!svgElement) return;
    if (sourceDistributionSamples.length === 0 || targetDistributionSamples.length === 0) return;

    initializeLayers();

    scales = createSourceTargetScales(sourceDistributionSamples, targetDistributionSamples, {
      width, height, marginWidth, marginHeight, sourceCenterX, targetCenterX, yShiftFactor
    });

    const svg = d3.select(svgElement);

    // Plot distributions (with lower opacity for context)
    plotSourceTargetScatter(svg, sourceDistributionSamples, targetDistributionSamples, scales, {
      sourcePointColor,
      targetPointColor,
      pointRadius,
      pointOpacity: pointOpacity * 0.5
    });

    // Plot path line between source and target
    plotPathLine();

    // Plot selected source and target points with labels
    plotSelectedPoints();

    // Plot intermediate point and both vectors
    plotIntermediatePointAndVectors();

    // Plot distribution labels using KaTeX
    const labelGroup = svg.select('#labels');
    const yDomain = scales.yScale.domain();
    // With default yScale, lower Y values (yDomain[0]) map to top of screen
    const yTop = yDomain[0];
    const distributionLabelY = scales.yScale(yTop) + labelYShiftFactor * 22;

    plotKatexInSVG(
      labelGroup,
      'p_0',
      scales.sourceCenterPixelX,
      distributionLabelY,
      {
        fontSize: 22,
        bg: false,
        color: '#666',
        anchor: 'top-center',
        outline: katexOutline,
        outlineColor: katexOutlineColor,
        outlineWidth: katexOutlineWidth,
        outlineOpacity: katexOutlineOpacity,
      }
    );

    plotKatexInSVG(
      labelGroup,
      'p_1',
      scales.targetCenterPixelX,
      distributionLabelY,
      {
        fontSize: 22,
        bg: false,
        color: '#666',
        anchor: 'top-center',
        outline: katexOutline,
        outlineColor: katexOutlineColor,
        outlineWidth: katexOutlineWidth,
        outlineOpacity: katexOutlineOpacity,
      }
    );

    isInitialized = true;
  }

  $: if (!isInitialized &&
         sourceDistributionSamples.length > 0 &&
         targetDistributionSamples.length > 0 &&
         svgElement) {
    initializeVisualization();
  }

  onMount(() => {
    return () => {
      // Cleanup if needed
    };
  });
</script>

<Figure {caption} {backgroundVisible} bind:isActive={figureIsActive}>
  {#snippet children()}
    <div style="display: flex; flex-direction: column; align-items: center; width: 100%;">
      <svg
        bind:this={svgElement}
        viewBox="0 0 {width} {height}"
        preserveAspectRatio="xMidYMid meet"
        style="width: 100%; height: auto; max-width: {width}px;"
      >
      </svg>
      <TimeSlider
        bind:value={t}
        min={0}
        max={1}
        disabled={true}
        color="#888"
      />
    </div>
  {/snippet}
</Figure>
