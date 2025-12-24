import * as d3 from 'd3';

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
  } = {}
): void {
  const {
    pointRadius = 5,
    pointOpacity = 0.25,
    pointColor = '#3b82f6',
    xShift = 0
  } = options;

  if (!svg || points.length === 0) return;

  const group = svg.select(`#${groupId}`);
  if (group.empty()) return;

  group.selectAll('circle')
    .data(points)
    .join('circle')
    .attr('cx', (d: [number, number]) => xScale(d[0] + xShift))
    .attr('cy', (d: [number, number]) => yScale(d[1]))
    .attr('r', pointRadius)
    .attr('fill', pointColor)
    .attr('opacity', pointOpacity);
}

/**
 * Plot source and target distribution scatter plots.
 * Source is plotted at xShift=0, target at xShift=flowWidth.
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
  } = {}
): void {
  const {
    flowWidth = 10,
    sourcePointColor = '#3b82f6',
    targetPointColor = '#3b82f6',
    pointRadius = 5,
    pointOpacity = 0.25
  } = options;

  plotScatter(svg, sourcePoints, xScale, yScale, 'sourceScatter', {
    pointRadius,
    pointOpacity,
    pointColor: sourcePointColor,
    xShift: 0
  });

  plotScatter(svg, targetPoints, xScale, yScale, 'targetScatter', {
    pointRadius,
    pointOpacity,
    pointColor: targetPointColor,
    xShift: flowWidth
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
  } = {}
): d3.Selection<SVGTextElement, unknown, null, undefined> {
  const {
    fontSize = 22,
    color = '#666',
    textAnchor = 'middle',
    withOutline = true,
    outlineColor = '#ffffff',
    outlineWidth = '4'
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
      .attr('paint-order', 'stroke');
  }

  textElement.text(text);

  return textElement;
}

/**
 * Plot source and target distribution labels.
 * Source label at xScale(0), target label at xScale(flowWidth).
 *
 * @param svg - D3 selection of the SVG element
 * @param xScale - D3 linear scale for x-axis
 * @param labelY - Y position for the labels
 * @param options - Styling options
 */
export function plotSourceTargetLabels(
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
  xScale: d3.ScaleLinear<number, number>,
  labelY: number,
  options: {
    flowWidth?: number;
    sourceLabelText?: string;
    targetLabelText?: string;
    labelFontSize?: number;
    labelColor?: string;
    groupId?: string;
  } = {}
): void {
  const {
    flowWidth = 10,
    sourceLabelText = 'Source Distribution',
    targetLabelText = 'Target Distribution',
    labelFontSize = 22,
    labelColor = '#666',
    groupId = 'labels'
  } = options;

  const group = svg.select(`#${groupId}`) as d3.Selection<SVGGElement, unknown, null, undefined>;
  if (group.empty()) return;

  const sourceLabelX = xScale(0);
  const targetLabelX = xScale(flowWidth);

  plotLabel(group, sourceLabelText, sourceLabelX, labelY, {
    fontSize: labelFontSize,
    color: labelColor
  });

  plotLabel(group, targetLabelText, targetLabelX, labelY, {
    fontSize: labelFontSize,
    color: labelColor
  });
}
