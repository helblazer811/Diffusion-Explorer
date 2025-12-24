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
