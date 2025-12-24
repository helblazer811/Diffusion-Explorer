<!-- Visualizes intersecting linear paths between source and target distributions with velocity vectors at intersection. -->

<script>
  import { onMount } from 'svelte';
  import * as d3 from 'd3';
  import Figure from '$lib/components/Figure.svelte';
  import TimeSlider from '$lib/components/TimeSlider.svelte';
  import { plotKatexInSVG } from '@diffusion-explorer/ui';
  import { settings } from '$lib/settings';
  import { plotSourceTargetScatter, plotSourceTargetLabels } from '$lib/d3_helpers';

  // Caption slot (passed as default children)
  export let children = undefined;
  $: caption = children;

  // Data props
  export let sourceDistributionSamples = [];
  export let targetDistributionSamples = [];

  // Arrow styling
  export let arrowColor = '#f17720';
  export let arrowLength = 0.25;
  export let meanVectorColor = '#22c55e';

  // Layout/Styling
  export let width = 800;
  export let height = 300;
  export let marginWidth = 20;
  export let marginHeight = 20;
  export let flowWidth = 10;
  export let pointRadius = 5;
  export let pointOpacity = 0.25;
  export let lineColor = '#666';
  export let lineWidth = 3;
  export let sourcePointColor = '#3b82f6';
  export let targetPointColor = '#3b82f6';
  export let arrowWidth = 2.5;
  export let labelVerticalOffset = -settings.labelStyling.yOffset;
  export let latexFontSize = settings.labelStyling.fontSize;
  export let labelFontSize = settings.labelStyling.fontSize;
  export let labelColor = settings.labelStyling.color;
  export let sourceLabelText = 'Source Distribution';
  export let targetLabelText = 'Target Distribution';

  // LaTeX labels
  export let intersectionLabel = 'x';
  export let topArrowLabel = 'v_t(x|x_0^a, x_1^a)';
  export let bottomArrowLabel = 'v_t(x|x_0^b, x_1^b)';
  export let meanArrowLabel = 'v_t^\\theta(x) = \\mathbb{E}[X_1 - X_0 | x_t = x]';
  export let sourcePointALabel = 'x_0^a';
  export let sourcePointBLabel = 'x_0^b';
  export let targetPointALabel = 'x_1^a';
  export let targetPointBLabel = 'x_1^b';

  // SVG and scale state
  let svgElement;
  let xScale = null;
  let yScale = null;
  let isInitialized = false;

  // Static time value for the disabled slider
  let time = 0.5;

  function normalize(v) {
    const len = Math.hypot(v.x, v.y);
    if (len < 1e-10) return { x: 0, y: 0 };
    return { x: v.x / len, y: v.y / len };
  }

  function selectPoints(sourcePoints, targetPoints) {
    // Filter source points to 60th-80th percentile range in x-direction
    const sortedSourceByX = [...sourcePoints].sort((a, b) => a[0] - b[0]);
    const x60thThreshold = sortedSourceByX[Math.floor(sortedSourceByX.length * 0.60)][0];
    const x80thThreshold = sortedSourceByX[Math.floor(sortedSourceByX.length * 0.80)][0];
    const filteredSource = sourcePoints.filter(p => p[0] >= x60thThreshold && p[0] <= x80thThreshold);

    // Filter target points to lower 10% in x-direction (below 10th percentile)
    const sortedTargetByX = [...targetPoints].sort((a, b) => a[0] - b[0]);
    const x10thThreshold = sortedTargetByX[Math.floor(sortedTargetByX.length * 0.10)][0];
    const filteredTarget = targetPoints.filter(p => p[0] <= x10thThreshold);

    // Sort filtered points by y, then choose y percentiles
    const sortedSource = [...filteredSource].map((p, i) => ({ point: p, index: i }))
      .sort((a, b) => a.point[1] - b.point[1]);

    const sortedTarget = [...filteredTarget].map((p, i) => ({ point: p, index: i }))
      .sort((a, b) => a.point[1] - b.point[1]);

    const source30thIdx = Math.floor(sortedSource.length * 0.30);
    const source70thIdx = Math.floor(sortedSource.length * 0.70);
    const target10thIdx = Math.floor(sortedTarget.length * 0.1);
    const target90thIdx = Math.floor(sortedTarget.length * 0.9);

    return {
      pair1: {
        source: sortedSource[source30thIdx].point,
        target: sortedTarget[target90thIdx].point
      },
      pair2: {
        source: sortedSource[source70thIdx].point,
        target: sortedTarget[target10thIdx].point
      }
    };
  }

  function createScales(sourcePoints, targetPoints) {
    const drawableWidth = width - 2 * marginWidth;
    const drawableHeight = height - 2 * marginHeight;
    const aspectRatio = drawableHeight / drawableWidth;

    const shiftedTargetPoints = targetPoints.map(p => [p[0] + flowWidth, p[1]]);
    const allPoints = [...sourcePoints, ...shiftedTargetPoints];

    const xExtent = d3.extent(allPoints, d => d[0]);
    const yExtent = d3.extent(allPoints, d => d[1]);

    const xRange = xExtent[1] - xExtent[0];
    const yRange = yExtent[1] - yExtent[0];

    const xCenter = (xExtent[0] + xExtent[1]) / 2;
    const yCenter = (yExtent[0] + yExtent[1]) / 2;

    let adjustedXRange = xRange;
    let adjustedYRange = yRange;

    if (yRange / xRange > aspectRatio) {
      adjustedXRange = yRange / aspectRatio;
    } else {
      adjustedYRange = xRange * aspectRatio;
    }

    const yCenterOffset = -adjustedYRange * 0.07;

    xScale = d3.scaleLinear()
      .domain([xCenter - adjustedXRange / 2, xCenter + adjustedXRange / 2])
      .range([marginWidth, width - marginWidth]);

    yScale = d3.scaleLinear()
      .domain([yCenter - adjustedYRange / 2 - yCenterOffset, yCenter + adjustedYRange / 2 - yCenterOffset])
      .range([marginHeight, height - marginHeight]);
  }

  function createArrowMarkers(svg) {
    const defs = svg.append('defs');

    defs.append('marker')
      .attr('id', 'direction-arrow')
      .attr('viewBox', '0 0 10 10')
      .attr('refX', 8)
      .attr('refY', 5)
      .attr('markerWidth', 5)
      .attr('markerHeight', 5)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M 0 0 L 10 5 L 0 10 z')
      .attr('fill', arrowColor);

    defs.append('marker')
      .attr('id', 'mean-arrow')
      .attr('viewBox', '0 0 10 10')
      .attr('refX', 8)
      .attr('refY', 5)
      .attr('markerWidth', 5)
      .attr('markerHeight', 5)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M 0 0 L 10 5 L 0 10 z')
      .attr('fill', meanVectorColor);
  }

  function initializeLayers() {
    const svg = d3.select(svgElement);
    svg.selectAll('*').remove();

    createArrowMarkers(svg);

    svg.append('g').attr('id', 'sourceScatter');
    svg.append('g').attr('id', 'targetScatter');
    svg.append('g').attr('id', 'connectionLines');
    svg.append('g').attr('id', 'arrows');
    svg.append('g').attr('id', 'labels');
  }

  function plotConnectingLine(sourcePoint, targetPoint, lineGroup) {
    const x1 = xScale(sourcePoint[0]);
    const y1 = yScale(sourcePoint[1]);
    const x2 = xScale(targetPoint[0] + flowWidth);
    const y2 = yScale(targetPoint[1]);

    lineGroup.append('line')
      .attr('x1', x1)
      .attr('y1', y1)
      .attr('x2', x2)
      .attr('y2', y2)
      .attr('stroke', lineColor)
      .attr('stroke-width', lineWidth)
      .attr('opacity', 0.8);

    lineGroup.append('circle')
      .attr('cx', x1)
      .attr('cy', y1)
      .attr('r', pointRadius)
      .attr('fill', lineColor)
      .attr('stroke', 'white')
      .attr('stroke-width', 2)
      .attr('stroke-opacity', 0.5);

    lineGroup.append('circle')
      .attr('cx', x2)
      .attr('cy', y2)
      .attr('r', pointRadius)
      .attr('fill', lineColor)
      .attr('stroke', 'white')
      .attr('stroke-width', 2)
      .attr('stroke-opacity', 0.5);

    return { x1, y1, x2, y2 };
  }

  function findIntersection(line1, line2) {
    const { x1, y1, x2, y2 } = line1;
    const { x1: x3, y1: y3, x2: x4, y2: y4 } = line2;

    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(denom) < 1e-10) return null;

    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;

    return {
      x: x1 + t * (x2 - x1),
      y: y1 + t * (y2 - y1),
      t: t
    };
  }

  function drawArrow(group, start, direction, length, color, markerId) {
    const endX = start.x + direction.x * length;
    const endY = start.y + direction.y * length;

    group.append('line')
      .attr('x1', start.x)
      .attr('y1', start.y)
      .attr('x2', endX)
      .attr('y2', endY)
      .attr('stroke', color)
      .attr('stroke-width', arrowWidth)
      .attr('marker-end', `url(#${markerId})`);
  }

  function plotVectors(intersection, line1, line2, arrowsGroup, labelsGroup) {
    plotKatexInSVG(labelsGroup, intersectionLabel, intersection.x - 15, intersection.y + labelVerticalOffset, { bg: false, fontSize: latexFontSize });

    const dir1 = normalize({ x: line1.x2 - line1.x1, y: line1.y2 - line1.y1 });
    const dir2 = normalize({ x: line2.x2 - line2.x1, y: line2.y2 - line2.y1 });

    const lineLength1 = Math.hypot(line1.x2 - line1.x1, line1.y2 - line1.y1);
    const lineLength2 = Math.hypot(line2.x2 - line2.x1, line2.y2 - line2.y1);
    const arrowScale = arrowLength * Math.min(lineLength1, lineLength2);

    drawArrow(arrowsGroup, intersection, dir1, arrowScale, arrowColor, 'direction-arrow');
    drawArrow(arrowsGroup, intersection, dir2, arrowScale, arrowColor, 'direction-arrow');

    const meanDir = normalize({
      x: (dir1.x + dir2.x) / 2,
      y: (dir1.y + dir2.y) / 2
    });
    drawArrow(arrowsGroup, intersection, meanDir, arrowScale, meanVectorColor, 'mean-arrow');

    // Arrow endpoint positions for labels
    const arrow1End = { x: intersection.x + dir1.x * arrowScale, y: intersection.y + dir1.y * arrowScale };
    const arrow2End = { x: intersection.x + dir2.x * arrowScale, y: intersection.y + dir2.y * arrowScale };
    const meanEnd = { x: intersection.x + meanDir.x * arrowScale, y: intersection.y + meanDir.y * arrowScale };

    // Label directly above top arrow
    plotKatexInSVG(labelsGroup, topArrowLabel, arrow2End.x - 70, arrow2End.y - 50, { bg: false, fontSize: latexFontSize });
    // Label directly below bottom arrow
    plotKatexInSVG(labelsGroup, bottomArrowLabel, arrow1End.x - 70, arrow1End.y + 20, { bg: false, fontSize: latexFontSize });
    // Label to the right of mean arrow
    plotKatexInSVG(labelsGroup, meanArrowLabel, meanEnd.x + 10, meanEnd.y - 18, { bg: false, fontSize: latexFontSize });

    arrowsGroup.append('circle')
      .attr('cx', intersection.x)
      .attr('cy', intersection.y)
      .attr('r', pointRadius)
      .attr('fill', lineColor);
  }

  function initializeVisualization() {
    if (!svgElement) return;
    if (sourceDistributionSamples.length === 0 || targetDistributionSamples.length === 0) return;

    initializeLayers();
    createScales(sourceDistributionSamples, targetDistributionSamples);

    const svg = d3.select(svgElement);
    plotSourceTargetScatter(svg, sourceDistributionSamples, targetDistributionSamples, xScale, yScale, {
      flowWidth,
      sourcePointColor,
      targetPointColor,
      pointRadius,
      pointOpacity
    });

    // Add distribution labels at top
    svg.append('g').attr('id', 'distributionLabels');
    const labelY = marginHeight + 1.5 * labelFontSize;
    plotSourceTargetLabels(svg, xScale, labelY, {
      flowWidth,
      sourceLabelText,
      targetLabelText,
      labelFontSize,
      labelColor,
      groupId: 'distributionLabels'
    });

    const linePairs = selectPoints(sourceDistributionSamples, targetDistributionSamples);

    const lineGroup = svg.select('#connectionLines');
    const arrowsGroup = svg.select('#arrows');
    const labelsGroup = svg.select('#labels');

    const line1Coords = plotConnectingLine(linePairs.pair1.source, linePairs.pair1.target, lineGroup);
    const line2Coords = plotConnectingLine(linePairs.pair2.source, linePairs.pair2.target, lineGroup);

    const intersection = findIntersection(line1Coords, line2Coords);
    if (intersection) {
      plotVectors(intersection, line1Coords, line2Coords, arrowsGroup, labelsGroup);
    }

    // Add endpoint labels (all above points)
    // pair1: bottom-left source (x_0^b) -> top-right target (x_1^b)
    // pair2: top-left source (x_0^a) -> bottom-right target (x_1^a)
    plotKatexInSVG(labelsGroup, sourcePointALabel, line2Coords.x1 - 15, line2Coords.y1 + labelVerticalOffset, { bg: false, fontSize: latexFontSize });
    plotKatexInSVG(labelsGroup, sourcePointBLabel, line1Coords.x1 - 15, line1Coords.y1 + labelVerticalOffset, { bg: false, fontSize: latexFontSize });
    plotKatexInSVG(labelsGroup, targetPointBLabel, line1Coords.x2 - 15, line1Coords.y2 + labelVerticalOffset, { bg: false, fontSize: latexFontSize });
    plotKatexInSVG(labelsGroup, targetPointALabel, line2Coords.x2 - 15, line2Coords.y2 + labelVerticalOffset, { bg: false, fontSize: latexFontSize });

    isInitialized = true;
  }

  // Reactive initialization
  $: if (!isInitialized &&
         sourceDistributionSamples.length > 0 &&
         targetDistributionSamples.length > 0 &&
         svgElement) {
    initializeVisualization();
  }

  onMount(() => {
    return () => {};
  });
</script>

<Figure caption={caption}>
  {#snippet children()}
    <div style="display: flex; flex-direction: column; align-items: center; width: 100%;">
      <svg bind:this={svgElement} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" style="width: 100%; height: auto; max-width: {width}px;">
      </svg>
      <TimeSlider
        bind:value={time}
        min={0}
        max={1}
        disabled={true}
        color="#888"
      />
    </div>
  {/snippet}
</Figure>
