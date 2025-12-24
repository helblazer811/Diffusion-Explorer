import * as d3 from 'd3';

/**
 * Create D3 scales for plotting source and target distributions.
 * Source is positioned at x=0, target at x=flowWidth.
 *
 * @param sourcePoints - Array of [x, y] coordinates for source distribution
 * @param targetPoints - Array of [x, y] coordinates for target distribution
 * @param options - Layout and styling options
 * @returns Object containing xScale and yScale
 */
export function createSourceTargetScales(
  sourcePoints: [number, number][],
  targetPoints: [number, number][],
  options: {
    width: number;
    height: number;
    marginWidth?: number;
    marginHeight?: number;
    flowWidth?: number;
    yShiftFactor?: number;
  }
): { xScale: d3.ScaleLinear<number, number>; yScale: d3.ScaleLinear<number, number> } {
  const {
    width,
    height,
    marginWidth = 20,
    marginHeight = 20,
    flowWidth = 10,
    yShiftFactor = 0
  } = options;

  const drawableWidth = width - 2 * marginWidth;
  const drawableHeight = height - 2 * marginHeight;
  const aspectRatio = drawableHeight / drawableWidth;

  // Shift target points by flowWidth for extent calculation
  const shiftedTargetPoints = targetPoints.map(p => [p[0] + flowWidth, p[1]] as [number, number]);
  const allPoints = [...sourcePoints, ...shiftedTargetPoints];

  const xExtent = d3.extent(allPoints, d => d[0]) as [number, number];
  const yExtent = d3.extent(allPoints, d => d[1]) as [number, number];
  const xRange = xExtent[1] - xExtent[0];
  const yRange = yExtent[1] - yExtent[0];
  const xCenter = (xExtent[0] + xExtent[1]) / 2;
  const yCenter = (yExtent[0] + yExtent[1]) / 2;

  // Adjust ranges to maintain aspect ratio
  let adjustedXRange = xRange;
  let adjustedYRange = yRange;

  if (yRange / xRange > aspectRatio) {
    adjustedXRange = yRange / aspectRatio;
  } else {
    adjustedYRange = xRange * aspectRatio;
  }

  // Apply vertical offset for labels and yShiftFactor
  const yCenterOffset = -adjustedYRange * 0.07 - yShiftFactor;

  const xScale = d3.scaleLinear()
    .domain([xCenter - adjustedXRange / 2, xCenter + adjustedXRange / 2])
    .range([marginWidth, width - marginWidth]);

  const yScale = d3.scaleLinear()
    .domain([yCenter - adjustedYRange / 2 - yCenterOffset, yCenter + adjustedYRange / 2 - yCenterOffset])
    .range([marginHeight, height - marginHeight]);

  return { xScale, yScale };
}

/**
 * Plot a scatter plot of points in an SVG group.
 *
 * @param svg - D3 selection of the SVG element
 * @param points - Array of [x, y] coordinates
 * @param xScale - D3 linear scale for x-axis
 * @param yScale - D3 linear scale for y-axis
 * @param groupId - ID of the group element to plot into
 * @param options - Styling options
 */
export function plotScatter(
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
  points: [number, number][],
  xScale: d3.ScaleLinear<number, number>,
  yScale: d3.ScaleLinear<number, number>,
  groupId: string,
  options: {
    pointRadius?: number;
    pointOpacity?: number;
    pointColor?: string;
    xShift?: number;
    yShiftFactor?: number;
  } = {}
): void {
  const {
    pointRadius = 5,
    pointOpacity = 0.25,
    pointColor = '#3b82f6',
    xShift = 0,
    yShiftFactor = 0
  } = options;

  if (!svg || points.length === 0) return;

  const group = svg.select(`#${groupId}`);
  if (group.empty()) return;

  group.selectAll('circle')
    .data(points)
    .join('circle')
    .attr('cx', (d: [number, number]) => xScale(d[0] + xShift))
    .attr('cy', (d: [number, number]) => yScale(d[1] + yShiftFactor))
    .attr('r', pointRadius)
    .attr('fill', pointColor)
    .attr('opacity', pointOpacity);
}

/**
 * Plot source and target distribution scatter plots.
 * Source is centered at x=0, target is centered at x=flowWidth.
 *
 * @param svg - D3 selection of the SVG element
 * @param sourcePoints - Array of [x, y] coordinates for source distribution
 * @param targetPoints - Array of [x, y] coordinates for target distribution
 * @param xScale - D3 linear scale for x-axis
 * @param yScale - D3 linear scale for y-axis
 * @param options - Styling options
 */
export function plotSourceTargetScatter(
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
  sourcePoints: [number, number][],
  targetPoints: [number, number][],
  xScale: d3.ScaleLinear<number, number>,
  yScale: d3.ScaleLinear<number, number>,
  options: {
    flowWidth?: number;
    sourcePointColor?: string;
    targetPointColor?: string;
    pointRadius?: number;
    pointOpacity?: number;
    yShiftFactor?: number;
    centerHorizontally?: boolean;
  } = {}
): void {
  const {
    flowWidth = 10,
    sourcePointColor = '#3b82f6',
    targetPointColor = '#3b82f6',
    pointRadius = 5,
    pointOpacity = 0.25,
    yShiftFactor = 0,
    centerHorizontally = true
  } = options;

  // Calculate x shifts to center each distribution
  let sourceXShift = 0;
  let targetXShift = flowWidth;

  if (centerHorizontally) {
    // Center source at x=0, target at x=flowWidth
    const sourceMeanX = sourcePoints.reduce((sum, p) => sum + p[0], 0) / sourcePoints.length;
    const targetMeanX = targetPoints.reduce((sum, p) => sum + p[0], 0) / targetPoints.length;
    sourceXShift = -sourceMeanX;
    targetXShift = flowWidth - targetMeanX;
  }

  plotScatter(svg, sourcePoints, xScale, yScale, 'sourceScatter', {
    pointRadius,
    pointOpacity,
    pointColor: sourcePointColor,
    xShift: sourceXShift,
    yShiftFactor
  });

  plotScatter(svg, targetPoints, xScale, yScale, 'targetScatter', {
    pointRadius,
    pointOpacity,
    pointColor: targetPointColor,
    xShift: targetXShift,
    yShiftFactor
  });
}

/**
 * Plot a text label with optional white outline for readability.
 *
 * @param group - D3 selection of the group element to append to
 * @param text - The label text
 * @param x - X position
 * @param y - Y position
 * @param options - Styling options
 * @returns The created text element
 */
export function plotLabel(
  group: d3.Selection<SVGGElement, unknown, null, undefined>,
  text: string,
  x: number,
  y: number,
  options: {
    fontSize?: number;
    color?: string;
    textAnchor?: string;
    withOutline?: boolean;
    outlineColor?: string;
    outlineWidth?: string;
    outlineOpacity?: number;
  } = {}
): d3.Selection<SVGTextElement, unknown, null, undefined> {
  const {
    fontSize = 22,
    color = '#666',
    textAnchor = 'middle',
    withOutline = true,
    outlineColor = '#ffffff',
    outlineWidth = '4',
    outlineOpacity = 1
  } = options;

  const textElement = group.append('text')
    .attr('x', x)
    .attr('y', y)
    .attr('text-anchor', textAnchor)
    .attr('font-size', `${fontSize}px`)
    .attr('fill', color);

  if (withOutline) {
    textElement
      .attr('stroke', outlineColor)
      .attr('stroke-width', outlineWidth)
      .attr('stroke-opacity', outlineOpacity)
      .attr('paint-order', 'stroke');
  }

  textElement.text(text);

  return textElement;
}

/**
 * Plot source and target distribution labels.
 * Source label at xScale(0), target label at xScale(flowWidth).
 * Label Y position is computed from yScale domain top + yShiftFactor * labelFontSize.
 *
 * @param svg - D3 selection of the SVG element
 * @param xScale - D3 linear scale for x-axis
 * @param yScale - D3 linear scale for y-axis
 * @param options - Styling options
 */
export function plotSourceTargetLabels(
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
  xScale: d3.ScaleLinear<number, number>,
  yScale: d3.ScaleLinear<number, number>,
  options: {
    flowWidth?: number;
    sourceLabelText?: string;
    targetLabelText?: string;
    labelFontSize?: number;
    labelColor?: string;
    yShiftFactor?: number;
    groupId?: string;
    outlineColor?: string;
    outlineOpacity?: number;
  } = {}
): void {
  const {
    flowWidth = 10,
    sourceLabelText = 'Source Distribution',
    targetLabelText = 'Target Distribution',
    labelFontSize = 22,
    labelColor = '#666',
    yShiftFactor = 0.5,
    groupId = 'labels',
    outlineColor = '#f9f9f9',
    outlineOpacity = 0.5
  } = options;

  const group = svg.select(`#${groupId}`) as d3.Selection<SVGGElement, unknown, null, undefined>;
  if (group.empty()) return;

  // Compute labelY from yScale domain
  const yDomain = yScale.domain();
  const yTop = yDomain[0];
  const labelY = yScale(yTop) + yShiftFactor * labelFontSize;

  const sourceLabelX = xScale(0);
  const targetLabelX = xScale(flowWidth);

  plotLabel(group, sourceLabelText, sourceLabelX, labelY, {
    fontSize: labelFontSize,
    color: labelColor,
    outlineColor,
    outlineOpacity
  });

  plotLabel(group, targetLabelText, targetLabelX, labelY, {
    fontSize: labelFontSize,
    color: labelColor,
    outlineColor,
    outlineOpacity
  });
}
