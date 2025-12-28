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

  // ===== PATH LINE STYLING =====
  export let pathLineColor = '#888';
  export let pathLineOpacity = 0.25;
  export let pathLineWidth = 3;
  export let numPathLines = 15;

  // ===== SELECTED TARGET POINT STYLING =====
  export let selectedTargetColor = '#888';
  export let selectedTargetRadius = 5;

  // ===== INTERMEDIATE POINT STYLING =====
  export let intermediatePointColor = '#f17720';
  export let intermediatePointRadius = 6;

  // ===== CONDITIONAL VECTOR STYLING =====
  export let vectorColor = '#f17720';
  export let vectorOpacity = 1.0;
  export let vectorWidth = 2.5;
  export let vectorScale = 80;
  export let t = 0.4;

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

  // Vertical spacing between point and label
  const labelAbovePointOffset = -5;

  // ===== STATE =====
  let svgElement;
  let scales = null;
  let isInitialized = false;
  let figureIsActive;

  // Selected indices
  let selectedTargetIndex = 0;
  let selectedSourceIndices = [];
  let selectedPathIndex = 0;

  function initializeLayers() {
    const svg = d3.select(svgElement);
    svg.selectAll('*').remove();

    // Create arrow marker for vector
    const defs = svg.append('defs');
    defs.append('marker')
      .attr('id', 'conditional-vector-arrow')
      .attr('viewBox', '0 0 10 10')
      .attr('refX', 8)
      .attr('refY', 5)
      .attr('markerWidth', 5)
      .attr('markerHeight', 5)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M 0 0 L 10 5 L 0 10 z')
      .attr('fill', vectorColor);

    svg.append('g').attr('id', 'pathLines');
    svg.append('g').attr('id', 'sourceScatter');
    svg.append('g').attr('id', 'targetScatter');
    svg.append('g').attr('id', 'selectedElements');
    svg.append('g').attr('id', 'vector');
    svg.append('g').attr('id', 'labels');
  }

  function selectRandomIndices() {
    // Select a random target point
    selectedTargetIndex = Math.floor(Math.random() * targetDistributionSamples.length);

    // Select random source points for path lines
    selectedSourceIndices = [];
    const sourceCount = sourceDistributionSamples.length;
    for (let i = 0; i < numPathLines && i < sourceCount; i++) {
      let idx;
      do {
        idx = Math.floor(Math.random() * sourceCount);
      } while (selectedSourceIndices.includes(idx));
      selectedSourceIndices.push(idx);
    }

    // Path selection is done after scales are created in initializeVisualization
  }

  function interpDataToPixel(dataX, dataY, tVal, scalesObj) {
    // Interpolate between source and target reference frames for X
    const sourcePixelX = scalesObj.sourceCenterPixelX + (dataX - scalesObj.sourceMeanX) * scalesObj.xScaleFactor;
    const targetPixelX = scalesObj.targetCenterPixelX + (dataX - scalesObj.targetMeanX) * scalesObj.xScaleFactor;
    const pixelX = (1 - tVal) * sourcePixelX + tVal * targetPixelX;
    const pixelY = scalesObj.yScale(dataY);
    return { x: pixelX, y: pixelY };
  }

  function selectPathByAngle() {
    // Get target point in pixel coords
    const targetPoint = targetDistributionSamples[selectedTargetIndex];
    const targetPixelX = dataToPixelX(targetPoint[0], false, scales);
    const targetPixelY = scales.yScale(targetPoint[1]);

    let maxAngle = -Infinity;
    selectedPathIndex = 0;

    for (let i = 0; i < selectedSourceIndices.length; i++) {
      const sourcePoint = sourceDistributionSamples[selectedSourceIndices[i]];
      const sourcePixelX = dataToPixelX(sourcePoint[0], true, scales);
      const sourcePixelY = scales.yScale(sourcePoint[1]);

      // Compute angle from target to source
      const dx = sourcePixelX - targetPixelX;
      const dy = sourcePixelY - targetPixelY;
      let angle = Math.atan2(dy, dx);

      // Normalize to [0, 2π) for counter-clockwise measurement from radian 0
      if (angle < 0) {
        angle += 2 * Math.PI;
      }

      if (angle > maxAngle) {
        maxAngle = angle;
        selectedPathIndex = i;
      }
    }
  }

  function plotPathLines() {
    if (!scales) return;

    const svg = d3.select(svgElement);
    const pathGroup = svg.select('#pathLines');
    pathGroup.selectAll('*').remove();

    const targetPoint = targetDistributionSamples[selectedTargetIndex];
    const targetX = dataToPixelX(targetPoint[0], false, scales);
    const targetY = scales.yScale(targetPoint[1]);

    selectedSourceIndices.forEach((sourceIdx) => {
      const sourcePoint = sourceDistributionSamples[sourceIdx];
      const sourceX = dataToPixelX(sourcePoint[0], true, scales);
      const sourceY = scales.yScale(sourcePoint[1]);

      pathGroup.append('line')
        .attr('x1', sourceX)
        .attr('y1', sourceY)
        .attr('x2', targetX)
        .attr('y2', targetY)
        .attr('stroke', pathLineColor)
        .attr('stroke-width', pathLineWidth)
        .attr('stroke-opacity', pathLineOpacity);
    });
  }

  function plotSelectedTarget() {
    if (!scales) return;

    const svg = d3.select(svgElement);
    const selectedGroup = svg.select('#selectedElements');

    const targetPoint = targetDistributionSamples[selectedTargetIndex];
    const targetX = dataToPixelX(targetPoint[0], false, scales);
    const targetY = scales.yScale(targetPoint[1]);

    // Draw selected target point
    selectedGroup.append('circle')
      .attr('cx', targetX)
      .attr('cy', targetY)
      .attr('r', selectedTargetRadius)
      .attr('fill', selectedTargetColor);

    // Add x_1 label above target point
    const labelGroup = svg.select('#labels');
    plotKatexInSVG(
      labelGroup,
      'x_1',
      targetX,
      targetY,
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

  function plotIntermediatePointAndVector() {
    if (!scales || selectedSourceIndices.length === 0) return;

    const svg = d3.select(svgElement);
    const selectedGroup = svg.select('#selectedElements');
    const vectorGroup = svg.select('#vector');
    const labelGroup = svg.select('#labels');

    // ===== STEP 1: Compute all positions in DATA coordinates =====
    const sourceIdx = selectedSourceIndices[selectedPathIndex];
    const sourcePoint = sourceDistributionSamples[sourceIdx];
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

    // Add x label above intermediate point (centered)
    plotKatexInSVG(
      labelGroup,
      'x',
      interpPixel.x,
      interpPixel.y,
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

    // Draw vector (if magnitude is significant)
    if (pixelMag > 0.01) {
      // Scale to desired pixel length
      const scaledEndX = interpPixel.x + (pixelDx / pixelMag) * vectorScale;
      const scaledEndY = interpPixel.y + (pixelDy / pixelMag) * vectorScale;

      vectorGroup.append('line')
        .attr('x1', interpPixel.x)
        .attr('y1', interpPixel.y)
        .attr('x2', scaledEndX)
        .attr('y2', scaledEndY)
        .attr('stroke', vectorColor)
        .attr('stroke-width', vectorWidth)
        .attr('stroke-opacity', vectorOpacity)
        .attr('marker-end', 'url(#conditional-vector-arrow)');

      // Add v_t(x|x_1) label above center of vector
      const vectorCenterX = (interpPixel.x + scaledEndX) / 2;
      const vectorCenterY = (interpPixel.y + scaledEndY) / 2;
      plotKatexInSVG(
        labelGroup,
        'v_t(x|x_1)',
        vectorCenterX,
        vectorCenterY - katexLabelOffset - 10,
        {
          fontSize: labelFontSize - 2,
          bg: false,
          color: vectorColor,
          anchor: 'bottom-center',
          outline: katexOutline,
          outlineColor: katexOutlineColor,
          outlineWidth: katexOutlineWidth,
          outlineOpacity: katexOutlineOpacity,
        }
      );
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

    // Select path based on angular position (needs scales)
    selectPathByAngle();

    const svg = d3.select(svgElement);

    // Plot distributions (with lower opacity for context)
    plotSourceTargetScatter(svg, sourceDistributionSamples, targetDistributionSamples, scales, {
      sourcePointColor,
      targetPointColor,
      pointRadius,
      pointOpacity: pointOpacity * 0.5
    });

    // Plot path lines
    plotPathLines();

    // Plot selected target with label
    plotSelectedTarget();

    // Plot intermediate point and conditional vector
    plotIntermediatePointAndVector();

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
    <svg
      bind:this={svgElement}
      viewBox="0 0 {width} {height}"
      preserveAspectRatio="xMidYMid meet"
      style="width: 100%; height: auto; max-width: {width}px;"
    >
    </svg>
  {/snippet}
</Figure>
