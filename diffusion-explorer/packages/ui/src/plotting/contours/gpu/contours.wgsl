/**
 * Density field computation: binning, normalization, and blur.
 *
 * Entry points:
 * 1. binning: Bins 2D points into a histogram grid using atomic operations
 * 2. findMax: Finds the maximum count value in the histogram
 * 3. normalize: Converts histogram counts (u32) to normalized density values (f32)
 * 4. boxBlurHorizontal: Horizontal pass of box blur (apply 3x for D3 match)
 * 5. boxBlurVertical: Vertical pass of box blur (apply 3x for D3 match)
 *
 * The blur uses D3-style 3-pass box blur with clamped edge handling.
 * Each pass outputs the average of a sliding window: sum / (2*radius + 1).
 */

struct Uniforms {
  gridWidth: u32,
  gridHeight: u32,
  numLevels: u32,
  numPoints: u32,
  xMin: f32,
  xMax: f32,
  yMin: f32,
  yMax: f32,
  blurRadius: u32,
  _pad1: u32,
  _pad2: u32,
  _pad3: u32,
}

// ============================================================================
// Binning pass bindings
// ============================================================================
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> points: array<f32>;  // [x0, y0, x1, y1, ...]
@group(0) @binding(2) var<storage, read_write> grid: array<atomic<u32>>;

/**
 * Bins 2D points into a density grid.
 * Each thread processes one point and atomically increments the corresponding grid cell.
 */
@compute @workgroup_size(256)
fn binning(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let pointIdx = globalId.x;

  if (pointIdx >= uniforms.numPoints) {
    return;
  }

  // Read point coordinates
  let x = points[pointIdx * 2u];
  let y = points[pointIdx * 2u + 1u];

  // Map to grid cell
  let xRange = uniforms.xMax - uniforms.xMin;
  let yRange = uniforms.yMax - uniforms.yMin;

  // Normalize to [0, 1]
  let xNorm = (x - uniforms.xMin) / xRange;
  let yNorm = (y - uniforms.yMin) / yRange;

  // Map to grid cell indices
  let cellX = u32(clamp(xNorm * f32(uniforms.gridWidth), 0.0, f32(uniforms.gridWidth - 1u)));
  let cellY = u32(clamp(yNorm * f32(uniforms.gridHeight), 0.0, f32(uniforms.gridHeight - 1u)));

  // Atomic increment
  let gridIdx = cellY * uniforms.gridWidth + cellX;
  atomicAdd(&grid[gridIdx], 1u);
}

// ============================================================================
// Normalization pass bindings (separate bind group)
// ============================================================================
@group(0) @binding(0) var<uniform> normalizeUniforms: Uniforms;
@group(0) @binding(1) var<storage, read> histogramGrid: array<u32>;
@group(0) @binding(2) var<storage, read_write> densityGrid: array<f32>;
@group(0) @binding(3) var<storage, read_write> maxValue: array<atomic<u32>>;

/**
 * Find maximum value in the histogram using atomic max.
 */
@compute @workgroup_size(256)
fn findMax(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let idx = globalId.x;
  let totalCells = normalizeUniforms.gridWidth * normalizeUniforms.gridHeight;

  if (idx >= totalCells) {
    return;
  }

  let count = histogramGrid[idx];
  atomicMax(&maxValue[0], count);
}

/**
 * Normalize histogram counts to [0, 1] range.
 */
@compute @workgroup_size(256)
fn normalize(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let idx = globalId.x;
  let totalCells = normalizeUniforms.gridWidth * normalizeUniforms.gridHeight;

  if (idx >= totalCells) {
    return;
  }

  let maxVal = f32(atomicLoad(&maxValue[0]));
  let count = f32(histogramGrid[idx]);

  // Avoid division by zero
  if (maxVal > 0.0) {
    densityGrid[idx] = count / maxVal;
  } else {
    densityGrid[idx] = 0.0;
  }
}

// ============================================================================
// Box blur pass bindings (separate bind group)
// No kernel buffer needed - box blur uses uniform weights
// ============================================================================
@group(0) @binding(0) var<uniform> blurUniforms: Uniforms;
@group(0) @binding(1) var<storage, read> inputGrid: array<f32>;
@group(0) @binding(2) var<storage, read_write> outputGrid: array<f32>;

/**
 * Horizontal box blur pass (sliding window average).
 * Apply 3 times for D3-equivalent smoothing.
 * Uses clamped edge handling (repeats boundary values).
 */
@compute @workgroup_size(256)
fn boxBlurHorizontal(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let idx = globalId.x;
  let y = idx / blurUniforms.gridWidth;
  let x = idx % blurUniforms.gridWidth;

  if (idx >= blurUniforms.gridWidth * blurUniforms.gridHeight) {
    return;
  }

  let radius = i32(blurUniforms.blurRadius);
  let windowSize = 2 * radius + 1;
  let invWindow = 1.0 / f32(windowSize);
  let width = i32(blurUniforms.gridWidth);

  // Accumulate window sum with zero-padding (out-of-bounds samples contribute 0)
  var sum = 0.0;
  for (var dx = -radius; dx <= radius; dx++) {
    let sx = i32(x) + dx;
    if (sx >= 0 && sx < width) {
      sum += inputGrid[y * blurUniforms.gridWidth + u32(sx)];
    }
  }

  outputGrid[idx] = sum * invWindow;
}

/**
 * Vertical box blur pass (sliding window average).
 * Apply 3 times for D3-equivalent smoothing.
 * Uses clamped edge handling (repeats boundary values).
 */
@compute @workgroup_size(256)
fn boxBlurVertical(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let idx = globalId.x;
  let y = idx / blurUniforms.gridWidth;
  let x = idx % blurUniforms.gridWidth;

  if (idx >= blurUniforms.gridWidth * blurUniforms.gridHeight) {
    return;
  }

  let radius = i32(blurUniforms.blurRadius);
  let windowSize = 2 * radius + 1;
  let invWindow = 1.0 / f32(windowSize);
  let height = i32(blurUniforms.gridHeight);

  // Accumulate window sum with zero-padding (out-of-bounds samples contribute 0)
  var sum = 0.0;
  for (var dy = -radius; dy <= radius; dy++) {
    let sy = i32(y) + dy;
    if (sy >= 0 && sy < height) {
      sum += inputGrid[u32(sy) * blurUniforms.gridWidth + x];
    }
  }

  outputGrid[idx] = sum * invWindow;
}

// ============================================================================
// Post-blur normalization pass bindings (separate bind group)
// Uses f32 smoothed grid for both read and write (in-place normalization)
// ============================================================================
@group(0) @binding(0) var<uniform> postBlurUniforms: Uniforms;
@group(0) @binding(1) var<storage, read> unusedPlaceholder: array<f32>;  // placeholder for layout compatibility
@group(0) @binding(2) var<storage, read_write> smoothedGrid: array<f32>;
@group(0) @binding(3) var<storage, read_write> postBlurMaxValue: array<atomic<u32>>;

/**
 * Find maximum value in the blurred f32 density grid using atomic max.
 * This is needed because Gaussian blur reduces peak values significantly.
 */
@compute @workgroup_size(256)
fn findMaxSmoothed(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let idx = globalId.x;
  let totalCells = postBlurUniforms.gridWidth * postBlurUniforms.gridHeight;

  if (idx >= totalCells) {
    return;
  }

  let value = smoothedGrid[idx];

  // Convert to fixed-point for atomic max (multiply by large number to preserve precision)
  // Using 10^6 gives us 6 decimal places of precision
  let fixedPoint = u32(value * 1000000.0);
  atomicMax(&postBlurMaxValue[0], fixedPoint);
}

/**
 * Normalize the blurred density grid to [0, 1] range in-place.
 * This ensures thresholds work correctly after blur reduces peak values.
 */
@compute @workgroup_size(256)
fn normalizeSmoothed(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let idx = globalId.x;
  let totalCells = postBlurUniforms.gridWidth * postBlurUniforms.gridHeight;

  if (idx >= totalCells) {
    return;
  }

  // Read max value (stored as fixed-point)
  let maxFixed = f32(atomicLoad(&postBlurMaxValue[0]));
  let maxVal = maxFixed / 1000000.0;

  let value = smoothedGrid[idx];

  // Normalize to [0, 1] and write back
  if (maxVal > 0.0) {
    smoothedGrid[idx] = value / maxVal;
  }
}

// ============================================================================
// Threshold-based fill shader
// Renders filled contours by computing per-pixel alpha from density levels
// ============================================================================

struct ThresholdFillUniforms {
  width: f32,
  height: f32,
  gridWidth: u32,
  gridHeight: u32,
  numLevels: u32,
  opacity: f32,
  _pad0: u32,
  _pad1: u32,
}

struct ThresholdVertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@group(0) @binding(0) var<uniform> fillUniforms: ThresholdFillUniforms;
@group(0) @binding(1) var<storage, read> fillDensityGrid: array<f32>;
@group(0) @binding(2) var<storage, read> thresholds: array<f32>;
@group(0) @binding(3) var<storage, read> colorLUT: array<vec4<f32>>;

/**
 * Full-screen quad vertex shader for threshold fill.
 */
@vertex
fn vs_threshold(@builtin(vertex_index) vertexIndex: u32) -> ThresholdVertexOutput {
  var output: ThresholdVertexOutput;

  // Full-screen quad (2 triangles, 6 vertices)
  var pos: vec2<f32>;
  var uv: vec2<f32>;

  switch (vertexIndex) {
    case 0u: {
      pos = vec2<f32>(-1.0, 1.0);
      uv = vec2<f32>(0.0, 0.0);
    }
    case 1u: {
      pos = vec2<f32>(-1.0, -1.0);
      uv = vec2<f32>(0.0, 1.0);
    }
    case 2u: {
      pos = vec2<f32>(1.0, 1.0);
      uv = vec2<f32>(1.0, 0.0);
    }
    case 3u: {
      pos = vec2<f32>(1.0, 1.0);
      uv = vec2<f32>(1.0, 0.0);
    }
    case 4u: {
      pos = vec2<f32>(-1.0, -1.0);
      uv = vec2<f32>(0.0, 1.0);
    }
    case 5u: {
      pos = vec2<f32>(1.0, -1.0);
      uv = vec2<f32>(1.0, 1.0);
    }
    default: {
      pos = vec2<f32>(0.0, 0.0);
      uv = vec2<f32>(0.0, 0.0);
    }
  }

  output.position = vec4<f32>(pos, 0.0, 1.0);
  output.uv = uv;
  return output;
}

/**
 * Sample density at UV with bilinear interpolation.
 */
fn sampleDensityAtUV(uv: vec2<f32>) -> f32 {
  // Map UV to grid coordinates (flip Y: UV y=0 is top, grid y=0 is bottom)
  let gx = uv.x * f32(fillUniforms.gridWidth - 1u);
  let gy = (1.0 - uv.y) * f32(fillUniforms.gridHeight - 1u);

  let x0 = u32(floor(gx));
  let y0 = u32(floor(gy));
  let x1 = min(x0 + 1u, fillUniforms.gridWidth - 1u);
  let y1 = min(y0 + 1u, fillUniforms.gridHeight - 1u);

  let fx = fract(gx);
  let fy = fract(gy);

  let d00 = fillDensityGrid[y0 * fillUniforms.gridWidth + x0];
  let d10 = fillDensityGrid[y0 * fillUniforms.gridWidth + x1];
  let d01 = fillDensityGrid[y1 * fillUniforms.gridWidth + x0];
  let d11 = fillDensityGrid[y1 * fillUniforms.gridWidth + x1];

  // Bilinear interpolation
  let d0 = mix(d00, d10, fx);
  let d1 = mix(d01, d11, fx);
  return mix(d0, d1, fy);
}

/**
 * Find which threshold level the density exceeds.
 * Returns -1 if below all thresholds.
 */
fn findLevelForDensity(density: f32) -> i32 {
  var level: i32 = -1;
  for (var i = 0u; i < fillUniforms.numLevels; i++) {
    if (density >= thresholds[i]) {
      level = i32(i);
    }
  }
  return level;
}

/**
 * Fragment shader for threshold-based fill.
 */
@fragment
fn fs_threshold(input: ThresholdVertexOutput) -> @location(0) vec4<f32> {
  let density = sampleDensityAtUV(input.uv);
  let level = findLevelForDensity(density);

  if (level < 0) {
    return vec4<f32>(0.0, 0.0, 0.0, 0.0);
  }

  let color = colorLUT[level];
  return vec4<f32>(color.rgb, color.a * fillUniforms.opacity);
}
