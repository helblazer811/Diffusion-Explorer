/**
 * Density field computation: binning, normalization, and blur.
 *
 * Entry points:
 * 1. binning: Bins 2D points into a histogram grid using atomic operations
 * 2. findMax: Finds the maximum count value in the histogram
 * 3. normalize: Converts histogram counts (u32) to normalized density values (f32)
 * 4. blurHorizontal: Horizontal pass of separable Gaussian blur
 * 5. blurVertical: Vertical pass of separable Gaussian blur
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
// Blur pass bindings (separate bind group)
// ============================================================================
@group(0) @binding(0) var<uniform> blurUniforms: Uniforms;
@group(0) @binding(1) var<storage, read> inputGrid: array<f32>;
@group(0) @binding(2) var<storage, read_write> outputGrid: array<f32>;
@group(0) @binding(3) var<storage, read> kernel: array<f32>;  // kernel[0] = center, kernel[i] = offset i

/**
 * Horizontal blur pass.
 * Each thread processes one grid cell.
 */
@compute @workgroup_size(16, 16)
fn blurHorizontal(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let x = globalId.x;
  let y = globalId.y;

  if (x >= blurUniforms.gridWidth || y >= blurUniforms.gridHeight) {
    return;
  }

  let radius = i32(blurUniforms.blurRadius);
  var sum = 0.0;

  // Center weight
  let centerIdx = y * blurUniforms.gridWidth + x;
  sum += inputGrid[centerIdx] * kernel[0];

  // Left and right weights (symmetric kernel)
  for (var i = 1; i <= radius; i++) {
    let leftX = max(0, i32(x) - i);
    let rightX = min(i32(blurUniforms.gridWidth) - 1, i32(x) + i);

    let leftIdx = y * blurUniforms.gridWidth + u32(leftX);
    let rightIdx = y * blurUniforms.gridWidth + u32(rightX);

    let weight = kernel[u32(i)];
    sum += inputGrid[leftIdx] * weight;
    sum += inputGrid[rightIdx] * weight;
  }

  outputGrid[centerIdx] = sum;
}

/**
 * Vertical blur pass.
 * Each thread processes one grid cell.
 */
@compute @workgroup_size(16, 16)
fn blurVertical(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let x = globalId.x;
  let y = globalId.y;

  if (x >= blurUniforms.gridWidth || y >= blurUniforms.gridHeight) {
    return;
  }

  let radius = i32(blurUniforms.blurRadius);
  var sum = 0.0;

  // Center weight
  let centerIdx = y * blurUniforms.gridWidth + x;
  sum += inputGrid[centerIdx] * kernel[0];

  // Top and bottom weights (symmetric kernel)
  for (var i = 1; i <= radius; i++) {
    let topY = max(0, i32(y) - i);
    let bottomY = min(i32(blurUniforms.gridHeight) - 1, i32(y) + i);

    let topIdx = u32(topY) * blurUniforms.gridWidth + x;
    let bottomIdx = u32(bottomY) * blurUniforms.gridWidth + x;

    let weight = kernel[u32(i)];
    sum += inputGrid[topIdx] * weight;
    sum += inputGrid[bottomIdx] * weight;
  }

  outputGrid[centerIdx] = sum;
}
