/**
 * Line Integral Convolution (LIC) implementation using WebGPU compute shaders.
 *
 * LIC is a technique for visualizing vector fields by convolving a noise texture
 * along streamlines, producing a texture that shows flow direction and structure.
 */

import type { LICOptions, LICResult, WebGPUContext, VectorFieldFn, LICColorOptions, ColorPalette, RGBColor } from './types';
import { generateScaledNoise } from './noise';
import licShaderBase from './shaders/lic-shader.wgsl?raw';
import velocityFieldShader from './shaders/velocity-field.wgsl?raw';
import integrationShader from './shaders/integration.wgsl?raw';

// Concatenate shader sources: base shader + velocity field functions + integration functions
// Velocity field functions must come after bindings, integration functions must come after getDirection()
const licShaderSource = licShaderBase
  .replace(
    '// Velocity field functions are defined in velocity-field.wgsl and concatenated at build time',
    velocityFieldShader
  )
  .replace(
    '// Integration functions are defined in integration.wgsl and concatenated at build time',
    integrationShader
  );

// Default LIC parameters
const DEFAULT_INTEGRATION_STEPS = 20;
const DEFAULT_STEP_SIZE = 0.5;
const DEFAULT_CONTRAST = 2.0;
const DEFAULT_NOISE_SCALE = 1.0;
const DEFAULT_MAX_ARC_LENGTH = 20.0;

// ============================================================================
// Color Palettes
// ============================================================================

/**
 * Interpolate between colors in a palette.
 */
function interpolatePalette(colors: RGBColor[], t: number): RGBColor {
  const clampedT = Math.max(0, Math.min(1, t));
  const n = colors.length - 1;
  const i = Math.min(Math.floor(clampedT * n), n - 1);
  const f = clampedT * n - i;

  const c0 = colors[i];
  const c1 = colors[i + 1];

  return [
    Math.round(c0[0] + f * (c1[0] - c0[0])),
    Math.round(c0[1] + f * (c1[1] - c0[1])),
    Math.round(c0[2] + f * (c1[2] - c0[2])),
  ];
}

/**
 * Viridis color palette (perceptually uniform, colorblind-friendly).
 */
export const viridis: ColorPalette = (t) =>
  interpolatePalette(
    [
      [68, 1, 84],
      [72, 40, 120],
      [62, 73, 137],
      [49, 104, 142],
      [38, 130, 142],
      [31, 158, 137],
      [53, 183, 121],
      [109, 205, 89],
      [180, 222, 44],
      [253, 231, 37],
    ],
    t
  );

/**
 * Plasma color palette (perceptually uniform).
 */
export const plasma: ColorPalette = (t) =>
  interpolatePalette(
    [
      [13, 8, 135],
      [75, 3, 161],
      [125, 3, 168],
      [168, 34, 150],
      [203, 70, 121],
      [229, 107, 93],
      [248, 148, 65],
      [253, 195, 40],
      [240, 249, 33],
    ],
    t
  );

/**
 * Inferno color palette (perceptually uniform).
 */
export const inferno: ColorPalette = (t) =>
  interpolatePalette(
    [
      [0, 0, 4],
      [40, 11, 84],
      [101, 21, 110],
      [159, 42, 99],
      [212, 72, 66],
      [245, 125, 21],
      [250, 193, 39],
      [252, 255, 164],
    ],
    t
  );

/**
 * Cool-warm diverging palette (blue to red).
 */
export const coolwarm: ColorPalette = (t) =>
  interpolatePalette(
    [
      [59, 76, 192],
      [98, 130, 234],
      [141, 176, 254],
      [184, 208, 249],
      [221, 221, 221],
      [245, 196, 173],
      [244, 154, 123],
      [222, 96, 77],
      [180, 4, 38],
    ],
    t
  );

/**
 * Turbo color palette (rainbow-like but perceptually improved).
 */
export const turbo: ColorPalette = (t) =>
  interpolatePalette(
    [
      [48, 18, 59],
      [69, 91, 205],
      [40, 165, 225],
      [32, 217, 162],
      [121, 245, 79],
      [212, 238, 58],
      [253, 180, 47],
      [248, 102, 36],
      [221, 38, 30],
      [122, 4, 3],
    ],
    t
  );

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
function createLICResult(
  data: Float32Array,
  magnitude: Float32Array,
  width: number,
  height: number
): LICResult {
  return {
    data,
    magnitude,
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

    toColoredImageData(options: LICColorOptions): ImageData {
      const { palette, minMagnitude, maxMagnitude, backgroundColor = [0, 0, 0] } = options;
      const [bgR, bgG, bgB] = backgroundColor;

      // Find magnitude range if not provided
      let minMag = minMagnitude;
      let maxMag = maxMagnitude;

      if (minMag === undefined || maxMag === undefined) {
        let dataMin = Infinity;
        let dataMax = -Infinity;
        for (let i = 0; i < magnitude.length; i++) {
          const m = magnitude[i];
          if (m < dataMin) dataMin = m;
          if (m > dataMax) dataMax = m;
        }
        minMag = minMag ?? dataMin;
        maxMag = maxMag ?? dataMax;
      }

      const magRange = maxMag - minMag;
      const imageData = new ImageData(width, height);
      const pixels = imageData.data;

      for (let i = 0; i < data.length; i++) {
        const intensity = data[i];
        const mag = magnitude[i];

        // Normalize magnitude to [0, 1]
        const normalizedMag = magRange > 0 ? (mag - minMag) / magRange : 0.5;

        // Get color from palette
        const [r, g, b] = palette(normalizedMag);

        // Blend between background color and palette color based on intensity
        const pixelIdx = i * 4;
        pixels[pixelIdx] = Math.round(bgR + (r - bgR) * intensity);     // R
        pixels[pixelIdx + 1] = Math.round(bgG + (g - bgG) * intensity); // G
        pixels[pixelIdx + 2] = Math.round(bgB + (b - bgB) * intensity); // B
        pixels[pixelIdx + 3] = 255;                                     // A
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
    contrast = DEFAULT_CONTRAST,
    noiseScale = DEFAULT_NOISE_SCALE,
    nearestNeighborVelocity = false,
    maxArcLength = DEFAULT_MAX_ARC_LENGTH,
    useEuler = false,
    velocityScale = 1.0
  } = options;

  // Compute velocity grid dimensions
  const velocityWidth = Math.max(1, Math.round(width * velocityScale));
  const velocityHeight = Math.max(1, Math.round(height * velocityScale));

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

    // Create uniform buffer (56 bytes: 14 fields, 16-byte aligned)
    const uniformData = new ArrayBuffer(56);
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
    uniformView.setUint32(36, nearestNeighborVelocity ? 1 : 0, true); // nearestNeighborVelocity
    uniformView.setFloat32(40, maxArcLength, true); // maxArcLength
    uniformView.setUint32(44, useEuler ? 1 : 0, true); // useEuler
    uniformView.setUint32(48, velocityWidth, true); // velocityWidth
    uniformView.setUint32(52, velocityHeight, true); // velocityHeight

    const uniformBuffer = device.createBuffer({
      label: 'LIC Uniforms',
      size: uniformData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(uniformBuffer, 0, uniformData);

    // Pre-compute vector field on CPU grid (may be lower resolution than output)
    const vectorFieldData = evaluateVectorFieldToBuffer(vectorField, velocityWidth, velocityHeight, domain);
    const vectorFieldBuffer = device.createBuffer({
      label: 'Vector Field',
      size: vectorFieldData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(vectorFieldBuffer, 0, vectorFieldData.buffer);

    // Generate and upload noise texture (scaled for wider streaks)
    const noiseData = generateScaledNoise(width, height, noiseScale, seed);
    const noiseBuffer = device.createBuffer({
      label: 'Noise Texture',
      size: noiseData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(noiseBuffer, 0, noiseData.buffer);

    // Create output buffer for LIC intensity
    const outputSize = width * height * 4; // Float32
    const outputBuffer = device.createBuffer({
      label: 'LIC Output',
      size: outputSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    });

    // Create output buffer for magnitude
    const magnitudeBuffer = device.createBuffer({
      label: 'Magnitude Output',
      size: outputSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    });

    // Create staging buffers for readback
    const stagingBuffer = device.createBuffer({
      label: 'Staging Buffer',
      size: outputSize,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
    });

    const magnitudeStagingBuffer = device.createBuffer({
      label: 'Magnitude Staging Buffer',
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
        },
        {
          binding: 4,
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
        { binding: 3, resource: { buffer: outputBuffer } },
        { binding: 4, resource: { buffer: magnitudeBuffer } }
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

    // Copy outputs to staging buffers
    commandEncoder.copyBufferToBuffer(outputBuffer, 0, stagingBuffer, 0, outputSize);
    commandEncoder.copyBufferToBuffer(magnitudeBuffer, 0, magnitudeStagingBuffer, 0, outputSize);

    // Submit commands
    device.queue.submit([commandEncoder.finish()]);

    // Read back results
    await Promise.all([
      stagingBuffer.mapAsync(GPUMapMode.READ),
      magnitudeStagingBuffer.mapAsync(GPUMapMode.READ)
    ]);

    const resultData = new Float32Array(stagingBuffer.getMappedRange().slice(0));
    const magnitudeData = new Float32Array(magnitudeStagingBuffer.getMappedRange().slice(0));

    stagingBuffer.unmap();
    magnitudeStagingBuffer.unmap();

    // Clean up buffers
    uniformBuffer.destroy();
    vectorFieldBuffer.destroy();
    noiseBuffer.destroy();
    outputBuffer.destroy();
    magnitudeBuffer.destroy();
    stagingBuffer.destroy();
    magnitudeStagingBuffer.destroy();

    return createLICResult(resultData, magnitudeData, width, height);
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
