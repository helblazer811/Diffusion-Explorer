<!-- Visualizes intersecting linear paths between source and target distributions with velocity vectors at intersection. -->

<script>
  import { onMount } from 'svelte';
  import * as d3 from 'd3';
  import Figure from '$lib/components/Figure.svelte';
  import TimeSlider from '$lib/components/TimeSlider.svelte';
  import { plotKatexInSVG } from '@diffusion-explorer/ui';
  import { settings } from '$lib/settings';
  import { plotSourceTargetScatter, plotSourceTargetLabels, createSourceTargetScales, dataToPixelX } from '$lib/d3_helpers';

  // Caption slot (passed as default children)
  export let children = undefined;
  $: caption = children;

  // Data props
  export let sourceDistributionSamples = [];
  export let targetDistributionSamples = [];

  // Arrow styling
  export let arrowColor = '#f17720';
  export let arrowLength = 0.4;
  export let meanVectorColor = '#22c55e';

  // Layout/Styling
  export let width = 800;
  export let height = 300;
  export let marginWidth = 50;
  export let marginHeight = 20;
  export let sourceCenterX = settings.stylingSettings.layout.sourceCenterX;
  export let targetCenterX = settings.stylingSettings.layout.targetCenterX;
  export let pointRadius = settings.stylingSettings.scatterPlot.radius;
  export let pointOpacity = settings.stylingSettings.scatterPlot.opacity;
  export let lineColor = '#888';
  export let lineOpacity = 0.25;
  export let lineWidth = 3;
  export let sourcePointColor = settings.stylingSettings.scatterPlot.color;
  export let targetPointColor = settings.stylingSettings.scatterPlot.color;
  export let arrowWidth = 2.5;
  export let yShiftFactor = settings.stylingSettings.scatterPlot.yShiftFactor;

  export let labelFontSize = settings.stylingSettings.label.fontSize;
  export let labelColor = settings.stylingSettings.label.color;
  export let outlineColor = settings.stylingSettings.label.outlineColor;
  export let outlineOpacity = settings.stylingSettings.label.outlineOpacity;
  export let labelYShiftFactor = settings.stylingSettings.label.yShiftFactor;
  export let sourceLabelText = 'Source Distribution';
  export let targetLabelText = 'Target Distribution';

  // LaTeX labels
  export let labelVerticalOffset = -35;
  export let latexFontSize = 16;
  export let figureLatexColor = settings.stylingSettings.figureLatex.color;
  export let intersectionLabel = 'x';
  export let topArrowLabel = 'v_t(x|x_0^a, x_1^a)';
  export let bottomArrowLabel = 'v_t(x|x_0^b, x_1^b)';
  export let meanArrowLabel = 'v_t^\\theta(x) = \\mathbb{E}[X_1 - X_0 | x_t = x]';
  export let sourcePointALabel = 'x_0^a';
  export let sourcePointBLabel = 'x_0^b';
  export let targetPointALabel = 'x_1^a';

  // Background visibility
  export let backgroundVisible = true;
  export let targetPointBLabel = 'x_1^b';

  // KaTeX outline styling
  export let katexOutline = settings.stylingSettings.figureLatex.outline;
  export let katexOutlineColor = settings.stylingSettings.figureLatex.outlineColor;
  export let katexOutlineWidth = settings.stylingSettings.figureLatex.outlineWidth;
  export let katexOutlineOpacity = settings.stylingSettings.figureLatex.outlineOpacity;

  // Vertical spacing between point and label
  const labelAbovePointOffset = -5;

  // LaTeX label offsets
  export let topArrowLabelOffset = { x: -55, y: -45 };
  export let bottomArrowLabelOffset = { x: -55, y: 8 };
  export let meanArrowLabelOffset = { x: 10, y: -18 };

  // Hardcoded line endpoint coordinates
  export let sourcePointA = [0.6, -0.8];
  export let sourcePointB = [0.6, 0.5];
  export let targetPointA = [0.2, 1.6];
  export let targetPointB = [-1.1, -1.0];

  // SVG and scale state
  let svgElement;
  let scales = null;
  let isInitialized = false;

  // Static time value for the disabled slider
  let time = 0.5;

  function normalize(v) {
    const len = Math.hypot(v.x, v.y);
    if (len < 1e-10) return { x: 0, y: 0 };
    return { x: v.x / len, y: v.y / len };
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
    const x1 = dataToPixelX(sourcePoint[0], true, scales);
    const y1 = scales.yScale(sourcePoint[1]);
    const x2 = dataToPixelX(targetPoint[0], false, scales);
    const y2 = scales.yScale(targetPoint[1]);

    lineGroup.append('line')
      .attr('x1', x1)
      .attr('y1', y1)
      .attr('x2', x2)
      .attr('y2', y2)
      .attr('stroke', lineColor)
      .attr('stroke-width', lineWidth)
      .attr('stroke-opacity', lineOpacity);

    lineGroup.append('circle')
      .attr('cx', x1)
      .attr('cy', y1)
      .attr('r', pointRadius)
      .attr('fill', lineColor);

    lineGroup.append('circle')
      .attr('cx', x2)
      .attr('cy', y2)
      .attr('r', pointRadius)
      .attr('fill', lineColor);

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
    plotKatexInSVG(labelsGroup, intersectionLabel, intersection.x, intersection.y, {
      bg: false,
      fontSize: latexFontSize,
      color: figureLatexColor,
      anchor: 'bottom-center',
      offsetY: labelAbovePointOffset,
      outline: katexOutline,
      outlineColor: katexOutlineColor,
      outlineWidth: katexOutlineWidth,
      outlineOpacity: katexOutlineOpacity,
    });

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

    // Label above the arrow (midpoint between intersection and arrow end)
    const arrow1Mid = { x: (intersection.x + arrow1End.x) / 2, y: (intersection.y + arrow1End.y) / 2 };
    const arrow2Mid = { x: (intersection.x + arrow2End.x) / 2, y: (intersection.y + arrow2End.y) / 2 };
    plotKatexInSVG(labelsGroup, topArrowLabel, arrow1Mid.x + topArrowLabelOffset.x, arrow1Mid.y + topArrowLabelOffset.y, {
      bg: false,
      fontSize: latexFontSize,
      color: figureLatexColor,
      outline: katexOutline,
      outlineColor: katexOutlineColor,
      outlineWidth: katexOutlineWidth,
      outlineOpacity: katexOutlineOpacity,
    });
    // Label below the arrow
    plotKatexInSVG(labelsGroup, bottomArrowLabel, arrow2Mid.x + bottomArrowLabelOffset.x, arrow2Mid.y + bottomArrowLabelOffset.y, {
      bg: false,
      fontSize: latexFontSize,
      color: figureLatexColor,
      outline: katexOutline,
      outlineColor: katexOutlineColor,
      outlineWidth: katexOutlineWidth,
      outlineOpacity: katexOutlineOpacity,
    });
    // Label to the right of mean arrow
    plotKatexInSVG(labelsGroup, meanArrowLabel, meanEnd.x + meanArrowLabelOffset.x, meanEnd.y + meanArrowLabelOffset.y, {
      bg: false,
      fontSize: latexFontSize,
      color: figureLatexColor,
      outline: katexOutline,
      outlineColor: katexOutlineColor,
      outlineWidth: katexOutlineWidth,
      outlineOpacity: katexOutlineOpacity,
    });

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
    scales = createSourceTargetScales(sourceDistributionSamples, targetDistributionSamples, {
      width, height, marginWidth, marginHeight, sourceCenterX, targetCenterX, yShiftFactor
    });

    const svg = d3.select(svgElement);
    plotSourceTargetScatter(svg, sourceDistributionSamples, targetDistributionSamples, scales, {
      sourcePointColor,
      targetPointColor,
      pointRadius,
      pointOpacity
    });

    // Add distribution labels at top
    svg.append('g').attr('id', 'distributionLabels');
    plotSourceTargetLabels(svg, scales, {
      sourceLabelText,
      targetLabelText,
      labelFontSize,
      labelColor,
      outlineColor,
      outlineOpacity,
      yShiftFactor: labelYShiftFactor,
      groupId: 'distributionLabels'
    });

    const lineGroup = svg.select('#connectionLines');
    const arrowsGroup = svg.select('#arrows');
    const labelsGroup = svg.select('#labels');

    const line1Coords = plotConnectingLine(sourcePointB, targetPointB, lineGroup);
    const line2Coords = plotConnectingLine(sourcePointA, targetPointA, lineGroup);

    const intersection = findIntersection(line1Coords, line2Coords);
    if (intersection) {
      plotVectors(intersection, line1Coords, line2Coords, arrowsGroup, labelsGroup);
    }

    // Add endpoint labels (all above points)
    // pair1: bottom-left source (x_0^b) -> top-right target (x_1^b)
    // pair2: top-left source (x_0^a) -> bottom-right target (x_1^a)
    plotKatexInSVG(labelsGroup, sourcePointALabel, line2Coords.x1, line2Coords.y1, {
      bg: false,
      fontSize: latexFontSize,
      color: figureLatexColor,
      anchor: 'bottom-center',
      offsetY: labelAbovePointOffset,
      outline: katexOutline,
      outlineColor: katexOutlineColor,
      outlineWidth: katexOutlineWidth,
      outlineOpacity: katexOutlineOpacity,
    });
    plotKatexInSVG(labelsGroup, sourcePointBLabel, line1Coords.x1, line1Coords.y1, {
      bg: false,
      fontSize: latexFontSize,
      color: figureLatexColor,
      anchor: 'bottom-center',
      offsetY: labelAbovePointOffset,
      outline: katexOutline,
      outlineColor: katexOutlineColor,
      outlineWidth: katexOutlineWidth,
      outlineOpacity: katexOutlineOpacity,
    });
    plotKatexInSVG(labelsGroup, targetPointBLabel, line1Coords.x2, line1Coords.y2, {
      bg: false,
      fontSize: latexFontSize,
      color: figureLatexColor,
      anchor: 'bottom-center',
      offsetY: labelAbovePointOffset,
      outline: katexOutline,
      outlineColor: katexOutlineColor,
      outlineWidth: katexOutlineWidth,
      outlineOpacity: katexOutlineOpacity,
    });
    plotKatexInSVG(labelsGroup, targetPointALabel, line2Coords.x2, line2Coords.y2, {
      bg: false,
      fontSize: latexFontSize,
      color: figureLatexColor,
      anchor: 'bottom-center',
      offsetY: labelAbovePointOffset,
      outline: katexOutline,
      outlineColor: katexOutlineColor,
      outlineWidth: katexOutlineWidth,
      outlineOpacity: katexOutlineOpacity,
    });

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

<Figure caption={caption} {backgroundVisible}>
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
