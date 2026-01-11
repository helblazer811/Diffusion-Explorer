import * as d3 from "d3";

/**
 * Pixel bounds for heatmap rendering
 */
export interface HeatmapBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Options for drawing a heatmap from scattered points
 */
export interface HeatmapOptions {
  /** Grid resolution (cells per axis). Default: 100 */
  resolution?: number;
  /** KDE bandwidth (larger = smoother). Default: 20 */
  bandwidth?: number;
  /** Domain bounds [xMin, xMax, yMin, yMax]. Auto-computed if not provided */
  domain?: [number, number, number, number];
  /** Color scale function mapping [0, 1] to color string. Default: d3.interpolateViridis */
  colorScale?: (t: number) => string;
  /** Global opacity. Default: 1 */
  opacity?: number;
  /** Canvas blend mode */
  blendMode?: GlobalCompositeOperation;
  /** Pixel bounds {x, y, width, height}. If provided, xScale/yScale are optional */
  bounds?: HeatmapBounds;
  /** Scale function: data x -> pixel x. Required if bounds not provided */
  xScale?: (x: number) => number;
  /** Scale function: data y -> pixel y. Required if bounds not provided */
  yScale?: (y: number) => number;
}

/**
 * Draw a continuous density heatmap from scattered 2D points.
 * Uses kernel density estimation (KDE) to compute density at each grid cell.
 *
 * @param ctx - Canvas 2D rendering context
 * @param points - Array of [x, y] points in data coordinates
 * @param options - Heatmap configuration options
 *
 * @example
 * ```typescript
 * drawHeatmap(ctx, points, {
 *   resolution: 50,
 *   bandwidth: 15,
 *   colorScale: d3.interpolateInferno,
 *   xScale: (x) => x * 100 + 200,
 *   yScale: (y) => y * 100 + 200,
 * });
 * ```
 */
export function drawHeatmap(
  ctx: CanvasRenderingContext2D,
  points: number[][],
  options: HeatmapOptions
): void {
  const {
    resolution = 100,
    bandwidth = 20,
    colorScale = d3.interpolateViridis,
    opacity = 1,
    blendMode,
    bounds,
  } = options;

  if (points.length === 0) return;

  // Compute domain from points if not provided
  let domain = options.domain;
  if (!domain) {
    const xExtent = d3.extent(points, (p) => p[0]) as [number, number];
    const yExtent = d3.extent(points, (p) => p[1]) as [number, number];
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

  // Create scales to map data coords to grid coords
  const xGridScale = d3.scaleLinear().domain([xMin, xMax]).range([0, resolution]);
  const yGridScale = d3.scaleLinear().domain([yMin, yMax]).range([0, resolution]);

  // Scale points to grid coordinates
  const scaledPoints: [number, number][] = points.map((p) => [
    xGridScale(p[0]),
    yGridScale(p[1]),
  ]);

  // Create density estimator
  const densityEstimator = d3
    .contourDensity<[number, number]>()
    .x((d) => d[0])
    .y((d) => d[1])
    .size([resolution, resolution])
    .bandwidth(bandwidth)
    .thresholds(resolution); // Use high threshold count for smooth sampling

  // Compute contours to get density values
  const contours = densityEstimator(scaledPoints);

  // Build a density grid by sampling contour values
  // For efficiency, we'll create a 2D array and fill based on contour membership
  const densityGrid: number[][] = Array.from({ length: resolution }, () =>
    Array(resolution).fill(0)
  );

  // For each contour level, mark cells that fall within it
  // Process from lowest to highest value so higher values overwrite
  const sortedContours = [...contours].sort((a, b) => a.value - b.value);

  for (const contour of sortedContours) {
    const value = contour.value;

    // For each cell center, check if it's inside this contour
    for (let gy = 0; gy < resolution; gy++) {
      for (let gx = 0; gx < resolution; gx++) {
        const cellCenterX = gx + 0.5;
        const cellCenterY = gy + 0.5;

        // Check if point is inside any polygon of this contour
        if (pointInContour(cellCenterX, cellCenterY, contour)) {
          densityGrid[gy][gx] = value;
        }
      }
    }
  }

  // Find max density for normalization
  let maxDensity = 0;
  for (let gy = 0; gy < resolution; gy++) {
    for (let gx = 0; gx < resolution; gx++) {
      if (densityGrid[gy][gx] > maxDensity) {
        maxDensity = densityGrid[gy][gx];
      }
    }
  }

  if (maxDensity === 0) return;

  // Draw heatmap
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.strokeStyle = "transparent";
  ctx.lineWidth = 0;
  ctx.imageSmoothingEnabled = false;
  if (blendMode) {
    ctx.globalCompositeOperation = blendMode;
  }

  // Create pixel scale functions from bounds or use provided scales
  let xScale: (x: number) => number;
  let yScale: (y: number) => number;

  if (bounds) {
    // Create scales from bounds
    xScale = d3.scaleLinear().domain([xMin, xMax]).range([bounds.x, bounds.x + bounds.width]);
    yScale = d3.scaleLinear().domain([yMin, yMax]).range([bounds.y + bounds.height, bounds.y]);
  } else if (options.xScale && options.yScale) {
    xScale = options.xScale;
    yScale = options.yScale;
  } else {
    throw new Error("drawHeatmap: Either bounds or xScale/yScale must be provided");
  }

  // Create ImageData at grid resolution to avoid cell boundary artifacts
  const imageData = ctx.createImageData(resolution, resolution);
  const data = imageData.data;

  for (let gy = 0; gy < resolution; gy++) {
    for (let gx = 0; gx < resolution; gx++) {
      const density = densityGrid[gy][gx];
      const normalizedDensity = density / maxDensity;

      // Get color from color scale and parse RGBA
      const color = d3.color(colorScale(normalizedDensity));
      const rgb = color?.rgb() ?? d3.rgb(0, 0, 0);

      // ImageData y-axis is top-down, so flip the y coordinate
      const pixelIndex = ((resolution - 1 - gy) * resolution + gx) * 4;
      data[pixelIndex] = rgb.r;
      data[pixelIndex + 1] = rgb.g;
      data[pixelIndex + 2] = rgb.b;
      data[pixelIndex + 3] = Math.round(255 * opacity);
    }
  }

  // Draw ImageData to a temporary canvas, then scale to target bounds
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = resolution;
  tempCanvas.height = resolution;
  const tempCtx = tempCanvas.getContext("2d")!;
  tempCtx.putImageData(imageData, 0, 0);

  // Compute target bounds from scales
  const targetX = xScale(xMin);
  const targetY = yScale(yMax); // yScale typically inverts, so yMax -> top
  const targetX2 = xScale(xMax);
  const targetY2 = yScale(yMin);
  const targetWidth = Math.abs(targetX2 - targetX);
  const targetHeight = Math.abs(targetY2 - targetY);

  ctx.drawImage(
    tempCanvas,
    Math.min(targetX, targetX2),
    Math.min(targetY, targetY2),
    targetWidth,
    targetHeight
  );

  ctx.restore();
}

/**
 * Check if a point is inside a contour's polygons using ray casting
 */
function pointInContour(
  x: number,
  y: number,
  contour: d3.ContourMultiPolygon
): boolean {
  for (const polygon of contour.coordinates) {
    // Check outer ring (first ring)
    const outerRing = polygon[0] as [number, number][];
    if (pointInPolygon(x, y, outerRing)) {
      // Check if point is in any hole (subsequent rings)
      let inHole = false;
      for (let i = 1; i < polygon.length; i++) {
        if (pointInPolygon(x, y, polygon[i] as [number, number][])) {
          inHole = true;
          break;
        }
      }
      if (!inHole) return true;
    }
  }
  return false;
}

/**
 * Ray casting algorithm for point-in-polygon test
 */
function pointInPolygon(
  x: number,
  y: number,
  ring: [number, number][]
): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];

    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}
