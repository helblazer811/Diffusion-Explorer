/**
 * 2D rectangular kernel density estimate via point splatting + separable
 * Gaussian blur. Returns an un-normalized row-major Float32Array of size
 * gridW * gridH.
 */
export function computeRectKDE(
  points: number[][],
  domain: [number, number, number, number],
  gridW: number,
  gridH: number,
  sigma: number,
): Float32Array {
  const [xMin, xMax, yMin, yMax] = domain;
  const grid = new Float32Array(gridW * gridH);

  const sx = (x: number) => ((x - xMin) / (xMax - xMin)) * (gridW - 1);
  const sy = (y: number) => ((y - yMin) / (yMax - yMin)) * (gridH - 1);

  for (const [x, y] of points) {
    const gx = Math.round(sx(x));
    const gy = Math.round(sy(y));
    if (gx >= 0 && gx < gridW && gy >= 0 && gy < gridH) {
      grid[gy * gridW + gx] += 1;
    }
  }

  const radius = Math.ceil(3 * sigma);
  const ksize = 2 * radius + 1;
  const kernel = new Float32Array(ksize);
  let ksum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + radius] = v;
    ksum += v;
  }
  for (let i = 0; i < ksize; i++) kernel[i] /= ksum;

  const tmp = new Float32Array(gridW * gridH);
  for (let y = 0; y < gridH; y++) {
    for (let x = 0; x < gridW; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = x + k;
        if (xx >= 0 && xx < gridW) acc += grid[y * gridW + xx] * kernel[k + radius];
      }
      tmp[y * gridW + x] = acc;
    }
  }

  const out = new Float32Array(gridW * gridH);
  for (let y = 0; y < gridH; y++) {
    for (let x = 0; x < gridW; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const yy = y + k;
        if (yy >= 0 && yy < gridH) acc += tmp[yy * gridW + x] * kernel[k + radius];
      }
      out[y * gridW + x] = acc;
    }
  }

  return out;
}
