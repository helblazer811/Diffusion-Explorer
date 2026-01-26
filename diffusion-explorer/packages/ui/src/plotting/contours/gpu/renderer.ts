/**
 * GPU-accelerated contour rendering using WebGPU.
 *
 * This renderer uses a fully GPU-resident pipeline:
 * 1. Histogram binning (GPU compute with atomics)
 * 2. Gaussian blur (GPU compute, separable)
 * 3. Marching squares (GPU compute, fixed allocation)
 * 4. Stencil-based fill rendering (GPU render)
 * 5. Framebuffer caching for fast redraws
 *
 * No GPU→CPU readbacks except for optional timing queries.
 */

import type {
  ContourRendererOptions,
  ContourRenderStyle,
  ContourGPUData,
  WebGPUContext,
  ContourPipelineTimings,
  ContourSegment,
} from './types';
import {
  CONTOUR_SEGMENT_FLOATS,
  COMPUTE_UNIFORM_BUFFER_SIZE,
  RENDER_UNIFORM_BUFFER_SIZE,
} from './types';
import type { ContourDomain, RGBAColor, ColorScaleFn } from '../types';
import { defaultColorScale } from '../types';

import densityShaderSource from './density.wgsl?raw';
import marchingSquaresShaderSource from './marching-squares.wgsl?raw';
import stencilShaderSource from './stencil.wgsl?raw';

// Default options
const DEFAULT_GRID_SIZE = 100;
const DEFAULT_BLUR_RADIUS = 10;
const DEFAULT_NUM_LEVELS = 10;
const DEFAULT_OPACITY = 1.0;

/**
 * Generate Gaussian kernel weights.
 * Returns array where kernel[0] is center, kernel[i] is weight at offset i.
 */
function generateGaussianKernel(radius: number, sigma?: number): Float32Array {
  const effectiveSigma = sigma ?? radius / 3;
  const kernel = new Float32Array(radius + 1);

  let sum = 0;
  for (let i = 0; i <= radius; i++) {
    const weight = Math.exp(-(i * i) / (2 * effectiveSigma * effectiveSigma));
    kernel[i] = weight;
    // Count twice for symmetry (except center)
    sum += i === 0 ? weight : 2 * weight;
  }

  // Normalize
  for (let i = 0; i <= radius; i++) {
    kernel[i] /= sum;
  }

  return kernel;
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

  // Add 10% padding
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
export class ContourRenderer {
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
  private marchingSquaresPipeline: GPUComputePipeline;

  // Render pipelines
  private stencilPipeline: GPURenderPipeline;
  private fillPipeline: GPURenderPipeline;
  private blitPipeline: GPURenderPipeline;

  // Buffers
  private computeUniformBuffer: GPUBuffer;
  private renderUniformBuffer: GPUBuffer;
  private kernelBuffer: GPUBuffer;
  private thresholdBuffer: GPUBuffer;

  // Per-data buffers (recreated when data changes)
  private pointBuffer: GPUBuffer | null = null;
  private histogramGridBuffer: GPUBuffer | null = null;  // u32 for atomic binning
  private maxValueBuffer: GPUBuffer | null = null;  // u32 for atomic max
  private densityGridBuffer: GPUBuffer | null = null;  // f32 normalized density
  private tempGridBuffer: GPUBuffer | null = null;
  private smoothedGridBuffer: GPUBuffer | null = null;
  private segmentBuffer: GPUBuffer | null = null;

  // Textures
  private cachedTexture: GPUTexture | null = null;
  private stencilTexture: GPUTexture | null = null;
  private blitSampler: GPUSampler;

  // Bind groups
  private binningBindGroup: GPUBindGroup | null = null;
  private findMaxBindGroup: GPUBindGroup | null = null;
  private normalizeBindGroup: GPUBindGroup | null = null;
  private blurHBindGroup: GPUBindGroup | null = null;
  private blurVBindGroup: GPUBindGroup | null = null;
  private findMaxSmoothedBindGroup: GPUBindGroup | null = null;
  private normalizeSmoothedBindGroup: GPUBindGroup | null = null;
  private marchingSquaresBindGroup: GPUBindGroup | null = null;
  private stencilBindGroup: GPUBindGroup | null = null;
  private fillBindGroup: GPUBindGroup | null = null;
  private blitBindGroup: GPUBindGroup | null = null;

  // State
  private canvasWidth: number;
  private canvasHeight: number;
  private dpr: number;
  private gridSize: number;
  private blurRadius: number;
  private numLevels: number;
  private colorScale: ColorScaleFn;
  private opacity: number;

  private domain: ContourDomain | null = null;
  private numPoints = 0;
  private isDataDirty = true;
  private isCacheDirty = true;

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
    marchingSquaresPipeline: GPUComputePipeline,
    stencilPipeline: GPURenderPipeline,
    fillPipeline: GPURenderPipeline,
    blitPipeline: GPURenderPipeline,
    computeUniformBuffer: GPUBuffer,
    renderUniformBuffer: GPUBuffer,
    kernelBuffer: GPUBuffer,
    thresholdBuffer: GPUBuffer,
    blitSampler: GPUSampler,
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
    this.marchingSquaresPipeline = marchingSquaresPipeline;
    this.stencilPipeline = stencilPipeline;
    this.fillPipeline = fillPipeline;
    this.blitPipeline = blitPipeline;
    this.computeUniformBuffer = computeUniformBuffer;
    this.renderUniformBuffer = renderUniformBuffer;
    this.kernelBuffer = kernelBuffer;
    this.thresholdBuffer = thresholdBuffer;
    this.blitSampler = blitSampler;
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;

    this.dpr = options.dpr ?? (typeof window !== 'undefined' ? window.devicePixelRatio : 1) ?? 1;
    this.gridSize = options.gridSize ?? DEFAULT_GRID_SIZE;
    this.blurRadius = options.blurRadius ?? DEFAULT_BLUR_RADIUS;
    this.numLevels = options.numLevels ?? DEFAULT_NUM_LEVELS;
    this.colorScale = options.colorScale ?? defaultColorScale;
    this.opacity = options.opacity ?? DEFAULT_OPACITY;
  }

  /**
   * Create a new ContourRenderer.
   */
  static async create(
    canvas: HTMLCanvasElement,
    options: ContourRendererOptions = {},
    gpuContext?: WebGPUContext
  ): Promise<ContourRenderer> {
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
      code: densityShaderSource,
    });
    const marchingSquaresModule = device.createShaderModule({
      label: 'Contour Marching Squares Shader',
      code: marchingSquaresShaderSource,
    });
    const stencilModule = device.createShaderModule({
      label: 'Contour Stencil Shader',
      code: stencilShaderSource,
    });

    // Create compute bind group layout
    const computeBindGroupLayout = device.createBindGroupLayout({
      label: 'Contour Compute Bind Group Layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      ],
    });

    const computePipelineLayout = device.createPipelineLayout({
      label: 'Contour Compute Pipeline Layout',
      bindGroupLayouts: [computeBindGroupLayout],
    });

    // Create binning-specific bind group layout (output is storage with u32 atomics)
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

    // Create normalize bind group layout (reads u32 histogram, writes f32 density, uses atomic max)
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
      label: 'Contour Blur Horizontal Pipeline',
      layout: computePipelineLayout,
      compute: { module: densityModule, entryPoint: 'blurHorizontal' },
    });

    const blurVPipeline = device.createComputePipeline({
      label: 'Contour Blur Vertical Pipeline',
      layout: computePipelineLayout,
      compute: { module: densityModule, entryPoint: 'blurVertical' },
    });

    // Create post-blur normalization bind group layout
    // This reads from smoothedGrid (f32) and writes back to it after finding max
    const postBlurNormalizeBindGroupLayout = device.createBindGroupLayout({
      label: 'Contour Post-Blur Normalize Bind Group Layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } }, // unused placeholder (f32)
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }, // smoothedGrid (read/write f32)
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }, // maxValue atomic (u32)
      ],
    });

    const postBlurNormalizePipelineLayout = device.createPipelineLayout({
      label: 'Contour Post-Blur Normalize Pipeline Layout',
      bindGroupLayouts: [postBlurNormalizeBindGroupLayout],
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

    const marchingSquaresPipeline = device.createComputePipeline({
      label: 'Contour Marching Squares Pipeline',
      layout: computePipelineLayout,
      compute: { module: marchingSquaresModule, entryPoint: 'main' },
    });

    // Create stencil render bind group layout
    const stencilBindGroupLayout = device.createBindGroupLayout({
      label: 'Contour Stencil Bind Group Layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      ],
    });

    const stencilPipelineLayout = device.createPipelineLayout({
      label: 'Contour Stencil Pipeline Layout',
      bindGroupLayouts: [stencilBindGroupLayout],
    });

    // Create stencil pipeline
    const stencilPipeline = device.createRenderPipeline({
      label: 'Contour Stencil Pipeline',
      layout: stencilPipelineLayout,
      vertex: { module: stencilModule, entryPoint: 'vs_stencil' },
      fragment: {
        module: stencilModule,
        entryPoint: 'fs_stencil',
        targets: [{ format, writeMask: 0 }],  // Don't write to color, only stencil
      },
      depthStencil: {
        format: 'stencil8',
        stencilFront: {
          compare: 'always',
          failOp: 'keep',
          depthFailOp: 'keep',
          passOp: 'invert',  // XOR mode for scanline fill
        },
        stencilBack: {
          compare: 'always',
          failOp: 'keep',
          depthFailOp: 'keep',
          passOp: 'invert',
        },
        stencilWriteMask: 0x01,
      },
      primitive: { topology: 'triangle-list' },
    });

    // Create fill pipeline (uses stencil test)
    const fillPipeline = device.createRenderPipeline({
      label: 'Contour Fill Pipeline',
      layout: stencilPipelineLayout,
      vertex: { module: stencilModule, entryPoint: 'vs_fill' },
      fragment: {
        module: stencilModule,
        entryPoint: 'fs_fill',
        targets: [{
          format,
          blend: {
            // Alpha compositing: overlapping regions accumulate saturation
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      depthStencil: {
        format: 'stencil8',
        stencilFront: {
          compare: 'equal',  // Only draw where stencil bit 0 is set (== 1)
          failOp: 'keep',
          depthFailOp: 'keep',
          passOp: 'keep',
        },
        stencilBack: {
          compare: 'equal',
          failOp: 'keep',
          depthFailOp: 'keep',
          passOp: 'keep',
        },
        stencilReadMask: 0x01,
      },
      primitive: { topology: 'triangle-list' },
    });

    // Create blit bind group layout
    const blitBindGroupLayout = device.createBindGroupLayout({
      label: 'Contour Blit Bind Group Layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    });

    const blitPipelineLayout = device.createPipelineLayout({
      label: 'Contour Blit Pipeline Layout',
      bindGroupLayouts: [blitBindGroupLayout],
    });

    // Create blit pipeline
    const blitPipeline = device.createRenderPipeline({
      label: 'Contour Blit Pipeline',
      layout: blitPipelineLayout,
      vertex: { module: stencilModule, entryPoint: 'vs_blit' },
      fragment: {
        module: stencilModule,
        entryPoint: 'fs_blit',
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

    const renderUniformBuffer = device.createBuffer({
      label: 'Contour Render Uniforms',
      size: RENDER_UNIFORM_BUFFER_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Create kernel buffer
    const blurRadius = options.blurRadius ?? DEFAULT_BLUR_RADIUS;
    const kernel = generateGaussianKernel(blurRadius);
    const kernelBuffer = device.createBuffer({
      label: 'Contour Blur Kernel',
      size: kernel.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(kernelBuffer, 0, kernel);

    // Create threshold buffer
    const numLevels = options.numLevels ?? DEFAULT_NUM_LEVELS;
    const thresholdBuffer = device.createBuffer({
      label: 'Contour Thresholds',
      size: numLevels * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // Create blit sampler
    const blitSampler = device.createSampler({
      label: 'Contour Blit Sampler',
      magFilter: 'linear',
      minFilter: 'linear',
    });

    return new ContourRenderer(
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
      marchingSquaresPipeline,
      stencilPipeline,
      fillPipeline,
      blitPipeline,
      computeUniformBuffer,
      renderUniformBuffer,
      kernelBuffer,
      thresholdBuffer,
      blitSampler,
      canvas.width,
      canvas.height,
      options
    );
  }

  /**
   * Set point data for contour computation.
   * Points are provided as a flat Float32Array: [x0, y0, x1, y1, ...]
   */
  setPoints(points: Float32Array, domain?: ContourDomain): void {
    this.numPoints = points.length / 2;

    if (this.numPoints === 0) {
      this.pointBuffer = null;
      this.isDataDirty = false;
      this.isCacheDirty = true;
      return;
    }

    // Compute or use provided domain
    this.domain = domain ?? computeDomainFromPoints(points);

    // Destroy old buffers
    this.pointBuffer?.destroy();
    this.histogramGridBuffer?.destroy();
    this.maxValueBuffer?.destroy();
    this.densityGridBuffer?.destroy();
    this.tempGridBuffer?.destroy();
    this.smoothedGridBuffer?.destroy();
    this.segmentBuffer?.destroy();

    // Create point buffer
    this.pointBuffer = this.device.createBuffer({
      label: 'Contour Points',
      size: points.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.pointBuffer, 0, points);

    // Create grid buffers
    const gridCells = this.gridSize * this.gridSize;

    // Histogram buffer (u32 for atomic binning)
    this.histogramGridBuffer = this.device.createBuffer({
      label: 'Contour Histogram Grid',
      size: gridCells * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // Max value buffer for normalization (single u32 atomic)
    this.maxValueBuffer = this.device.createBuffer({
      label: 'Contour Max Value',
      size: 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // Density buffer (f32 normalized values)
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

    // Create segment buffer (fixed allocation: 2 slots per cell per level)
    const cellWidth = this.gridSize - 1;
    const cellHeight = this.gridSize - 1;
    const maxSegmentSlots = cellWidth * cellHeight * this.numLevels * 2;
    this.segmentBuffer = this.device.createBuffer({
      label: 'Contour Segments',
      size: maxSegmentSlots * CONTOUR_SEGMENT_FLOATS * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });

    this.isDataDirty = true;
    this.isCacheDirty = true;
  }

  /**
   * Run the compute pipeline to generate contours.
   */
  private runComputePipeline(): void {
    if (!this.pointBuffer || !this.domain) {
      console.log('[ContourRenderer] runComputePipeline: skipped (no points or domain)');
      return;
    }
    console.log('[ContourRenderer] runComputePipeline: starting...');
    console.log(`  - numPoints: ${this.numPoints}`);
    console.log(`  - gridSize: ${this.gridSize}`);
    console.log(`  - numLevels: ${this.numLevels}`);
    console.log(`  - domain: [${this.domain.xMin}, ${this.domain.xMax}] x [${this.domain.yMin}, ${this.domain.yMax}]`);

    // Update compute uniforms
    const uniformData = new ArrayBuffer(COMPUTE_UNIFORM_BUFFER_SIZE);
    const uniformView = new DataView(uniformData);
    uniformView.setUint32(0, this.gridSize, true);  // gridWidth
    uniformView.setUint32(4, this.gridSize, true);  // gridHeight
    uniformView.setUint32(8, this.numLevels, true);  // numLevels
    uniformView.setUint32(12, this.numPoints, true);  // numPoints
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

    // Update thresholds (evenly spaced, will be adjusted after blur)
    // For now, use placeholder values that will be normalized after binning
    const thresholds = new Float32Array(this.numLevels);
    for (let i = 0; i < this.numLevels; i++) {
      // Threshold at (i+1)/(numLevels+1) of the range
      thresholds[i] = (i + 1) / (this.numLevels + 1);
    }
    this.device.queue.writeBuffer(this.thresholdBuffer, 0, thresholds);

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
        { binding: 2, resource: { buffer: this.densityGridBuffer! } },  // Unused in findMax
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

    this.blurHBindGroup = this.device.createBindGroup({
      label: 'Contour Blur H Bind Group',
      layout: this.blurHPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.computeUniformBuffer } },
        { binding: 1, resource: { buffer: this.densityGridBuffer! } },
        { binding: 2, resource: { buffer: this.tempGridBuffer! } },
        { binding: 3, resource: { buffer: this.kernelBuffer } },
      ],
    });

    this.blurVBindGroup = this.device.createBindGroup({
      label: 'Contour Blur V Bind Group',
      layout: this.blurVPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.computeUniformBuffer } },
        { binding: 1, resource: { buffer: this.tempGridBuffer! } },
        { binding: 2, resource: { buffer: this.smoothedGridBuffer! } },
        { binding: 3, resource: { buffer: this.kernelBuffer } },
      ],
    });

    // Post-blur normalization bind groups
    // These use smoothedGridBuffer for both reading and writing (in-place normalization)
    this.findMaxSmoothedBindGroup = this.device.createBindGroup({
      label: 'Contour Find Max Smoothed Bind Group',
      layout: this.findMaxSmoothedPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.computeUniformBuffer } },
        { binding: 1, resource: { buffer: this.tempGridBuffer! } },  // unused placeholder
        { binding: 2, resource: { buffer: this.smoothedGridBuffer! } },
        { binding: 3, resource: { buffer: this.maxValueBuffer! } },
      ],
    });

    this.normalizeSmoothedBindGroup = this.device.createBindGroup({
      label: 'Contour Normalize Smoothed Bind Group',
      layout: this.normalizeSmoothedPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.computeUniformBuffer } },
        { binding: 1, resource: { buffer: this.tempGridBuffer! } },  // unused placeholder
        { binding: 2, resource: { buffer: this.smoothedGridBuffer! } },
        { binding: 3, resource: { buffer: this.maxValueBuffer! } },
      ],
    });

    this.marchingSquaresBindGroup = this.device.createBindGroup({
      label: 'Contour Marching Squares Bind Group',
      layout: this.marchingSquaresPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.computeUniformBuffer } },
        { binding: 1, resource: { buffer: this.smoothedGridBuffer! } },
        { binding: 2, resource: { buffer: this.segmentBuffer! } },
        { binding: 3, resource: { buffer: this.thresholdBuffer } },
      ],
    });

    // Execute compute passes
    const commandEncoder = this.device.createCommandEncoder();

    // Pass 1: Binning
    console.log('[ContourRenderer] Pass 1: Binning...');
    console.log(`  - workgroups: ${Math.ceil(this.numPoints / 256)}`);
    const binningPass = commandEncoder.beginComputePass();
    binningPass.setPipeline(this.binningPipeline);
    binningPass.setBindGroup(0, this.binningBindGroup);
    binningPass.dispatchWorkgroups(Math.ceil(this.numPoints / 256));
    binningPass.end();

    // Pass 2: Find max value
    console.log('[ContourRenderer] Pass 2: Find max...');
    console.log(`  - workgroups: ${Math.ceil(gridCells / 256)}`);
    const findMaxPass = commandEncoder.beginComputePass();
    findMaxPass.setPipeline(this.findMaxPipeline);
    findMaxPass.setBindGroup(0, this.findMaxBindGroup);
    findMaxPass.dispatchWorkgroups(Math.ceil(gridCells / 256));
    findMaxPass.end();

    // Pass 3: Normalize histogram to [0, 1]
    console.log('[ContourRenderer] Pass 3: Normalize...');
    const normalizePass = commandEncoder.beginComputePass();
    normalizePass.setPipeline(this.normalizePipeline);
    normalizePass.setBindGroup(0, this.normalizeBindGroup);
    normalizePass.dispatchWorkgroups(Math.ceil(gridCells / 256));
    normalizePass.end();

    // Pass 4: Horizontal blur
    console.log('[ContourRenderer] Pass 4: Horizontal blur...');
    console.log(`  - workgroups: ${Math.ceil(this.gridSize / 16)} x ${Math.ceil(this.gridSize / 16)}`);
    const blurHPass = commandEncoder.beginComputePass();
    blurHPass.setPipeline(this.blurHPipeline);
    blurHPass.setBindGroup(0, this.blurHBindGroup);
    blurHPass.dispatchWorkgroups(
      Math.ceil(this.gridSize / 16),
      Math.ceil(this.gridSize / 16)
    );
    blurHPass.end();

    // Pass 5: Vertical blur
    console.log('[ContourRenderer] Pass 5: Vertical blur...');
    const blurVPass = commandEncoder.beginComputePass();
    blurVPass.setPipeline(this.blurVPipeline);
    blurVPass.setBindGroup(0, this.blurVBindGroup);
    blurVPass.dispatchWorkgroups(
      Math.ceil(this.gridSize / 16),
      Math.ceil(this.gridSize / 16)
    );
    blurVPass.end();

    // Submit blur passes first, then clear max value buffer for re-use
    this.device.queue.submit([commandEncoder.finish()]);

    // Clear max value buffer before post-blur normalization
    this.device.queue.writeBuffer(this.maxValueBuffer!, 0, new Uint32Array([0]));

    // Create new command encoder for post-blur normalization
    const postBlurEncoder = this.device.createCommandEncoder();

    // Pass 6: Find max of smoothed grid
    console.log('[ContourRenderer] Pass 6: Find max smoothed...');
    const findMaxSmoothedPass = postBlurEncoder.beginComputePass();
    findMaxSmoothedPass.setPipeline(this.findMaxSmoothedPipeline);
    findMaxSmoothedPass.setBindGroup(0, this.findMaxSmoothedBindGroup!);
    findMaxSmoothedPass.dispatchWorkgroups(Math.ceil(gridCells / 256));
    findMaxSmoothedPass.end();

    // Pass 7: Normalize smoothed grid to [0, 1]
    console.log('[ContourRenderer] Pass 7: Normalize smoothed...');
    const normalizeSmoothedPass = postBlurEncoder.beginComputePass();
    normalizeSmoothedPass.setPipeline(this.normalizeSmoothedPipeline);
    normalizeSmoothedPass.setBindGroup(0, this.normalizeSmoothedBindGroup!);
    normalizeSmoothedPass.dispatchWorkgroups(Math.ceil(gridCells / 256));
    normalizeSmoothedPass.end();

    this.device.queue.submit([postBlurEncoder.finish()]);

    // Create another command encoder for marching squares
    const msEncoder = this.device.createCommandEncoder();

    // Pass 8: Marching squares
    const cellWidth = this.gridSize - 1;
    const cellHeight = this.gridSize - 1;

    // Clear segment buffer before marching squares (buffer may contain garbage or stale data)
    console.log('[ContourRenderer] Clearing segment buffer...');
    const segmentBufferSize = this.segmentBuffer!.size;
    const zeroData = new Float32Array(segmentBufferSize / 4);
    this.device.queue.writeBuffer(this.segmentBuffer!, 0, zeroData);

    console.log('[ContourRenderer] Pass 8: Marching squares...');
    console.log(`  - workgroups: ${Math.ceil(cellWidth / 8)} x ${Math.ceil(cellHeight / 8)} x ${this.numLevels}`);
    const msPass = msEncoder.beginComputePass();
    msPass.setPipeline(this.marchingSquaresPipeline);
    msPass.setBindGroup(0, this.marchingSquaresBindGroup);
    msPass.dispatchWorkgroups(
      Math.ceil(cellWidth / 8),
      Math.ceil(cellHeight / 8),
      this.numLevels
    );
    msPass.end();

    console.log('[ContourRenderer] Submitting marching squares command buffer...');
    this.device.queue.submit([msEncoder.finish()]);
    console.log('[ContourRenderer] Compute pipeline complete');

    this.isDataDirty = false;
  }

  /**
   * Render the contours to the cached framebuffer.
   */
  private renderToCache(): void {
    if (!this.segmentBuffer || !this.domain) {
      console.log('[ContourRenderer] renderToCache: skipped (no segments or domain)');
      return;
    }
    console.log('[ContourRenderer] renderToCache: starting...');
    console.log(`  - canvasSize: ${this.canvasWidth} x ${this.canvasHeight}`);

    // Create or recreate textures if needed
    if (!this.cachedTexture ||
        this.cachedTexture.width !== this.canvasWidth ||
        this.cachedTexture.height !== this.canvasHeight) {
      this.cachedTexture?.destroy();
      this.stencilTexture?.destroy();

      this.cachedTexture = this.device.createTexture({
        label: 'Contour Cached Texture',
        size: [this.canvasWidth, this.canvasHeight],
        format: this.format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });

      this.stencilTexture = this.device.createTexture({
        label: 'Contour Stencil Texture',
        size: [this.canvasWidth, this.canvasHeight],
        format: 'stencil8',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });

      this.blitBindGroup = this.device.createBindGroup({
        label: 'Contour Blit Bind Group',
        layout: this.blitPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.cachedTexture.createView() },
          { binding: 1, resource: this.blitSampler },
        ],
      });
    }

    const cachedView = this.cachedTexture.createView();
    const stencilView = this.stencilTexture!.createView();

    // Calculate center point for triangle fan (domain center)
    const centerX = 0.5;  // Center of normalized coordinates
    const centerY = 0.5;

    // Create stencil bind group
    this.stencilBindGroup = this.device.createBindGroup({
      label: 'Contour Stencil Bind Group',
      layout: this.stencilPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.renderUniformBuffer } },
        { binding: 1, resource: { buffer: this.segmentBuffer } },
      ],
    });

    this.fillBindGroup = this.device.createBindGroup({
      label: 'Contour Fill Bind Group',
      layout: this.fillPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.renderUniformBuffer } },
        { binding: 1, resource: { buffer: this.segmentBuffer } },
      ],
    });

    const commandEncoder = this.device.createCommandEncoder();

    // Clear the cached texture
    const clearPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: cachedView,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    clearPass.end();

    // Calculate segment count
    const cellWidth = this.gridSize - 1;
    const cellHeight = this.gridSize - 1;
    const maxSegmentSlots = cellWidth * cellHeight * this.numLevels * 2;
    console.log(`[ContourRenderer] maxSegmentSlots: ${maxSegmentSlots}`);

    // Render each contour level (outer to inner for proper layering)
    console.log(`[ContourRenderer] Rendering ${this.numLevels} contour levels...`);
    for (let level = this.numLevels - 1; level >= 0; level--) {
      // Map level to color: inner levels (low level number, rendered last) should have
      // higher t values for more saturated/opaque colors that show on top
      const t = 1 - (level + 1) / (this.numLevels + 1);
      const color = this.colorScale(t);
      console.log(`[ContourRenderer]   Level ${level}: color=(${color[0].toFixed(3)}, ${color[1].toFixed(3)}, ${color[2].toFixed(3)}, ${color[3].toFixed(3)})`);

      // Update render uniforms
      const uniformData = new Float32Array(16);
      uniformData[0] = this.canvasWidth;
      uniformData[1] = this.canvasHeight;
      uniformData[2] = this.dpr;
      uniformData[3] = this.numLevels;
      uniformData[4] = level;  // currentLevel
      uniformData[5] = this.domain.xMin;
      uniformData[6] = this.domain.xMax;
      uniformData[7] = this.domain.yMin;
      uniformData[8] = this.domain.yMax;
      uniformData[9] = this.opacity;
      uniformData[10] = color[0];  // R
      uniformData[11] = color[1];  // G
      uniformData[12] = color[2];  // B
      uniformData[13] = color[3];  // A
      uniformData[14] = centerX;
      uniformData[15] = centerY;
      this.device.queue.writeBuffer(this.renderUniformBuffer, 0, uniformData);

      // Stencil pass: render triangles
      const stencilPass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: cachedView,
          loadOp: 'load',
          storeOp: 'store',
        }],
        depthStencilAttachment: {
          view: stencilView,
          stencilClearValue: 0,
          stencilLoadOp: 'clear',
          stencilStoreOp: 'store',
        },
      });
      stencilPass.setPipeline(this.stencilPipeline);
      stencilPass.setBindGroup(0, this.stencilBindGroup!);
      stencilPass.setStencilReference(1);  // Write 1 to stencil where quads are drawn
      // 6 vertices per quad (2 triangles for scanline fill), maxSegmentSlots instances
      stencilPass.draw(6, maxSegmentSlots, 0, 0);
      stencilPass.end();

      // Fill pass: render full-screen quad where stencil is set
      const fillPass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: cachedView,
          loadOp: 'load',
          storeOp: 'store',
        }],
        depthStencilAttachment: {
          view: stencilView,
          stencilLoadOp: 'load',
          stencilStoreOp: 'store',
        },
      });
      fillPass.setPipeline(this.fillPipeline);
      fillPass.setBindGroup(0, this.fillBindGroup!);
      fillPass.setStencilReference(1);  // Fill where stencil bit 0 == 1 (inside contour)
      fillPass.draw(3, 1, 0, 0);
      fillPass.end();
    }

    console.log('[ContourRenderer] Submitting render command buffer...');
    this.device.queue.submit([commandEncoder.finish()]);
    console.log('[ContourRenderer] renderToCache complete');

    this.isCacheDirty = false;
  }

  /**
   * Render contours to the canvas.
   */
  render(style?: ContourRenderStyle): void {
    console.log('[ContourRenderer] render() called');
    console.log(`  - isDataDirty: ${this.isDataDirty}, isCacheDirty: ${this.isCacheDirty}`);

    // Update options from style
    if (style?.colorScale) this.colorScale = style.colorScale;
    if (style?.opacity !== undefined) this.opacity = style.opacity;
    if (style?.dpr !== undefined) this.dpr = style.dpr;

    // Run compute pipeline if data is dirty
    if (this.isDataDirty) {
      console.log('[ContourRenderer] Data is dirty, running compute pipeline...');
      this.runComputePipeline();
      this.isCacheDirty = true;
    }

    // Render to cache if needed
    if (this.isCacheDirty) {
      console.log('[ContourRenderer] Cache is dirty, rendering to cache...');
      this.renderToCache();
    }

    // Blit cached texture to canvas
    if (!this.blitBindGroup) {
      console.log('[ContourRenderer] No blit bind group, skipping blit');
      return;
    }

    console.log('[ContourRenderer] Blitting cached texture to canvas...');
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
    renderPass.setPipeline(this.blitPipeline);
    renderPass.setBindGroup(0, this.blitBindGroup);
    renderPass.draw(3, 1, 0, 0);
    renderPass.end();

    this.device.queue.submit([commandEncoder.finish()]);
    console.log('[ContourRenderer] render() complete');
  }

  /**
   * Invalidate the cache, forcing a full re-render on next render() call.
   */
  invalidateCache(): void {
    this.isCacheDirty = true;
  }

  /**
   * Update canvas size.
   */
  resize(width: number, height: number, dpr?: number): void {
    this.canvasWidth = width;
    this.canvasHeight = height;
    if (dpr !== undefined) this.dpr = dpr;
    this.isCacheDirty = true;
  }

  /**
   * Update rendering options.
   */
  updateOptions(options: Partial<ContourRendererOptions>): void {
    if (options.gridSize !== undefined && options.gridSize !== this.gridSize) {
      this.gridSize = options.gridSize;
      this.isDataDirty = true;
    }
    if (options.blurRadius !== undefined && options.blurRadius !== this.blurRadius) {
      this.blurRadius = options.blurRadius;
      const kernel = generateGaussianKernel(this.blurRadius);
      this.device.queue.writeBuffer(this.kernelBuffer, 0, kernel);
      this.isDataDirty = true;
    }
    if (options.numLevels !== undefined && options.numLevels !== this.numLevels) {
      this.numLevels = options.numLevels;
      this.isDataDirty = true;
    }
    if (options.colorScale !== undefined) {
      this.colorScale = options.colorScale;
      this.isCacheDirty = true;
    }
    if (options.opacity !== undefined) {
      this.opacity = options.opacity;
      this.isCacheDirty = true;
    }
  }

  /**
   * Get the GPU device.
   */
  getDevice(): GPUDevice {
    return this.device;
  }

  /**
   * Read segments back from GPU for debugging.
   * This is slow (requires GPU→CPU copy) and should only be used for debugging.
   */
  async getSegments(): Promise<ContourSegment[]> {
    if (!this.segmentBuffer) {
      return [];
    }

    // Ensure compute pipeline has run
    if (this.isDataDirty) {
      this.runComputePipeline();
    }

    // Create staging buffer for readback
    const stagingBuffer = this.device.createBuffer({
      label: 'Contour Segments Staging',
      size: this.segmentBuffer.size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    // Copy segment buffer to staging
    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(
      this.segmentBuffer, 0,
      stagingBuffer, 0,
      this.segmentBuffer.size
    );
    this.device.queue.submit([encoder.finish()]);

    // Map and read
    await stagingBuffer.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(stagingBuffer.getMappedRange().slice(0));
    stagingBuffer.unmap();
    stagingBuffer.destroy();

    // Parse into ContourSegment objects
    const segments: ContourSegment[] = [];
    for (let i = 0; i < data.length; i += CONTOUR_SEGMENT_FLOATS) {
      const valid = data[i + 6];
      if (valid > 0.5) {
        segments.push({
          x0: data[i],
          y0: data[i + 1],
          x1: data[i + 2],
          y1: data[i + 3],
          contourLevel: data[i + 4],
          contourIndex: data[i + 5],
          valid: valid,
          _padding: data[i + 7],
        });
      }
    }

    return segments;
  }

  /**
   * Read back the density grid from GPU for debugging/visualization.
   * Returns a Float32Array of size gridSize x gridSize with values in [0, 1].
   * @param postBlur - If true (default), returns the blurred density used by marching squares.
   *                   If false, returns the raw normalized histogram before blur.
   */
  async getDensityGrid(postBlur = true): Promise<{ data: Float32Array; width: number; height: number }> {
    const sourceBuffer = postBlur ? this.smoothedGridBuffer : this.densityGridBuffer;
    if (!sourceBuffer) {
      return { data: new Float32Array(0), width: 0, height: 0 };
    }

    // Ensure compute pipeline has run
    if (this.isDataDirty) {
      this.runComputePipeline();
    }

    // Create staging buffer for readback
    const stagingBuffer = this.device.createBuffer({
      label: 'Contour Density Grid Staging',
      size: sourceBuffer.size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    // Copy density buffer to staging
    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(
      sourceBuffer, 0,
      stagingBuffer, 0,
      sourceBuffer.size
    );
    this.device.queue.submit([encoder.finish()]);

    // Map and read
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
    this.computeUniformBuffer.destroy();
    this.renderUniformBuffer.destroy();
    this.kernelBuffer.destroy();
    this.thresholdBuffer.destroy();
    this.pointBuffer?.destroy();
    this.histogramGridBuffer?.destroy();
    this.maxValueBuffer?.destroy();
    this.densityGridBuffer?.destroy();
    this.tempGridBuffer?.destroy();
    this.smoothedGridBuffer?.destroy();
    this.segmentBuffer?.destroy();
    this.cachedTexture?.destroy();
    this.stencilTexture?.destroy();
  }
}
