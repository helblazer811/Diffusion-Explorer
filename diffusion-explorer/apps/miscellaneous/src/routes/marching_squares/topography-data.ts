/**
 * Volcano Terrain Data
 *
 * Loads the R volcano dataset (Maunga Whau, Auckland) and provides
 * Gaussian blur smoothing for terrain visualization.
 */

/**
 * Linear interpolation between two values
 */
function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

/**
 * Applies Gaussian blur to a 2D heightmap
 *
 * @param data - Input heightmap data (row-major order)
 * @param width - Grid width
 * @param height - Grid height
 * @param sigma - Standard deviation of the Gaussian kernel
 * @returns Blurred heightmap data
 */
export function gaussianBlur(
  data: Float32Array,
  width: number,
  height: number,
  sigma: number = 2
): Float32Array {
  // Compute kernel size (3 sigma covers 99.7% of Gaussian)
  const kernelRadius = Math.ceil(sigma * 3);
  const kernelSize = kernelRadius * 2 + 1;

  // Generate 1D Gaussian kernel
  const kernel = new Float32Array(kernelSize);
  let sum = 0;
  for (let i = 0; i < kernelSize; i++) {
    const x = i - kernelRadius;
    kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
    sum += kernel[i];
  }
  // Normalize kernel
  for (let i = 0; i < kernelSize; i++) {
    kernel[i] /= sum;
  }

  // Separable convolution: horizontal pass
  const temp = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = 0; k < kernelSize; k++) {
        const sx = Math.max(0, Math.min(width - 1, x + k - kernelRadius));
        acc += data[y * width + sx] * kernel[k];
      }
      temp[y * width + x] = acc;
    }
  }

  // Vertical pass
  const result = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = 0; k < kernelSize; k++) {
        const sy = Math.max(0, Math.min(height - 1, y + k - kernelRadius));
        acc += temp[sy * width + x] * kernel[k];
      }
      result[y * width + x] = acc;
    }
  }

  return result;
}

/**
 * Parses volcano CSV data and returns a heightmap
 *
 * @param csvText - Raw CSV text (87 rows x 61 columns)
 * @returns Object with heightmap data and dimensions
 */
export function parseVolcanoCSV(csvText: string): {
  data: Float32Array;
  width: number;
  height: number;
  minHeight: number;
  maxHeight: number;
} {
  const lines = csvText.trim().split('\n');
  // Skip header row (V1, V2, ...)
  const dataLines = lines.slice(1);
  const height = dataLines.length;
  const width = dataLines[0].split(',').length;

  const data = new Float32Array(width * height);
  let minHeight = Infinity;
  let maxHeight = -Infinity;

  for (let y = 0; y < height; y++) {
    const values = dataLines[y].split(',').map(Number);
    for (let x = 0; x < width; x++) {
      const value = values[x];
      data[y * width + x] = value;
      if (value < minHeight) minHeight = value;
      if (value > maxHeight) maxHeight = value;
    }
  }

  return { data, width, height, minHeight, maxHeight };
}

/**
 * Loads and processes volcano data from a URL
 *
 * @param url - URL to the volcano.csv file
 * @param blurSigma - Gaussian blur sigma (0 for no blur)
 * @returns Promise with processed heightmap data
 */
export async function loadVolcanoData(
  url: string,
  blurSigma: number = 2
): Promise<{
  data: Float32Array;
  width: number;
  height: number;
  minHeight: number;
  maxHeight: number;
}> {
  const response = await fetch(url);
  const csvText = await response.text();
  const parsed = parseVolcanoCSV(csvText);

  if (blurSigma > 0) {
    const blurred = gaussianBlur(parsed.data, parsed.width, parsed.height, blurSigma);
    // Recalculate min/max after blur
    let minHeight = Infinity;
    let maxHeight = -Infinity;
    for (let i = 0; i < blurred.length; i++) {
      if (blurred[i] < minHeight) minHeight = blurred[i];
      if (blurred[i] > maxHeight) maxHeight = blurred[i];
    }
    return {
      data: blurred,
      width: parsed.width,
      height: parsed.height,
      minHeight,
      maxHeight,
    };
  }

  return parsed;
}

/**
 * Evaluates the heightmap at a given position using bilinear interpolation
 *
 * @param heightmap - The heightmap data
 * @param width - Grid width
 * @param height - Grid height
 * @param x - X coordinate (0 to width-1)
 * @param y - Y coordinate (0 to height-1)
 * @returns Interpolated height value
 */
export function evaluateHeightmap(
  heightmap: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number
): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);

  if (x0 < 0 || x0 >= width || y0 < 0 || y0 >= height) {
    return 0;
  }

  const fx = x - x0;
  const fy = y - y0;

  const v00 = heightmap[y0 * width + x0];
  const v10 = heightmap[y0 * width + x1];
  const v01 = heightmap[y1 * width + x0];
  const v11 = heightmap[y1 * width + x1];

  return lerp(lerp(v00, v10, fx), lerp(v01, v11, fx), fy);
}

// Keep generateHeightmap for backwards compatibility but mark deprecated
export interface HeightmapOptions {
  width: number;
  height: number;
  scale?: number;
  seed?: number;
  octaves?: number;
}

/**
 * @deprecated Use loadVolcanoData instead
 */
export function generateHeightmap(_options: HeightmapOptions): Float32Array {
  console.warn('generateHeightmap is deprecated. Use loadVolcanoData instead.');
  return new Float32Array(0);
}
