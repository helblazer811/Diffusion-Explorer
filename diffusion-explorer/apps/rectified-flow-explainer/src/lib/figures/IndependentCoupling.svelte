<!-- The goal here is to visualize a naive independent coupling (X_0, X_1) such that X_0 \sim \pi_0 and X_1 \sim \pi_1 which are independently distributed. -->

<script>
  import * as tf from '@tensorflow/tfjs';
  import { onMount } from 'svelte';
  import * as d3 from 'd3';
  import { sampleMultivariateNormal } from '@diffusion-explorer/diffusion';
  import Figure from '$lib/components/Figure.svelte';
  import { settings } from '$lib/settings';

  // Caption slot (passed as default children)
  export let children = undefined;
  $: caption = children;

  export const numSamples = 100;
  export const height = 300;
  export const width = 800;
  export const sourcePointColor = '#3b82f6';
  export const targetPointColor = '#3b82f6';
  export const flowWidth = 10;
  export const marginWidth = 20;
  export const marginHeight = 20;
  export const sourceLabelText = 'Source Distribution';
  export const targetLabelText = 'Target Distribution';
  export const labelFontSize = settings.labelStyling.fontSize;
  export const labelColor = settings.labelStyling.color;
  export const edgeColor = '#888';
  export const edgeOpacity = 0.3;
  export const edgeWidth = 1.5;
  export const pointRadius = 5;
  export const pointOpacity = 0.4;
  export const hoverEdgeColor = '#555';
  export const hoverEdgeWidth = 3;
  export const hoverEdgeOpacity = 0.8;
  export const hoverPointOpacity = 0.9;
  export const dashed = false;

  let sourceDistributionPoints = null;
  let targetDistributionPoints = null;
  let svgElement;
  let xScale = null;
  let yScale = null;
  let highlightEdgeIndex = Math.floor(Math.random() * numSamples);

  function createScales(sourcePoints, targetPoints) {
    const drawableWidth = width - 2 * marginWidth;
    const drawableHeight = height - 2 * marginHeight;
    const aspectRatio = drawableHeight / drawableWidth;

    // Combine both point sets to get overall extent
    const allPoints = [...sourcePoints, ...targetPoints];

    const xExtent = d3.extent(allPoints, d => d[0]);
    const yExtent = d3.extent(allPoints, d => d[1]);

    const xRange = xExtent[1] - xExtent[0];
    const yRange = yExtent[1] - yExtent[0];

    const xCenter = (xExtent[0] + xExtent[1]) / 2;
    const yCenter = (yExtent[0] + yExtent[1]) / 2;

    // Adjust ranges to match aspect ratio
    let adjustedXRange = xRange;
    let adjustedYRange = yRange;

    if (yRange / xRange > aspectRatio) {
      // Y range is too large, expand X range
      adjustedXRange = yRange / aspectRatio;
    } else {
      // X range is too large, expand Y range
      adjustedYRange = xRange * aspectRatio;
    }

    // Shift y center down to accommodate labels at the top
    const yCenterOffset = -adjustedYRange * 0.12;

    xScale = d3.scaleLinear()
      .domain([xCenter - adjustedXRange / 2, xCenter + adjustedXRange / 2])
      .range([marginWidth, width - marginWidth]);

    yScale = d3.scaleLinear()
      .domain([yCenter - adjustedYRange / 2 - yCenterOffset, yCenter + adjustedYRange / 2 - yCenterOffset])
      .range([height - marginHeight, marginHeight]);
  }

  function plotLabels(sourcePoints, targetPoints) {
    if (!svgElement || !xScale || !yScale) return;

    const svg = d3.select(svgElement);

    // Remove existing labels group if it exists
    svg.select('#labels').remove();

    // Create labels group
    const labelsGroup = svg.append('g').attr('id', 'labels');

    // Calculate x positions for labels (centered on each distribution)
    const sourceLabelX = xScale(0);
    const targetLabelX = xScale(flowWidth);

    // Position labels relative to the top of the SVG
    const yDomain = yScale.domain();
    const yTop = yDomain[1]; // Max value maps to top of screen
    const labelY = yScale(yTop) + 1.5 * labelFontSize;

    // Add source distribution label with white outline
    labelsGroup.append('text')
      .attr('x', sourceLabelX)
      .attr('y', labelY)
      .attr('text-anchor', 'middle')
      .attr('font-size', `${labelFontSize}px`)
      .attr('fill', labelColor)
      .attr('stroke', '#ffffff')
      .attr('stroke-width', '4')
      .attr('paint-order', 'stroke')
      .text(sourceLabelText);

    // Add target distribution label with white outline
    labelsGroup.append('text')
      .attr('x', targetLabelX)
      .attr('y', labelY)
      .attr('text-anchor', 'middle')
      .attr('font-size', `${labelFontSize}px`)
      .attr('fill', labelColor)
      .attr('stroke', '#ffffff')
      .attr('stroke-width', '4')
      .attr('paint-order', 'stroke')
      .text(targetLabelText);
  }

  function plotScatter(data, color, opacity, groupId) {
    if (!data || !svgElement || !xScale || !yScale) return;

    const points = data.arraySync();

    // Select SVG
    const svg = d3.select(svgElement);

    // Remove existing group if it exists
    svg.select(`#${groupId}`).remove();

    // Create a group for this scatter plot
    const group = svg.append('g').attr('id', groupId);

    // Plot points
    group.selectAll('circle')
      .data(points)
      .enter()
      .append('circle')
      .attr('class', (d, i) => `${groupId}-point point-${i}`)
      .attr('cx', d => xScale(d[0]))
      .attr('cy', d => yScale(d[1]))
      .attr('r', pointRadius)
      .attr('fill', color)
      .attr('opacity', opacity)
      .attr('data-original-opacity', opacity)
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
        highlightEdgeIndex = index;

        // Highlight the edge
        edgesGroup.select(`.edge-${index}`)
          .attr('stroke', hoverEdgeColor)
          .attr('stroke-width', hoverEdgeWidth)
          .attr('stroke-opacity', hoverEdgeOpacity);

        // Highlight both endpoints
        const targetPoint = shuffledTargets[index];
        svg.select(`.sourcePoints-point.point-${index}`)
          .attr('opacity', hoverPointOpacity);
        const targetIndex = targetIndexMap.get(targetPoint.toString());
        svg.select(`.targetPoints-point.point-${targetIndex}`)
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
        const sourceCircle = svg.select(`.sourcePoints-point.point-${index}`);
        sourceCircle.attr('opacity', sourceCircle.attr('data-original-opacity'));
        const targetIndex = targetIndexMap.get(targetPoint.toString());
        const targetCircle = svg.select(`.targetPoints-point.point-${targetIndex}`);
        targetCircle.attr('opacity', targetCircle.attr('data-original-opacity'));
      });

    return { couplingData, shuffledTargets };
  }

  function setupPointHoverHandlers(sourcePoints, targetPoints, shuffledTargets) {
    if (!svgElement) return;

    const svg = d3.select(svgElement);
    const edgesGroup = svg.select('#couplingEdges');

    // Create a mapping from target points to their indices
    const targetIndexMap = new Map(targetPoints.map((point, i) => [point.toString(), i]));

    // Add hover handlers to source points
    svg.selectAll('.sourcePoints-point')
      .on('mouseover', function(event, d) {
        const sourceIndex = parseInt(d3.select(this).attr('class').match(/point-(\d+)/)?.[1] || '0');
        const targetPoint = shuffledTargets[sourceIndex];

        // Highlight the edge
        edgesGroup.select(`.edge-${sourceIndex}`)
          .attr('stroke', hoverEdgeColor)
          .attr('stroke-width', hoverEdgeWidth)
          .attr('stroke-opacity', hoverEdgeOpacity);

        // Highlight both endpoints
        d3.select(this).attr('opacity', hoverPointOpacity);
        const targetIndex = targetIndexMap.get(targetPoint.toString());
        svg.select(`.targetPoints-point.point-${targetIndex}`)
          .attr('opacity', hoverPointOpacity);
      })
      .on('mouseout', function(event, d) {
        const sourceIndex = parseInt(d3.select(this).attr('class').match(/point-(\d+)/)?.[1] || '0');
        const targetPoint = shuffledTargets[sourceIndex];

        // Reset the edge
        edgesGroup.select(`.edge-${sourceIndex}`)
          .attr('stroke', edgeColor)
          .attr('stroke-width', edgeWidth)
          .attr('stroke-opacity', edgeOpacity);

        // Reset both endpoints
        d3.select(this).attr('opacity', d3.select(this).attr('data-original-opacity'));
        const targetIndex = targetIndexMap.get(targetPoint.toString());
        const targetCircle = svg.select(`.targetPoints-point.point-${targetIndex}`);
        targetCircle.attr('opacity', targetCircle.attr('data-original-opacity'));
      });

    // Add hover handlers to target points
    svg.selectAll('.targetPoints-point')
      .on('mouseover', function(event, d) {
        const targetIndex = parseInt(d3.select(this).attr('class').match(/point-(\d+)/)?.[1] || '0');
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
        svg.select(`.sourcePoints-point.point-${sourceIndex}`)
          .attr('opacity', hoverPointOpacity);
      })
      .on('mouseout', function(event, d) {
        const targetIndex = parseInt(d3.select(this).attr('class').match(/point-(\d+)/)?.[1] || '0');
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
        const sourceCircle = svg.select(`.sourcePoints-point.point-${sourceIndex}`);
        sourceCircle.attr('opacity', sourceCircle.attr('data-original-opacity'));
      });
  }

  async function loadTargetDataset(numSamples) {
    // Load smiley face data
    const response = await fetch('/data/smiley_face.json');
    const data = await response.json();
    const allPoints = data.points;

    // Randomly subsample numSamples points
    const shuffled = [...allPoints].sort(() => Math.random() - 0.5);
    const sampledPoints = shuffled.slice(0, numSamples);

    // Flip target points vertically about the center and shift right
    const yCoords = sampledPoints.map(p => p[1]);
    const yCenter = (Math.max(...yCoords) + Math.min(...yCoords)) / 2;
    const flippedAndShiftedPoints = sampledPoints.map(([x, y]) => [x + flowWidth, 2 * yCenter - y]);

    return tf.tensor(flippedAndShiftedPoints);
  }

  onMount(async () => {
    // Load and subsample target dataset
    targetDistributionPoints = await loadTargetDataset(numSamples);
    console.log('Loaded target distribution points:', targetDistributionPoints.shape);

    // Generate multivariate gaussian samples with truncation at 3 std
    const mean = [0, 0];
    const cov = [[0.6, 0], [0, 0.6]];
    const std = Math.sqrt(0.6);
    const truncationThreshold = 3 * std;

    // Generate samples until we have enough within 3 std
    const acceptedSamples = [];
    while (acceptedSamples.length < numSamples) {
      const samples = sampleMultivariateNormal(mean, cov, numSamples * 2);
      const samplesArray = samples.arraySync();

      // Filter samples within 3 std
      const validSamples = samplesArray.filter(([x, y]) =>
        Math.abs(x) <= truncationThreshold && Math.abs(y) <= truncationThreshold
      );

      acceptedSamples.push(...validSamples);
      samples.dispose();
    }

    // Take only the required number of samples
    const truncatedSamples = acceptedSamples.slice(0, numSamples);
    sourceDistributionPoints = tf.tensor(truncatedSamples);

    console.log('Generated source distribution points:', sourceDistributionPoints.shape);

    const sourcePoints = sourceDistributionPoints.arraySync();
    let targetPointsArray = targetDistributionPoints.arraySync();

    // Align the vertical centers of source and target distributions
    const sourceYCenter = sourcePoints.reduce((sum, p) => sum + p[1], 0) / sourcePoints.length;
    const targetYCenter = targetPointsArray.reduce((sum, p) => sum + p[1], 0) / targetPointsArray.length;
    const yShift = sourceYCenter - targetYCenter;

    // Apply vertical shift to target points
    targetPointsArray = targetPointsArray.map(([x, y]) => [x, y + yShift]);
    targetDistributionPoints = tf.tensor(targetPointsArray);

    createScales(sourcePoints, targetPointsArray);
    const { shuffledTargets } = plotCoupling(sourcePoints, targetPointsArray);
    plotScatter(sourceDistributionPoints, sourcePointColor, pointOpacity, 'sourcePoints');
    plotScatter(targetDistributionPoints, targetPointColor, pointOpacity, 'targetPoints');
    plotLabels(sourcePoints, targetPointsArray);
    setupPointHoverHandlers(sourcePoints, targetPointsArray, shuffledTargets);
  });
</script>

<Figure {caption}>
  {#snippet children()}
    <svg bind:this={svgElement} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" style="width: 100%; height: auto; max-width: {width}px;">
    </svg>
  {/snippet}
</Figure>