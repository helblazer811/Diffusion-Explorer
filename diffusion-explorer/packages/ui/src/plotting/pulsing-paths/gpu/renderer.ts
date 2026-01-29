/**
 * GPU-accelerated pulsing paths rendering using WebGPU.
 *
 * This renderer uses:
 * - Instanced rendering: one instance per segment
 * - Vertex shader: expands segments into quads with rounded cap margins
 * - Fragment shader: SDF for smooth edges, sawtooth pulse animation
 *
 * This is a generic renderer for animated pulses along arbitrary paths.
 * For vector field streamlines, consider using StreamlineRenderer which
 * builds on top of this with streamline-specific optimizations.
 *
 * Performance characteristics:
 * - GPU buffers are created once and reused
 * - Only uniforms are updated per frame (phase, etc.)
 * - Suitable for thousands of segments at 60fps
 */

import type {
  PulsingPathsRendererOptions,
  PulsingPathsRenderStyle,
  PulsingPathsGPUData,
  WebGPUContext,
  RGBAColor,
} from './types';
import { parseColor } from './types';
import { computeStreamlineLengths } from '../../streamlines/lengths';

// Import shader sources
import shaderBase from './pulsing-paths-shader.wgsl?raw';
import sdfUtils from '../../shared/shaders/sdf-utils.wgsl?raw';
import pulsePattern from '../../shared/shaders/pulse-pattern.wgsl?raw';

// Compose shader at runtime by replacing placeholder comments
const shaderSource = shaderBase
  .replace('// SDF_UTILS_PLACEHOLDER', sdfUtils)
  .replace('// PULSE_PATTERN_PLACEHOLDER', pulsePattern);

// Default options
const DEFAULT_THICKNESS = 2.5;
const DEFAULT_PULSE_WIDTH = 30;
const DEFAULT_PULSE_GAP = 50;
const DEFAULT_BASE_OPACITY = 0.8;
const DEFAULT_COLOR = '#3b82f6';
const DEFAULT_PREVIEW_OPACITY = 0.3;

// Uniform buffer size (must be 16-byte aligned)
// 15 floats * 4 bytes = 60 bytes, round up to 64 for alignment
const UNIFORM_BUFFER_SIZE = 64;

/**
 * Merge consecutive short segments by removing intermediate points.
 * This avoids visual artifacts when cap radius exceeds segment length.
 */
function mergeShortSegments(
  path: number[][],
  minLength: number
): number[][] {
  if (path.length < 2) return path;

  const result: number[][] = [path[0]];

  for (let i = 1; i < path.length; i++) {
    const lastPoint = result[result.length - 1];
    const currentPoint = path[i];
    const dx = currentPoint[0] - lastPoint[0];
    const dy = currentPoint[1] - lastPoint[1];
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Always keep the last point of the path
    const isLastPoint = i === path.length - 1;

    if (dist >= minLength || isLastPoint) {
      result.push(currentPoint);
    }
    // Otherwise skip this point (merge segment with next)
  }

  return result;
}

/**
 * Prepare path data for GPU upload.
 *
 * Converts an array of paths (each path is an array of [x, y] points)
 * into a flat Float32Array suitable for GPU storage buffer.
 *
 * @param paths - Array of paths in pixel coordinates
 * @param offsets - Phase offsets per path ('random' or 'synchronized')
 * @param minSegmentLength - Minimum segment length; shorter segments are merged (default: 0 = no merging)
 * @returns GPU-ready data structure
 */
export function preparePathData(
  paths: number[][][],
  offsets: 'random' | 'synchronized' = 'synchronized',
  minSegmentLength: number = 0
): PulsingPathsGPUData {
  // Pre-process to merge short segments if needed
  const processedPaths = minSegmentLength > 0
    ? paths.map(p => mergeShortSegments(p, minSegmentLength))
    : paths;

  // Count total segments
  let segmentCount = 0;
  for (const path of processedPaths) {
    if (path.length >= 2) {
      segmentCount += path.length - 1;
    }
  }

  // Allocate buffer (8 floats per segment)
  const segments = new Float32Array(segmentCount * 8);

  let segmentIdx = 0;
  let pathCount = 0;

  for (const path of processedPaths) {
    if (path.length < 2) continue;

    // Compute lengths for this path
    const { cumulativeLengths, totalLength } = computeStreamlineLengths(path);

    // Generate phase offset for this path
    const phaseOffset = offsets === 'random' ? Math.random() : 0;

    // Add segments
    for (let i = 0; i < path.length - 1; i++) {
      const baseIdx = segmentIdx * 8;
      const [x0, y0] = path[i];
      const [x1, y1] = path[i + 1];

      segments[baseIdx + 0] = x0;
      segments[baseIdx + 1] = y0;
      segments[baseIdx + 2] = x1;
      segments[baseIdx + 3] = y1;
      segments[baseIdx + 4] = cumulativeLengths[i];
      segments[baseIdx + 5] = totalLength;
      segments[baseIdx + 6] = phaseOffset;
      // Segment flags: 1 = first, 2 = last, 3 = both (single-segment path)
      const isFirst = (i === 0) ? 1.0 : 0.0;
      const isLast = (i === path.length - 2) ? 2.0 : 0.0;
      segments[baseIdx + 7] = isFirst + isLast;

      segmentIdx++;
    }

    pathCount++;
  }

  return {
    segments,
    segmentCount,
    pathCount,
  };
}

/**
 * GPU-accelerated pulsing paths renderer.
 *
 * @example
 * ```typescript
 * const renderer = await PulsingPathsRenderer.create(canvas, {
 *   thickness: 3,
 *   color: '#ff6b6b',
 *   pulseWidth: 40,
 * });
 *
 * renderer.setPaths(paths);
 *
 * function animate(time) {
 *   renderer.render({ phase: (time / 2000) % 1 });
 *   requestAnimationFrame(animate);
 * }
 * ```
 */
export class PulsingPathsRenderer {
  private device: GPUDevice;
  private context: GPUCanvasContext;
  private format: GPUTextureFormat;
  private pipeline: GPURenderPipeline;
  private uniformBuffer: GPUBuffer;
  private segmentBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;

  private segmentCount = 0;
  private canvasWidth: number;  // Physical pixels
  private canvasHeight: number; // Physical pixels
  private dpr: number;          // Device pixel ratio

  // Cached options (in logical/CSS pixels)
  private thickness: number;
  private pulseWidth: number;
  private pulseSpacing: number;
  private baseOpacity: number;
  private binaryPulse: boolean;
  private color: RGBAColor;
  private showPreview: boolean;
  private previewOpacity: number;

  private constructor(
    device: GPUDevice,
    context: GPUCanvasContext,
    format: GPUTextureFormat,
    pipeline: GPURenderPipeline,
    uniformBuffer: GPUBuffer,
    canvasWidth: number,
    canvasHeight: number,
    dpr: number,
    options: PulsingPathsRendererOptions
  ) {
    this.device = device;
    this.context = context;
    this.format = format;
    this.pipeline = pipeline;
    this.uniformBuffer = uniformBuffer;
    this.canvasWidth = canvasWidth;   // Physical pixels
    this.canvasHeight = canvasHeight; // Physical pixels
    this.dpr = dpr;

    // Store options (in logical/CSS pixels)
    this.thickness = options.thickness ?? DEFAULT_THICKNESS;
    this.pulseWidth = options.pulseWidth ?? DEFAULT_PULSE_WIDTH;
    const pulseGap = options.pulseGap ?? DEFAULT_PULSE_GAP;
    this.pulseSpacing = this.pulseWidth + pulseGap;
    this.baseOpacity = options.baseOpacity ?? DEFAULT_BASE_OPACITY;
    this.binaryPulse = options.binaryPulse ?? false;
    this.color = parseColor(options.color ?? DEFAULT_COLOR);
    this.showPreview = options.showPreview ?? false;
    this.previewOpacity = options.previewOpacity ?? DEFAULT_PREVIEW_OPACITY;
  }

  /**
   * Create a new PulsingPathsRenderer for a canvas.
   *
   * The canvas should already be sized for the device pixel ratio:
   * - canvas.width = cssWidth * dpr (physical pixels)
   * - canvas.height = cssHeight * dpr (physical pixels)
   * - canvas.style.width = cssWidth + 'px' (CSS pixels)
   * - canvas.style.height = cssHeight + 'px' (CSS pixels)
   *
   * Path coordinates should be in CSS/logical pixels. The renderer
   * will automatically scale them to physical pixels based on DPR.
   *
   * @param canvas - HTML canvas element to render to (already DPR-sized)
   * @param options - Renderer configuration options
   * @param gpuContext - Optional existing WebGPU context
   * @returns Promise resolving to the renderer instance
   * @throws Error if WebGPU is not available
   */
  static async create(
    canvas: HTMLCanvasElement,
    options: PulsingPathsRendererOptions = {},
    gpuContext?: WebGPUContext
  ): Promise<PulsingPathsRenderer> {
    // Get DPR from options or window
    const dpr = options.dpr ?? (typeof window !== 'undefined' ? window.devicePixelRatio : 1) ?? 1;

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
      label: 'Pulsing Paths Shader',
      code: shaderSource,
    });

    // Create uniform buffer
    const uniformBuffer = device.createBuffer({
      label: 'Pulsing Paths Uniforms',
      size: UNIFORM_BUFFER_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Create bind group layout
    const bindGroupLayout = device.createBindGroupLayout({
      label: 'Pulsing Paths Bind Group Layout',
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
      label: 'Pulsing Paths Pipeline Layout',
      bindGroupLayouts: [bindGroupLayout],
    });

    // Create render pipeline with max blending
    // Max blend makes overlapping renders idempotent - no ownership logic needed
    const pipeline = device.createRenderPipeline({
      label: 'Pulsing Paths Render Pipeline',
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
                srcFactor: 'one',
                dstFactor: 'one',
                operation: 'max',
              },
              alpha: {
                srcFactor: 'one',
                dstFactor: 'one',
                operation: 'max',
              },
            },
          },
        ],
      },
      primitive: {
        topology: 'triangle-list',
      },
    });

    return new PulsingPathsRenderer(
      device,
      context,
      format,
      pipeline,
      uniformBuffer,
      canvas.width,  // Physical pixels
      canvas.height, // Physical pixels
      dpr,
      options
    );
  }

  /**
   * Set the paths to render.
   *
   * This uploads the path data to the GPU. Call this once when
   * paths change, not every frame.
   *
   * @param paths - Array of paths in pixel coordinates
   * @param offsets - Phase offset mode ('random' or 'synchronized')
   */
  setPaths(
    paths: number[][][],
    offsets: 'random' | 'synchronized' = 'synchronized'
  ): void {
    // Minimum segment length = cap radius (half thickness)
    const minSegmentLength = this.thickness / 2;

    // Prepare data with segment merging
    const gpuData = preparePathData(paths, offsets, minSegmentLength);
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
      label: 'Pulsing Paths Segments',
      size: gpuData.segments.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.segmentBuffer, 0, gpuData.segments);

    // Create bind group
    this.bindGroup = this.device.createBindGroup({
      label: 'Pulsing Paths Bind Group',
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.segmentBuffer } },
      ],
    });
  }

  /**
   * Set paths from pre-prepared GPU data.
   *
   * Useful when you want to prepare data once and reuse it.
   *
   * @param gpuData - Pre-prepared GPU data from preparePathData()
   */
  setPathData(gpuData: PulsingPathsGPUData): void {
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
      label: 'Pulsing Paths Segments',
      size: gpuData.segments.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.segmentBuffer, 0, gpuData.segments);

    // Create bind group
    this.bindGroup = this.device.createBindGroup({
      label: 'Pulsing Paths Bind Group',
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
  }

  /**
   * Get the current device pixel ratio.
   */
  getDpr(): number {
    return this.dpr;
  }

  /**
   * Render the paths.
   *
   * Call this every frame with the current animation phase.
   *
   * @param style - Render style with animation phase and optional overrides
   * @param clearColor - Optional background color to clear with (RGBA 0-1)
   */
  render(
    style: PulsingPathsRenderStyle,
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
    const dpr = style.dpr ?? this.dpr;
    const showPreview = style.showPreview ?? this.showPreview;
    const previewOpacity = style.previewOpacity ?? this.previewOpacity;

    // Uniform layout matches shader struct:
    // width, height, dpr, phase, thickness, pulseWidth, pulseSpacing,
    // baseOpacity, binaryPulse, colorR, colorG, colorB, colorA, showPreview, previewOpacity
    const uniformData = new Float32Array(16); // 64 bytes / 4
    uniformData[0] = this.canvasWidth;   // Physical pixels
    uniformData[1] = this.canvasHeight;  // Physical pixels
    uniformData[2] = dpr;
    uniformData[3] = style.phase;
    uniformData[4] = thickness;          // Logical pixels (shader scales by DPR)
    uniformData[5] = this.pulseWidth;    // Logical pixels
    uniformData[6] = this.pulseSpacing;  // Logical pixels
    uniformData[7] = baseOpacity;
    uniformData[8] = this.binaryPulse ? 1.0 : 0.0;
    uniformData[9] = color[0];
    uniformData[10] = color[1];
    uniformData[11] = color[2];
    uniformData[12] = color[3];
    uniformData[13] = showPreview ? 1.0 : 0.0;
    uniformData[14] = previewOpacity;
    // Padding to 64 bytes (index 15 unused)

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
    style: PulsingPathsRenderStyle,
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
    const dpr = style.dpr ?? this.dpr;
    const showPreview = style.showPreview ?? this.showPreview;
    const previewOpacity = style.previewOpacity ?? this.previewOpacity;

    // Uniform layout matches shader struct
    const uniformData = new Float32Array(16);
    uniformData[0] = this.canvasWidth;   // Physical pixels
    uniformData[1] = this.canvasHeight;  // Physical pixels
    uniformData[2] = dpr;
    uniformData[3] = style.phase;
    uniformData[4] = thickness;          // Logical pixels
    uniformData[5] = this.pulseWidth;    // Logical pixels
    uniformData[6] = this.pulseSpacing;  // Logical pixels
    uniformData[7] = baseOpacity;
    uniformData[8] = this.binaryPulse ? 1.0 : 0.0;
    uniformData[9] = color[0];
    uniformData[10] = color[1];
    uniformData[11] = color[2];
    uniformData[12] = color[3];
    uniformData[13] = showPreview ? 1.0 : 0.0;
    uniformData[14] = previewOpacity;

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
  updateOptions(options: Partial<PulsingPathsRendererOptions>): void {
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
    if (options.showPreview !== undefined) {
      this.showPreview = options.showPreview;
    }
    if (options.previewOpacity !== undefined) {
      this.previewOpacity = options.previewOpacity;
    }
  }

  /**
   * Get the current segment count.
   */
  getSegmentCount(): number {
    return this.segmentCount;
  }

  /**
   * Get the GPU device used by this renderer.
   */
  getDevice(): GPUDevice {
    return this.device;
  }

  /**
   * Get the texture format used by this renderer.
   */
  getFormat(): GPUTextureFormat {
    return this.format;
  }

  /**
   * Get the canvas context for direct access.
   */
  getContext(): GPUCanvasContext {
    return this.context;
  }

  /**
   * Get the current canvas dimensions in physical pixels.
   */
  getCanvasSize(): { width: number; height: number } {
    return { width: this.canvasWidth, height: this.canvasHeight };
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
