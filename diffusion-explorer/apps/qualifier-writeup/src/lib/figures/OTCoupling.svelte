<!-- Visualizes an Optimal Transport coupling (X_0, X_1) computed via Sinkhorn algorithm. -->

<script lang="ts">
  import * as d3 from 'd3';
  import { Figure, plotSourceTargetLabels, plotSourceTargetScatter, createSourceTargetScales, dataToPixelX } from '@diffusion-explorer/ui';
  import type { Snippet } from 'svelte';
  import { settings } from '$lib/settings';

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  // Caption slot (passed as default children)
  export let children: Snippet | undefined = undefined;

  // Data props (from parent - loaded from cached OT coupling)
  export let sourceDistributionSamples: [number, number][] = [];
  export let targetDistributionSamples: [number, number][] = [];
  export let matching: number[] = []; // matching[i] = target index for source i

  // Layout
  export const height = 450;
  export const width = 800;
  export const sourceCenterX = settings.stylingSettings.layout.sourceCenterX;
  export const targetCenterX = settings.stylingSettings.layout.targetCenterX;
  export const marginWidth = 50;
  export const marginHeight = 20;

  // Labels
  export const sourceLabelText = 'Source Distribution';
  export const targetLabelText = 'Target Distribution';
  const labelFontSize = settings.stylingSettings.label.fontSize;
  const labelColor = settings.stylingSettings.label.color;
  const labelOpacity = settings.stylingSettings.label.opacity;
  const outlineColor = settings.stylingSettings.label.outlineColor;
  const outlineOpacity = settings.stylingSettings.label.outlineOpacity;

  // Styling
  export const sourcePointColor = settings.stylingSettings.scatterPlot.color;
  export const targetPointColor = '#f17720';
  export const pointRadius = settings.stylingSettings.scatterPlot.radius;
  export const pointOpacity = 0.4; // Custom: different from default
  export const yShiftFactor = settings.stylingSettings.scatterPlot.yShiftFactor;

  // Edge styling
  export const edgeColor = '#888';
  export const edgeOpacity = 0.3;
  export const edgeWidth = 2;
  export const dashed = false;

  // Hover styling
  export const hoverEdgeColor = '#555';
  export const hoverEdgeWidth = 3;
  export const hoverEdgeOpacity = 0.8;
  export const hoverPointOpacity = 0.9;

  // Background visibility
  export let backgroundVisible: boolean = true;

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  let svgElement: SVGSVGElement;
  let scales: ReturnType<typeof createSourceTargetScales> | null = null;
  let isInitialized: boolean = false;

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  function addHoverAttributes(svg: d3.Selection<SVGSVGElement, unknown, null, undefined>): void {
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

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function runInitialComputation(): void {
    if (!svgElement) return;
    if (sourceDistributionSamples.length === 0 || targetDistributionSamples.length === 0) return;
    if (matching.length === 0) return;

    const svg = d3.select(svgElement);

    // Create groups (plotSourceTargetScatter and plotSourceTargetLabels expect these)
    svg.append('g').attr('id', 'sourceScatter');
    svg.append('g').attr('id', 'targetScatter');
    svg.append('g').attr('id', 'labels');

    // Create scales using proportional positioning
    scales = createSourceTargetScales(sourceDistributionSamples, targetDistributionSamples, {
      width, height, marginWidth, marginHeight, sourceCenterX, targetCenterX, yShiftFactor
    });

    // Plot coupling edges first (so they're behind scatter points)
    plotCoupling(sourceDistributionSamples, targetDistributionSamples, matching);

    // Plot scatter using d3_helpers
    plotSourceTargetScatter(svg, sourceDistributionSamples, targetDistributionSamples, scales, {
      sourcePointColor,
      targetPointColor,
      pointRadius,
      pointOpacity
    });

    // Add hover attributes and handlers
    addHoverAttributes(svg);
    plotLabels();
    setupPointHoverHandlers(targetDistributionSamples, matching);
    isInitialized = true;
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function plotLabels(): void {
    if (!svgElement || !scales) return;

    const svg = d3.select(svgElement);

    plotSourceTargetLabels(svg, scales, {
      sourceLabelText,
      targetLabelText,
      labelFontSize,
      labelColor,
      labelOpacity,
      outlineColor,
      outlineOpacity
    });
  }

  function plotCoupling(sourcePoints: [number, number][], targetPoints: [number, number][], matchingArray: number[]): void {
    if (!svgElement || !scales) return;
    if (matchingArray.length === 0) return;

    const svg = d3.select(svgElement);
    const { yScale } = scales;

    // Remove existing coupling edges if they exist
    svg.select('#couplingEdges').remove();

    // Create a group for coupling edges
    const edgesGroup = svg.append('g').attr('id', 'couplingEdges');

    // Use the matching array to create coupling data
    // matching[i] = target index for source i
    const numPairs = Math.min(sourcePoints.length, matchingArray.length);

    const couplingData = [];
    for (let i = 0; i < numPairs; i++) {
      const targetIdx = matchingArray[i];
      if (targetIdx >= 0 && targetIdx < targetPoints.length) {
        couplingData.push({
          source: sourcePoints[i],
          target: targetPoints[targetIdx],
          sourceIndex: i,
          targetIndex: targetIdx
        });
      }
    }

    // Draw visible edges
    edgesGroup.selectAll('line.visible-edge')
      .data(couplingData)
      .enter()
      .append('line')
      .attr('class', (d, i) => `visible-edge edge-${i}`)
      .attr('x1', d => dataToPixelX(d.source[0], true, scales))
      .attr('y1', d => yScale(d.source[1]))
      .attr('x2', d => dataToPixelX(d.target[0], false, scales))
      .attr('y2', d => yScale(d.target[1]))
      .attr('stroke', edgeColor)
      .attr('stroke-width', edgeWidth)
      .attr('stroke-opacity', edgeOpacity)
      .attr('stroke-dasharray', dashed ? '4,4' : 'none');

    // Draw invisible hit area edges (twice as wide)
    edgesGroup.selectAll('line.hit-area')
      .data(couplingData)
      .enter()
      .append('line')
      .attr('class', (d, i) => `hit-area hit-area-${i}`)
      .attr('x1', d => dataToPixelX(d.source[0], true, scales))
      .attr('y1', d => yScale(d.source[1]))
      .attr('x2', d => dataToPixelX(d.target[0], false, scales))
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
        svg.select(`#sourceScatter circle[data-index="${d.sourceIndex}"]`)
          .attr('opacity', hoverPointOpacity);
        svg.select(`#targetScatter circle[data-index="${d.targetIndex}"]`)
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
        const sourceCircle = svg.select(`#sourceScatter circle[data-index="${d.sourceIndex}"]`);
        sourceCircle.attr('opacity', sourceCircle.attr('data-original-opacity'));
        const targetCircle = svg.select(`#targetScatter circle[data-index="${d.targetIndex}"]`);
        targetCircle.attr('opacity', targetCircle.attr('data-original-opacity'));
      });
  }

  // ----------------------------------------------------------------
  // Event Handlers
  // ----------------------------------------------------------------

  function setupPointHoverHandlers(targetPoints: [number, number][], matchingArray: number[]): void {
    if (!svgElement) return;

    const svg = d3.select(svgElement);
    const edgesGroup = svg.select('#couplingEdges');

    // Create a reverse mapping: target index -> source index
    const targetToSourceMap = new Map();
    for (let i = 0; i < matchingArray.length; i++) {
      targetToSourceMap.set(matchingArray[i], i);
    }

    // Add hover handlers to source points
    svg.select('#sourceScatter').selectAll('circle')
      .on('mouseover', function() {
        const sourceIndex = parseInt(d3.select(this).attr('data-index'));
        const targetIndex = matchingArray[sourceIndex];

        // Highlight the edge
        edgesGroup.select(`.edge-${sourceIndex}`)
          .attr('stroke', hoverEdgeColor)
          .attr('stroke-width', hoverEdgeWidth)
          .attr('stroke-opacity', hoverEdgeOpacity);

        // Highlight both endpoints
        d3.select(this).attr('opacity', hoverPointOpacity);
        svg.select(`#targetScatter circle[data-index="${targetIndex}"]`)
          .attr('opacity', hoverPointOpacity);
      })
      .on('mouseout', function() {
        const sourceIndex = parseInt(d3.select(this).attr('data-index'));
        const targetIndex = matchingArray[sourceIndex];

        // Reset the edge
        edgesGroup.select(`.edge-${sourceIndex}`)
          .attr('stroke', edgeColor)
          .attr('stroke-width', edgeWidth)
          .attr('stroke-opacity', edgeOpacity);

        // Reset both endpoints
        d3.select(this).attr('opacity', d3.select(this).attr('data-original-opacity'));
        const targetCircle = svg.select(`#targetScatter circle[data-index="${targetIndex}"]`);
        targetCircle.attr('opacity', targetCircle.attr('data-original-opacity'));
      });

    // Add hover handlers to target points
    svg.select('#targetScatter').selectAll('circle')
      .on('mouseover', function() {
        const targetIndex = parseInt(d3.select(this).attr('data-index'));
        const sourceIndex = targetToSourceMap.get(targetIndex);

        if (sourceIndex !== undefined) {
          // Highlight the edge
          edgesGroup.select(`.edge-${sourceIndex}`)
            .attr('stroke', hoverEdgeColor)
            .attr('stroke-width', hoverEdgeWidth)
            .attr('stroke-opacity', hoverEdgeOpacity);

          // Highlight both endpoints
          d3.select(this).attr('opacity', hoverPointOpacity);
          svg.select(`#sourceScatter circle[data-index="${sourceIndex}"]`)
            .attr('opacity', hoverPointOpacity);
        }
      })
      .on('mouseout', function() {
        const targetIndex = parseInt(d3.select(this).attr('data-index'));
        const sourceIndex = targetToSourceMap.get(targetIndex);

        if (sourceIndex !== undefined) {
          // Reset the edge
          edgesGroup.select(`.edge-${sourceIndex}`)
            .attr('stroke', edgeColor)
            .attr('stroke-width', edgeWidth)
            .attr('stroke-opacity', edgeOpacity);

          // Reset both endpoints
          d3.select(this).attr('opacity', d3.select(this).attr('data-original-opacity'));
          const sourceCircle = svg.select(`#sourceScatter circle[data-index="${sourceIndex}"]`);
          sourceCircle.attr('opacity', sourceCircle.attr('data-original-opacity'));
        }
      });
  }

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  $: caption = children as Snippet | undefined;

  // Reactive initialization
  $: if (!isInitialized &&
         sourceDistributionSamples.length > 0 &&
         targetDistributionSamples.length > 0 &&
         matching.length > 0 &&
         svgElement) {
    runInitialComputation();
  }
</script>

<Figure {caption} {backgroundVisible}>
  {#snippet children()}
    <svg bind:this={svgElement} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" style="width: 100%; height: auto; max-width: {width}px;">
    </svg>
  {/snippet}
</Figure>
