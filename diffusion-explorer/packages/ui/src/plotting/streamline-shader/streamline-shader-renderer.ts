/**
 * WebGPU-based streamline renderer using spatial hashing for efficient lookup.
 *
 * Provides GPU-accelerated rendering of animated streamlines with pulse effects.
 * Uses a compute shader that processes each pixel in parallel, looking up
 * nearby segments via a spatial hash for O(1) per-pixel complexity.
 */

import type { PackedStreamlineData, StreamlineShaderOptions } from './types';
import type { StreamlineLengthData } from '../../animation/streamline-animation';
import { buildPackedStreamlineData } from './spatial-hash';
import streamlineShaderSource from './streamline-shader.wgsl?raw';

/**
 * Result of a shader render pass.
 */
export interface StreamlineShaderResult {
  /** RGBA image data ready for canvas */
  imageData: ImageData;
}

/**
 * GPU-accelerated streamline renderer.
 *
 * Manages WebGPU resources and provides efficient rendering of animated
 * streamlines. Create once, then call render() each frame with updated phase.
 *
 * @example
 * ```typescript
 * const renderer = await StreamlineShaderRenderer.create({
 *   streamlines,
 *   lengthData,
 *   offsets,
 *   options: {
 *     width: 800,
 *     height: 600,
 *     strokeWidth: 2.5,
 *     pulseWidth: 30,
 *     pulsePauseWidth: 50,
 *     baseOpacity: 0.8,
 *     color: [0.23, 0.51, 0.96], // #3b82f6
 *   }
 * });
 *
 * // Each frame:
 * const result = await renderer.render(phase);
 * ctx.putImageData(result.imageData, 0, 0);
 *
 * // When done:
 * renderer.destroy();
 * ```
 */
export class StreamlineShaderRenderer {
  private device: GPUDevice;
  private pipeline: GPUComputePipeline;
  private bindGroupLayout: GPUBindGroupLayout;
  private bindGroup: GPUBindGroup;

  // Buffers
  private uniformBuffer: GPUBuffer;
  private cellOffsetsBuffer: GPUBuffer;
  private segmentIndicesBuffer: GPUBuffer;
  private segmentDataBuffer: GPUBuffer;
  private outputBuffer: GPUBuffer;
  private stagingBuffer: GPUBuffer;

  // Dimensions
  private readonly width: number;
  private readonly height: number;
  private readonly workgroupsX: number;
  private readonly workgroupsY: number;

  // Uniform data (mutable for phase updates)
  private readonly uniformData: ArrayBuffer;
  private readonly uniformView: DataView;

  private constructor(
    device: GPUDevice,
    pipeline: GPUComputePipeline,
    bindGroupLayout: GPUBindGroupLayout,
    bindGroup: GPUBindGroup,
    uniformBuffer: GPUBuffer,
    cellOffsetsBuffer: GPUBuffer,
    segmentIndicesBuffer: GPUBuffer,
    segmentDataBuffer: GPUBuffer,
    outputBuffer: GPUBuffer,
    stagingBuffer: GPUBuffer,
    width: number,
    height: number,
    uniformData: ArrayBuffer
  ) {
    this.device = device;
    this.pipeline = pipeline;
    this.bindGroupLayout = bindGroupLayout;
    this.bindGroup = bindGroup;
    this.uniformBuffer = uniformBuffer;
    this.cellOffsetsBuffer = cellOffsetsBuffer;
    this.segmentIndicesBuffer = segmentIndicesBuffer;
    this.segmentDataBuffer = segmentDataBuffer;
    this.outputBuffer = outputBuffer;
    this.stagingBuffer = stagingBuffer;
    this.width = width;
    this.height = height;
    this.workgroupsX = Math.ceil(width / 16);
    this.workgroupsY = Math.ceil(height / 16);
    this.uniformData = uniformData;
    this.uniformView = new DataView(uniformData);
  }

  /**
   * Create a new StreamlineShaderRenderer.
   *
   * @param config - Configuration including streamlines and rendering options
   * @returns Promise resolving to renderer instance
   * @throws Error if WebGPU is not available
   */
  static async create(config: {
    streamlines: number[][][];
    lengthData: StreamlineLengthData[];
    offsets: number[];
    options: StreamlineShaderOptions;
  }): Promise<StreamlineShaderRenderer> {
    const { streamlines, lengthData, offsets, options } = config;

    // Initialize WebGPU
    if (!navigator.gpu) {
      throw new Error('WebGPU is not supported in this browser');
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error('Failed to get WebGPU adapter');
    }

    const device = await adapter.requestDevice();

    // Build spatial hash and pack data
    const packedData = buildPackedStreamlineData(streamlines, lengthData, offsets, {
      width: options.width,
      height: options.height,
      strokeWidth: options.strokeWidth,
      pulseWidth: options.pulseWidth,
      pulsePauseWidth: options.pulsePauseWidth,
      baseOpacity: options.baseOpacity,
      binaryPulse: options.binaryPulse,
      cellSize: options.cellSize
    });

    // Create shader module
    const shaderModule = device.createShaderModule({
      label: 'Streamline Shader',
      code: streamlineShaderSource
    });

    // Create bind group layout
    const bindGroupLayout = device.createBindGroupLayout({
      label: 'Streamline Bind Group Layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }
      ]
    });

    // Create pipeline
    const pipelineLayout = device.createPipelineLayout({
      label: 'Streamline Pipeline Layout',
      bindGroupLayouts: [bindGroupLayout]
    });

    const pipeline = device.createComputePipeline({
      label: 'Streamline Compute Pipeline',
      layout: pipelineLayout,
      compute: {
        module: shaderModule,
        entryPoint: 'main'
      }
    });

    // Create uniform buffer (64 bytes, 16-byte aligned)
    const uniformData = new ArrayBuffer(64);
    const uniformView = new DataView(uniformData);
    const u = packedData.uniforms;

    uniformView.setUint32(0, u.width, true);
    uniformView.setUint32(4, u.height, true);
    uniformView.setFloat32(8, u.cellSize, true);
    uniformView.setUint32(12, u.gridWidth, true);
    uniformView.setUint32(16, u.gridHeight, true);
    uniformView.setFloat32(20, u.strokeWidth, true);
    uniformView.setFloat32(24, u.pulseWidth, true);
    uniformView.setFloat32(28, u.pulseSpacing, true);
    uniformView.setFloat32(32, u.baseOpacity, true);
    uniformView.setUint32(36, u.binaryPulse ? 1 : 0, true);
    uniformView.setFloat32(40, 0, true); // phase (will be updated each frame)
    uniformView.setFloat32(44, options.color[0], true); // colorR
    uniformView.setFloat32(48, options.color[1], true); // colorG
    uniformView.setFloat32(52, options.color[2], true); // colorB
    uniformView.setFloat32(56, 0, true); // padding

    const uniformBuffer = device.createBuffer({
      label: 'Streamline Uniforms',
      size: uniformData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(uniformBuffer, 0, uniformData);

    // Create cell offsets buffer
    const cellOffsetsBuffer = device.createBuffer({
      label: 'Cell Offsets',
      size: packedData.cellOffsets.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(cellOffsetsBuffer, 0, packedData.cellOffsets.buffer);

    // Create segment indices buffer
    // Ensure minimum size of 4 bytes for empty data
    const segmentIndicesSize = Math.max(4, packedData.segmentIndices.byteLength);
    const segmentIndicesBuffer = device.createBuffer({
      label: 'Segment Indices',
      size: segmentIndicesSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    if (packedData.segmentIndices.byteLength > 0) {
      device.queue.writeBuffer(segmentIndicesBuffer, 0, packedData.segmentIndices.buffer);
    }

    // Create segment data buffer
    // Ensure minimum size of 4 bytes for empty data
    const segmentDataSize = Math.max(4, packedData.segmentData.byteLength);
    const segmentDataBuffer = device.createBuffer({
      label: 'Segment Data',
      size: segmentDataSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    if (packedData.segmentData.byteLength > 0) {
      device.queue.writeBuffer(segmentDataBuffer, 0, packedData.segmentData.buffer);
    }

    // Create output buffer (RGBA8, 4 bytes per pixel)
    const outputSize = u.width * u.height * 4;
    const outputBuffer = device.createBuffer({
      label: 'Output Buffer',
      size: outputSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    });

    // Create staging buffer for readback
    const stagingBuffer = device.createBuffer({
      label: 'Staging Buffer',
      size: outputSize,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
    });

    // Create bind group
    const bindGroup = device.createBindGroup({
      label: 'Streamline Bind Group',
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: cellOffsetsBuffer } },
        { binding: 2, resource: { buffer: segmentIndicesBuffer } },
        { binding: 3, resource: { buffer: segmentDataBuffer } },
        { binding: 4, resource: { buffer: outputBuffer } }
      ]
    });

    return new StreamlineShaderRenderer(
      device,
      pipeline,
      bindGroupLayout,
      bindGroup,
      uniformBuffer,
      cellOffsetsBuffer,
      segmentIndicesBuffer,
      segmentDataBuffer,
      outputBuffer,
      stagingBuffer,
      u.width,
      u.height,
      uniformData
    );
  }

  /**
   * Render streamlines at the given animation phase.
   *
   * @param phase - Animation phase [0, 1)
   * @returns Promise resolving to render result with ImageData
   */
  async render(phase: number): Promise<StreamlineShaderResult> {
    // Update phase in uniform buffer
    this.uniformView.setFloat32(40, phase, true);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);

    // Create command encoder
    const commandEncoder = this.device.createCommandEncoder();

    // Dispatch compute shader
    const computePass = commandEncoder.beginComputePass();
    computePass.setPipeline(this.pipeline);
    computePass.setBindGroup(0, this.bindGroup);
    computePass.dispatchWorkgroups(this.workgroupsX, this.workgroupsY);
    computePass.end();

    // Copy output to staging buffer
    commandEncoder.copyBufferToBuffer(
      this.outputBuffer, 0,
      this.stagingBuffer, 0,
      this.width * this.height * 4
    );

    // Submit commands
    this.device.queue.submit([commandEncoder.finish()]);

    // Map staging buffer and read results
    await this.stagingBuffer.mapAsync(GPUMapMode.READ);
    const resultData = new Uint8ClampedArray(
      this.stagingBuffer.getMappedRange().slice(0)
    );
    this.stagingBuffer.unmap();

    // Create ImageData
    const imageData = new ImageData(resultData, this.width, this.height);

    return { imageData };
  }

  /**
   * Release all GPU resources.
   * Call when done with the renderer.
   */
  destroy(): void {
    this.uniformBuffer.destroy();
    this.cellOffsetsBuffer.destroy();
    this.segmentIndicesBuffer.destroy();
    this.segmentDataBuffer.destroy();
    this.outputBuffer.destroy();
    this.stagingBuffer.destroy();
    this.device.destroy();
  }
}
