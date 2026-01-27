/**
 * GPU-accelerated heatmap density computation using WebGPU.
 * Matches CPU implementation exactly using true Gaussian blur.
 */

import type { HeatmapGPUContext } from "../types";
import shaderSource from "./heatmap.wgsl?raw";

const UNIFORM_BUFFER_SIZE = 32; // 8 u32/f32 fields = 32 bytes

/**
 * Build normalized 1D Gaussian kernel (matches CPU implementation).
 */
function buildGaussianKernel(sigma: number): Float32Array {
  const radius = Math.ceil(3 * sigma);
  const size = radius * 2 + 1;
  const kernel = new Float32Array(size);

  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + radius] = v;
    sum += v;
  }
  // Normalize
  for (let i = 0; i < size; i++) {
    kernel[i] /= sum;
  }

  return kernel;
}

/**
 * Convert number[][] to Float32Array.
 */
function normalizeToFloat32Array(points: number[][] | Float32Array): Float32Array {
  if (points instanceof Float32Array) {
    return points;
  }
  const result = new Float32Array(points.length * 2);
  for (let i = 0; i < points.length; i++) {
    result[i * 2] = points[i][0];
    result[i * 2 + 1] = points[i][1];
  }
  return result;
}

interface HeatmapGPUContextInternal extends HeatmapGPUContext {
  binningPipeline: GPUComputePipeline;
  histogramToFloatPipeline: GPUComputePipeline;
  blurHPipeline: GPUComputePipeline;
  blurVPipeline: GPUComputePipeline;
  findMaxPipeline: GPUComputePipeline;
  normalizePipeline: GPUComputePipeline;
  uniformBuffer: GPUBuffer;
}

/**
 * Initialize GPU context for heatmap computation.
 * Can be reused across multiple computeHeatmapGPU calls.
 */
export async function initHeatmapGPU(): Promise<HeatmapGPUContext> {
  if (!navigator.gpu) {
    throw new Error("WebGPU is not supported in this browser");
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error("Failed to get WebGPU adapter");
  }

  const device = await adapter.requestDevice();

  // Create shader module
  const shaderModule = device.createShaderModule({
    label: "Heatmap Shader",
    code: shaderSource,
  });

  // Create bind group layouts
  const binningLayout = device.createBindGroupLayout({
    label: "Heatmap Binning Layout",
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
    ],
  });

  const histogramToFloatLayout = device.createBindGroupLayout({
    label: "Heatmap Histogram To Float Layout",
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
    ],
  });

  const blurLayout = device.createBindGroupLayout({
    label: "Heatmap Blur Layout",
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
    ],
  });

  const findMaxLayout = device.createBindGroupLayout({
    label: "Heatmap Find Max Layout",
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
    ],
  });

  const normalizeLayout = device.createBindGroupLayout({
    label: "Heatmap Normalize Layout",
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
    ],
  });

  // Create pipelines
  const binningPipeline = device.createComputePipeline({
    label: "Heatmap Binning Pipeline",
    layout: device.createPipelineLayout({ bindGroupLayouts: [binningLayout] }),
    compute: { module: shaderModule, entryPoint: "binning" },
  });

  const histogramToFloatPipeline = device.createComputePipeline({
    label: "Heatmap Histogram To Float Pipeline",
    layout: device.createPipelineLayout({ bindGroupLayouts: [histogramToFloatLayout] }),
    compute: { module: shaderModule, entryPoint: "histogramToFloat" },
  });

  const blurHPipeline = device.createComputePipeline({
    label: "Heatmap Blur H Pipeline",
    layout: device.createPipelineLayout({ bindGroupLayouts: [blurLayout] }),
    compute: { module: shaderModule, entryPoint: "gaussianBlurH" },
  });

  const blurVPipeline = device.createComputePipeline({
    label: "Heatmap Blur V Pipeline",
    layout: device.createPipelineLayout({ bindGroupLayouts: [blurLayout] }),
    compute: { module: shaderModule, entryPoint: "gaussianBlurV" },
  });

  const findMaxPipeline = device.createComputePipeline({
    label: "Heatmap Find Max Pipeline",
    layout: device.createPipelineLayout({ bindGroupLayouts: [findMaxLayout] }),
    compute: { module: shaderModule, entryPoint: "findMax" },
  });

  const normalizePipeline = device.createComputePipeline({
    label: "Heatmap Normalize Pipeline",
    layout: device.createPipelineLayout({ bindGroupLayouts: [normalizeLayout] }),
    compute: { module: shaderModule, entryPoint: "normalize" },
  });

  // Create uniform buffer
  const uniformBuffer = device.createBuffer({
    label: "Heatmap Uniforms",
    size: UNIFORM_BUFFER_SIZE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const context: HeatmapGPUContextInternal = {
    device,
    binningPipeline,
    histogramToFloatPipeline,
    blurHPipeline,
    blurVPipeline,
    findMaxPipeline,
    normalizePipeline,
    uniformBuffer,
    destroy() {
      uniformBuffer.destroy();
      device.destroy();
    },
  };

  return context;
}

/**
 * Compute heatmap density using GPU.
 * Matches CPU implementation exactly.
 *
 * @param points - Array of [x, y] points or Float32Array
 * @param domain - Domain bounds [xMin, xMax, yMin, yMax]
 * @param resolution - Grid resolution (cells per axis)
 * @param bandwidth - KDE bandwidth (sigma for Gaussian)
 * @param context - Optional GPU context (created if not provided)
 * @returns Promise<Float32Array> - Normalized density [0, 1]
 */
export async function computeHeatmapGPU(
  points: number[][] | Float32Array,
  domain: [number, number, number, number],
  resolution: number,
  bandwidth: number,
  context?: HeatmapGPUContext
): Promise<Float32Array> {
  // Get or create context
  let ctx: HeatmapGPUContextInternal;
  let ownContext = false;

  if (context) {
    ctx = context as HeatmapGPUContextInternal;
  } else {
    ctx = (await initHeatmapGPU()) as HeatmapGPUContextInternal;
    ownContext = true;
  }

  const {
    device,
    binningPipeline,
    histogramToFloatPipeline,
    blurHPipeline,
    blurVPipeline,
    findMaxPipeline,
    normalizePipeline,
    uniformBuffer,
  } = ctx;

  const normalizedPoints = normalizeToFloat32Array(points);
  const numPoints = normalizedPoints.length / 2;
  const gridCells = resolution * resolution;
  const [xMin, xMax, yMin, yMax] = domain;

  // Build Gaussian kernel (matches CPU)
  const kernel = buildGaussianKernel(bandwidth);
  const kernelRadius = Math.ceil(3 * bandwidth);

  // Update uniforms
  const uniformData = new ArrayBuffer(UNIFORM_BUFFER_SIZE);
  const view = new DataView(uniformData);
  view.setUint32(0, resolution, true); // gridWidth
  view.setUint32(4, resolution, true); // gridHeight
  view.setUint32(8, numPoints, true); // numPoints
  view.setUint32(12, kernelRadius, true); // kernelRadius
  view.setFloat32(16, xMin, true);
  view.setFloat32(20, xMax, true);
  view.setFloat32(24, yMin, true);
  view.setFloat32(28, yMax, true);
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);

  // Create buffers
  const pointBuffer = device.createBuffer({
    label: "Heatmap Points",
    size: normalizedPoints.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(pointBuffer, 0, normalizedPoints);

  const kernelBuffer = device.createBuffer({
    label: "Heatmap Kernel",
    size: kernel.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(kernelBuffer, 0, kernel);

  const histogramBuffer = device.createBuffer({
    label: "Heatmap Histogram",
    size: gridCells * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(histogramBuffer, 0, new Uint32Array(gridCells));

  const floatGridBuffer = device.createBuffer({
    label: "Heatmap Float Grid",
    size: gridCells * 4,
    usage: GPUBufferUsage.STORAGE,
  });

  const tempBuffer = device.createBuffer({
    label: "Heatmap Temp",
    size: gridCells * 4,
    usage: GPUBufferUsage.STORAGE,
  });

  const outputBuffer = device.createBuffer({
    label: "Heatmap Output",
    size: gridCells * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });

  const maxValueBuffer = device.createBuffer({
    label: "Heatmap Max Value",
    size: 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(maxValueBuffer, 0, new Uint32Array([0]));

  const readbackBuffer = device.createBuffer({
    label: "Heatmap Readback",
    size: gridCells * 4,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });

  // Create bind groups
  const binningBindGroup = device.createBindGroup({
    layout: binningPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: pointBuffer } },
      { binding: 2, resource: { buffer: histogramBuffer } },
    ],
  });

  const histogramToFloatBindGroup = device.createBindGroup({
    layout: histogramToFloatPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: histogramBuffer } },
      { binding: 2, resource: { buffer: floatGridBuffer } },
    ],
  });

  const blurHBindGroup = device.createBindGroup({
    layout: blurHPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: kernelBuffer } },
      { binding: 2, resource: { buffer: floatGridBuffer } },
      { binding: 3, resource: { buffer: tempBuffer } },
    ],
  });

  const blurVBindGroup = device.createBindGroup({
    layout: blurVPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: kernelBuffer } },
      { binding: 2, resource: { buffer: tempBuffer } },
      { binding: 3, resource: { buffer: outputBuffer } },
    ],
  });

  const findMaxBindGroup = device.createBindGroup({
    layout: findMaxPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: outputBuffer } },
      { binding: 2, resource: { buffer: maxValueBuffer } },
    ],
  });

  const normalizeBindGroup = device.createBindGroup({
    layout: normalizePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: outputBuffer } },
      { binding: 2, resource: { buffer: maxValueBuffer } },
    ],
  });

  // Execute compute passes
  const commandEncoder = device.createCommandEncoder();
  const workgroupsPoints = Math.ceil(numPoints / 256);
  const workgroupsGrid = Math.ceil(gridCells / 256);

  // 1. Binning
  const binningPass = commandEncoder.beginComputePass();
  binningPass.setPipeline(binningPipeline);
  binningPass.setBindGroup(0, binningBindGroup);
  binningPass.dispatchWorkgroups(workgroupsPoints);
  binningPass.end();

  // 2. Convert histogram to float
  const convertPass = commandEncoder.beginComputePass();
  convertPass.setPipeline(histogramToFloatPipeline);
  convertPass.setBindGroup(0, histogramToFloatBindGroup);
  convertPass.dispatchWorkgroups(workgroupsGrid);
  convertPass.end();

  // 3. Gaussian blur horizontal
  const blurHPass = commandEncoder.beginComputePass();
  blurHPass.setPipeline(blurHPipeline);
  blurHPass.setBindGroup(0, blurHBindGroup);
  blurHPass.dispatchWorkgroups(workgroupsGrid);
  blurHPass.end();

  // 4. Gaussian blur vertical
  const blurVPass = commandEncoder.beginComputePass();
  blurVPass.setPipeline(blurVPipeline);
  blurVPass.setBindGroup(0, blurVBindGroup);
  blurVPass.dispatchWorkgroups(workgroupsGrid);
  blurVPass.end();

  // 5. Find max
  const findMaxPass = commandEncoder.beginComputePass();
  findMaxPass.setPipeline(findMaxPipeline);
  findMaxPass.setBindGroup(0, findMaxBindGroup);
  findMaxPass.dispatchWorkgroups(workgroupsGrid);
  findMaxPass.end();

  // 6. Normalize
  const normalizePass = commandEncoder.beginComputePass();
  normalizePass.setPipeline(normalizePipeline);
  normalizePass.setBindGroup(0, normalizeBindGroup);
  normalizePass.dispatchWorkgroups(workgroupsGrid);
  normalizePass.end();

  // Copy to readback buffer
  commandEncoder.copyBufferToBuffer(outputBuffer, 0, readbackBuffer, 0, gridCells * 4);

  device.queue.submit([commandEncoder.finish()]);

  // Read back result
  await readbackBuffer.mapAsync(GPUMapMode.READ);
  const result = new Float32Array(readbackBuffer.getMappedRange().slice(0));
  readbackBuffer.unmap();

  // Cleanup buffers
  pointBuffer.destroy();
  kernelBuffer.destroy();
  histogramBuffer.destroy();
  floatGridBuffer.destroy();
  tempBuffer.destroy();
  outputBuffer.destroy();
  maxValueBuffer.destroy();
  readbackBuffer.destroy();

  // Destroy context if we created it
  if (ownContext) {
    ctx.destroy();
  }

  return result;
}
