/**
 * GPU-accelerated streamline rendering using WebGPU.
 *
 * This renderer uses:
 * - Instanced rendering: one instance per segment
 * - Vertex shader: expands segments into quads with rounded cap margins
 * - Fragment shader: SDF for smooth edges, sawtooth pulse animation
 *
 * Performance characteristics:
 * - GPU buffers are created once and reused
 * - Only uniforms are updated per frame (phase, etc.)
 * - Suitable for thousands of segments at 60fps
 */

import type {
  StreamlineRendererOptions,
  StreamlineRenderStyle,
  StreamlineGPUData,
  WebGPUContext,
  RGBAColor,
} from './types';
import { parseColor } from './types';
import { computeStreamlineLengths } from '../streamlines';
import shaderSource from './streamline-shader.wgsl?raw';

// Default options
const DEFAULT_THICKNESS = 2.5;
const DEFAULT_PULSE_WIDTH = 30;
const DEFAULT_PULSE_GAP = 50;
const DEFAULT_BASE_OPACITY = 0.8;
const DEFAULT_COLOR = '#3b82f6';

// Uniform buffer size (must be 16-byte aligned)
// 12 floats * 4 bytes = 48 bytes, round up to 64 for alignment
const UNIFORM_BUFFER_SIZE = 64;

/**
 * Prepare streamline data for GPU upload.
 *
 * Converts an array of streamlines (each streamline is an array of [x, y] points)
 * into a flat Float32Array suitable for GPU storage buffer.
 *
 * @param streamlines - Array of streamlines in pixel coordinates
 * @param offsets - Phase offsets per streamline ('random' or 'synchronized')
 * @returns GPU-ready data structure
 */
export function prepareStreamlineData(
  streamlines: number[][][],
  offsets: 'random' | 'synchronized' = 'synchronized'
): StreamlineGPUData {
  // Count total segments
  let segmentCount = 0;
  for (const streamline of streamlines) {
    if (streamline.length >= 2) {
      segmentCount += streamline.length - 1;
    }
  }

  // Allocate buffer (8 floats per segment)
  const segments = new Float32Array(segmentCount * 8);

  let segmentIdx = 0;
  let streamlineIdx = 0;

  for (const streamline of streamlines) {
    if (streamline.length < 2) continue;

    // Compute lengths for this streamline
    const { cumulativeLengths, totalLength } = computeStreamlineLengths(streamline);

    // Generate phase offset for this streamline
    const phaseOffset = offsets === 'random' ? Math.random() : 0;

    // Add segments
    for (let i = 0; i < streamline.length - 1; i++) {
      const baseIdx = segmentIdx * 8;
      const [x0, y0] = streamline[i];
      const [x1, y1] = streamline[i + 1];

      segments[baseIdx + 0] = x0;
      segments[baseIdx + 1] = y0;
      segments[baseIdx + 2] = x1;
      segments[baseIdx + 3] = y1;
      segments[baseIdx + 4] = cumulativeLengths[i];
      segments[baseIdx + 5] = totalLength;
      segments[baseIdx + 6] = phaseOffset;
      segments[baseIdx + 7] = 0; // padding

      segmentIdx++;
    }

    streamlineIdx++;
  }

  return {
    segments,
    segmentCount,
    streamlineCount: streamlineIdx,
  };
}

/**
 * GPU-accelerated streamline renderer.
 *
 * @example
 * ```typescript
 * const renderer = await StreamlineRenderer.create(canvas, {
 *   thickness: 3,
 *   color: '#ff6b6b',
 *   pulseWidth: 40,
 * });
 *
 * renderer.setStreamlines(streamlines);
 *
 * function animate(time) {
 *   renderer.render({ phase: (time / 2000) % 1 });
 *   requestAnimationFrame(animate);
 * }
 * ```
 */
export class StreamlineRenderer {
  private device: GPUDevice;
  private context: GPUCanvasContext;
  private format: GPUTextureFormat;
  private pipeline: GPURenderPipeline;
  private uniformBuffer: GPUBuffer;
  private segmentBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;

  private segmentCount = 0;
  private canvasWidth: number;
  private canvasHeight: number;

  // Cached options
  private thickness: number;
  private pulseWidth: number;
  private pulseSpacing: number;
  private baseOpacity: number;
  private binaryPulse: boolean;
  private color: RGBAColor;

  private constructor(
    device: GPUDevice,
    context: GPUCanvasContext,
    format: GPUTextureFormat,
    pipeline: GPURenderPipeline,
    uniformBuffer: GPUBuffer,
    canvasWidth: number,
    canvasHeight: number,
    options: StreamlineRendererOptions
  ) {
    this.device = device;
    this.context = context;
    this.format = format;
    this.pipeline = pipeline;
    this.uniformBuffer = uniformBuffer;
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;

    // Store options
    this.thickness = options.thickness ?? DEFAULT_THICKNESS;
    this.pulseWidth = options.pulseWidth ?? DEFAULT_PULSE_WIDTH;
    const pulseGap = options.pulseGap ?? DEFAULT_PULSE_GAP;
    this.pulseSpacing = this.pulseWidth + pulseGap;
    this.baseOpacity = options.baseOpacity ?? DEFAULT_BASE_OPACITY;
    this.binaryPulse = options.binaryPulse ?? false;
    this.color = parseColor(options.color ?? DEFAULT_COLOR);
  }

  /**
   * Create a new StreamlineRenderer for a canvas.
   *
   * @param canvas - HTML canvas element to render to
   * @param options - Renderer configuration options
   * @param gpuContext - Optional existing WebGPU context
   * @returns Promise resolving to the renderer instance
   * @throws Error if WebGPU is not available
   */
  static async create(
    canvas: HTMLCanvasElement,
    options: StreamlineRendererOptions = {},
    gpuContext?: WebGPUContext
  ): Promise<StreamlineRenderer> {
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

    // Create shader module
    const shaderModule = device.createShaderModule({
      label: 'Streamline Shader',
      code: shaderSource,
    });

    // Create uniform buffer
    const uniformBuffer = device.createBuffer({
      label: 'Streamline Uniforms',
      size: UNIFORM_BUFFER_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Create bind group layout
    const bindGroupLayout = device.createBindGroupLayout({
      label: 'Streamline Bind Group Layout',
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
      label: 'Streamline Pipeline Layout',
      bindGroupLayouts: [bindGroupLayout],
    });

    // Create render pipeline
    const pipeline = device.createRenderPipeline({
      label: 'Streamline Render Pipeline',
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
      primitive: {
        topology: 'triangle-list',
      },
    });

    return new StreamlineRenderer(
      device,
      context,
      format,
      pipeline,
      uniformBuffer,
      canvas.width,
      canvas.height,
      options
    );
  }

  /**
   * Set the streamlines to render.
   *
   * This uploads the streamline data to the GPU. Call this once when
   * streamlines change, not every frame.
   *
   * @param streamlines - Array of streamlines in pixel coordinates
   * @param offsets - Phase offset mode ('random' or 'synchronized')
   */
  setStreamlines(
    streamlines: number[][][],
    offsets: 'random' | 'synchronized' = 'synchronized'
  ): void {
    // Prepare data
    const gpuData = prepareStreamlineData(streamlines, offsets);
    this.segmentCount = gpuData.segmentCount;

    if (this.segmentCount === 0) {
      this.segmentBuffer = null;
      this.bindGroup = null;
      return;
    }

    // Destroy old buffer if exists
    if (this.segmentBuffer) {
      this.segmentBuffer.destroy();
    }

    // Create segment buffer
    this.segmentBuffer = this.device.createBuffer({
      label: 'Streamline Segments',
      size: gpuData.segments.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.segmentBuffer, 0, gpuData.segments);

    // Create bind group
    this.bindGroup = this.device.createBindGroup({
      label: 'Streamline Bind Group',
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.segmentBuffer } },
      ],
    });
  }

  /**
   * Set streamlines from pre-prepared GPU data.
   *
   * Useful when you want to prepare data once and reuse it.
   *
   * @param gpuData - Pre-prepared GPU data from prepareStreamlineData()
   */
  setStreamlineData(gpuData: StreamlineGPUData): void {
    this.segmentCount = gpuData.segmentCount;

    if (this.segmentCount === 0) {
      this.segmentBuffer = null;
      this.bindGroup = null;
      return;
    }

    // Destroy old buffer if exists
    if (this.segmentBuffer) {
      this.segmentBuffer.destroy();
    }

    // Create segment buffer
    this.segmentBuffer = this.device.createBuffer({
      label: 'Streamline Segments',
      size: gpuData.segments.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.segmentBuffer, 0, gpuData.segments);

    // Create bind group
    this.bindGroup = this.device.createBindGroup({
      label: 'Streamline Bind Group',
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.segmentBuffer } },
      ],
    });
  }

  /**
   * Update canvas size.
   *
   * Call this if the canvas is resized.
   *
   * @param width - New canvas width in pixels
   * @param height - New canvas height in pixels
   */
  resize(width: number, height: number): void {
    this.canvasWidth = width;
    this.canvasHeight = height;
  }

  /**
   * Render the streamlines.
   *
   * Call this every frame with the current animation phase.
   *
   * @param style - Render style with animation phase and optional overrides
   * @param clearColor - Optional background color to clear with (RGBA 0-1)
   */
  render(
    style: StreamlineRenderStyle,
    clearColor?: [number, number, number, number]
  ): void {
    if (!this.bindGroup || this.segmentCount === 0) {
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

    // Update uniforms
    const thickness = style.thickness ?? this.thickness;
    const baseOpacity = style.baseOpacity ?? this.baseOpacity;
    const color = style.color ? parseColor(style.color) : this.color;

    const uniformData = new Float32Array(16); // 64 bytes / 4
    uniformData[0] = this.canvasWidth;
    uniformData[1] = this.canvasHeight;
    uniformData[2] = style.phase;
    uniformData[3] = thickness;
    uniformData[4] = this.pulseWidth;
    uniformData[5] = this.pulseSpacing;
    uniformData[6] = baseOpacity;
    uniformData[7] = this.binaryPulse ? 1.0 : 0.0;
    uniformData[8] = color[0];
    uniformData[9] = color[1];
    uniformData[10] = color[2];
    uniformData[11] = color[3];
    // Padding to 64 bytes (indices 12-15 unused)

    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);

    // Create render pass
    const commandEncoder = this.device.createCommandEncoder();
    const textureView = this.context.getCurrentTexture().createView();

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
    });

    renderPass.setPipeline(this.pipeline);
    renderPass.setBindGroup(0, this.bindGroup);
    // 6 vertices per instance (2 triangles), segmentCount instances
    renderPass.draw(6, this.segmentCount, 0, 0);
    renderPass.end();

    this.device.queue.submit([commandEncoder.finish()]);
  }

  /**
   * Render to an offscreen texture (for compositing).
   *
   * @param style - Render style with animation phase
   * @param targetView - GPU texture view to render to
   * @param clearColor - Optional background color to clear with
   */
  renderToTexture(
    style: StreamlineRenderStyle,
    targetView: GPUTextureView,
    clearColor?: [number, number, number, number]
  ): GPUCommandBuffer {
    if (!this.bindGroup || this.segmentCount === 0) {
      // Return empty command buffer
      const commandEncoder = this.device.createCommandEncoder();
      if (clearColor) {
        const renderPass = commandEncoder.beginRenderPass({
          colorAttachments: [
            {
              view: targetView,
              clearValue: { r: clearColor[0], g: clearColor[1], b: clearColor[2], a: clearColor[3] },
              loadOp: 'clear',
              storeOp: 'store',
            },
          ],
        });
        renderPass.end();
      }
      return commandEncoder.finish();
    }

    // Update uniforms
    const thickness = style.thickness ?? this.thickness;
    const baseOpacity = style.baseOpacity ?? this.baseOpacity;
    const color = style.color ? parseColor(style.color) : this.color;

    const uniformData = new Float32Array(16);
    uniformData[0] = this.canvasWidth;
    uniformData[1] = this.canvasHeight;
    uniformData[2] = style.phase;
    uniformData[3] = thickness;
    uniformData[4] = this.pulseWidth;
    uniformData[5] = this.pulseSpacing;
    uniformData[6] = baseOpacity;
    uniformData[7] = this.binaryPulse ? 1.0 : 0.0;
    uniformData[8] = color[0];
    uniformData[9] = color[1];
    uniformData[10] = color[2];
    uniformData[11] = color[3];

    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);

    // Create render pass
    const commandEncoder = this.device.createCommandEncoder();

    const loadOp: GPULoadOp = clearColor ? 'clear' : 'load';
    const clearValue = clearColor
      ? { r: clearColor[0], g: clearColor[1], b: clearColor[2], a: clearColor[3] }
      : { r: 0, g: 0, b: 0, a: 0 };

    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: targetView,
          clearValue,
          loadOp,
          storeOp: 'store',
        },
      ],
    });

    renderPass.setPipeline(this.pipeline);
    renderPass.setBindGroup(0, this.bindGroup);
    renderPass.draw(6, this.segmentCount, 0, 0);
    renderPass.end();

    return commandEncoder.finish();
  }

  /**
   * Update rendering options.
   *
   * @param options - New options to apply
   */
  updateOptions(options: Partial<StreamlineRendererOptions>): void {
    if (options.thickness !== undefined) {
      this.thickness = options.thickness;
    }
    if (options.pulseWidth !== undefined) {
      this.pulseWidth = options.pulseWidth;
      const pulseGap = options.pulseGap ?? (this.pulseSpacing - this.pulseWidth);
      this.pulseSpacing = this.pulseWidth + pulseGap;
    }
    if (options.pulseGap !== undefined) {
      this.pulseSpacing = this.pulseWidth + options.pulseGap;
    }
    if (options.baseOpacity !== undefined) {
      this.baseOpacity = options.baseOpacity;
    }
    if (options.binaryPulse !== undefined) {
      this.binaryPulse = options.binaryPulse;
    }
    if (options.color !== undefined) {
      this.color = parseColor(options.color);
    }
  }

  /**
   * Get the current segment count.
   */
  getSegmentCount(): number {
    return this.segmentCount;
  }

  /**
   * Destroy the renderer and release GPU resources.
   */
  destroy(): void {
    this.uniformBuffer.destroy();
    if (this.segmentBuffer) {
      this.segmentBuffer.destroy();
    }
  }
}
