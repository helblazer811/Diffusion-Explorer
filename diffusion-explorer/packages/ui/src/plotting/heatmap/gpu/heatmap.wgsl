/**
 * Heatmap GPU Shader
 *
 * Computes density estimation using binning and separable Gaussian blur.
 * Matches CPU implementation exactly.
 *
 * Entry points:
 * 1. binning: Bins 2D points into a histogram grid using atomic operations
 * 2. gaussianBlurH: Horizontal Gaussian blur with kernel weights
 * 3. gaussianBlurV: Vertical Gaussian blur with kernel weights
 * 4. findMax: Finds maximum value in density grid
 * 5. normalize: Normalizes density to [0, 1]
 */

struct Uniforms {
  gridWidth: u32,
  gridHeight: u32,
  numPoints: u32,
  kernelRadius: u32,
  xMin: f32,
  xMax: f32,
  yMin: f32,
  yMax: f32,
}

// ============================================================================
// Binning pass
// ============================================================================
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> points: array<f32>;  // [x0, y0, x1, y1, ...]
@group(0) @binding(2) var<storage, read_write> grid: array<atomic<u32>>;

@compute @workgroup_size(256)
fn binning(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let pointIdx = globalId.x;

  if (pointIdx >= uniforms.numPoints) {
    return;
  }

  let x = points[pointIdx * 2u];
  let y = points[pointIdx * 2u + 1u];

  let xRange = uniforms.xMax - uniforms.xMin;
  let yRange = uniforms.yMax - uniforms.yMin;

  let xNorm = (x - uniforms.xMin) / xRange;
  let yNorm = (y - uniforms.yMin) / yRange;

  let cellX = u32(clamp(xNorm * f32(uniforms.gridWidth - 1u), 0.0, f32(uniforms.gridWidth - 1u)));
  let cellY = u32(clamp(yNorm * f32(uniforms.gridHeight - 1u), 0.0, f32(uniforms.gridHeight - 1u)));

  let gridIdx = cellY * uniforms.gridWidth + cellX;
  atomicAdd(&grid[gridIdx], 1u);
}

// ============================================================================
// Convert histogram to float
// ============================================================================
@group(0) @binding(0) var<uniform> convertUniforms: Uniforms;
@group(0) @binding(1) var<storage, read> histogramGrid: array<u32>;
@group(0) @binding(2) var<storage, read_write> floatGrid: array<f32>;

@compute @workgroup_size(256)
fn histogramToFloat(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let idx = globalId.x;
  let totalCells = convertUniforms.gridWidth * convertUniforms.gridHeight;

  if (idx >= totalCells) {
    return;
  }

  floatGrid[idx] = f32(histogramGrid[idx]);
}

// ============================================================================
// Gaussian blur passes (with kernel weights)
// ============================================================================
@group(0) @binding(0) var<uniform> blurUniforms: Uniforms;
@group(0) @binding(1) var<storage, read> kernel: array<f32>;
@group(0) @binding(2) var<storage, read> inputGrid: array<f32>;
@group(0) @binding(3) var<storage, read_write> outputGrid: array<f32>;

@compute @workgroup_size(256)
fn gaussianBlurH(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let idx = globalId.x;
  let width = blurUniforms.gridWidth;
  let height = blurUniforms.gridHeight;

  if (idx >= width * height) {
    return;
  }

  let y = idx / width;
  let x = idx % width;
  let radius = i32(blurUniforms.kernelRadius);

  var sum = 0.0;
  for (var k = -radius; k <= radius; k++) {
    let sx = i32(x) + k;
    if (sx >= 0 && sx < i32(width)) {
      sum += inputGrid[y * width + u32(sx)] * kernel[k + radius];
    }
  }

  outputGrid[idx] = sum;
}

@compute @workgroup_size(256)
fn gaussianBlurV(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let idx = globalId.x;
  let width = blurUniforms.gridWidth;
  let height = blurUniforms.gridHeight;

  if (idx >= width * height) {
    return;
  }

  let y = idx / width;
  let x = idx % width;
  let radius = i32(blurUniforms.kernelRadius);

  var sum = 0.0;
  for (var k = -radius; k <= radius; k++) {
    let sy = i32(y) + k;
    if (sy >= 0 && sy < i32(height)) {
      sum += inputGrid[u32(sy) * width + x] * kernel[k + radius];
    }
  }

  outputGrid[idx] = sum;
}

// ============================================================================
// Find max pass
// ============================================================================
@group(0) @binding(0) var<uniform> maxUniforms: Uniforms;
@group(0) @binding(1) var<storage, read> densityGrid: array<f32>;
@group(0) @binding(2) var<storage, read_write> maxValue: array<atomic<u32>>;

@compute @workgroup_size(256)
fn findMax(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let idx = globalId.x;
  let totalCells = maxUniforms.gridWidth * maxUniforms.gridHeight;

  if (idx >= totalCells) {
    return;
  }

  let value = densityGrid[idx];
  // Convert to fixed-point for atomic max (multiply by 10^6 for precision)
  let fixedPoint = u32(value * 1000000.0);
  atomicMax(&maxValue[0], fixedPoint);
}

// ============================================================================
// Normalize pass
// ============================================================================
@group(0) @binding(0) var<uniform> normUniforms: Uniforms;
@group(0) @binding(1) var<storage, read_write> normGrid: array<f32>;
@group(0) @binding(2) var<storage, read_write> maxVal: array<atomic<u32>>;

@compute @workgroup_size(256)
fn normalize(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let idx = globalId.x;
  let totalCells = normUniforms.gridWidth * normUniforms.gridHeight;

  if (idx >= totalCells) {
    return;
  }

  let maxFixed = f32(atomicLoad(&maxVal[0]));
  let maxValF = maxFixed / 1000000.0;

  if (maxValF > 0.0) {
    normGrid[idx] = normGrid[idx] / maxValF;
  }
}
