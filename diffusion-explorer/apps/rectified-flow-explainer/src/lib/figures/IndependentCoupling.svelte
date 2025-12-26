<!-- The goal here is to visualize a naive independent coupling (X_0, X_1) such that X_0 \sim \pi_0 and X_1 \sim \pi_1 which are independently distributed. -->

<script>
  import * as d3 from 'd3';
  import Figure from '$lib/components/Figure.svelte';
  import { settings } from '$lib/settings';
  import { plotSourceTargetLabels, plotSourceTargetScatter, createSourceTargetScales } from '$lib/d3_helpers';

  // Caption slot (passed as default children)
  export let children = undefined;
  $: caption = children;

  // Data props (from parent)
  export let sourceDistributionSamples = [];
  export let targetDistributionSamples = [];

  export const height = 300;
  export const width = 800;
  export const sourcePointColor = settings.stylingSettings.scatterPlot.color;
  export const targetPointColor = settings.stylingSettings.scatterPlot.color;
  export const flowWidth = 10;
  export const marginWidth = 50;
  export const marginHeight = 20;
  export const sourceLabelText = 'Source Distribution';
  export const targetLabelText = 'Target Distribution';
  export const labelFontSize = settings.stylingSettings.label.fontSize;
  export const labelColor = settings.stylingSettings.label.color;
  export const outlineColor = settings.stylingSettings.label.outlineColor;
  export const outlineOpacity = settings.stylingSettings.label.outlineOpacity;
  export const edgeColor = '#888';
  export const edgeOpacity = 0.3;
  export const edgeWidth = 1.5;
  export const pointRadius = settings.stylingSettings.scatterPlot.radius;
  export const pointOpacity = 0.4; // Custom: different from default
  export const yShiftFactor = settings.stylingSettings.scatterPlot.yShiftFactor;
  export const hoverEdgeColor = '#555';
  export const hoverEdgeWidth = 3;
  export const hoverEdgeOpacity = 0.8;
  export const hoverPointOpacity = 0.9;
  export const dashed = false;

  let svgElement;
  let xScale = null;
  let yScale = null;
  let isInitialized = false;

  function plotLabels() {
    if (!svgElement || !xScale || !yScale) return;

    const svg = d3.select(svgElement);

    plotSourceTargetLabels(svg, xScale, yScale, {
      flowWidth,
      sourceLabelText,
      targetLabelText,
      labelFontSize,
      labelColor,
      outlineColor,
      outlineOpacity
    });
  }

  function addHoverAttributes(svg) {
    // Add hover-related attributes to scatter circles
    svg.select('#sourceScatter').selectAll('circle')
      .attr('data-index', (d, i) => i)
      .attr('data-original-opacity', pointOpacity)
      .style('cursor', 'pointer');

    svg.select('#targetScatter').selectAll('circle')
      .attr('data-index', (d, i) => i)
      .attr('data-original-opacity', pointOpacity)
      .style('cursor', 'pointer');
  }

  function plotCoupling(sourcePoints, targetPoints) {
    if (!svgElement || !xScale || !yScale) return { couplingData: [], shuffledTargets: [] };

    const svg = d3.select(svgElement);

    // Remove existing coupling edges if they exist
    svg.select('#couplingEdges').remove();

    // Create a group for coupling edges
    const edgesGroup = svg.append('g').attr('id', 'couplingEdges');

    // Shuffle the target points array for one-to-one pairing
    const shuffledTargets = [...targetPoints].sort(() => Math.random() - 0.5);

    // Create random pairings without replacement
    const couplingData = sourcePoints.map((sourcePoint, i) => {
      const targetPoint = shuffledTargets[i];
      return { source: sourcePoint, target: targetPoint };
    });

    // Draw visible dashed edges
    const visibleEdges = edgesGroup.selectAll('line.visible-edge')
      .data(couplingData)
      .enter()
      .append('line')
      .attr('class', (d, i) => `visible-edge edge-${i}`)
      .attr('x1', d => xScale(d.source[0]))
      .attr('y1', d => yScale(d.source[1]))
      .attr('x2', d => xScale(d.target[0]))
      .attr('y2', d => yScale(d.target[1]))
      .attr('stroke', edgeColor)
      .attr('stroke-width', edgeWidth)
      .attr('stroke-opacity', edgeOpacity)
      .attr('stroke-dasharray', dashed ? '4,4' : 'none');

    // Create a mapping from target points to their indices
    const targetIndexMap = new Map(targetPoints.map((point, i) => [point.toString(), i]));

    // Draw invisible hit area edges (twice as wide)
    edgesGroup.selectAll('line.hit-area')
      .data(couplingData)
      .enter()
      .append('line')
      .attr('class', (d, i) => `hit-area hit-area-${i}`)
      .attr('x1', d => xScale(d.source[0]))
      .attr('y1', d => yScale(d.source[1]))
      .attr('x2', d => xScale(d.target[0]))
      .attr('y2', d => yScale(d.target[1]))
      .attr('stroke', 'transparent')
      .attr('stroke-width', edgeWidth * 2)
      .style('cursor', 'pointer')
      .on('mouseover', function(event, d) {
        const index = couplingData.indexOf(d);

        // Highlight the edge
        edgesGroup.select(`.edge-${index}`)
          .attr('stroke', hoverEdgeColor)
          .attr('stroke-width', hoverEdgeWidth)
          .attr('stroke-opacity', hoverEdgeOpacity);

        // Highlight both endpoints
        const targetPoint = shuffledTargets[index];
        svg.select(`#sourceScatter circle[data-index="${index}"]`)
          .attr('opacity', hoverPointOpacity);
        const targetIndex = targetIndexMap.get(targetPoint.toString());
        svg.select(`#targetScatter circle[data-index="${targetIndex}"]`)
          .attr('opacity', hoverPointOpacity);
      })
      .on('mouseout', function(event, d) {
        const index = couplingData.indexOf(d);

        // Reset the edge
        edgesGroup.select(`.edge-${index}`)
          .attr('stroke', edgeColor)
          .attr('stroke-width', edgeWidth)
          .attr('stroke-opacity', edgeOpacity);

        // Reset both endpoints
        const targetPoint = shuffledTargets[index];
        const sourceCircle = svg.select(`#sourceScatter circle[data-index="${index}"]`);
        sourceCircle.attr('opacity', sourceCircle.attr('data-original-opacity'));
        const targetIndex = targetIndexMap.get(targetPoint.toString());
        const targetCircle = svg.select(`#targetScatter circle[data-index="${targetIndex}"]`);
        targetCircle.attr('opacity', targetCircle.attr('data-original-opacity'));
      });

    return { couplingData, shuffledTargets };
  }

  function setupPointHoverHandlers(targetPoints, shuffledTargets) {
    if (!svgElement) return;

    const svg = d3.select(svgElement);
    const edgesGroup = svg.select('#couplingEdges');

    // Create a mapping from target points to their indices
    const targetIndexMap = new Map(targetPoints.map((point, i) => [point.toString(), i]));

    // Add hover handlers to source points
    svg.select('#sourceScatter').selectAll('circle')
      .on('mouseover', function() {
        const sourceIndex = parseInt(d3.select(this).attr('data-index'));
        const targetPoint = shuffledTargets[sourceIndex];

        // Highlight the edge
        edgesGroup.select(`.edge-${sourceIndex}`)
          .attr('stroke', hoverEdgeColor)
          .attr('stroke-width', hoverEdgeWidth)
          .attr('stroke-opacity', hoverEdgeOpacity);

        // Highlight both endpoints
        d3.select(this).attr('opacity', hoverPointOpacity);
        const targetIndex = targetIndexMap.get(targetPoint.toString());
        svg.select(`#targetScatter circle[data-index="${targetIndex}"]`)
          .attr('opacity', hoverPointOpacity);
      })
      .on('mouseout', function() {
        const sourceIndex = parseInt(d3.select(this).attr('data-index'));
        const targetPoint = shuffledTargets[sourceIndex];

        // Reset the edge
        edgesGroup.select(`.edge-${sourceIndex}`)
          .attr('stroke', edgeColor)
          .attr('stroke-width', edgeWidth)
          .attr('stroke-opacity', edgeOpacity);

        // Reset both endpoints
        d3.select(this).attr('opacity', d3.select(this).attr('data-original-opacity'));
        const targetIndex = targetIndexMap.get(targetPoint.toString());
        const targetCircle = svg.select(`#targetScatter circle[data-index="${targetIndex}"]`);
        targetCircle.attr('opacity', targetCircle.attr('data-original-opacity'));
      });

    // Add hover handlers to target points
    svg.select('#targetScatter').selectAll('circle')
      .on('mouseover', function() {
        const targetIndex = parseInt(d3.select(this).attr('data-index'));
        const targetPoint = targetPoints[targetIndex];

        // Find which source point maps to this target
        const sourceIndex = shuffledTargets.findIndex(t => t.toString() === targetPoint.toString());

        // Highlight the edge
        edgesGroup.select(`.edge-${sourceIndex}`)
          .attr('stroke', hoverEdgeColor)
          .attr('stroke-width', hoverEdgeWidth)
          .attr('stroke-opacity', hoverEdgeOpacity);

        // Highlight both endpoints
        d3.select(this).attr('opacity', hoverPointOpacity);
        svg.select(`#sourceScatter circle[data-index="${sourceIndex}"]`)
          .attr('opacity', hoverPointOpacity);
      })
      .on('mouseout', function() {
        const targetIndex = parseInt(d3.select(this).attr('data-index'));
        const targetPoint = targetPoints[targetIndex];

        // Find which source point maps to this target
        const sourceIndex = shuffledTargets.findIndex(t => t.toString() === targetPoint.toString());

        // Reset the edge
        edgesGroup.select(`.edge-${sourceIndex}`)
          .attr('stroke', edgeColor)
          .attr('stroke-width', edgeWidth)
          .attr('stroke-opacity', edgeOpacity);

        // Reset both endpoints
        d3.select(this).attr('opacity', d3.select(this).attr('data-original-opacity'));
        const sourceCircle = svg.select(`#sourceScatter circle[data-index="${sourceIndex}"]`);
        sourceCircle.attr('opacity', sourceCircle.attr('data-original-opacity'));
      });
  }

  function initializeVisualization() {
    if (!svgElement) return;
    if (sourceDistributionSamples.length === 0 || targetDistributionSamples.length === 0) return;

    const svg = d3.select(svgElement);

    // Create groups (plotSourceTargetScatter and plotSourceTargetLabels expect these)
    svg.append('g').attr('id', 'sourceScatter');
    svg.append('g').attr('id', 'targetScatter');
    svg.append('g').attr('id', 'labels');

    // Create scales - helper shifts target points by flowWidth internally
    const scales = createSourceTargetScales(sourceDistributionSamples, targetDistributionSamples, {
      width, height, marginWidth, marginHeight, flowWidth, yShiftFactor
    });
    xScale = scales.xScale;
    yScale = scales.yScale;

    // Plot coupling edges first (so they're behind scatter points)
    const shiftedTargetPoints = targetDistributionSamples.map(([x, y]) => [x + flowWidth, y]);
    const { shuffledTargets } = plotCoupling(sourceDistributionSamples, shiftedTargetPoints);

    // Plot scatter using d3_helpers (centers horizontally by default)
    plotSourceTargetScatter(svg, sourceDistributionSamples, targetDistributionSamples, xScale, yScale, {
      flowWidth,
      sourcePointColor,
      targetPointColor,
      pointRadius,
      pointOpacity,
      centerHorizontally: false  // Don't center - use our own scale
    });

    // Add hover attributes and handlers
    addHoverAttributes(svg);
    plotLabels();
    setupPointHoverHandlers(shiftedTargetPoints, shuffledTargets);
    isInitialized = true;
  }

  // Reactive initialization
  $: if (!isInitialized &&
         sourceDistributionSamples.length > 0 &&
         targetDistributionSamples.length > 0 &&
         svgElement) {
    initializeVisualization();
  }
</script>

<Figure {caption}>
  {#snippet children()}
    <svg bind:this={svgElement} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" style="width: 100%; height: auto; max-width: {width}px;">
    </svg>
  {/snippet}
</Figure>