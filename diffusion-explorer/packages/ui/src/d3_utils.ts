import * as d3 from 'd3';
import katex from 'katex';

export interface PlotKatexOptions {
  fontSize?: number;
  padding?: number;
  color?: string;
  bg?: string | false;
  bgOpacity?: number;
  rx?: number;
  ry?: number;
  className?: string;
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
    className = 'katex-label'
  } = opts;

  const selection = svg instanceof d3.selection
    ? svg
    : d3.select(svg);

  // Group everything so positioning is easy
  const g = selection.append('g')
    .attr('class', className)
    .attr('transform', `translate(${x}, ${y})`);

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

  // Measure AFTER render
  const bbox = (div.node() as HTMLElement).getBoundingClientRect();
  // Add buffer to prevent clipping
  const contentWidth = bbox.width * 1.1;
  const contentHeight = bbox.height * 1.1;
  const width = contentWidth + 2 * padding;
  const height = contentHeight + 2 * padding;

  // Resize foreignObject with buffer
  fo.attr('x', padding)
    .attr('y', padding)
    .attr('width', contentWidth)
    .attr('height', contentHeight);

  // SVG background rect (inserted behind fo) - only if bg is not false
  if (bg !== false) {
    g.insert('rect', ':first-child')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', width)
      .attr('height', height)
      .attr('rx', rx)
      .attr('ry', ry)
      .attr('fill', bg)
      .attr('opacity', bgOpacity);
  }

  return g;
}
