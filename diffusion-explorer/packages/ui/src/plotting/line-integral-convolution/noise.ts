/**
 * White noise generation for LIC computation.
 */

/**
 * Xorshift32 pseudo-random number generator.
 * Fast, simple, and produces good quality random numbers.
 */
function xorshift32(state: { value: number }): number {
  let x = state.value;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  state.value = x >>> 0; // Keep as unsigned 32-bit
  // Convert to [0, 1) range
  return (x >>> 0) / 4294967296;
}

/**
 * Generate a white noise texture for LIC computation.
 *
 * @param width - Texture width in pixels
 * @param height - Texture height in pixels
 * @param seed - Optional random seed (default: random)
 * @returns Float32Array of random values in [0, 1]
 */
export function generateWhiteNoise(
  width: number,
  height: number,
  seed?: number
): Float32Array {
  const size = width * height;
  const noise = new Float32Array(size);

  // Initialize seed (use provided seed or random value)
  const state = {
    value: seed !== undefined ? (seed >>> 0) || 1 : (Math.random() * 4294967296) >>> 0 || 1
  };

  // Generate noise values
  for (let i = 0; i < size; i++) {
    noise[i] = xorshift32(state);
  }

  return noise;
}

/**
 * Generate a scaled (low-frequency) noise texture for wider LIC streaks.
 * Generates noise at reduced resolution and upscales with nearest-neighbor sampling.
 *
 * @param width - Output texture width in pixels
 * @param height - Output texture height in pixels
 * @param scale - Scale factor (e.g., 4 means each noise pixel covers 4x4 output pixels)
 * @param seed - Optional random seed (default: random)
 * @returns Float32Array of noise values in [0, 1]
 */
export function generateScaledNoise(
  width: number,
  height: number,
  scale: number = 1,
  seed?: number
): Float32Array {
  // If scale is 1, just return regular white noise
  if (scale <= 1) {
    return generateWhiteNoise(width, height, seed);
  }

  // Generate at reduced resolution
  const scaledW = Math.ceil(width / scale);
  const scaledH = Math.ceil(height / scale);
  const smallNoise = generateWhiteNoise(scaledW, scaledH, seed);

  // Upscale with nearest-neighbor sampling to full resolution (preserves sharp edges)
  const result = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Map to small noise coordinates and use nearest-neighbor
      const nearestX = Math.min(Math.round(x / scale), scaledW - 1);
      const nearestY = Math.min(Math.round(y / scale), scaledH - 1);

      result[y * width + x] = smallNoise[nearestY * scaledW + nearestX];
    }
  }

  return result;
}
