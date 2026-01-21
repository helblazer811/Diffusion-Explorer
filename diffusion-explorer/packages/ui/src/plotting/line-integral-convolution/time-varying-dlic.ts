/**
 * Time-Varying Dynamic Line Integral Convolution (DLIC) implementation using WebGPU compute shaders.
 *
 * Extends standard DLIC with support for time-dependent vector fields by pre-computing
 * velocity fields at multiple time slices and interpolating between them in the shader.
 *
 * The 3D velocity buffer is organized as: [timeSlices][velocityHeight][velocityWidth]
 * When timeSlices == 1, this behaves identically to the standard DLIC.
 */

import type { DLICOptions, DLICResult, WebGPUContext, TimeVaryingVectorFieldFn, LICDomain } from './types';
import { generateScaledNoise } from './noise';
import { createLICResult } from './shared';
import { initWebGPUContext } from './line-integral-convolution';
import timeVaryingDlicShaderBase from './shaders/time-varying-dlic-shader.wgsl?raw';
import timeVaryingVelocityFieldShader from './shaders/time-varying-velocity-field.wgsl?raw';
import integrationShader from './shaders/integration.wgsl?raw';

// Concatenate shader sources
const timeVaryingDlicShaderSource = timeVaryingDlicShaderBase
  .replace('// PLACEHOLDER_VELOCITY_FIELD', timeVaryingVelocityFieldShader)
  .replace('// PLACEHOLDER_INTEGRATION', integrationShader);

// Default parameters
const DEFAULT_INTEGRATION_STEPS = 20;
const DEFAULT_STEP_SIZE = 0.5;
const DEFAULT_CONTRAST = 2.0;
const DEFAULT_NOISE_SCALE = 1.0;
const DEFAULT_MAX_ARC_LENGTH = 20.0;
const DEFAULT_WAVELENGTH = 40.0;
const DEFAULT_TIME_SLICES = 32;

/**
 * Extended DLIC options for time-varying vector fields.
 */
export interface TimeVaryingDLICOptions extends Omit<DLICOptions, 'vectorField'> {
  /** Time-varying vector field function (required) */
  timeVaryingVectorField: TimeVaryingVectorFieldFn;
  /** Number of time slices to pre-compute (default: 32) */
  timeSlices?: number;
  /**
   * Array of times to compute. If provided, overrides frameCount.
   * Each entry is a time value [0, 1] for the vector field.
   * Phases are computed automatically based on array length.
   */
  timeValues?: number[];
}

/**
 * Evaluate a time-varying vector field on a grid at multiple time slices.
 * Returns a 3D buffer organized as: [timeSlices][height][width] with vec2 values.
 */
export function evaluateTimeVaryingVectorFieldTo3DBuffer(
  vectorField: TimeVaryingVectorFieldFn,
  width: number,
  height: number,
  domain: LICDomain,
  timeSlices: number
): Float32Array {
  // Total size: timeSlices * height * width * 2 (for vec2)
  const buffer = new Float32Array(timeSlices * width * height * 2);

  const xScale = (domain.xMax - domain.xMin) / width;
  const yScale = (domain.yMax - domain.yMin) / height;
  const sliceSize = width * height * 2;

  for (let t = 0; t < timeSlices; t++) {
    // Map time slice index to time value [0, 1]
    const time = timeSlices > 1 ? t / (timeSlices - 1) : 0;
    const sliceOffset = t * sliceSize;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Map pixel center to world coordinates
        const worldX = domain.xMin + (x + 0.5) * xScale;
        const worldY = domain.yMin + (y + 0.5) * yScale;

        const [vx, vy] = vectorField(worldX, worldY, time);

        // Convert world-space velocity to pixel-space velocity
        const pxVx = vx / xScale;
        const pxVy = vy / yScale;

        const idx = sliceOffset + (y * width + x) * 2;
        buffer[idx] = pxVx;
        buffer[idx + 1] = pxVy;
      }
    }
  }

  return buffer;
}

/**
 * Compute Time-Varying Dynamic LIC for a time-dependent vector field using WebGPU.
 *
 * This pre-computes the vector field at multiple time slices and uploads them
 * all to the GPU, allowing efficient temporal interpolation in the shader.
 *
 * @param options - Time-varying DLIC computation options
 * @param context - Optional WebGPU context (will create one if not provided)
 * @yields DLICResult[] - Batch of computed frames after each batch completes
 * @throws Error if WebGPU is not available
 *
 * @example
 * ```typescript
 * // Time-varying vector field from a flow model
 * const vectorField = (x, y, t) => {
 *   // Get velocity from flow model at time t
 *   return model.getVelocity(x, y, t);
 * };
 *
 * // Compute DLIC frames
 * const allFrames: DLICResult[] = [];
 * for await (const batchResults of computeTimeVaryingDLIC({
 *   timeVaryingVectorField: vectorField,
 *   domain: { xMin: -3, xMax: 3, yMin: -3, yMax: 3 },
 *   width: 512,
 *   height: 512,
 *   phase: 0,
 *   frameCount: 60,
 *   timeSlices: 32,
 * })) {
 *   allFrames.push(...batchResults);
 * }
 * ```
 */
export async function* computeTimeVaryingDLIC(
  options: TimeVaryingDLICOptions,
  context?: WebGPUContext
): AsyncGenerator<DLICResult[], void, void> {
  const {
    timeVaryingVectorField,
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
    velocityScale = 1.0,
    phase,
    wavelength = DEFAULT_WAVELENGTH,
    padding = 0,
    frameCount,
    batchSize = 8,
    timeSlices = DEFAULT_TIME_SLICES,
    timeValues,
  } = options;

  // Compute padded dimensions for edge artifact elimination
  const paddedWidth = width + 2 * padding;
  const paddedHeight = height + 2 * padding;

  // Expand domain to cover padded region
  const domainWidth = domain.xMax - domain.xMin;
  const domainHeight = domain.yMax - domain.yMin;
  const padFracX = padding / width;
  const padFracY = padding / height;
  const paddedDomain = {
    xMin: domain.xMin - padFracX * domainWidth,
    xMax: domain.xMax + padFracX * domainWidth,
    yMin: domain.yMin - padFracY * domainHeight,
    yMax: domain.yMax + padFracY * domainHeight,
  };

  // Compute velocity grid dimensions (based on padded size)
  const velocityWidth = Math.max(1, Math.round(paddedWidth * velocityScale));
  const velocityHeight = Math.max(1, Math.round(paddedHeight * velocityScale));

  // Get or create WebGPU context
  const ownContext = !context;
  const ctx = context ?? await initWebGPUContext();
  const { device } = ctx;

  // Determine number of frames to compute
  const totalFrames = timeValues?.length ?? (frameCount !== undefined && frameCount > 1 ? frameCount : 1);
  const effectiveBatchSize = Math.min(batchSize, totalFrames);

  // Declare shared buffers outside try block
  let vectorFieldBuffer: GPUBuffer | undefined;
  let noiseBuffer: GPUBuffer | undefined;

  try {
    // ========================================================================
    // Pre-compute time-varying vector field at multiple time slices
    // ========================================================================

    console.log(`[TimeVaryingDLIC] Pre-computing ${timeSlices} time slices of velocity field...`);
    const vectorFieldData = evaluateTimeVaryingVectorFieldTo3DBuffer(
      timeVaryingVectorField,
      velocityWidth,
      velocityHeight,
      paddedDomain,
      timeSlices
    );
    console.log(`[TimeVaryingDLIC] Velocity buffer size: ${(vectorFieldData.byteLength / 1024 / 1024).toFixed(2)} MB`);

    // ========================================================================
    // Shared resources (created once, reused across all frames)
    // ========================================================================

    // Create shader module
    const shaderModule = device.createShaderModule({
      label: 'Time-Varying DLIC Compute Shader',
      code: timeVaryingDlicShaderSource
    });

    // Create bind group layout
    const bindGroupLayout = device.createBindGroupLayout({
      label: 'Time-Varying DLIC Bind Group Layout',
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

    // Create compute pipeline
    const pipelineLayout = device.createPipelineLayout({
      label: 'Time-Varying DLIC Pipeline Layout',
      bindGroupLayouts: [bindGroupLayout]
    });

    const computePipeline = device.createComputePipeline({
      label: 'Time-Varying DLIC Compute Pipeline',
      layout: pipelineLayout,
      compute: {
        module: shaderModule,
        entryPoint: 'main'
      }
    });

    // Upload 3D vector field buffer
    vectorFieldBuffer = device.createBuffer({
      label: 'Time-Varying Vector Field',
      size: vectorFieldData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(vectorFieldBuffer, 0, vectorFieldData.buffer);

    // Generate and upload noise texture
    const noiseData = generateScaledNoise(paddedWidth, paddedHeight, noiseScale, seed);
    noiseBuffer = device.createBuffer({
      label: 'Noise Texture',
      size: noiseData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(noiseBuffer, 0, noiseData.buffer);

    // Compute workgroups (16x16 workgroup size)
    const workgroupsX = Math.ceil(paddedWidth / 16);
    const workgroupsY = Math.ceil(paddedHeight / 16);

    // Output buffer size
    const outputSize = paddedWidth * paddedHeight * 4; // Float32

    // Uniform buffer size (must be 80 bytes for the extended struct)
    const uniformSize = 80; // 18 u32/f32 values * 4 bytes + padding

    // ========================================================================
    // Batch processing loop
    // ========================================================================

    for (let batchStart = 0; batchStart < totalFrames; batchStart += effectiveBatchSize) {
      const batchEnd = Math.min(batchStart + effectiveBatchSize, totalFrames);
      const batchFrameCount = batchEnd - batchStart;

      // Per-batch resources
      const uniformBuffers: GPUBuffer[] = [];
      const outputBuffers: GPUBuffer[] = [];
      const magnitudeBuffers: GPUBuffer[] = [];
      const stagingBuffers: GPUBuffer[] = [];
      const magnitudeStagingBuffers: GPUBuffer[] = [];
      const bindGroups: GPUBindGroup[] = [];

      // Create resources for each frame in this batch
      for (let i = 0; i < batchFrameCount; i++) {
        const frameIndex = batchStart + i;

        // Compute phase and time for this frame
        const framePhase = totalFrames > 1 ? frameIndex / totalFrames : phase;
        const frameTime = timeValues ? timeValues[frameIndex] : framePhase;

        // Create uniform buffer with this frame's phase and time
        const uniformData = new ArrayBuffer(uniformSize);
        const uniformView = new DataView(uniformData);
        uniformView.setUint32(0, paddedWidth, true);          // width (padded)
        uniformView.setUint32(4, paddedHeight, true);         // height (padded)
        uniformView.setUint32(8, integrationSteps, true);     // maxIterations
        uniformView.setFloat32(12, stepSize, true);           // stepSize
        uniformView.setFloat32(16, paddedDomain.xMin, true);  // xMin (padded)
        uniformView.setFloat32(20, paddedDomain.xMax, true);  // xMax (padded)
        uniformView.setFloat32(24, paddedDomain.yMin, true);  // yMin (padded)
        uniformView.setFloat32(28, paddedDomain.yMax, true);  // yMax (padded)
        uniformView.setFloat32(32, contrast, true);           // contrast
        uniformView.setUint32(36, nearestNeighborVelocity ? 1 : 0, true); // nearestNeighborVelocity
        uniformView.setFloat32(40, maxArcLength, true);       // maxArcLength
        uniformView.setUint32(44, useEuler ? 1 : 0, true);    // useEuler
        uniformView.setUint32(48, velocityWidth, true);       // velocityWidth
        uniformView.setUint32(52, velocityHeight, true);      // velocityHeight
        uniformView.setFloat32(56, framePhase, true);         // phase (animation phase)
        uniformView.setFloat32(60, wavelength, true);         // wavelength
        uniformView.setFloat32(64, frameTime, true);          // time (for time-varying field)
        uniformView.setUint32(68, timeSlices, true);          // timeSlices

        const uniformBuffer = device.createBuffer({
          label: `Time-Varying DLIC Uniforms Frame ${frameIndex}`,
          size: uniformSize,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        device.queue.writeBuffer(uniformBuffer, 0, uniformData);
        uniformBuffers.push(uniformBuffer);

        // Create output buffers for this frame
        const outputBuffer = device.createBuffer({
          label: `Time-Varying DLIC Output Frame ${frameIndex}`,
          size: outputSize,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        });
        outputBuffers.push(outputBuffer);

        const magnitudeBuffer = device.createBuffer({
          label: `Magnitude Output Frame ${frameIndex}`,
          size: outputSize,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        });
        magnitudeBuffers.push(magnitudeBuffer);

        // Create staging buffers for readback
        const stagingBuffer = device.createBuffer({
          label: `Staging Buffer Frame ${frameIndex}`,
          size: outputSize,
          usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
        });
        stagingBuffers.push(stagingBuffer);

        const magnitudeStagingBuffer = device.createBuffer({
          label: `Magnitude Staging Buffer Frame ${frameIndex}`,
          size: outputSize,
          usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
        });
        magnitudeStagingBuffers.push(magnitudeStagingBuffer);

        // Create bind group (reuses shared vectorFieldBuffer and noiseBuffer)
        const bindGroup = device.createBindGroup({
          label: `Time-Varying DLIC Bind Group Frame ${frameIndex}`,
          layout: bindGroupLayout,
          entries: [
            { binding: 0, resource: { buffer: uniformBuffer } },
            { binding: 1, resource: { buffer: vectorFieldBuffer } },
            { binding: 2, resource: { buffer: noiseBuffer } },
            { binding: 3, resource: { buffer: outputBuffer } },
            { binding: 4, resource: { buffer: magnitudeBuffer } }
          ]
        });
        bindGroups.push(bindGroup);
      }

      // Single command encoder for entire batch
      const commandEncoder = device.createCommandEncoder();

      for (let i = 0; i < batchFrameCount; i++) {
        const computePass = commandEncoder.beginComputePass();
        computePass.setPipeline(computePipeline);
        computePass.setBindGroup(0, bindGroups[i]);
        computePass.dispatchWorkgroups(workgroupsX, workgroupsY);
        computePass.end();

        // Copy outputs to staging buffers
        commandEncoder.copyBufferToBuffer(outputBuffers[i], 0, stagingBuffers[i], 0, outputSize);
        commandEncoder.copyBufferToBuffer(magnitudeBuffers[i], 0, magnitudeStagingBuffers[i], 0, outputSize);
      }

      // Single submit for entire batch
      device.queue.submit([commandEncoder.finish()]);

      // Read back all frames in batch
      await Promise.all([
        ...stagingBuffers.map(b => b.mapAsync(GPUMapMode.READ)),
        ...magnitudeStagingBuffers.map(b => b.mapAsync(GPUMapMode.READ))
      ]);

      // Extract results from each frame in this batch
      const batchResults: DLICResult[] = [];
      for (let i = 0; i < batchFrameCount; i++) {
        const resultData = new Float32Array(stagingBuffers[i].getMappedRange().slice(0));
        const magnitudeData = new Float32Array(magnitudeStagingBuffers[i].getMappedRange().slice(0));

        stagingBuffers[i].unmap();
        magnitudeStagingBuffers[i].unmap();

        // Extract central region from padded result (if padding was used)
        if (padding > 0) {
          const croppedData = new Float32Array(width * height);
          const croppedMagnitude = new Float32Array(width * height);

          for (let y = 0; y < height; y++) {
            const srcRowStart = (y + padding) * paddedWidth + padding;
            const dstRowStart = y * width;
            for (let x = 0; x < width; x++) {
              croppedData[dstRowStart + x] = resultData[srcRowStart + x];
              croppedMagnitude[dstRowStart + x] = magnitudeData[srcRowStart + x];
            }
          }

          batchResults.push(createLICResult(croppedData, croppedMagnitude, width, height));
        } else {
          batchResults.push(createLICResult(resultData, magnitudeData, width, height));
        }
      }

      // Yield this batch immediately
      yield batchResults;

      // Destroy batch-specific buffers
      for (let i = 0; i < batchFrameCount; i++) {
        uniformBuffers[i].destroy();
        outputBuffers[i].destroy();
        magnitudeBuffers[i].destroy();
        stagingBuffers[i].destroy();
        magnitudeStagingBuffers[i].destroy();
      }
    }

  } finally {
    // Clean up shared buffers
    vectorFieldBuffer?.destroy();
    noiseBuffer?.destroy();

    // Destroy context if we created it
    if (ownContext) {
      ctx.destroy();
    }
  }
}
