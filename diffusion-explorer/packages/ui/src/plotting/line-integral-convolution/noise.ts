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
