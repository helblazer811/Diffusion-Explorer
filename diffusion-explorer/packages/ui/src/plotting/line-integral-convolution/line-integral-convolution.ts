/**
 * Line Integral Convolution (LIC) implementation using WebGPU compute shaders.
 *
 * LIC is a technique for visualizing vector fields by convolving a noise texture
 * along streamlines, producing a texture that shows flow direction and structure.
 */

import type { LICOptions, LICResult, WebGPUContext, VectorFieldFn } from './types';
import { generateWhiteNoise } from './noise';
import licShaderSource from './lic-shader.wgsl?raw';

// Default LIC parameters
const DEFAULT_INTEGRATION_STEPS = 20;
const DEFAULT_STEP_SIZE = 0.5;
const DEFAULT_CONTRAST = 1.0;

/**
 * Check if WebGPU is available in the current environment.
 */
export async function isWebGPUAvailable(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    return false;
  }

  try {
    const adapter = await navigator.gpu.requestAdapter();
    return adapter !== null;
  } catch {
    return false;
  }
}

/**
 * Initialize a WebGPU context for reuse across multiple LIC computations.
 * This is more efficient than initializing a new context for each computation.
 *
 * @throws Error if WebGPU is not available
 */
export async function initWebGPUContext(): Promise<WebGPUContext> {
  if (!navigator.gpu) {
    throw new Error('WebGPU is not supported in this browser');
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error('Failed to get WebGPU adapter');
  }

  const device = await adapter.requestDevice();

  return {
    adapter,
    device,
    destroy() {
      device.destroy();
    }
  };
}

/**
 * Evaluate a vector field function on a grid and store in a Float32Array buffer.
 * This pre-computes the vector field on CPU so the GPU shader can sample from it.
 */
function evaluateVectorFieldToBuffer(
  vectorField: VectorFieldFn,
  width: number,
  height: number,
  domain: { xMin: number; xMax: number; yMin: number; yMax: number }
): Float32Array {
  const buffer = new Float32Array(width * height * 2);

  const xScale = (domain.xMax - domain.xMin) / width;
  const yScale = (domain.yMax - domain.yMin) / height;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Map pixel center to world coordinates
      const worldX = domain.xMin + (x + 0.5) * xScale;
      const worldY = domain.yMin + (y + 0.5) * yScale;

      const [vx, vy] = vectorField(worldX, worldY);

      // Convert world-space velocity to pixel-space velocity
      const pxVx = vx / xScale;
      const pxVy = vy / yScale;

      const idx = (y * width + x) * 2;
      buffer[idx] = pxVx;
      buffer[idx + 1] = pxVy;
    }
  }

  return buffer;
}

/**
 * Create an LICResult object from raw output data.
 */
function createLICResult(data: Float32Array, width: number, height: number): LICResult {
  return {
    data,
    width,
    height,

    toImageData(): ImageData {
      const imageData = new ImageData(width, height);
      const pixels = imageData.data;

      for (let i = 0; i < data.length; i++) {
        const value = Math.round(data[i] * 255);
        const pixelIdx = i * 4;
        pixels[pixelIdx] = value;     // R
        pixels[pixelIdx + 1] = value; // G
        pixels[pixelIdx + 2] = value; // B
        pixels[pixelIdx + 3] = 255;   // A
      }

      return imageData;
    },

    async toImageBitmap(): Promise<ImageBitmap> {
      const imageData = this.toImageData();
      return createImageBitmap(imageData);
    }
  };
}

/**
 * Compute Line Integral Convolution for a vector field using WebGPU.
 *
 * @param options - LIC computation options
 * @param context - Optional WebGPU context (will create one if not provided)
 * @returns LIC result with grayscale intensity values
 * @throws Error if WebGPU is not available
 *
 * @example
 * ```typescript
 * const result = await computeLIC({
 *   vectorField: (x, y) => [y, -x], // rotation field
 *   domain: { xMin: -2, xMax: 2, yMin: -2, yMax: 2 },
 *   width: 512,
 *   height: 512,
 * });
 *
 * ctx.putImageData(result.toImageData(), 0, 0);
 * ```
 */
export async function computeLIC(
  options: LICOptions,
  context?: WebGPUContext
): Promise<LICResult> {
  const {
    vectorField,
    domain,
    width,
    height,
    integrationSteps = DEFAULT_INTEGRATION_STEPS,
    stepSize = DEFAULT_STEP_SIZE,
    seed,
    contrast = DEFAULT_CONTRAST
  } = options;

  // Get or create WebGPU context
  const ownContext = !context;
  const ctx = context ?? await initWebGPUContext();
  const { device } = ctx;

  try {
    // Create shader module
    const shaderModule = device.createShaderModule({
      label: 'LIC Compute Shader',
      code: licShaderSource
    });

    // Create uniform buffer
    const uniformData = new ArrayBuffer(40); // 10 x 4 bytes
    const uniformView = new DataView(uniformData);
    uniformView.setUint32(0, width, true);          // width
    uniformView.setUint32(4, height, true);         // height
    uniformView.setUint32(8, integrationSteps, true); // integrationSteps
    uniformView.setFloat32(12, stepSize, true);     // stepSize
    uniformView.setFloat32(16, domain.xMin, true);  // xMin
    uniformView.setFloat32(20, domain.xMax, true);  // xMax
    uniformView.setFloat32(24, domain.yMin, true);  // yMin
    uniformView.setFloat32(28, domain.yMax, true);  // yMax
    uniformView.setFloat32(32, contrast, true);     // contrast
    uniformView.setFloat32(36, 0, true);            // padding

    const uniformBuffer = device.createBuffer({
      label: 'LIC Uniforms',
      size: uniformData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(uniformBuffer, 0, uniformData);

    // Pre-compute vector field on CPU grid (GPU shader will interpolate from this)
    const vectorFieldData = evaluateVectorFieldToBuffer(vectorField, width, height, domain);
    const vectorFieldBuffer = device.createBuffer({
      label: 'Vector Field',
      size: vectorFieldData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(vectorFieldBuffer, 0, vectorFieldData.buffer);

    // Generate and upload noise texture
    const noiseData = generateWhiteNoise(width, height, seed);
    const noiseBuffer = device.createBuffer({
      label: 'Noise Texture',
      size: noiseData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(noiseBuffer, 0, noiseData.buffer);

    // Create output buffer
    const outputSize = width * height * 4; // Float32
    const outputBuffer = device.createBuffer({
      label: 'LIC Output',
      size: outputSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    });

    // Create staging buffer for readback
    const stagingBuffer = device.createBuffer({
      label: 'Staging Buffer',
      size: outputSize,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
    });

    // Create bind group layout
    const bindGroupLayout = device.createBindGroupLayout({
      label: 'LIC Bind Group Layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'uniform' }
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'read-only-storage' }
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'read-only-storage' }
        },
        {
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' }
        }
      ]
    });

    // Create bind group
    const bindGroup = device.createBindGroup({
      label: 'LIC Bind Group',
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: vectorFieldBuffer } },
        { binding: 2, resource: { buffer: noiseBuffer } },
        { binding: 3, resource: { buffer: outputBuffer } }
      ]
    });

    // Create compute pipeline
    const pipelineLayout = device.createPipelineLayout({
      label: 'LIC Pipeline Layout',
      bindGroupLayouts: [bindGroupLayout]
    });

    const computePipeline = device.createComputePipeline({
      label: 'LIC Compute Pipeline',
      layout: pipelineLayout,
      compute: {
        module: shaderModule,
        entryPoint: 'main'
      }
    });

    // Dispatch compute shader
    const commandEncoder = device.createCommandEncoder();
    const computePass = commandEncoder.beginComputePass();
    computePass.setPipeline(computePipeline);
    computePass.setBindGroup(0, bindGroup);

    // Workgroup size is 16x16, compute number of workgroups
    const workgroupsX = Math.ceil(width / 16);
    const workgroupsY = Math.ceil(height / 16);
    computePass.dispatchWorkgroups(workgroupsX, workgroupsY);
    computePass.end();

    // Copy output to staging buffer
    commandEncoder.copyBufferToBuffer(outputBuffer, 0, stagingBuffer, 0, outputSize);

    // Submit commands
    device.queue.submit([commandEncoder.finish()]);

    // Read back results
    await stagingBuffer.mapAsync(GPUMapMode.READ);
    const resultData = new Float32Array(stagingBuffer.getMappedRange().slice(0));
    stagingBuffer.unmap();

    // Clean up buffers
    uniformBuffer.destroy();
    vectorFieldBuffer.destroy();
    noiseBuffer.destroy();
    outputBuffer.destroy();
    stagingBuffer.destroy();

    return createLICResult(resultData, width, height);
  } finally {
    // Destroy context if we created it
    if (ownContext) {
      ctx.destroy();
    }
  }
}

/**
 * Compute and draw LIC directly to a canvas context.
 *
 * @param ctx - Canvas 2D rendering context
 * @param options - LIC computation options
 *
 * @example
 * ```typescript
 * await drawLIC(ctx, {
 *   vectorField: (x, y) => [y, -x],
 *   domain: { xMin: -2, xMax: 2, yMin: -2, yMax: 2 },
 *   width: canvas.width,
 *   height: canvas.height,
 * });
 * ```
 */
export async function drawLIC(
  ctx: CanvasRenderingContext2D,
  options: LICOptions
): Promise<void> {
  const result = await computeLIC(options);
  ctx.putImageData(result.toImageData(), 0, 0);
}
