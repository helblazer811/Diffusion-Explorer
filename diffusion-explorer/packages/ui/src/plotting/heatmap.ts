import * as d3 from "d3";

/**
 * Compute heatmap density using separable Gaussian blur.
 * More performant than d3 contour-based KDE.
 */
function computeHeatmapDensity(
  points: number[][],
  domain: [number, number, number, number],
  resolution: number,
  sigma: number
): Float32Array {
  const [xMin, xMax, yMin, yMax] = domain;

  const w = resolution;
  const h = resolution;
  const grid = new Float32Array(w * h);

  const xScale = (x: number) => ((x - xMin) / (xMax - xMin)) * (w - 1);
  const yScale = (y: number) => ((y - yMin) / (yMax - yMin)) * (h - 1);

  // ---- 1) Splat points into grid ----
  for (const [x, y] of points) {
    const gx = Math.round(xScale(x));
    const gy = Math.round(yScale(y));
    if (gx >= 0 && gx < w && gy >= 0 && gy < h) {
      grid[gy * w + gx] += 1;
    }
  }

  // ---- 2) Build 1D Gaussian kernel ----
  const radius = Math.ceil(3 * sigma);
  const size = radius * 2 + 1;
  const kernel = new Float32Array(size);

  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + radius] = v;
    sum += v;
  }
  for (let i = 0; i < size; i++) kernel[i] /= sum;

  // ---- 3) Separable blur: horizontal ----
  const temp = new Float32Array(w * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = x + k;
        if (xx >= 0 && xx < w) {
          acc += grid[y * w + xx] * kernel[k + radius];
        }
      }
      temp[y * w + x] = acc;
    }
  }

  // ---- 4) Separable blur: vertical ----
  const out = new Float32Array(w * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const yy = y + k;
        if (yy >= 0 && yy < h) {
          acc += temp[yy * w + x] * kernel[k + radius];
        }
      }
      out[y * w + x] = acc;
    }
  }

  return out;
}

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

  // Compute density grid using separable Gaussian blur
  const densityGrid = computeHeatmapDensity(points, domain, resolution, bandwidth);

  // Find max density for normalization
  let maxDensity = 0;
  for (let i = 0; i < densityGrid.length; i++) {
    if (densityGrid[i] > maxDensity) {
      maxDensity = densityGrid[i];
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
      const density = densityGrid[gy * resolution + gx];
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
