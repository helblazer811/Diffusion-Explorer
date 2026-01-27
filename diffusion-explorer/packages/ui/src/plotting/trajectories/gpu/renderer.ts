/**
 * GPU-accelerated trajectory rendering using WebGPU.
 *
 * This renderer uses:
 * - Instanced rendering: one instance per segment
 * - Depth buffer for time-based z-ordering (more recent segments on top)
 * - Two-pass rendering for outlines (outline pass, then main stroke pass)
 * - Vertex shader: expands segments into quads with rounded cap margins
 * - Fragment shader: SDF for smooth edges, per-segment alpha interpolation
 *
 * Performance characteristics:
 * - GPU buffers are created once and reused
 * - Only uniforms are updated per frame
 * - Suitable for thousands of segments at 60fps
 */

import type {
  GPUTrajectoryStyleOptions,
  GPUTrajectoryData,
} from '../types';
import { parseColor, prepareGPUTrajectoryData } from '../types';
import shaderSource from './trajectory-shader.wgsl?raw';

// Default options
const DEFAULT_THICKNESS = 2.5;
const DEFAULT_OPACITY = 0.8;
const DEFAULT_COLOR = '#3b82f6';
const DEFAULT_POINT_RADIUS = 4;

// Uniform buffer size (must be 16-byte aligned)
// 16 floats * 4 bytes = 64 bytes
const UNIFORM_BUFFER_SIZE = 64;

/**
 * Options for creating a GPU trajectory renderer.
 */
export interface GPUTrajectoryRendererOptions {
  /** Device pixel ratio (default: window.devicePixelRatio) */
  dpr?: number;
}

/**
 * GPU-accelerated trajectory renderer.
 *
 * @example
 * ```typescript
 * const renderer = await GPUTrajectoryRenderer.create(canvas, { dpr: 2 });
 *
 * renderer.setTrajectories(trajectories, segmentIndex, {
 *   strokeWidth: 3,
 *   color: '#ff6b6b',
 *   opacity: 0.9,
 *   pointRadius: 4,
 *   outline: { color: '#000000', width: 5, opacity: 0.5 },
 *   opacityGradient: { mode: 'recency', timeWindow: 0.8 },
 * });
 *
 * renderer.draw();
 * ```
 */
export class GPUTrajectoryRenderer {
  private device: GPUDevice;
  private context: GPUCanvasContext;
  private format: GPUTextureFormat;
  private pipeline: GPURenderPipeline;
  private uniformBuffer: GPUBuffer;
  private segmentBuffer: GPUBuffer | null = null;
  private headBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private headBindGroup: GPUBindGroup | null = null;
  private depthTexture: GPUTexture | null = null;

  private segmentCount = 0;
  private headCount = 0;
  private canvasWidth: number;  // Physical pixels
  private canvasHeight: number; // Physical pixels
  private dpr: number;

  // Cached style options
  private thickness = DEFAULT_THICKNESS;
  private colorR = 0.231;
  private colorG = 0.510;
  private colorB = 0.965;
  private baseOpacity = DEFAULT_OPACITY;
  private outlineThickness = DEFAULT_THICKNESS + 2;
  private outlineColorR = 0;
  private outlineColorG = 0;
  private outlineColorB = 0;
  private outlineOpacity = DEFAULT_OPACITY;
  private hasOutline = false;

  private constructor(
    device: GPUDevice,
    context: GPUCanvasContext,
    format: GPUTextureFormat,
    pipeline: GPURenderPipeline,
    uniformBuffer: GPUBuffer,
    canvasWidth: number,
    canvasHeight: number,
    dpr: number
  ) {
    this.device = device;
    this.context = context;
    this.format = format;
    this.pipeline = pipeline;
    this.uniformBuffer = uniformBuffer;
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;
    this.dpr = dpr;

    // Create initial depth texture
    this.createDepthTexture();
  }

  /**
   * Create a new GPUTrajectoryRenderer for a canvas.
   *
   * @param canvas - HTML canvas element to render to (already DPR-sized)
   * @param options - Renderer configuration options
   * @returns Promise resolving to the renderer instance
   * @throws Error if WebGPU is not available
   */
  static async create(
    canvas: HTMLCanvasElement,
    options: GPUTrajectoryRendererOptions = {}
  ): Promise<GPUTrajectoryRenderer> {
    const dpr = options.dpr ?? (typeof window !== 'undefined' ? window.devicePixelRatio : 1) ?? 1;

    if (!navigator.gpu) {
      throw new Error('WebGPU is not supported in this browser');
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error('Failed to get WebGPU adapter');
    }

    const device = await adapter.requestDevice();

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

    // Create shader module
    const shaderModule = device.createShaderModule({
      label: 'Trajectory Shader',
      code: shaderSource,
    });

    // Create uniform buffer
    const uniformBuffer = device.createBuffer({
      label: 'Trajectory Uniforms',
      size: UNIFORM_BUFFER_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Create bind group layout (uniforms + segments)
    const bindGroupLayout = device.createBindGroupLayout({
      label: 'Trajectory Bind Group Layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'read-only-storage' },
        },
      ],
    });

    // Create pipeline layout
    const pipelineLayout = device.createPipelineLayout({
      label: 'Trajectory Pipeline Layout',
      bindGroupLayouts: [bindGroupLayout],
    });

    // Create render pipeline with depth testing
    const pipeline = device.createRenderPipeline({
      label: 'Trajectory Render Pipeline',
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [
          {
            format,
            blend: {
              color: {
                srcFactor: 'src-alpha',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
              alpha: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
            },
          },
        ],
      },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less', // Smaller z = closer = on top
      },
      primitive: {
        topology: 'triangle-list',
      },
    });

    return new GPUTrajectoryRenderer(
      device,
      context,
      format,
      pipeline,
      uniformBuffer,
      canvas.width,
      canvas.height,
      dpr
    );
  }

  /**
   * Create or recreate depth texture for z-ordering.
   */
  private createDepthTexture(): void {
    if (this.depthTexture) {
      this.depthTexture.destroy();
    }

    this.depthTexture = this.device.createTexture({
      label: 'Trajectory Depth Texture',
      size: [this.canvasWidth, this.canvasHeight],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  /**
   * Set trajectories to render.
   *
   * @param trajectories - Array of trajectories in pixel coords: [trajectory][timestep][x,y]
   * @param segmentIndex - Current animation progress (which segment to draw up to)
   * @param style - Styling options
   */
  setTrajectories(
    trajectories: number[][][],
    segmentIndex: number,
    style: GPUTrajectoryStyleOptions
  ): void {
    // Update cached style
    this.thickness = style.strokeWidth ?? DEFAULT_THICKNESS;
    const color = parseColor(style.color ?? DEFAULT_COLOR);
    this.colorR = color[0];
    this.colorG = color[1];
    this.colorB = color[2];
    this.baseOpacity = style.opacity ?? DEFAULT_OPACITY;

    // Outline style
    this.hasOutline = !!style.outline;
    if (style.outline) {
      const outlineColor = parseColor(style.outline.color ?? '#000000');
      this.outlineThickness = style.outline.width ?? this.thickness + 2;
      this.outlineColorR = outlineColor[0];
      this.outlineColorG = outlineColor[1];
      this.outlineColorB = outlineColor[2];
      this.outlineOpacity = style.outline.opacity ?? this.baseOpacity;
    }

    // Prepare GPU data
    const gpuData = prepareGPUTrajectoryData(trajectories, segmentIndex, style);
    this.segmentCount = gpuData.segmentCount;
    this.headCount = gpuData.trajectoryCount;

    if (this.segmentCount === 0) {
      this.segmentBuffer = null;
      this.headBuffer = null;
      this.bindGroup = null;
      this.headBindGroup = null;
      return;
    }

    // Destroy old buffers
    if (this.segmentBuffer) {
      this.segmentBuffer.destroy();
    }
    if (this.headBuffer) {
      this.headBuffer.destroy();
    }

    // Create segment buffer
    this.segmentBuffer = this.device.createBuffer({
      label: 'Trajectory Segments',
      size: gpuData.segments.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.segmentBuffer, 0, gpuData.segments.buffer);

    // Create head buffer
    this.headBuffer = this.device.createBuffer({
      label: 'Trajectory Heads',
      size: gpuData.headPositions.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.headBuffer, 0, gpuData.headPositions.buffer);

    // Create bind group for segments
    this.bindGroup = this.device.createBindGroup({
      label: 'Trajectory Bind Group',
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.segmentBuffer } },
      ],
    });

    // Create bind group for heads (using head buffer in binding 1)
    this.headBindGroup = this.device.createBindGroup({
      label: 'Trajectory Head Bind Group',
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.headBuffer } },
      ],
    });
  }

  /**
   * Draw the trajectories.
   *
   * @param clearColor - Optional background color (RGBA 0-1)
   */
  draw(clearColor?: [number, number, number, number]): void {
    if (!this.bindGroup || this.segmentCount === 0 || !this.depthTexture) {
      // Nothing to render, but may still need to clear
      if (clearColor) {
        const commandEncoder = this.device.createCommandEncoder();
        const textureView = this.context.getCurrentTexture().createView();
        const renderPass = commandEncoder.beginRenderPass({
          colorAttachments: [
            {
              view: textureView,
              clearValue: { r: clearColor[0], g: clearColor[1], b: clearColor[2], a: clearColor[3] },
              loadOp: 'clear',
              storeOp: 'store',
            },
          ],
        });
        renderPass.end();
        this.device.queue.submit([commandEncoder.finish()]);
      }
      return;
    }

    const commandEncoder = this.device.createCommandEncoder();
    const textureView = this.context.getCurrentTexture().createView();
    const depthView = this.depthTexture.createView();

    const loadOp: GPULoadOp = clearColor ? 'clear' : 'load';
    const clearValue = clearColor
      ? { r: clearColor[0], g: clearColor[1], b: clearColor[2], a: clearColor[3] }
      : { r: 0, g: 0, b: 0, a: 0 };

    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: textureView,
          clearValue,
          loadOp,
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: depthView,
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    // Pass 1: Draw outlines (if enabled)
    if (this.hasOutline) {
      this.updateUniforms(true); // isOutlinePass = true
      renderPass.setPipeline(this.pipeline);
      renderPass.setBindGroup(0, this.bindGroup);
      renderPass.draw(6, this.segmentCount, 0, 0);
    }

    // Pass 2: Draw main strokes
    this.updateUniforms(false); // isOutlinePass = false
    renderPass.setPipeline(this.pipeline);
    renderPass.setBindGroup(0, this.bindGroup);
    renderPass.draw(6, this.segmentCount, 0, 0);

    // Note: Head markers are not implemented in this version
    // (the existing CPU code handles head markers)

    renderPass.end();
    this.device.queue.submit([commandEncoder.finish()]);
  }

  /**
   * Update uniforms buffer.
   */
  private updateUniforms(isOutlinePass: boolean): void {
    // Uniform layout (16 floats = 64 bytes):
    // [width, height, dpr, _pad0,
    //  thickness, colorR, colorG, colorB, baseOpacity,
    //  outlineThickness, outlineColorR, outlineColorG, outlineColorB, outlineOpacity,
    //  isOutlinePass, _pad1]
    const uniformData = new Float32Array(16);
    uniformData[0] = this.canvasWidth;
    uniformData[1] = this.canvasHeight;
    uniformData[2] = this.dpr;
    uniformData[3] = 0; // padding

    uniformData[4] = this.thickness;
    uniformData[5] = this.colorR;
    uniformData[6] = this.colorG;
    uniformData[7] = this.colorB;
    uniformData[8] = this.baseOpacity;

    uniformData[9] = this.outlineThickness;
    uniformData[10] = this.outlineColorR;
    uniformData[11] = this.outlineColorG;
    uniformData[12] = this.outlineColorB;
    uniformData[13] = this.outlineOpacity;

    uniformData[14] = isOutlinePass ? 1.0 : 0.0;
    uniformData[15] = 0; // padding

    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);
  }

  /**
   * Resize the renderer.
   *
   * @param width - New canvas width in physical pixels
   * @param height - New canvas height in physical pixels
   * @param dpr - Optional new device pixel ratio
   */
  resize(width: number, height: number, dpr?: number): void {
    this.canvasWidth = width;
    this.canvasHeight = height;
    if (dpr !== undefined) {
      this.dpr = dpr;
    }
    this.createDepthTexture();
  }

  /**
   * Get the current backend type.
   */
  get backend(): 'gpu' {
    return 'gpu';
  }

  /**
   * Destroy the renderer and release GPU resources.
   */
  destroy(): void {
    this.uniformBuffer.destroy();
    if (this.segmentBuffer) {
      this.segmentBuffer.destroy();
    }
    if (this.headBuffer) {
      this.headBuffer.destroy();
    }
    if (this.depthTexture) {
      this.depthTexture.destroy();
    }
  }
}
