/**
 * Pulse Pattern Computation Utilities
 *
 * Shared functions for computing animated pulse patterns along paths.
 * Used by streamlines, pulsing paths, and other trajectory renderers.
 *
 * Requires sdf-utils.wgsl to be included before this file.
 */

/**
 * Information about the pulse region a fragment is in.
 */
struct PulseInfo {
  inPulseRegion: bool,  // Whether fragment is potentially in pulse render area
  bodyStart: f32,       // Arc length where body starts (logical pixels)
  bodyEnd: f32,         // Arc length where body ends (logical pixels)
  posInPattern: f32,    // Position within pulse pattern (for alpha)
}

/**
 * Compute pulse body bounds for a fragment's position.
 *
 * The pattern repeats every `pulseSpacing` pixels along the path.
 * This function finds the arc length positions of the nearest pulse's
 * body start (tail) and body end (head).
 *
 * @param arcLength - Position along the path (logical pixels)
 * @param phase - Animation phase (0-1)
 * @param phaseOffset - Per-path phase offset (0-1)
 * @param pulseSpacing - Total spacing (pulse + gap) in logical pixels
 * @param pulseWidth - Width of pulse body in logical pixels
 * @param halfThickness - Half thickness for cap extent calculation (logical pixels)
 * @returns PulseInfo struct with body bounds and region info
 */
fn computePulseInfo(
  arcLength: f32,
  phase: f32,
  phaseOffset: f32,
  pulseSpacing: f32,
  pulseWidth: f32,
  halfThickness: f32
) -> PulseInfo {
  var info: PulseInfo;

  // Combine global phase and per-path offset
  let totalPhase = fract(phase + phaseOffset);
  let phasePixels = totalPhase * pulseSpacing;

  // Position in pattern (0 to pulseSpacing)
  let posInPattern = fract((arcLength - phasePixels) / pulseSpacing) * pulseSpacing;

  // The pulse body spans [0, pulseWidth] in pattern space
  // Convert to arc length of the pulse that contains/nearest this fragment
  let patternStart = arcLength - posInPattern;

  info.bodyStart = patternStart;
  info.bodyEnd = patternStart + pulseWidth;
  info.posInPattern = posInPattern;

  // Check if in potential render area (body + caps + AA margin)
  let aaMargin = 1.0;
  let capExtent = halfThickness + aaMargin;

  info.inPulseRegion = (arcLength >= info.bodyStart - capExtent) &&
                        (arcLength <= info.bodyEnd + capExtent);

  return info;
}

/**
 * Compute the SDF for a pulse capsule (body + head/tail caps).
 * Returns the signed distance to the pulse shape in logical pixels.
 *
 * @param arcLength - Position along the path (logical pixels)
 * @param perpDistLogical - Perpendicular distance from centerline (logical pixels)
 * @param pulseInfo - Pulse bounds from computePulseInfo
 * @param halfThicknessLogical - Half thickness (logical pixels)
 * @returns Signed distance in logical pixels
 */
fn computePulseSDF(
  arcLength: f32,
  perpDistLogical: f32,
  pulseInfo: PulseInfo,
  halfThicknessLogical: f32
) -> f32 {
  var sdPulse: f32 = 1e6;  // Start outside all pulses

  let aaMargin = 1.0;
  let capExtent = halfThicknessLogical + aaMargin;

  // Body: rectangle between bodyStart and bodyEnd
  let inBody = (arcLength >= pulseInfo.bodyStart) && (arcLength <= pulseInfo.bodyEnd);
  if (inBody) {
    sdPulse = sdLine(perpDistLogical, halfThicknessLogical);
  }

  // Tail cap (at bodyStart): semicircle
  let tailDist = pulseInfo.bodyStart - arcLength;
  if (tailDist > 0.0 && tailDist < capExtent) {
    let tailSd = length(vec2<f32>(tailDist, perpDistLogical)) - halfThicknessLogical;
    sdPulse = min(sdPulse, tailSd);
  }

  // Head cap (at bodyEnd): semicircle
  let headDist = arcLength - pulseInfo.bodyEnd;
  if (headDist > 0.0 && headDist < capExtent) {
    let headSd = length(vec2<f32>(headDist, perpDistLogical)) - halfThicknessLogical;
    sdPulse = min(sdPulse, headSd);
  }

  return sdPulse;
}

/**
 * Compute pulse alpha based on position within pattern.
 * Linear gradient from 0 at tail to 1 at head, or 1.0 for binary mode.
 *
 * @param arcLength - Position along the path (logical pixels)
 * @param bodyStart - Arc length where pulse body starts (logical pixels)
 * @param pulseWidth - Width of pulse body (logical pixels)
 * @param binaryPulse - 0.0 for gradient, 1.0 for solid
 * @returns Alpha value (0.0 to 1.0)
 */
fn computePulseAlpha(
  arcLength: f32,
  bodyStart: f32,
  pulseWidth: f32,
  binaryPulse: f32
) -> f32 {
  let normalizedPos = saturate((arcLength - bodyStart) / pulseWidth);
  return mix(normalizedPos, 1.0, binaryPulse);
}

/**
 * Compute path capsule SDF for clipping pulses to path bounds.
 * Clips rendering to [0, totalLength] with rounded ends.
 *
 * @param arcLength - Position along the path (logical pixels)
 * @param perpDistLogical - Perpendicular distance from centerline (logical pixels)
 * @param totalLength - Total path length (logical pixels)
 * @param halfThicknessLogical - Half thickness (logical pixels)
 * @returns Signed distance in logical pixels
 */
fn computePathCapsuleSDF(
  arcLength: f32,
  perpDistLogical: f32,
  totalLength: f32,
  halfThicknessLogical: f32
) -> f32 {
  var sd: f32;
  if (arcLength < 0.0) {
    // Before start: circular cap at arcLength=0
    sd = length(vec2<f32>(-arcLength, perpDistLogical)) - halfThicknessLogical;
  } else if (arcLength > totalLength) {
    // Past end: circular cap at arcLength=totalLength
    sd = length(vec2<f32>(arcLength - totalLength, perpDistLogical)) - halfThicknessLogical;
  } else {
    // On path: perpendicular distance only
    sd = perpDistLogical - halfThicknessLogical;
  }
  return sd;
}
