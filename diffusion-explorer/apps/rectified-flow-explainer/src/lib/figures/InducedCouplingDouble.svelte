<!-- Compares independent coupling (left) vs induced coupling from flow model (right) -->

<script>
  import { onMount } from 'svelte';
  import * as d3 from 'd3';
  import DoubleFigure from '$lib/components/DoubleFigure.svelte';
  import { settings } from '$lib/settings';
  import { createSourceTargetScales, dataToPixelX } from '$lib/d3_helpers';
  import { clipAllRectifiedTrajectoriesToStartingRadius } from '$lib/utils';

  // Caption slot (passed as default children)
  export let children = undefined;
  $: caption = children;

  // Data props
  export let allRectifiedTrajectories = []; // [rectifiedStep][timestep][sample][dim]
  export let targetDistribution = []; // For displaying target points

  // Clipping props (tighter than global default for smaller SVG)
  export let clippingRadius = 1.5;

  // Apply clipping internally
  $: clippedTrajectories = clipAllRectifiedTrajectoriesToStartingRadius(
    allRectifiedTrajectories ?? [],
    clippingRadius
  );

  // Data validation
  $: isDataValid =
    clippedTrajectories &&
    clippedTrajectories.length > 0 &&
    clippedTrajectories[0] &&
    clippedTrajectories[0].length > 0 &&
    targetDistribution &&
    targetDistribution.length > 0;

  // Layout props
  export let svgWidth = 350;
  export let svgHeight = 250;
  export let sourceCenterX = settings.stylingSettings.layout.sourceCenterX;
  export let targetCenterX = settings.stylingSettings.layout.targetCenterX;
  export let marginWidth = 20;
  export let marginHeight = 20;
  export let gap = 30;

  // Styling props
  export let sourcePointColor = settings.stylingSettings.scatterPlot.color;
  export let targetPointColor = settings.stylingSettings.scatterPlot.color;
  export let edgeColor = '#888';
  export let edgeOpacity = 0.3;
  export let edgeWidth = 1.5;
  export let pointRadius = settings.stylingSettings.scatterPlot.radius;
  export let pointOpacity = 0.35; // Custom: different from default
  export let hoverEdgeColor = '#555';
  export let hoverEdgeWidth = 3;
  export let hoverEdgeOpacity = 0.8;
  export let hoverPointOpacity = 0.9;
  export let yShiftFactor = settings.stylingSettings.scatterPlot.yShiftFactor;
  export let distributionScaleFactor = 0.6;

  // Label props
  export let leftLabel = 'Independent Coupling';
  export let rightLabel = 'Induced Coupling';
  export let labelFontSize = settings.stylingSettings.label.fontSize;
  export let labelColor = settings.stylingSettings.label.color;

  // Background visibility
  export let backgroundVisible = true;

  // Number of samples to show (subsample if too many)
  export let numSamplesToShow = 50;

  // SVG references
  let leftSvgElement;
  let rightSvgElement;

  // Scales (shared between panels)
  let scales = null;

  // State
  let isInitialized = false;
  let selectedIndices = [];
  let shuffledIndicesForLeft = [];

  // Derived data
  $: sourcePoints = isDataValid ? clippedTrajectories[0][0] : [];
  $: destinationPoints = isDataValid
    ? clippedTrajectories[0][clippedTrajectories[0].length - 1]
    : [];

  function selectSampleIndices() {
    if (!isDataValid) return;

    const numAvailable = sourcePoints.length;
    const numToSelect = Math.min(numSamplesToShow, numAvailable);

    const indices = [];
    const availableIndices = Array.from({ length: numAvailable }, (_, i) => i);

    for (let i = 0; i < numToSelect; i++) {
      const randomIndex = Math.floor(Math.random() * availableIndices.length);
      indices.push(availableIndices.splice(randomIndex, 1)[0]);
    }

    selectedIndices = indices;

    // Create shuffled version for independent coupling (left panel)
    shuffledIndicesForLeft = [...indices].sort(() => Math.random() - 0.5);
  }

  function plotScatter(svgElement, points, color, groupId, isSource = true) {
    if (!svgElement || !scales || points.length === 0) return;

    const svg = d3.select(svgElement);
    svg.select(`#${groupId}`).remove();

    const group = svg.append('g').attr('id', groupId);

    group.selectAll('circle')
      .data(points)
      .enter()
      .append('circle')
      .attr('class', (d, i) => `${groupId}-point point-${i}`)
      .attr('cx', d => dataToPixelX(d[0], isSource, scales))
      .attr('cy', d => scales.yScale(d[1]))
      .attr('r', pointRadius)
      .attr('fill', color)
      .attr('opacity', pointOpacity)
      .attr('data-original-opacity', pointOpacity)
      .style('cursor', 'pointer');
  }

  function plotCouplingEdges(svgElement, sourcePoints, targetPoints, groupId, isInduced = false) {
    if (!svgElement || !scales) return;

    const svg = d3.select(svgElement);
    svg.select(`#${groupId}`).remove();

    const edgesGroup = svg.append('g').attr('id', groupId);

    // For independent coupling (left): use shuffled pairing
    // For induced coupling (right): use direct pairing (source[i] → target[i])
    const couplingData = sourcePoints.map((sourcePoint, i) => {
      const targetIdx = isInduced ? i : shuffledIndicesForLeft.indexOf(selectedIndices[i]);
      const targetPoint = targetPoints[isInduced ? i : targetIdx >= 0 ? targetIdx : i];
      return { source: sourcePoint, target: targetPoint, sourceIdx: i, targetIdx: isInduced ? i : targetIdx };
    });

    // Draw visible edges
    edgesGroup.selectAll('line.visible-edge')
      .data(couplingData)
      .enter()
      .append('line')
      .attr('class', (d, i) => `visible-edge edge-${i}`)
      .attr('x1', d => dataToPixelX(d.source[0], true, scales))
      .attr('y1', d => scales.yScale(d.source[1]))
      .attr('x2', d => dataToPixelX(d.target[0], false, scales))
      .attr('y2', d => scales.yScale(d.target[1]))
      .attr('stroke', edgeColor)
      .attr('stroke-width', edgeWidth)
      .attr('stroke-opacity', edgeOpacity);

    // Draw invisible hit area edges
    edgesGroup.selectAll('line.hit-area')
      .data(couplingData)
      .enter()
      .append('line')
      .attr('class', (d, i) => `hit-area hit-area-${i}`)
      .attr('x1', d => dataToPixelX(d.source[0], true, scales))
      .attr('y1', d => scales.yScale(d.source[1]))
      .attr('x2', d => dataToPixelX(d.target[0], false, scales))
      .attr('y2', d => scales.yScale(d.target[1]))
      .attr('stroke', 'transparent')
      .attr('stroke-width', edgeWidth * 3)
      .style('cursor', 'pointer')
      .on('mouseover', function(event, d) {
        const index = couplingData.indexOf(d);

        // Highlight the edge
        edgesGroup.select(`.edge-${index}`)
          .attr('stroke', hoverEdgeColor)
          .attr('stroke-width', hoverEdgeWidth)
          .attr('stroke-opacity', hoverEdgeOpacity);

        // Highlight endpoints
        svg.select(`.sourcePoints-point.point-${index}`)
          .attr('opacity', hoverPointOpacity);
        svg.select(`.targetPoints-point.point-${d.targetIdx}`)
          .attr('opacity', hoverPointOpacity);
      })
      .on('mouseout', function(event, d) {
        const index = couplingData.indexOf(d);

        // Reset the edge
        edgesGroup.select(`.edge-${index}`)
          .attr('stroke', edgeColor)
          .attr('stroke-width', edgeWidth)
          .attr('stroke-opacity', edgeOpacity);

        // Reset endpoints
        const sourceCircle = svg.select(`.sourcePoints-point.point-${index}`);
        sourceCircle.attr('opacity', sourceCircle.attr('data-original-opacity'));
        const targetCircle = svg.select(`.targetPoints-point.point-${d.targetIdx}`);
        targetCircle.attr('opacity', targetCircle.attr('data-original-opacity'));
      });

    return couplingData;
  }

  function plotPanelLabel(svgElement, label) {
    if (!svgElement) return;

    const svg = d3.select(svgElement);
    svg.select('.panel-label').remove();

    const labelGroup = svg.append('g').attr('class', 'panel-label');
    const labelX = svgWidth / 2;
    const labelY = 1.2 * labelFontSize;

    labelGroup
      .append('text')
      .attr('x', labelX)
      .attr('y', labelY)
      .attr('text-anchor', 'middle')
      .attr('font-size', `${labelFontSize}px`)
      .attr('fill', labelColor)
      .text(label);
  }

  function setupPointHoverHandlers(svgElement, couplingData) {
    if (!svgElement) return;

    const svg = d3.select(svgElement);
    const edgesGroup = svg.select('#couplingEdges');

    // Source point hover
    svg.selectAll('.sourcePoints-point')
      .on('mouseover', function(event, d) {
        const sourceIndex = parseInt(d3.select(this).attr('class').match(/point-(\d+)/)?.[1] || '0');
        const coupling = couplingData[sourceIndex];

        edgesGroup.select(`.edge-${sourceIndex}`)
          .attr('stroke', hoverEdgeColor)
          .attr('stroke-width', hoverEdgeWidth)
          .attr('stroke-opacity', hoverEdgeOpacity);

        d3.select(this).attr('opacity', hoverPointOpacity);
        svg.select(`.targetPoints-point.point-${coupling.targetIdx}`)
          .attr('opacity', hoverPointOpacity);
      })
      .on('mouseout', function(event, d) {
        const sourceIndex = parseInt(d3.select(this).attr('class').match(/point-(\d+)/)?.[1] || '0');
        const coupling = couplingData[sourceIndex];

        edgesGroup.select(`.edge-${sourceIndex}`)
          .attr('stroke', edgeColor)
          .attr('stroke-width', edgeWidth)
          .attr('stroke-opacity', edgeOpacity);

        d3.select(this).attr('opacity', d3.select(this).attr('data-original-opacity'));
        const targetCircle = svg.select(`.targetPoints-point.point-${coupling.targetIdx}`);
        targetCircle.attr('opacity', targetCircle.attr('data-original-opacity'));
      });

    // Target point hover
    svg.selectAll('.targetPoints-point')
      .on('mouseover', function(event, d) {
        const targetIndex = parseInt(d3.select(this).attr('class').match(/point-(\d+)/)?.[1] || '0');
        const coupling = couplingData.find(c => c.targetIdx === targetIndex);
        if (!coupling) return;

        const sourceIndex = couplingData.indexOf(coupling);

        edgesGroup.select(`.edge-${sourceIndex}`)
          .attr('stroke', hoverEdgeColor)
          .attr('stroke-width', hoverEdgeWidth)
          .attr('stroke-opacity', hoverEdgeOpacity);

        d3.select(this).attr('opacity', hoverPointOpacity);
        svg.select(`.sourcePoints-point.point-${sourceIndex}`)
          .attr('opacity', hoverPointOpacity);
      })
      .on('mouseout', function(event, d) {
        const targetIndex = parseInt(d3.select(this).attr('class').match(/point-(\d+)/)?.[1] || '0');
        const coupling = couplingData.find(c => c.targetIdx === targetIndex);
        if (!coupling) return;

        const sourceIndex = couplingData.indexOf(coupling);

        edgesGroup.select(`.edge-${sourceIndex}`)
          .attr('stroke', edgeColor)
          .attr('stroke-width', edgeWidth)
          .attr('stroke-opacity', edgeOpacity);

        d3.select(this).attr('opacity', d3.select(this).attr('data-original-opacity'));
        const sourceCircle = svg.select(`.sourcePoints-point.point-${sourceIndex}`);
        sourceCircle.attr('opacity', sourceCircle.attr('data-original-opacity'));
      });
  }

  function initializePanel(svgElement, label, isInduced) {
    if (!svgElement || !isDataValid || !scales) return;

    const svg = d3.select(svgElement);
    svg.selectAll('*').remove();

    // Get selected points
    const selectedSource = selectedIndices.map(i => sourcePoints[i]);
    const selectedDest = selectedIndices.map(i => destinationPoints[i]);

    // Plot coupling edges first (behind points)
    const couplingData = plotCouplingEdges(svgElement, selectedSource, selectedDest, 'couplingEdges', isInduced);

    // Plot scatter points
    plotScatter(svgElement, selectedSource, sourcePointColor, 'sourcePoints', true);
    plotScatter(svgElement, selectedDest, targetPointColor, 'targetPoints', false);

    // Plot panel label
    plotPanelLabel(svgElement, label);

    // Setup hover handlers
    setupPointHoverHandlers(svgElement, couplingData);
  }

  function initializeVisualization() {
    if (!leftSvgElement || !rightSvgElement || !isDataValid) return;

    selectSampleIndices();
    const selectedSource = selectedIndices.map(i => sourcePoints[i]);
    const selectedDest = selectedIndices.map(i => destinationPoints[i]);
    scales = createSourceTargetScales(selectedSource, selectedDest, {
      width: svgWidth, height: svgHeight, marginWidth, marginHeight, sourceCenterX, targetCenterX, yShiftFactor, distributionScaleFactor
    });
    initializePanel(leftSvgElement, leftLabel, false);
    initializePanel(rightSvgElement, rightLabel, true);
    isInitialized = true;
  }

  $: if (isDataValid && leftSvgElement && rightSvgElement && !isInitialized) {
    initializeVisualization();
  }

  onMount(() => {
    if (isDataValid) {
      initializeVisualization();
    }
  });
</script>

{#if isDataValid}
  <DoubleFigure {gap} {caption} {backgroundVisible}>
    {#snippet left()}
      <svg
        bind:this={leftSvgElement}
        viewBox="0 0 {svgWidth} {svgHeight}"
        preserveAspectRatio="xMidYMid meet"
        style="width: 100%; height: auto; max-width: {svgWidth}px;"
      >
      </svg>
    {/snippet}

    {#snippet right()}
      <svg
        bind:this={rightSvgElement}
        viewBox="0 0 {svgWidth} {svgHeight}"
        preserveAspectRatio="xMidYMid meet"
        style="width: 100%; height: auto; max-width: {svgWidth}px;"
      >
      </svg>
    {/snippet}
  </DoubleFigure>
{:else}
  <div class="placeholder">
    <p>Induced coupling visualization requires rectified flow trajectory data.</p>
  </div>
{/if}

<style>
  .placeholder {
    padding: 2rem;
    text-align: center;
    background-color: #f9f9f9;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    color: #666;
  }
</style>
