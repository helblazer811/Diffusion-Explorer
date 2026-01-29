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
  // Convert to arc length of the pulse whose pattern contains this fragment
  let currentPatternStart = arcLength - posInPattern;

  // Check if in potential render area (body + caps + AA margin)
  let aaMargin = 1.0;
  let capExtent = halfThickness + aaMargin;

  // Calculate distances to current, next, and previous pulses
  let currentBodyStart = currentPatternStart;
  let currentBodyEnd = currentPatternStart + pulseWidth;
  let nextBodyStart = currentPatternStart + pulseSpacing;
  let prevBodyEnd = currentPatternStart - pulseSpacing + pulseWidth;

  // Distance to nearest point on each pulse body
  let distToCurrent = max(currentBodyStart - arcLength, arcLength - currentBodyEnd);
  let distToNext = nextBodyStart - arcLength;  // Always positive (next is ahead)
  let distToPrev = arcLength - prevBodyEnd;    // Always positive (prev is behind)

  // Find which pulse is closest
  // For current pulse, use the clamped distance (0 if inside body)
  let clampedDistToCurrent = max(0.0, distToCurrent);

  // Select the nearest pulse's bounds
  if (distToNext < clampedDistToCurrent && distToNext < distToPrev) {
    // Next pulse is closest (we're in the gap, closer to next pulse's tail)
    info.bodyStart = nextBodyStart;
    info.bodyEnd = nextBodyStart + pulseWidth;
  } else if (distToPrev < clampedDistToCurrent) {
    // Previous pulse is closest (we're in the gap, closer to prev pulse's head)
    info.bodyStart = currentPatternStart - pulseSpacing;
    info.bodyEnd = prevBodyEnd;
  } else {
    // Current pulse is closest or we're inside it
    info.bodyStart = currentBodyStart;
    info.bodyEnd = currentBodyEnd;
  }

  info.posInPattern = posInPattern;

  // Check if we're within cap extent of the selected pulse
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
  // Capsule SDF: clamp arc length to [bodyStart, bodyEnd], then compute distance
  // This naturally creates rounded caps at both ends
  let clampedArc = clamp(arcLength, pulseInfo.bodyStart, pulseInfo.bodyEnd);
  let alongDist = arcLength - clampedArc;  // Distance along path from clamped point

  // Distance from the capsule centerline
  let dist = length(vec2<f32>(alongDist, perpDistLogical));

  return dist - halfThicknessLogical;
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
