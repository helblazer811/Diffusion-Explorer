/**
 * CPU-based heatmap density computation using separable Gaussian blur.
 */

/**
 * Compute heatmap density using separable Gaussian blur.
 * More performant than d3 contour-based KDE.
 *
 * @param points - Array of [x, y] points in data coordinates
 * @param domain - Domain bounds [xMin, xMax, yMin, yMax]
 * @param resolution - Grid resolution (cells per axis)
 * @param sigma - Gaussian blur sigma (bandwidth)
 * @returns Float32Array of density values (unnormalized)
 */
export function computeHeatmapDensity(
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
 * Compute normalized heatmap density [0, 1].
 *
 * @param points - Array of [x, y] points in data coordinates
 * @param domain - Domain bounds [xMin, xMax, yMin, yMax]
 * @param resolution - Grid resolution (cells per axis)
 * @param sigma - Gaussian blur sigma (bandwidth)
 * @returns Float32Array of normalized density values [0, 1]
 */
export function computeNormalizedDensity(
  points: number[][],
  domain: [number, number, number, number],
  resolution: number,
  sigma: number
): Float32Array {
  const density = computeHeatmapDensity(points, domain, resolution, sigma);

  // Find max density
  let max = 0;
  for (let i = 0; i < density.length; i++) {
    if (density[i] > max) max = density[i];
  }

  // Normalize to [0, 1]
  if (max > 0) {
    for (let i = 0; i < density.length; i++) {
      density[i] /= max;
    }
  }

  return density;
}
