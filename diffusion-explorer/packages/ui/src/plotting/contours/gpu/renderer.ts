/**
 * GPU-accelerated contour rendering using WebGPU.
 *
 * This renderer uses a fully GPU-resident pipeline:
 * 1. Histogram binning (GPU compute with atomics)
 * 2. Gaussian blur (GPU compute, separable box blur)
 * 3. Threshold-based fill (GPU render, per-pixel alpha from density levels)
 *
 * No GPU→CPU readbacks except for optional debug methods.
 */

import type {
  ContourRendererOptions,
  ContourRenderStyle,
  WebGPUContext,
} from './types';
import {
  COMPUTE_UNIFORM_BUFFER_SIZE,
  THRESHOLD_FILL_UNIFORM_SIZE,
} from './types';
import type { ContourDomain, ColorScaleFn } from '../types';
import { defaultColorScale, normalizeThresholds } from '../types';

import contoursShaderSource from './contours.wgsl?raw';

// Default options
const DEFAULT_GRID_SIZE = 100;
const DEFAULT_BANDWIDTH = 20;
const DEFAULT_OPACITY = 1.0;

/**
 * Convert bandwidth parameter to blur radius using D3's formula.
 */
function bandwidthToBlurRadius(bandwidth: number): number {
  const r = (Math.sqrt(4 * bandwidth * bandwidth + 1) - 1) / 2;
  const pow2k = 0.25;
  return Math.max(1, Math.round(r * pow2k));
}

/**
 * Convert number[][] to Float32Array.
 */
function normalizeToFloat32Array(points: Float32Array | number[][]): Float32Array {
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

/**
 * Compute domain from points with padding.
 */
function computeDomainFromPoints(points: Float32Array): ContourDomain {
  if (points.length < 2) {
    return { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
  }

  let xMin = Infinity, xMax = -Infinity;
  let yMin = Infinity, yMax = -Infinity;

  for (let i = 0; i < points.length; i += 2) {
    const x = points[i];
    const y = points[i + 1];
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }

  const xPad = (xMax - xMin) * 0.1 || 0.1;
  const yPad = (yMax - yMin) * 0.1 || 0.1;

  return {
    xMin: xMin - xPad,
    xMax: xMax + xPad,
    yMin: yMin - yPad,
    yMax: yMax + yPad,
  };
}

/**
 * GPU-accelerated contour renderer.
 */
export class GPUContourRenderer {
  private device: GPUDevice;
  private context: GPUCanvasContext;
  private format: GPUTextureFormat;

  // Compute pipelines
  private binningPipeline: GPUComputePipeline;
  private findMaxPipeline: GPUComputePipeline;
  private normalizePipeline: GPUComputePipeline;
  private blurHPipeline: GPUComputePipeline;
  private blurVPipeline: GPUComputePipeline;
  private findMaxSmoothedPipeline: GPUComputePipeline;
  private normalizeSmoothedPipeline: GPUComputePipeline;

  // Render pipelines
  private thresholdFillPipeline: GPURenderPipeline;

  // Buffers
  private computeUniformBuffer: GPUBuffer;
  private thresholdFillUniformBuffer: GPUBuffer;
  private thresholdBuffer: GPUBuffer;
  private colorLUTBuffer: GPUBuffer;

  // Per-data buffers (recreated when data changes)
  private pointBuffer: GPUBuffer | null = null;
  private histogramGridBuffer: GPUBuffer | null = null;
  private maxValueBuffer: GPUBuffer | null = null;
  private densityGridBuffer: GPUBuffer | null = null;
  private tempGridBuffer: GPUBuffer | null = null;
  private smoothedGridBuffer: GPUBuffer | null = null;

  // Bind groups
  private binningBindGroup: GPUBindGroup | null = null;
  private findMaxBindGroup: GPUBindGroup | null = null;
  private normalizeBindGroup: GPUBindGroup | null = null;
  private blurHBindGroup: GPUBindGroup | null = null;
  private blurVBindGroup: GPUBindGroup | null = null;
  private findMaxSmoothedBindGroup: GPUBindGroup | null = null;
  private normalizeSmoothedBindGroup: GPUBindGroup | null = null;
  private thresholdFillBindGroup: GPUBindGroup | null = null;

  // State
  private canvasWidth: number;
  private canvasHeight: number;
  private dpr: number;
  private gridSize: number;
  private blurRadius: number;
  private thresholds: number[];
  private colorScale: ColorScaleFn;
  private opacity: number;

  private domain: ContourDomain | null = null;
  private numPoints = 0;
  private isDataDirty = true;

  // Multi-frame state
  private pendingFrames: Map<number, { points: Float32Array; domain: ContourDomain }> = new Map();
  private frameBuffers: Map<number, {
    smoothedGridBuffer: GPUBuffer;
    pointBuffer: GPUBuffer;
    histogramGridBuffer: GPUBuffer;
    maxValueBuffer: GPUBuffer;
    densityGridBuffer: GPUBuffer;
    tempGridBuffer: GPUBuffer;
  }> = new Map();

  private constructor(
    device: GPUDevice,
    context: GPUCanvasContext,
    format: GPUTextureFormat,
    binningPipeline: GPUComputePipeline,
    findMaxPipeline: GPUComputePipeline,
    normalizePipeline: GPUComputePipeline,
    blurHPipeline: GPUComputePipeline,
    blurVPipeline: GPUComputePipeline,
    findMaxSmoothedPipeline: GPUComputePipeline,
    normalizeSmoothedPipeline: GPUComputePipeline,
    thresholdFillPipeline: GPURenderPipeline,
    computeUniformBuffer: GPUBuffer,
    thresholdFillUniformBuffer: GPUBuffer,
    thresholdBuffer: GPUBuffer,
    colorLUTBuffer: GPUBuffer,
    canvasWidth: number,
    canvasHeight: number,
    options: ContourRendererOptions
  ) {
    this.device = device;
    this.context = context;
    this.format = format;
    this.binningPipeline = binningPipeline;
    this.findMaxPipeline = findMaxPipeline;
    this.normalizePipeline = normalizePipeline;
    this.blurHPipeline = blurHPipeline;
    this.blurVPipeline = blurVPipeline;
    this.findMaxSmoothedPipeline = findMaxSmoothedPipeline;
    this.normalizeSmoothedPipeline = normalizeSmoothedPipeline;
    this.thresholdFillPipeline = thresholdFillPipeline;
    this.computeUniformBuffer = computeUniformBuffer;
    this.thresholdFillUniformBuffer = thresholdFillUniformBuffer;
    this.thresholdBuffer = thresholdBuffer;
    this.colorLUTBuffer = colorLUTBuffer;
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;

    this.dpr = options.dpr ?? (typeof window !== 'undefined' ? window.devicePixelRatio : 1) ?? 1;
    this.gridSize = options.gridSize ?? DEFAULT_GRID_SIZE;
    this.blurRadius = bandwidthToBlurRadius(options.bandwidth ?? DEFAULT_BANDWIDTH);
    this.thresholds = normalizeThresholds(options.thresholds).values;
    this.colorScale = options.colorScale ?? defaultColorScale;
    this.opacity = options.opacity ?? DEFAULT_OPACITY;
  }

  /**
   * Create a new GPUContourRenderer.
   */
  static async create(
    canvas: HTMLCanvasElement,
    options: ContourRendererOptions = {},
    gpuContext?: WebGPUContext
  ): Promise<GPUContourRenderer> {
    // Get or create device
    let device: GPUDevice;
    if (gpuContext) {
      device = gpuContext.device;
    } else {
      if (!navigator.gpu) {
        throw new Error('WebGPU is not supported in this browser');
      }
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        throw new Error('Failed to get WebGPU adapter');
      }
      device = await adapter.requestDevice();
    }

    // Configure canvas context
    const context = canvas.getContext('webgpu');
    if (!context) {
      throw new Error('Failed to get WebGPU canvas context');
    }

    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
      device,
      format,
      alphaMode: 'premultiplied',
    });

    // Create shader modules
    const densityModule = device.createShaderModule({
      label: 'Contour Density Shader',
      code: contoursShaderSource,
    });
    // Threshold fill shaders are now in density.wgsl
    const thresholdFillModule = densityModule;

    // Create binning bind group layout
    const binningBindGroupLayout = device.createBindGroupLayout({
      label: 'Contour Binning Bind Group Layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });

    const binningPipelineLayout = device.createPipelineLayout({
      label: 'Contour Binning Pipeline Layout',
      bindGroupLayouts: [binningBindGroupLayout],
    });

    // Create normalize bind group layout
    const normalizeBindGroupLayout = device.createBindGroupLayout({
      label: 'Contour Normalize Bind Group Layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });

    const normalizePipelineLayout = device.createPipelineLayout({
      label: 'Contour Normalize Pipeline Layout',
      bindGroupLayouts: [normalizeBindGroupLayout],
    });

    // Create blur bind group layout
    const blurBindGroupLayout = device.createBindGroupLayout({
      label: 'Contour Blur Bind Group Layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });

    const blurPipelineLayout = device.createPipelineLayout({
      label: 'Contour Blur Pipeline Layout',
      bindGroupLayouts: [blurBindGroupLayout],
    });

    // Create post-blur normalization bind group layout
    const postBlurNormalizeBindGroupLayout = device.createBindGroupLayout({
      label: 'Contour Post-Blur Normalize Bind Group Layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });

    const postBlurNormalizePipelineLayout = device.createPipelineLayout({
      label: 'Contour Post-Blur Normalize Pipeline Layout',
      bindGroupLayouts: [postBlurNormalizeBindGroupLayout],
    });

    // Create compute pipelines
    const binningPipeline = device.createComputePipeline({
      label: 'Contour Binning Pipeline',
      layout: binningPipelineLayout,
      compute: { module: densityModule, entryPoint: 'binning' },
    });

    const findMaxPipeline = device.createComputePipeline({
      label: 'Contour Find Max Pipeline',
      layout: normalizePipelineLayout,
      compute: { module: densityModule, entryPoint: 'findMax' },
    });

    const normalizePipeline = device.createComputePipeline({
      label: 'Contour Normalize Pipeline',
      layout: normalizePipelineLayout,
      compute: { module: densityModule, entryPoint: 'normalize' },
    });

    const blurHPipeline = device.createComputePipeline({
      label: 'Contour Box Blur Horizontal Pipeline',
      layout: blurPipelineLayout,
      compute: { module: densityModule, entryPoint: 'boxBlurHorizontal' },
    });

    const blurVPipeline = device.createComputePipeline({
      label: 'Contour Box Blur Vertical Pipeline',
      layout: blurPipelineLayout,
      compute: { module: densityModule, entryPoint: 'boxBlurVertical' },
    });

    const findMaxSmoothedPipeline = device.createComputePipeline({
      label: 'Contour Find Max Smoothed Pipeline',
      layout: postBlurNormalizePipelineLayout,
      compute: { module: densityModule, entryPoint: 'findMaxSmoothed' },
    });

    const normalizeSmoothedPipeline = device.createComputePipeline({
      label: 'Contour Normalize Smoothed Pipeline',
      layout: postBlurNormalizePipelineLayout,
      compute: { module: densityModule, entryPoint: 'normalizeSmoothed' },
    });

    // Create threshold fill bind group layout
    const thresholdFillBindGroupLayout = device.createBindGroupLayout({
      label: 'Contour Threshold Fill Bind Group Layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      ],
    });

    const thresholdFillPipelineLayout = device.createPipelineLayout({
      label: 'Contour Threshold Fill Pipeline Layout',
      bindGroupLayouts: [thresholdFillBindGroupLayout],
    });

    // Create threshold fill pipeline
    const thresholdFillPipeline = device.createRenderPipeline({
      label: 'Contour Threshold Fill Pipeline',
      layout: thresholdFillPipelineLayout,
      vertex: { module: thresholdFillModule, entryPoint: 'vs_threshold' },
      fragment: {
        module: thresholdFillModule,
        entryPoint: 'fs_threshold',
        targets: [{
          format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
    });

    // Create uniform buffers
    const computeUniformBuffer = device.createBuffer({
      label: 'Contour Compute Uniforms',
      size: COMPUTE_UNIFORM_BUFFER_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const thresholdFillUniformBuffer = device.createBuffer({
      label: 'Contour Threshold Fill Uniforms',
      size: THRESHOLD_FILL_UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Create threshold buffer
    const thresholdsArray = normalizeThresholds(options.thresholds).values;
    const numLevels = thresholdsArray.length;
    const thresholdBuffer = device.createBuffer({
      label: 'Contour Thresholds',
      size: numLevels * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // Create color LUT buffer
    const colorLUTBuffer = device.createBuffer({
      label: 'Contour Color LUT',
      size: numLevels * 4 * 4, // numLevels * vec4<f32>
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    return new GPUContourRenderer(
      device,
      context,
      format,
      binningPipeline,
      findMaxPipeline,
      normalizePipeline,
      blurHPipeline,
      blurVPipeline,
      findMaxSmoothedPipeline,
      normalizeSmoothedPipeline,
      thresholdFillPipeline,
      computeUniformBuffer,
      thresholdFillUniformBuffer,
      thresholdBuffer,
      colorLUTBuffer,
      canvas.width,
      canvas.height,
      options
    );
  }

  /**
   * Set point data for contour computation.
   */
  setPoints(points: Float32Array | number[][], domain?: ContourDomain): void {
    const normalizedPoints = normalizeToFloat32Array(points);
    this.numPoints = normalizedPoints.length / 2;

    if (this.numPoints === 0) {
      this.pointBuffer = null;
      this.isDataDirty = false;
      return;
    }

    this.domain = domain ?? computeDomainFromPoints(normalizedPoints);

    // Destroy old buffers
    this.pointBuffer?.destroy();
    this.histogramGridBuffer?.destroy();
    this.maxValueBuffer?.destroy();
    this.densityGridBuffer?.destroy();
    this.tempGridBuffer?.destroy();
    this.smoothedGridBuffer?.destroy();

    // Create point buffer
    this.pointBuffer = this.device.createBuffer({
      label: 'Contour Points',
      size: normalizedPoints.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.pointBuffer, 0, normalizedPoints);

    // Create grid buffers
    const gridCells = this.gridSize * this.gridSize;

    this.histogramGridBuffer = this.device.createBuffer({
      label: 'Contour Histogram Grid',
      size: gridCells * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    this.maxValueBuffer = this.device.createBuffer({
      label: 'Contour Max Value',
      size: 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    this.densityGridBuffer = this.device.createBuffer({
      label: 'Contour Density Grid',
      size: gridCells * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    this.tempGridBuffer = this.device.createBuffer({
      label: 'Contour Temp Grid',
      size: gridCells * 4,
      usage: GPUBufferUsage.STORAGE,
    });

    this.smoothedGridBuffer = this.device.createBuffer({
      label: 'Contour Smoothed Grid',
      size: gridCells * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    this.isDataDirty = true;
  }

  /**
   * Run the compute pipeline to generate density field.
   */
  private runComputePipeline(): void {
    if (!this.pointBuffer || !this.domain) {
      return;
    }

    // Update compute uniforms
    const uniformData = new ArrayBuffer(COMPUTE_UNIFORM_BUFFER_SIZE);
    const uniformView = new DataView(uniformData);
    uniformView.setUint32(0, this.gridSize, true);
    uniformView.setUint32(4, this.gridSize, true);
    uniformView.setUint32(8, this.thresholds.length, true);
    uniformView.setUint32(12, this.numPoints, true);
    uniformView.setFloat32(16, this.domain.xMin, true);
    uniformView.setFloat32(20, this.domain.xMax, true);
    uniformView.setFloat32(24, this.domain.yMin, true);
    uniformView.setFloat32(28, this.domain.yMax, true);
    uniformView.setUint32(32, this.blurRadius, true);
    this.device.queue.writeBuffer(this.computeUniformBuffer, 0, uniformData);

    // Clear histogram grid
    const gridCells = this.gridSize * this.gridSize;
    const clearData = new Uint32Array(gridCells);
    this.device.queue.writeBuffer(this.histogramGridBuffer!, 0, clearData);

    // Clear max value buffer
    this.device.queue.writeBuffer(this.maxValueBuffer!, 0, new Uint32Array([0]));

    // Update thresholds
    const thresholdData = new Float32Array(this.thresholds);
    this.device.queue.writeBuffer(this.thresholdBuffer, 0, thresholdData);

    // Create bind groups
    this.binningBindGroup = this.device.createBindGroup({
      label: 'Contour Binning Bind Group',
      layout: this.binningPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.computeUniformBuffer } },
        { binding: 1, resource: { buffer: this.pointBuffer } },
        { binding: 2, resource: { buffer: this.histogramGridBuffer! } },
      ],
    });

    this.findMaxBindGroup = this.device.createBindGroup({
      label: 'Contour Find Max Bind Group',
      layout: this.findMaxPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.computeUniformBuffer } },
        { binding: 1, resource: { buffer: this.histogramGridBuffer! } },
        { binding: 2, resource: { buffer: this.densityGridBuffer! } },
        { binding: 3, resource: { buffer: this.maxValueBuffer! } },
      ],
    });

    this.normalizeBindGroup = this.device.createBindGroup({
      label: 'Contour Normalize Bind Group',
      layout: this.normalizePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.computeUniformBuffer } },
        { binding: 1, resource: { buffer: this.histogramGridBuffer! } },
        { binding: 2, resource: { buffer: this.densityGridBuffer! } },
        { binding: 3, resource: { buffer: this.maxValueBuffer! } },
      ],
    });

    // Blur bind groups for ping-pong
    this.blurHBindGroup = this.device.createBindGroup({
      label: 'Contour Box Blur H Bind Group (density->temp)',
      layout: this.blurHPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.computeUniformBuffer } },
        { binding: 1, resource: { buffer: this.densityGridBuffer! } },
        { binding: 2, resource: { buffer: this.tempGridBuffer! } },
      ],
    });

    const blurHBindGroupAlt = this.device.createBindGroup({
      label: 'Contour Box Blur H Bind Group (temp->density)',
      layout: this.blurHPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.computeUniformBuffer } },
        { binding: 1, resource: { buffer: this.tempGridBuffer! } },
        { binding: 2, resource: { buffer: this.densityGridBuffer! } },
      ],
    });

    this.blurVBindGroup = this.device.createBindGroup({
      label: 'Contour Box Blur V Bind Group (temp->smoothed)',
      layout: this.blurVPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.computeUniformBuffer } },
        { binding: 1, resource: { buffer: this.tempGridBuffer! } },
        { binding: 2, resource: { buffer: this.smoothedGridBuffer! } },
      ],
    });

    const blurVBindGroupAlt = this.device.createBindGroup({
      label: 'Contour Box Blur V Bind Group (smoothed->temp)',
      layout: this.blurVPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.computeUniformBuffer } },
        { binding: 1, resource: { buffer: this.smoothedGridBuffer! } },
        { binding: 2, resource: { buffer: this.tempGridBuffer! } },
      ],
    });

    this.findMaxSmoothedBindGroup = this.device.createBindGroup({
      label: 'Contour Find Max Smoothed Bind Group',
      layout: this.findMaxSmoothedPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.computeUniformBuffer } },
        { binding: 1, resource: { buffer: this.tempGridBuffer! } },
        { binding: 2, resource: { buffer: this.smoothedGridBuffer! } },
        { binding: 3, resource: { buffer: this.maxValueBuffer! } },
      ],
    });

    this.normalizeSmoothedBindGroup = this.device.createBindGroup({
      label: 'Contour Normalize Smoothed Bind Group',
      layout: this.normalizeSmoothedPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.computeUniformBuffer } },
        { binding: 1, resource: { buffer: this.tempGridBuffer! } },
        { binding: 2, resource: { buffer: this.smoothedGridBuffer! } },
        { binding: 3, resource: { buffer: this.maxValueBuffer! } },
      ],
    });

    // Execute compute passes
    const commandEncoder = this.device.createCommandEncoder();

    // Pass 1: Binning
    const binningPass = commandEncoder.beginComputePass();
    binningPass.setPipeline(this.binningPipeline);
    binningPass.setBindGroup(0, this.binningBindGroup);
    binningPass.dispatchWorkgroups(Math.ceil(this.numPoints / 256));
    binningPass.end();

    // Pass 2: Find max value
    const findMaxPass = commandEncoder.beginComputePass();
    findMaxPass.setPipeline(this.findMaxPipeline);
    findMaxPass.setBindGroup(0, this.findMaxBindGroup);
    findMaxPass.dispatchWorkgroups(Math.ceil(gridCells / 256));
    findMaxPass.end();

    // Pass 3: Normalize histogram
    const normalizePass = commandEncoder.beginComputePass();
    normalizePass.setPipeline(this.normalizePipeline);
    normalizePass.setBindGroup(0, this.normalizeBindGroup);
    normalizePass.dispatchWorkgroups(Math.ceil(gridCells / 256));
    normalizePass.end();

    // Pass 4-6: Horizontal box blur (3 passes)
    const blurWorkgroups = Math.ceil(gridCells / 256);

    const blurH1Pass = commandEncoder.beginComputePass();
    blurH1Pass.setPipeline(this.blurHPipeline);
    blurH1Pass.setBindGroup(0, this.blurHBindGroup);
    blurH1Pass.dispatchWorkgroups(blurWorkgroups);
    blurH1Pass.end();

    const blurH2Pass = commandEncoder.beginComputePass();
    blurH2Pass.setPipeline(this.blurHPipeline);
    blurH2Pass.setBindGroup(0, blurHBindGroupAlt);
    blurH2Pass.dispatchWorkgroups(blurWorkgroups);
    blurH2Pass.end();

    const blurH3Pass = commandEncoder.beginComputePass();
    blurH3Pass.setPipeline(this.blurHPipeline);
    blurH3Pass.setBindGroup(0, this.blurHBindGroup);
    blurH3Pass.dispatchWorkgroups(blurWorkgroups);
    blurH3Pass.end();

    // Pass 7-9: Vertical box blur (3 passes)
    const blurV1Pass = commandEncoder.beginComputePass();
    blurV1Pass.setPipeline(this.blurVPipeline);
    blurV1Pass.setBindGroup(0, this.blurVBindGroup);
    blurV1Pass.dispatchWorkgroups(blurWorkgroups);
    blurV1Pass.end();

    const blurV2Pass = commandEncoder.beginComputePass();
    blurV2Pass.setPipeline(this.blurVPipeline);
    blurV2Pass.setBindGroup(0, blurVBindGroupAlt);
    blurV2Pass.dispatchWorkgroups(blurWorkgroups);
    blurV2Pass.end();

    const blurV3Pass = commandEncoder.beginComputePass();
    blurV3Pass.setPipeline(this.blurVPipeline);
    blurV3Pass.setBindGroup(0, this.blurVBindGroup);
    blurV3Pass.dispatchWorkgroups(blurWorkgroups);
    blurV3Pass.end();

    this.device.queue.submit([commandEncoder.finish()]);

    // Clear max value buffer before post-blur normalization
    this.device.queue.writeBuffer(this.maxValueBuffer!, 0, new Uint32Array([0]));

    // Post-blur normalization
    const postBlurEncoder = this.device.createCommandEncoder();

    const findMaxSmoothedPass = postBlurEncoder.beginComputePass();
    findMaxSmoothedPass.setPipeline(this.findMaxSmoothedPipeline);
    findMaxSmoothedPass.setBindGroup(0, this.findMaxSmoothedBindGroup!);
    findMaxSmoothedPass.dispatchWorkgroups(Math.ceil(gridCells / 256));
    findMaxSmoothedPass.end();

    const normalizeSmoothedPass = postBlurEncoder.beginComputePass();
    normalizeSmoothedPass.setPipeline(this.normalizeSmoothedPipeline);
    normalizeSmoothedPass.setBindGroup(0, this.normalizeSmoothedBindGroup!);
    normalizeSmoothedPass.dispatchWorkgroups(Math.ceil(gridCells / 256));
    normalizeSmoothedPass.end();

    this.device.queue.submit([postBlurEncoder.finish()]);

    this.isDataDirty = false;
  }

  /**
   * Draw contours to the canvas (alias for render).
   */
  draw(): void {
    this.render();
  }

  /**
   * Render contours to the canvas.
   */
  render(style?: ContourRenderStyle): void {
    // Update options from style
    if (style?.colorScale) this.colorScale = style.colorScale;
    if (style?.opacity !== undefined) this.opacity = style.opacity;
    if (style?.dpr !== undefined) this.dpr = style.dpr;

    // Run compute pipeline if data is dirty
    if (this.isDataDirty) {
      this.runComputePipeline();
    }

    if (!this.smoothedGridBuffer || !this.domain) {
      return;
    }

    // Build color LUT from colorScale function (index-based normalization)
    const numLevels = this.thresholds.length;
    const colorLUTData = new Float32Array(numLevels * 4);
    for (let i = 0; i < numLevels; i++) {
      const t = (i + 0.5) / numLevels;
      const color = this.colorScale(t);
      colorLUTData[i * 4 + 0] = color[0];
      colorLUTData[i * 4 + 1] = color[1];
      colorLUTData[i * 4 + 2] = color[2];
      colorLUTData[i * 4 + 3] = color[3];
    }
    this.device.queue.writeBuffer(this.colorLUTBuffer, 0, colorLUTData);

    // Update threshold fill uniforms
    const uniformData = new ArrayBuffer(THRESHOLD_FILL_UNIFORM_SIZE);
    const view = new DataView(uniformData);
    view.setFloat32(0, this.canvasWidth, true);
    view.setFloat32(4, this.canvasHeight, true);
    view.setUint32(8, this.gridSize, true);
    view.setUint32(12, this.gridSize, true);
    view.setUint32(16, numLevels, true);
    view.setFloat32(20, this.opacity, true);
    this.device.queue.writeBuffer(this.thresholdFillUniformBuffer, 0, uniformData);

    // Create threshold fill bind group
    this.thresholdFillBindGroup = this.device.createBindGroup({
      label: 'Contour Threshold Fill Bind Group',
      layout: this.thresholdFillPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.thresholdFillUniformBuffer } },
        { binding: 1, resource: { buffer: this.smoothedGridBuffer } },
        { binding: 2, resource: { buffer: this.thresholdBuffer } },
        { binding: 3, resource: { buffer: this.colorLUTBuffer } },
      ],
    });

    // Render directly to canvas
    const commandEncoder = this.device.createCommandEncoder();
    const textureView = this.context.getCurrentTexture().createView();

    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: textureView,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    renderPass.setPipeline(this.thresholdFillPipeline);
    renderPass.setBindGroup(0, this.thresholdFillBindGroup);
    renderPass.draw(6, 1); // 6 vertices for full-screen quad
    renderPass.end();

    this.device.queue.submit([commandEncoder.finish()]);
  }

  /**
   * Update canvas size.
   */
  resize(width: number, height: number, dpr?: number): void {
    this.canvasWidth = width;
    this.canvasHeight = height;
    if (dpr !== undefined) this.dpr = dpr;
  }

  /**
   * Update the color scale.
   */
  setColorScale(colorScale: ColorScaleFn): void {
    this.colorScale = colorScale;
  }

  /**
   * Update the opacity.
   */
  setOpacity(opacity: number): void {
    this.opacity = opacity;
  }

  // ============================================================================
  // Multi-frame API
  // ============================================================================

  /**
   * Queue points for a specific frame (no computation yet).
   */
  setPointsForFrame(frameIndex: number, points: Float32Array | number[][], domain?: ContourDomain): void {
    const normalizedPoints = normalizeToFloat32Array(points);
    this.pendingFrames.set(frameIndex, {
      points: normalizedPoints,
      domain: domain ?? computeDomainFromPoints(normalizedPoints),
    });
  }

  /**
   * Compute all queued frames in parallel.
   * All compute passes are encoded into a single command buffer for GPU parallelism.
   */
  async computeAllFrames(): Promise<void> {
    if (this.pendingFrames.size === 0) return;

    const gridCells = this.gridSize * this.gridSize;

    // Create buffers and encode compute passes for all frames
    const commandEncoder = this.device.createCommandEncoder();

    for (const [frameIndex, { points, domain }] of this.pendingFrames) {
      // Create buffers for this frame
      const pointBuffer = this.device.createBuffer({
        label: `Contour Points Frame ${frameIndex}`,
        size: points.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(pointBuffer, 0, points);

      const histogramGridBuffer = this.device.createBuffer({
        label: `Contour Histogram Grid Frame ${frameIndex}`,
        size: gridCells * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });

      const maxValueBuffer = this.device.createBuffer({
        label: `Contour Max Value Frame ${frameIndex}`,
        size: 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });

      const densityGridBuffer = this.device.createBuffer({
        label: `Contour Density Grid Frame ${frameIndex}`,
        size: gridCells * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      });

      const tempGridBuffer = this.device.createBuffer({
        label: `Contour Temp Grid Frame ${frameIndex}`,
        size: gridCells * 4,
        usage: GPUBufferUsage.STORAGE,
      });

      const smoothedGridBuffer = this.device.createBuffer({
        label: `Contour Smoothed Grid Frame ${frameIndex}`,
        size: gridCells * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      });

      // Store buffers for later use
      this.frameBuffers.set(frameIndex, {
        smoothedGridBuffer,
        pointBuffer,
        histogramGridBuffer,
        maxValueBuffer,
        densityGridBuffer,
        tempGridBuffer,
      });

      // Clear histogram and max value
      this.device.queue.writeBuffer(histogramGridBuffer, 0, new Uint32Array(gridCells));
      this.device.queue.writeBuffer(maxValueBuffer, 0, new Uint32Array([0]));

      // Update uniforms for this frame
      const uniformData = new ArrayBuffer(COMPUTE_UNIFORM_BUFFER_SIZE);
      const uniformView = new DataView(uniformData);
      uniformView.setUint32(0, this.gridSize, true);
      uniformView.setUint32(4, this.gridSize, true);
      uniformView.setUint32(8, this.thresholds.length, true);
      uniformView.setUint32(12, points.length / 2, true);
      uniformView.setFloat32(16, domain.xMin, true);
      uniformView.setFloat32(20, domain.xMax, true);
      uniformView.setFloat32(24, domain.yMin, true);
      uniformView.setFloat32(28, domain.yMax, true);
      uniformView.setUint32(32, this.blurRadius, true);
      this.device.queue.writeBuffer(this.computeUniformBuffer, 0, uniformData);

      // Create bind groups for this frame
      const binningBindGroup = this.device.createBindGroup({
        layout: this.binningPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.computeUniformBuffer } },
          { binding: 1, resource: { buffer: pointBuffer } },
          { binding: 2, resource: { buffer: histogramGridBuffer } },
        ],
      });

      const findMaxBindGroup = this.device.createBindGroup({
        layout: this.findMaxPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.computeUniformBuffer } },
          { binding: 1, resource: { buffer: histogramGridBuffer } },
          { binding: 2, resource: { buffer: densityGridBuffer } },
          { binding: 3, resource: { buffer: maxValueBuffer } },
        ],
      });

      const normalizeBindGroup = this.device.createBindGroup({
        layout: this.normalizePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.computeUniformBuffer } },
          { binding: 1, resource: { buffer: histogramGridBuffer } },
          { binding: 2, resource: { buffer: densityGridBuffer } },
          { binding: 3, resource: { buffer: maxValueBuffer } },
        ],
      });

      // Blur bind groups
      const blurHBindGroup = this.device.createBindGroup({
        layout: this.blurHPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.computeUniformBuffer } },
          { binding: 1, resource: { buffer: densityGridBuffer } },
          { binding: 2, resource: { buffer: tempGridBuffer } },
        ],
      });

      const blurHBindGroupAlt = this.device.createBindGroup({
        layout: this.blurHPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.computeUniformBuffer } },
          { binding: 1, resource: { buffer: tempGridBuffer } },
          { binding: 2, resource: { buffer: densityGridBuffer } },
        ],
      });

      const blurVBindGroup = this.device.createBindGroup({
        layout: this.blurVPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.computeUniformBuffer } },
          { binding: 1, resource: { buffer: tempGridBuffer } },
          { binding: 2, resource: { buffer: smoothedGridBuffer } },
        ],
      });

      const blurVBindGroupAlt = this.device.createBindGroup({
        layout: this.blurVPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.computeUniformBuffer } },
          { binding: 1, resource: { buffer: smoothedGridBuffer } },
          { binding: 2, resource: { buffer: tempGridBuffer } },
        ],
      });

      const findMaxSmoothedBindGroup = this.device.createBindGroup({
        layout: this.findMaxSmoothedPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.computeUniformBuffer } },
          { binding: 1, resource: { buffer: tempGridBuffer } },
          { binding: 2, resource: { buffer: smoothedGridBuffer } },
          { binding: 3, resource: { buffer: maxValueBuffer } },
        ],
      });

      const normalizeSmoothedBindGroup = this.device.createBindGroup({
        layout: this.normalizeSmoothedPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.computeUniformBuffer } },
          { binding: 1, resource: { buffer: tempGridBuffer } },
          { binding: 2, resource: { buffer: smoothedGridBuffer } },
          { binding: 3, resource: { buffer: maxValueBuffer } },
        ],
      });

      const numPoints = points.length / 2;
      const blurWorkgroups = Math.ceil(gridCells / 256);

      // Encode compute passes for this frame
      const binningPass = commandEncoder.beginComputePass();
      binningPass.setPipeline(this.binningPipeline);
      binningPass.setBindGroup(0, binningBindGroup);
      binningPass.dispatchWorkgroups(Math.ceil(numPoints / 256));
      binningPass.end();

      const findMaxPass = commandEncoder.beginComputePass();
      findMaxPass.setPipeline(this.findMaxPipeline);
      findMaxPass.setBindGroup(0, findMaxBindGroup);
      findMaxPass.dispatchWorkgroups(blurWorkgroups);
      findMaxPass.end();

      const normalizePass = commandEncoder.beginComputePass();
      normalizePass.setPipeline(this.normalizePipeline);
      normalizePass.setBindGroup(0, normalizeBindGroup);
      normalizePass.dispatchWorkgroups(blurWorkgroups);
      normalizePass.end();

      // Box blur passes (3 horizontal, 3 vertical)
      const blurH1 = commandEncoder.beginComputePass();
      blurH1.setPipeline(this.blurHPipeline);
      blurH1.setBindGroup(0, blurHBindGroup);
      blurH1.dispatchWorkgroups(blurWorkgroups);
      blurH1.end();

      const blurH2 = commandEncoder.beginComputePass();
      blurH2.setPipeline(this.blurHPipeline);
      blurH2.setBindGroup(0, blurHBindGroupAlt);
      blurH2.dispatchWorkgroups(blurWorkgroups);
      blurH2.end();

      const blurH3 = commandEncoder.beginComputePass();
      blurH3.setPipeline(this.blurHPipeline);
      blurH3.setBindGroup(0, blurHBindGroup);
      blurH3.dispatchWorkgroups(blurWorkgroups);
      blurH3.end();

      const blurV1 = commandEncoder.beginComputePass();
      blurV1.setPipeline(this.blurVPipeline);
      blurV1.setBindGroup(0, blurVBindGroup);
      blurV1.dispatchWorkgroups(blurWorkgroups);
      blurV1.end();

      const blurV2 = commandEncoder.beginComputePass();
      blurV2.setPipeline(this.blurVPipeline);
      blurV2.setBindGroup(0, blurVBindGroupAlt);
      blurV2.dispatchWorkgroups(blurWorkgroups);
      blurV2.end();

      const blurV3 = commandEncoder.beginComputePass();
      blurV3.setPipeline(this.blurVPipeline);
      blurV3.setBindGroup(0, blurVBindGroup);
      blurV3.dispatchWorkgroups(blurWorkgroups);
      blurV3.end();

      // Post-blur normalization
      this.device.queue.writeBuffer(maxValueBuffer, 0, new Uint32Array([0]));

      const findMaxSmoothedPass = commandEncoder.beginComputePass();
      findMaxSmoothedPass.setPipeline(this.findMaxSmoothedPipeline);
      findMaxSmoothedPass.setBindGroup(0, findMaxSmoothedBindGroup);
      findMaxSmoothedPass.dispatchWorkgroups(blurWorkgroups);
      findMaxSmoothedPass.end();

      const normalizeSmoothedPass = commandEncoder.beginComputePass();
      normalizeSmoothedPass.setPipeline(this.normalizeSmoothedPipeline);
      normalizeSmoothedPass.setBindGroup(0, normalizeSmoothedBindGroup);
      normalizeSmoothedPass.dispatchWorkgroups(blurWorkgroups);
      normalizeSmoothedPass.end();
    }

    // Submit all work at once
    this.device.queue.submit([commandEncoder.finish()]);

    // Wait for all frames to complete
    await this.device.queue.onSubmittedWorkDone();

    this.pendingFrames.clear();
  }

  /**
   * Draw a specific pre-computed frame.
   */
  drawFrame(frameIndex: number): void {
    const frameData = this.frameBuffers.get(frameIndex);
    if (!frameData) return;

    const numLevels = this.thresholds.length;

    // Build color LUT (index-based normalization)
    const colorLUTData = new Float32Array(numLevels * 4);
    for (let i = 0; i < numLevels; i++) {
      const t = (i + 0.5) / numLevels;
      const color = this.colorScale(t);
      colorLUTData[i * 4 + 0] = color[0];
      colorLUTData[i * 4 + 1] = color[1];
      colorLUTData[i * 4 + 2] = color[2];
      colorLUTData[i * 4 + 3] = color[3];
    }
    this.device.queue.writeBuffer(this.colorLUTBuffer, 0, colorLUTData);

    // Update thresholds
    const thresholdData = new Float32Array(this.thresholds);
    this.device.queue.writeBuffer(this.thresholdBuffer, 0, thresholdData);

    // Update threshold fill uniforms
    const uniformData = new ArrayBuffer(THRESHOLD_FILL_UNIFORM_SIZE);
    const view = new DataView(uniformData);
    view.setFloat32(0, this.canvasWidth, true);
    view.setFloat32(4, this.canvasHeight, true);
    view.setUint32(8, this.gridSize, true);
    view.setUint32(12, this.gridSize, true);
    view.setUint32(16, numLevels, true);
    view.setFloat32(20, this.opacity, true);
    this.device.queue.writeBuffer(this.thresholdFillUniformBuffer, 0, uniformData);

    // Create bind group for this frame's smoothed grid
    const bindGroup = this.device.createBindGroup({
      layout: this.thresholdFillPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.thresholdFillUniformBuffer } },
        { binding: 1, resource: { buffer: frameData.smoothedGridBuffer } },
        { binding: 2, resource: { buffer: this.thresholdBuffer } },
        { binding: 3, resource: { buffer: this.colorLUTBuffer } },
      ],
    });

    // Render
    const commandEncoder = this.device.createCommandEncoder();
    const textureView = this.context.getCurrentTexture().createView();

    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: textureView,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    renderPass.setPipeline(this.thresholdFillPipeline);
    renderPass.setBindGroup(0, bindGroup);
    renderPass.draw(6, 1);
    renderPass.end();

    this.device.queue.submit([commandEncoder.finish()]);
  }

  /**
   * Get number of computed frames.
   */
  getFrameCount(): number {
    return this.frameBuffers.size;
  }

  /**
   * Clear all cached frames and release their GPU resources.
   */
  clearFrames(): void {
    for (const frameData of this.frameBuffers.values()) {
      frameData.smoothedGridBuffer.destroy();
      frameData.pointBuffer.destroy();
      frameData.histogramGridBuffer.destroy();
      frameData.maxValueBuffer.destroy();
      frameData.densityGridBuffer.destroy();
      frameData.tempGridBuffer.destroy();
    }
    this.frameBuffers.clear();
    this.pendingFrames.clear();
  }

  /**
   * Update rendering options.
   */
  updateOptions(options: Partial<ContourRendererOptions>): void {
    if (options.gridSize !== undefined && options.gridSize !== this.gridSize) {
      this.gridSize = options.gridSize;
      this.isDataDirty = true;
    }
    if (options.bandwidth !== undefined) {
      const newBlurRadius = bandwidthToBlurRadius(options.bandwidth);
      if (newBlurRadius !== this.blurRadius) {
        this.blurRadius = newBlurRadius;
        this.isDataDirty = true;
      }
    }
    if (options.thresholds !== undefined) {
      const newThresholds = normalizeThresholds(options.thresholds).values;
      const sizeChanged = newThresholds.length !== this.thresholds.length;
      this.thresholds = newThresholds;

      if (sizeChanged) {
        // Recreate threshold and color LUT buffers
        this.thresholdBuffer.destroy();
        this.colorLUTBuffer.destroy();

        this.thresholdBuffer = this.device.createBuffer({
          label: 'Contour Thresholds',
          size: this.thresholds.length * 4,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        this.colorLUTBuffer = this.device.createBuffer({
          label: 'Contour Color LUT',
          size: this.thresholds.length * 4 * 4,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        this.isDataDirty = true;
      }
    }
    if (options.colorScale !== undefined) {
      this.colorScale = options.colorScale;
    }
    if (options.opacity !== undefined) {
      this.opacity = options.opacity;
    }
  }

  /**
   * Get the GPU device.
   */
  getDevice(): GPUDevice {
    return this.device;
  }

  /**
   * Read back the density grid from GPU for debugging/visualization.
   */
  async getDensityGrid(postBlur = true): Promise<{ data: Float32Array; width: number; height: number }> {
    const sourceBuffer = postBlur ? this.smoothedGridBuffer : this.densityGridBuffer;
    if (!sourceBuffer) {
      return { data: new Float32Array(0), width: 0, height: 0 };
    }

    if (this.isDataDirty) {
      this.runComputePipeline();
    }

    const stagingBuffer = this.device.createBuffer({
      label: 'Contour Density Grid Staging',
      size: sourceBuffer.size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(sourceBuffer, 0, stagingBuffer, 0, sourceBuffer.size);
    this.device.queue.submit([encoder.finish()]);

    await stagingBuffer.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(stagingBuffer.getMappedRange().slice(0));
    stagingBuffer.unmap();
    stagingBuffer.destroy();

    return { data, width: this.gridSize, height: this.gridSize };
  }

  /**
   * Destroy the renderer and release resources.
   */
  destroy(): void {
    // Clean up multi-frame buffers
    this.clearFrames();

    // Clean up shared buffers
    this.computeUniformBuffer.destroy();
    this.thresholdFillUniformBuffer.destroy();
    this.thresholdBuffer.destroy();
    this.colorLUTBuffer.destroy();
    this.pointBuffer?.destroy();
    this.histogramGridBuffer?.destroy();
    this.maxValueBuffer?.destroy();
    this.densityGridBuffer?.destroy();
    this.tempGridBuffer?.destroy();
    this.smoothedGridBuffer?.destroy();
  }
}
