import * as d3 from "d3";

/**
 * Options for computing contours from point data
 */
export interface ContourOptions {
  // Grid resolution for density estimation
  gridSize?: number;
  // Bandwidth for kernel density estimation (larger = smoother)
  bandwidth?: number;
  // Number of contour levels to generate
  thresholds?: number | number[];
  // Domain bounds [xMin, xMax, yMin, yMax] - if not provided, computed from points
  domain?: [number, number, number, number];
}

/**
 * Computed contour data that can be rendered later
 */
export interface ComputedContours {
  // Array of contour polygons with their values
  contours: d3.ContourMultiPolygon[];
  // The domain used for computation
  domain: [number, number, number, number];
  // Grid size used
  gridSize: number;
  // Min/max density values
  minValue: number;
  maxValue: number;
}

/**
 * Options for rendering contours
 */
export interface PlotContourOptions {
  // Single fill color (if provided, used for all contours instead of colorScale)
  fillColor?: string;
  // Color scale function mapping [0, 1] to color string (used if fillColor not provided)
  colorScale?: (t: number) => string;
  // Whether to fill contours (default: true)
  fill?: boolean;
  // Whether to stroke contour lines (default: false)
  stroke?: boolean;
  // Stroke color (default: uses fillColor or colorScale)
  strokeColor?: string;
  // Stroke width (default: 1)
  strokeWidth?: number;
  // Global opacity (default: 1)
  opacity?: number;
  // Canvas globalCompositeOperation for blending (e.g., "screen", "multiply")
  blendMode?: GlobalCompositeOperation;
  // Scale functions to convert from data coordinates to pixel coordinates
  xScale: (x: number) => number;
  yScale: (y: number) => number;
}

/**
 * Compute density contours from a set of 2D points using D3's contour density estimation.
 *
 * @param points - Array of [x, y] points
 * @param options - Configuration options
 * @returns Computed contour data for later rendering
 */
export function computeContours(
  points: [number, number][] | number[][],
  options: ContourOptions = {}
): ComputedContours {
  const {
    gridSize = 100,
    bandwidth = 20,
    thresholds = 10,
  } = options;

  if (points.length === 0) {
    return {
      contours: [],
      domain: [0, 1, 0, 1],
      gridSize,
      minValue: 0,
      maxValue: 0,
    };
  }

  // Compute domain from points if not provided
  let domain = options.domain;
  if (!domain) {
    const xExtent = d3.extent(points, (p) => p[0]) as [number, number];
    const yExtent = d3.extent(points, (p) => p[1]) as [number, number];
    // Add small padding
    const xPad = (xExtent[1] - xExtent[0]) * 0.1;
    const yPad = (yExtent[1] - yExtent[0]) * 0.1;
    domain = [
      xExtent[0] - xPad,
      xExtent[1] + xPad,
      yExtent[0] - yPad,
      yExtent[1] + yPad,
    ];
  }

  const [xMin, xMax, yMin, yMax] = domain;

  // Create density contour generator
  const contourGenerator = d3
    .contourDensity<[number, number] | number[]>()
    .x((d) => d[0])
    .y((d) => d[1])
    .size([gridSize, gridSize])
    .bandwidth(bandwidth)
    .thresholds(thresholds);

  // Scale points to grid coordinates for density estimation
  const xGridScale = d3.scaleLinear().domain([xMin, xMax]).range([0, gridSize]);
  const yGridScale = d3.scaleLinear().domain([yMin, yMax]).range([0, gridSize]);

  const scaledPoints: [number, number][] = points.map((p) => [
    xGridScale(p[0]),
    yGridScale(p[1]),
  ]);

  // Compute contours
  const contours = contourGenerator(scaledPoints);

  // Find min/max values
  const values = contours.map((c) => c.value);
  const minValue = d3.min(values) ?? 0;
  const maxValue = d3.max(values) ?? 0;

  return {
    contours,
    domain,
    gridSize,
    minValue,
    maxValue,
  };
}

/**
 * Render computed contours to a canvas context.
 *
 * @param ctx - Canvas 2D rendering context
 * @param computedContours - Contour data from computeContours()
 * @param options - Rendering options including scale functions
 */
export function plotContours(
  ctx: CanvasRenderingContext2D,
  computedContours: ComputedContours,
  options: PlotContourOptions
): void {
  const {
    fillColor,
    colorScale = d3.interpolateBlues,
    fill = true,
    stroke = false,
    strokeColor,
    strokeWidth = 1,
    opacity = 1,
    blendMode,
    xScale,
    yScale,
  } = options;

  const { contours, domain, gridSize, minValue, maxValue } = computedContours;

  if (contours.length === 0) return;

  const [xMin, xMax, yMin, yMax] = domain;

  // Create scales to convert from grid coordinates back to data coordinates
  const gridToDataX = d3.scaleLinear().domain([0, gridSize]).range([xMin, xMax]);
  const gridToDataY = d3.scaleLinear().domain([0, gridSize]).range([yMin, yMax]);

  // Value normalization for color mapping (only used if no fillColor)
  const valueRange = maxValue - minValue;
  const normalizeValue = (v: number) =>
    valueRange > 0 ? (v - minValue) / valueRange : 0;

  ctx.save();
  ctx.globalAlpha = opacity;

  // Set blend mode if specified
  if (blendMode) {
    ctx.globalCompositeOperation = blendMode;
  }

  // Draw contours from highest to lowest value so denser regions are on top
  const sortedContours = [...contours].sort((a, b) => b.value - a.value);
  for (const contour of sortedContours) {
    // Use single fillColor if provided, otherwise use colorScale
    const color = fillColor ?? colorScale(normalizeValue(contour.value));

    ctx.beginPath();

    // Each contour can have multiple polygons (for disconnected regions)
    for (const polygon of contour.coordinates) {
      // Each polygon can have multiple rings (outer + holes)
      for (const ring of polygon) {
        for (let i = 0; i < ring.length; i++) {
          const [gridX, gridY] = ring[i];
          // Convert grid coords -> data coords -> pixel coords
          const dataX = gridToDataX(gridX);
          const dataY = gridToDataY(gridY);
          const pixelX = xScale(dataX);
          const pixelY = yScale(dataY);

          if (i === 0) {
            ctx.moveTo(pixelX, pixelY);
          } else {
            ctx.lineTo(pixelX, pixelY);
          }
        }
        ctx.closePath();
      }
    }

    if (fill) {
      ctx.fillStyle = color;
      ctx.fill();
    }

    if (stroke) {
      ctx.strokeStyle = strokeColor ?? color;
      ctx.lineWidth = strokeWidth;
      ctx.stroke();
    }
  }

  ctx.restore();
}
