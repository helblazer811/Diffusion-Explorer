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
