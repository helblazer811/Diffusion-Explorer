<script>
  import { onMount } from 'svelte';
  import * as d3 from 'd3';
  import Figure from '$lib/components/Figure.svelte';
  import { plotKatexInSVG } from '@diffusion-explorer/ui';
  import { settings } from '$lib/settings';
  import {
    plotSourceTargetScatter,
    createSourceTargetScales,
    dataToPixelX
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

  // ===== STATE =====
  let svgElement;
  let scales = null;
  let isInitialized = false;
  let figureIsActive;

  // Selected indices
  let selectedSourceIndex = 0;
  let selectedTargetIndex = 0;

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

  function selectRandomIndices() {
    // Select a random source point
    selectedSourceIndex = Math.floor(Math.random() * sourceDistributionSamples.length);
    // Select a random target point
    selectedTargetIndex = Math.floor(Math.random() * targetDistributionSamples.length);
  }

  function interpDataToPixel(dataX, dataY, tVal, scalesObj) {
    // Interpolate between source and target reference frames for X
    const sourcePixelX = scalesObj.sourceCenterPixelX + (dataX - scalesObj.sourceMeanX) * scalesObj.xScaleFactor;
    const targetPixelX = scalesObj.targetCenterPixelX + (dataX - scalesObj.targetMeanX) * scalesObj.xScaleFactor;
    const pixelX = (1 - tVal) * sourcePixelX + tVal * targetPixelX;
    const pixelY = scalesObj.yScale(dataY);
    return { x: pixelX, y: pixelY };
  }

  function plotPathLine() {
    if (!scales) return;

    const svg = d3.select(svgElement);
    const pathGroup = svg.select('#pathLines');
    pathGroup.selectAll('*').remove();

    const sourcePoint = sourceDistributionSamples[selectedSourceIndex];
    const targetPoint = targetDistributionSamples[selectedTargetIndex];

    const sourceX = dataToPixelX(sourcePoint[0], true, scales);
    const sourceY = scales.yScale(sourcePoint[1]);
    const targetX = dataToPixelX(targetPoint[0], false, scales);
    const targetY = scales.yScale(targetPoint[1]);

    pathGroup.append('line')
      .attr('x1', sourceX)
      .attr('y1', sourceY)
      .attr('x2', targetX)
      .attr('y2', targetY)
      .attr('stroke', lineColor)
      .attr('stroke-width', lineWidth)
      .attr('stroke-opacity', lineOpacity);
  }

  function plotSelectedPoints() {
    if (!scales) return;

    const svg = d3.select(svgElement);
    const selectedGroup = svg.select('#selectedElements');
    const labelGroup = svg.select('#labels');

    // Get source point
    const sourcePoint = sourceDistributionSamples[selectedSourceIndex];
    const sourceX = dataToPixelX(sourcePoint[0], true, scales);
    const sourceY = scales.yScale(sourcePoint[1]);

    // Draw selected source point (x_0)
    selectedGroup.append('circle')
      .attr('cx', sourceX)
      .attr('cy', sourceY)
      .attr('r', selectedPointRadius)
      .attr('fill', selectedPointColor);

    // Add x_0 label above source point (centered)
    plotKatexInSVG(
      labelGroup,
      'x_0',
      sourceX - 14,
      sourceY - katexLabelOffset - 10,
      {
        fontSize: labelFontSize,
        bg: false,
        color: labelColor
      }
    );

    // Get target point
    const targetPoint = targetDistributionSamples[selectedTargetIndex];
    const targetX = dataToPixelX(targetPoint[0], false, scales);
    const targetY = scales.yScale(targetPoint[1]);

    // Draw selected target point (x_1)
    selectedGroup.append('circle')
      .attr('cx', targetX)
      .attr('cy', targetY)
      .attr('r', selectedPointRadius)
      .attr('fill', selectedPointColor);

    // Add x_1 label above target point (centered)
    plotKatexInSVG(
      labelGroup,
      'x_1',
      targetX - 14,
      targetY - katexLabelOffset - 10,
      {
        fontSize: labelFontSize,
        bg: false,
        color: labelColor
      }
    );
  }

  function plotIntermediatePointAndVectors() {
    if (!scales) return;

    const svg = d3.select(svgElement);
    const selectedGroup = svg.select('#selectedElements');
    const vectorGroup = svg.select('#vectors');
    const dashedLineGroup = svg.select('#dashedLine');
    const labelGroup = svg.select('#labels');

    // ===== STEP 1: Compute all positions in DATA coordinates =====
    const sourcePoint = sourceDistributionSamples[selectedSourceIndex];
    const targetPoint = targetDistributionSamples[selectedTargetIndex];

    // Intermediate point at time t (data coords)
    const interpDataX = (1 - t) * sourcePoint[0] + t * targetPoint[0];
    const interpDataY = (1 - t) * sourcePoint[1] + t * targetPoint[1];

    // ===== STEP 2: Convert positions to PIXEL coordinates =====
    const interpPixel = interpDataToPixel(interpDataX, interpDataY, t, scales);

    // Convert target point to pixel coords (target is at t=1)
    const targetPixelX = dataToPixelX(targetPoint[0], false, scales);
    const targetPixelY = scales.yScale(targetPoint[1]);

    // Compute vector direction in PIXEL space (from interp toward target)
    const pixelDx = targetPixelX - interpPixel.x;
    const pixelDy = targetPixelY - interpPixel.y;
    const pixelMag = Math.sqrt(pixelDx * pixelDx + pixelDy * pixelDy);

    // ===== STEP 3: Draw everything using pixel coordinates =====

    // Draw intermediate point
    selectedGroup.append('circle')
      .attr('cx', interpPixel.x)
      .attr('cy', interpPixel.y)
      .attr('r', intermediatePointRadius)
      .attr('fill', intermediatePointColor);

    // Add x label above intermediate point (shifted left a bit)
    plotKatexInSVG(
      labelGroup,
      'x',
      interpPixel.x - 12,
      interpPixel.y - katexLabelOffset - 10,
      {
        fontSize: labelFontSize,
        bg: false,
        color: labelColor
      }
    );

    // Draw vectors (if magnitude is significant)
    if (pixelMag > 0.01) {
      // Scale to desired pixel length for v_t
      const vtEndX = interpPixel.x + (pixelDx / pixelMag) * vectorScale;
      const vtEndY = interpPixel.y + (pixelDy / pixelMag) * vectorScale;

      // Draw v_t(x|x_1) vector
      vectorGroup.append('line')
        .attr('x1', interpPixel.x)
        .attr('y1', interpPixel.y)
        .attr('x2', vtEndX)
        .attr('y2', vtEndY)
        .attr('stroke', vectorColor)
        .attr('stroke-width', vectorWidth)
        .attr('stroke-opacity', vectorOpacity)
        .attr('marker-end', 'url(#conditional-flow-arrow)');

      // Add v_t(x|x_1) label above center of vector
      const vtCenterX = (interpPixel.x + vtEndX) / 2;
      const vtCenterY = (interpPixel.y + vtEndY) / 2;
      plotKatexInSVG(
        labelGroup,
        'v_t(x|x_1)',
        vtCenterX,
        vtCenterY - katexLabelOffset - 10,
        {
          fontSize: labelFontSize - 2,
          bg: false,
          color: vectorColor
        }
      );

      // Compute v_t^\theta endpoint by adding noise vector in pixel coords
      const vtThetaEndX = vtEndX + noiseVector[0];
      const vtThetaEndY = vtEndY + noiseVector[1];

      // Draw v_t^\theta(x) vector
      vectorGroup.append('line')
        .attr('x1', interpPixel.x)
        .attr('y1', interpPixel.y)
        .attr('x2', vtThetaEndX)
        .attr('y2', vtThetaEndY)
        .attr('stroke', noisyVectorColor)
        .attr('stroke-width', vectorWidth)
        .attr('stroke-opacity', vectorOpacity)
        .attr('marker-end', 'url(#noisy-flow-arrow)');

      // Add v_t^\theta(x) label above center of noisy vector
      const vtThetaCenterX = (interpPixel.x + vtThetaEndX) / 2;
      const vtThetaCenterY = (interpPixel.y + vtThetaEndY) / 2;
      plotKatexInSVG(
        labelGroup,
        'v_t^\\theta(x)',
        vtThetaCenterX,
        vtThetaCenterY - katexLabelOffset - 10,
        {
          fontSize: labelFontSize - 2,
          bg: false,
          color: noisyVectorColor
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
    selectRandomIndices();

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

    // Offset to center (plotKatexInSVG positions from left edge)
    const katexCenterOffset = 15;

    plotKatexInSVG(
      labelGroup,
      'p_0',
      scales.sourceCenterPixelX - katexCenterOffset,
      distributionLabelY,
      {
        fontSize: 22,
        bg: false,
        color: '#666'
      }
    );

    plotKatexInSVG(
      labelGroup,
      'p_1',
      scales.targetCenterPixelX - katexCenterOffset,
      distributionLabelY,
      {
        fontSize: 22,
        bg: false,
        color: '#666'
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
    <svg
      bind:this={svgElement}
      viewBox="0 0 {width} {height}"
      preserveAspectRatio="xMidYMid meet"
      style="width: 100%; height: auto; max-width: {width}px;"
    >
    </svg>
  {/snippet}
</Figure>
