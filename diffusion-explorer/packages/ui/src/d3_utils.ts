import * as d3 from 'd3';
import katex from 'katex';

export type Anchor =
  | 'top-left' | 'top-center' | 'top-right'
  | 'center-left' | 'center' | 'center-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right';

export interface PlotKatexOptions {
  fontSize?: number;
  padding?: number;
  color?: string;
  bg?: string | false;
  bgOpacity?: number;
  rx?: number;
  ry?: number;
  className?: string;
  outline?: boolean;
  outlineColor?: string;
  outlineWidth?: number;
  outlineOpacity?: number;
  anchor?: Anchor;
  offsetX?: number;  // Additional X offset applied after anchor positioning
  offsetY?: number;  // Additional Y offset applied after anchor positioning
}

/**
 * Plot LaTeX math into an SVG with an optional background box.
 * Background size is computed from the rendered KaTeX.
 * Set bg to false to disable the background.
 */
export function plotKatexInSVG(
  svg: d3.Selection<SVGElement, unknown, null, undefined> | SVGElement,
  latex: string,
  x: number,
  y: number,
  opts: PlotKatexOptions = {}
): d3.Selection<SVGGElement, unknown, null, undefined> {
  const {
    fontSize = 18,
    padding = 6,
    color = '#111',
    bg = 'white',
    bgOpacity = 0.9,
    rx = 4,
    ry = 4,
    className = 'katex-label',
    outline = false,
    outlineColor = '#fff',
    outlineWidth = 1,
    outlineOpacity = 1,
    anchor = 'top-left',
    offsetX = 0,
    offsetY = 0
  } = opts;

  const selection = svg instanceof d3.selection
    ? svg
    : d3.select(svg);

  // Group everything for organization (but don't use transform - Safari has issues with foreignObject inside transformed groups)
  const g = selection.append('g')
    .attr('class', className);

  // foreignObject (initially size-less)
  const fo = g.append('foreignObject');

  const div = fo.append('xhtml:div')
    .style('display', 'inline-block')
    .style('font-size', `${fontSize}px`)
    .style('line-height', '1.2')
    .style('white-space', 'nowrap');

  // Render KaTeX
  katex.render(latex, div.node() as HTMLElement, {
    throwOnError: false
  });

  // Apply color and fill to KaTeX elements before measurement
  const katexRoot = d3.select(div.node()).select('.katex');
  katexRoot.style('color', color).style('fill', color);
  katexRoot.selectAll('*').style('color', color).style('fill', color);

  // Apply outline using -webkit-text-stroke for clean outlines
  if (outline) {
    // Convert hex color to rgba if opacity is specified
    let strokeColor = outlineColor;
    if (outlineOpacity < 1) {
      // Parse hex color and convert to rgba
      let r = 255, g = 255, b = 255;
      if (outlineColor.startsWith('#')) {
        const hex = outlineColor.slice(1);
        if (hex.length === 3) {
          r = parseInt(hex[0] + hex[0], 16);
          g = parseInt(hex[1] + hex[1], 16);
          b = parseInt(hex[2] + hex[2], 16);
        } else if (hex.length === 6) {
          r = parseInt(hex.slice(0, 2), 16);
          g = parseInt(hex.slice(2, 4), 16);
          b = parseInt(hex.slice(4, 6), 16);
        }
      }
      strokeColor = `rgba(${r}, ${g}, ${b}, ${outlineOpacity})`;
    }
    // Use text-stroke for a clean outline, with paint-order to draw stroke behind fill
    katexRoot.style('-webkit-text-stroke', `${outlineWidth}px ${strokeColor}`);
    katexRoot.style('paint-order', 'stroke fill');
  }

  // Measure AFTER render
  const bbox = (div.node() as HTMLElement).getBoundingClientRect();
  // Add buffer to prevent clipping
  const contentWidth = bbox.width * 1.1;
  const contentHeight = bbox.height * 1.1;
  const width = contentWidth + 2 * padding;
  const height = contentHeight + 2 * padding;

  // Calculate anchor offsets based on the anchor position
  let anchorOffsetX = 0;
  let anchorOffsetY = 0;

  // Vertical offset
  if (anchor.startsWith('center')) {
    anchorOffsetY = -height / 2;
  } else if (anchor.startsWith('bottom')) {
    anchorOffsetY = -height;
  }
  // top is default (0)

  // Horizontal offset
  if (anchor.endsWith('center') || anchor === 'center') {
    anchorOffsetX = -width / 2;
  } else if (anchor.endsWith('right')) {
    anchorOffsetX = -width;
  }
  // left is default (0)

  // Apply anchor offsets and user offsets to get final position
  const finalX = x + anchorOffsetX + offsetX;
  const finalY = y + anchorOffsetY + offsetY;

  // Resize foreignObject with buffer - use explicit x/y for Safari compatibility
  fo.attr('x', finalX + padding)
    .attr('y', finalY + padding)
    .attr('width', contentWidth)
    .attr('height', contentHeight);

  // SVG background rect (inserted behind fo) - only if bg is not false
  // Use explicit x/y positioning for Safari compatibility
  if (bg !== false) {
    g.insert('rect', ':first-child')
      .attr('x', finalX)
      .attr('y', finalY)
      .attr('width', width)
      .attr('height', height)
      .attr('rx', rx)
      .attr('ry', ry)
      .attr('fill', bg)
      .attr('opacity', bgOpacity);
  }

  return g;
}

/**
 * Create D3 scales for plotting source and target distributions.
 * Distributions are positioned at proportional x positions (e.g., source at 0.2, target at 0.8).
 *
 * @param sourcePoints - Array of [x, y] coordinates for source distribution
 * @param targetPoints - Array of [x, y] coordinates for target distribution
 * @param options - Layout and styling options
 * @returns Object containing scales and positioning info
 */
export function createSourceTargetScales(
  sourcePoints: [number, number][],
  targetPoints: [number, number][],
  options: {
    width: number;
    height: number;
    marginWidth?: number;
    marginHeight?: number;
    sourceCenterX?: number;  // Proportion of width (e.g., 0.2)
    targetCenterX?: number;  // Proportion of width (e.g., 0.8)
    yShiftFactor?: number;
    distributionScaleFactor?: number;  // Scale factor for distribution sizing (default: 0.8)
  }
): {
  yScale: d3.ScaleLinear<number, number>;
  xScaleFactor: number;
  sourceCenterPixelX: number;
  targetCenterPixelX: number;
  sourceMeanX: number;
  targetMeanX: number;
} {
  const {
    width,
    height,
    marginWidth = 50,
    marginHeight = 20,
    sourceCenterX = 0.2,
    targetCenterX = 0.8,
    yShiftFactor = 0,
    distributionScaleFactor = 0.8
  } = options;

  // Compute pixel centers for each distribution
  const sourceCenterPixelX = width * sourceCenterX;
  const targetCenterPixelX = width * targetCenterX;

  // Compute data extents for y (used for scaling)
  const sourceYExtent = d3.extent(sourcePoints, d => d[1]) as [number, number];
  const targetYExtent = d3.extent(targetPoints, d => d[1]) as [number, number];

  // Compute y range (combined for both distributions)
  const yMin = Math.min(sourceYExtent[0], targetYExtent[0]);
  const yMax = Math.max(sourceYExtent[1], targetYExtent[1]);
  const yRange = yMax - yMin;
  const yCenter = (yMin + yMax) / 2;

  // Compute available height
  const drawableHeight = height - 2 * marginHeight;

  // Scale factor based purely on height (independent of horizontal positioning)
  const scaleFactor = drawableHeight / (yRange || 1);
  const xScaleFactor = scaleFactor * distributionScaleFactor;

  // Compute adjusted y range - expand by 1/distributionScaleFactor so data appears smaller
  const adjustedYRange = drawableHeight / (scaleFactor * distributionScaleFactor);

  // Apply vertical offset for labels and yShiftFactor
  const yCenterOffset = -adjustedYRange * 0.07 - yShiftFactor;

  // Create y scale (same for both distributions)
  const yScale = d3.scaleLinear()
    .domain([yCenter - adjustedYRange / 2 - yCenterOffset, yCenter + adjustedYRange / 2 - yCenterOffset])
    .range([marginHeight, height - marginHeight]);

  // Compute mean x values for centering
  const sourceMeanX = sourcePoints.reduce((sum, p) => sum + p[0], 0) / sourcePoints.length;
  const targetMeanX = targetPoints.reduce((sum, p) => sum + p[0], 0) / targetPoints.length;

  return {
    yScale,
    xScaleFactor,
    sourceCenterPixelX,
    targetCenterPixelX,
    sourceMeanX,
    targetMeanX
  };
}

/**
 * Plot a scatter plot of points in an SVG group with explicit pixel positioning.
 *
 * @param svg - D3 selection of the SVG element
 * @param points - Array of [x, y] coordinates
 * @param yScale - D3 linear scale for y-axis
 * @param groupId - ID of the group element to plot into
 * @param options - Styling and positioning options
 */
export function plotScatterAtCenter(
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
  points: [number, number][],
  yScale: d3.ScaleLinear<number, number>,
  groupId: string,
  options: {
    centerPixelX: number;
    meanX: number;
    xScaleFactor: number;
    pointRadius?: number;
    pointOpacity?: number;
    pointColor?: string;
  }
): void {
  const {
    centerPixelX,
    meanX,
    xScaleFactor,
    pointRadius = 5,
    pointOpacity = 0.25,
    pointColor = '#3b82f6'
  } = options;

  if (!svg || points.length === 0) return;

  const group = svg.select(`#${groupId}`);
  if (group.empty()) return;

  group.selectAll('circle')
    .data(points)
    .join('circle')
    .attr('cx', (d: [number, number]) => centerPixelX + (d[0] - meanX) * xScaleFactor)
    .attr('cy', (d: [number, number]) => yScale(d[1]))
    .attr('r', pointRadius)
    .attr('fill', pointColor)
    .attr('opacity', pointOpacity);
}

/**
 * Plot source and target distribution scatter plots.
 * Each distribution is centered at its designated proportional x position.
 *
 * @param svg - D3 selection of the SVG element
 * @param sourcePoints - Array of [x, y] coordinates for source distribution
 * @param targetPoints - Array of [x, y] coordinates for target distribution
 * @param scales - Scales and positioning info from createSourceTargetScales
 * @param options - Styling options
 */
export function plotSourceTargetScatter(
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
  sourcePoints: [number, number][],
  targetPoints: [number, number][],
  scales: {
    yScale: d3.ScaleLinear<number, number>;
    xScaleFactor: number;
    sourceCenterPixelX: number;
    targetCenterPixelX: number;
    sourceMeanX: number;
    targetMeanX: number;
  },
  options: {
    sourcePointColor?: string;
    targetPointColor?: string;
    pointRadius?: number;
    pointOpacity?: number;
  } = {}
): void {
  const {
    sourcePointColor = '#3b82f6',
    targetPointColor = '#3b82f6',
    pointRadius = 5,
    pointOpacity = 0.25
  } = options;

  const { yScale, xScaleFactor, sourceCenterPixelX, targetCenterPixelX, sourceMeanX, targetMeanX } = scales;

  plotScatterAtCenter(svg, sourcePoints, yScale, 'sourceScatter', {
    centerPixelX: sourceCenterPixelX,
    meanX: sourceMeanX,
    xScaleFactor,
    pointRadius,
    pointOpacity,
    pointColor: sourcePointColor
  });

  plotScatterAtCenter(svg, targetPoints, yScale, 'targetScatter', {
    centerPixelX: targetCenterPixelX,
    meanX: targetMeanX,
    xScaleFactor,
    pointRadius,
    pointOpacity,
    pointColor: targetPointColor
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
    opacity?: number;
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
    opacity = 1,
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
    .attr('fill', color)
    .attr('opacity', opacity);

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
 * Labels are positioned at the proportional center positions.
 *
 * @param svg - D3 selection of the SVG element
 * @param scales - Scales and positioning info from createSourceTargetScales
 * @param options - Styling options
 */
export function plotSourceTargetLabels(
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
  scales: {
    yScale: d3.ScaleLinear<number, number>;
    sourceCenterPixelX: number;
    targetCenterPixelX: number;
  },
  options: {
    sourceLabelText?: string;
    targetLabelText?: string;
    labelFontSize?: number;
    labelColor?: string;
    labelOpacity?: number;
    yShiftFactor?: number;
    groupId?: string;
    outlineColor?: string;
    outlineOpacity?: number;
  } = {}
): void {
  const {
    sourceLabelText = 'Source Distribution',
    targetLabelText = 'Target Distribution',
    labelFontSize = 22,
    labelColor = '#666',
    labelOpacity = 1,
    yShiftFactor = 0.5,
    groupId = 'labels',
    outlineColor = '#f9f9f9',
    outlineOpacity = 0.5
  } = options;

  const { yScale, sourceCenterPixelX, targetCenterPixelX } = scales;

  const group = svg.select(`#${groupId}`) as d3.Selection<SVGGElement, unknown, null, undefined>;
  if (group.empty()) return;

  // Compute labelY from yScale domain
  const yDomain = yScale.domain();
  const yTop = yDomain[0];
  const labelY = yScale(yTop) + yShiftFactor * labelFontSize;

  plotLabel(group, sourceLabelText, sourceCenterPixelX, labelY, {
    fontSize: labelFontSize,
    color: labelColor,
    opacity: labelOpacity,
    outlineColor,
    outlineOpacity
  });

  plotLabel(group, targetLabelText, targetCenterPixelX, labelY, {
    fontSize: labelFontSize,
    color: labelColor,
    opacity: labelOpacity,
    outlineColor,
    outlineOpacity
  });
}

/**
 * Compute pixel x position for a data point given scales info.
 * Useful for figures that need to position individual elements.
 */
export function dataToPixelX(
  dataX: number,
  isSource: boolean,
  scales: {
    xScaleFactor: number;
    sourceCenterPixelX: number;
    targetCenterPixelX: number;
    sourceMeanX: number;
    targetMeanX: number;
  }
): number {
  const { xScaleFactor, sourceCenterPixelX, targetCenterPixelX, sourceMeanX, targetMeanX } = scales;
  if (isSource) {
    return sourceCenterPixelX + (dataX - sourceMeanX) * xScaleFactor;
  } else {
    return targetCenterPixelX + (dataX - targetMeanX) * xScaleFactor;
  }
}
