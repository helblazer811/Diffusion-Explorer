/**
 * CPU-based alpha/opacity computation for animated streamline pulses.
 *
 * Uses precomputed lookup tables (LUT) and pattern indices for efficient
 * per-frame alpha computation.
 */

/**
 * Create a lookup table for alpha values across one pulse period.
 *
 * The LUT covers positions from 0 to spacing, with alpha values
 * that fade from 0 at front to baseOpacity at the back of the pulse.
 *
 * @param pulseWidth - Width of the pulse in pixels
 * @param spacing - Total period (pulseWidth + pulsePauseWidth) in pixels
 * @param baseOpacity - Maximum opacity at pulse back
 * @param resolution - Number of entries in the LUT (default 256)
 * @param binary - If true, use binary (on/off) pulses instead of gradient
 * @returns Float32Array of alpha values
 */
export function createAlphaLUT(
  pulseWidth: number,
  spacing: number,
  baseOpacity: number,
  resolution: number = 256,
  binary: boolean = false
): Float32Array {
  const lut = new Float32Array(resolution);
  const invPulseWidth = 1 / pulseWidth;

  for (let i = 0; i < resolution; i++) {
    const posInPattern = (i / resolution) * spacing;
    if (posInPattern < pulseWidth) {
      if (binary) {
        // Binary mode: full opacity, no gradient
        lut[i] = baseOpacity;
      } else {
        // Gradient mode: fade from 0 at front to baseOpacity at back
        const u = posInPattern * invPulseWidth; // 0 at front -> 1 at back
        lut[i] = baseOpacity * u;
      }
    }
    // else lut[i] stays 0 (gap region)
  }

  return lut;
}

/**
 * Precompute pattern positions for a streamline.
 *
 * Computes (pos % spacing) for each point, normalized to LUT indices.
 * This allows fast lookup during animation.
 *
 * @param cumulativeLengths - Cumulative pixel length at each point
 * @param spacing - Total period (pulseWidth + pulsePauseWidth) in pixels
 * @param lutResolution - Resolution of the alpha LUT
 * @returns Uint16Array of LUT indices for each point
 */
export function precomputePatternIndices(
  cumulativeLengths: number[],
  spacing: number,
  lutResolution: number = 256
): Uint16Array {
  const numPoints = cumulativeLengths.length;
  const indices = new Uint16Array(numPoints);
  const scale = lutResolution / spacing;

  for (let i = 0; i < numPoints; i++) {
    const pos = cumulativeLengths[i];
    const posInPattern = pos % spacing;
    indices[i] = Math.floor(posInPattern * scale) % lutResolution;
  }

  return indices;
}

/**
 * Compute alpha values for animated pulses along a streamline.
 *
 * Uses precomputed pattern indices and LUT for efficient per-frame computation.
 * Uses fractional indexing with linear interpolation to avoid flickering.
 *
 * @param patternIndices - Precomputed LUT indices for each point (from precomputePatternIndices)
 * @param alphaLUT - Precomputed alpha lookup table (from createAlphaLUT)
 * @param phase - Animation phase [0, 1)
 * @param offset - Random phase offset for this streamline (0-1)
 * @param outAlphas - Output buffer for alpha values (reused to avoid allocation)
 */
export function computeAlphaTrail(
  patternIndices: Uint16Array,
  alphaLUT: Float32Array,
  phase: number,
  offset: number,
  outAlphas: Float32Array
): void {
  const numPoints = patternIndices.length;
  const lutResolution = alphaLUT.length;

  // Use fractional shift for smooth animation (no Math.floor!)
  const shiftAmount = ((phase + offset) % 1) * lutResolution;

  for (let i = 0; i < numPoints; i++) {
    // Compute fractional index
    let fracIdx = patternIndices[i] - shiftAmount;
    if (fracIdx < 0) fracIdx += lutResolution;

    // Linear interpolation between adjacent LUT entries
    const idx0 = Math.floor(fracIdx) % lutResolution;
    const idx1 = (idx0 + 1) % lutResolution;
    const t = fracIdx - Math.floor(fracIdx);

    outAlphas[i] = alphaLUT[idx0] * (1 - t) + alphaLUT[idx1] * t;
  }
}
