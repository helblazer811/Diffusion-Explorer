/**
 * Dynamic Line Integral Convolution (DLIC) implementation using WebGPU compute shaders.
 *
 * DLIC extends LIC with phase-based noise advection, creating animated vector field
 * visualizations with flowing texture effects. The noise appears to move along
 * streamlines, creating the illusion of particles flowing through the field.
 */

import type { DLICOptions, DLICResult, WebGPUContext } from './types';
import { generateScaledNoise } from './noise';
import { evaluateVectorFieldToBuffer, createLICResult } from './shared';
import { initWebGPUContext } from './line-integral-convolution';
import dlicShaderBase from './shaders/dlic-shader.wgsl?raw';
import velocityFieldShader from './shaders/velocity-field.wgsl?raw';
import integrationShader from './shaders/integration.wgsl?raw';

// Concatenate shader sources: base shader + velocity field functions + integration functions
const dlicShaderSource = dlicShaderBase
  .replace(
    '// Velocity field functions are defined in velocity-field.wgsl and concatenated at build time',
    velocityFieldShader
  )
  .replace(
    '// Integration functions are defined in integration.wgsl and concatenated at build time',
    integrationShader
  );

// Default DLIC parameters
const DEFAULT_INTEGRATION_STEPS = 20;
const DEFAULT_STEP_SIZE = 0.5;
const DEFAULT_CONTRAST = 2.0;
const DEFAULT_NOISE_SCALE = 1.0;
const DEFAULT_MAX_ARC_LENGTH = 20.0;
const DEFAULT_WAVELENGTH = 40.0;

/**
 * Compute Dynamic Line Integral Convolution for a vector field using WebGPU.
 *
 * This is an async generator that yields batches of frames as they complete,
 * allowing the UI to display frames progressively and start animation playback
 * before all frames are ready.
 *
 * @param options - DLIC computation options (includes phase for animation)
 * @param context - Optional WebGPU context (will create one if not provided)
 * @yields DLICResult[] - Batch of computed frames after each batch completes
 * @throws Error if WebGPU is not available
 *
 * @example
 * ```typescript
 * // Single frame at phase 0.5
 * for await (const results of computeDLIC({
 *   vectorField: (x, y) => [y, -x],
 *   domain: { xMin: -2, xMax: 2, yMin: -2, yMax: 2 },
 *   width: 512,
 *   height: 512,
 *   phase: 0.5,
 *   wavelength: 40,
 * })) {
 *   // Process single frame
 *   const result = results[0];
 * }
 *
 * // Batched multi-frame computation with progressive loading
 * const allFrames: DLICResult[] = [];
 * for await (const batchResults of computeDLIC({
 *   vectorField: (x, y) => [y, -x],
 *   domain: { xMin: -2, xMax: 2, yMin: -2, yMax: 2 },
 *   width: 512,
 *   height: 512,
 *   phase: 0, // ignored when frameCount is set
 *   frameCount: 60,
 *   batchSize: 8,
 * })) {
 *   allFrames.push(...batchResults);
 *   // Can start animation here before all frames are loaded
 * }
 * ```
 */
export async function* computeDLIC(
  options: DLICOptions,
  context?: WebGPUContext
): AsyncGenerator<DLICResult[], void, void> {
  const {
    vectorField: staticVectorField,
    timeVaryingVectorField,
    time = 0,
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
  } = options;

  // Resolve vector field (static or time-varying)
  const vectorField = timeVaryingVectorField
    ? (x: number, y: number) => timeVaryingVectorField(x, y, time)
    : staticVectorField;

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
  const totalFrames = frameCount !== undefined && frameCount > 1 ? frameCount : 1;
  const effectiveBatchSize = Math.min(batchSize, totalFrames);

  // Declare shared buffers outside try block so they're accessible in finally
  let vectorFieldBuffer: GPUBuffer | undefined;
  let noiseBuffer: GPUBuffer | undefined;

  try {
    // ========================================================================
    // Shared resources (created once, reused across all frames)
    // ========================================================================

    // Create shader module
    const shaderModule = device.createShaderModule({
      label: 'DLIC Compute Shader',
      code: dlicShaderSource
    });

    // Create bind group layout
    const bindGroupLayout = device.createBindGroupLayout({
      label: 'DLIC Bind Group Layout',
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
      label: 'DLIC Pipeline Layout',
      bindGroupLayouts: [bindGroupLayout]
    });

    const computePipeline = device.createComputePipeline({
      label: 'DLIC Compute Pipeline',
      layout: pipelineLayout,
      compute: {
        module: shaderModule,
        entryPoint: 'main'
      }
    });

    // Pre-compute vector field on CPU grid (use padded domain)
    const vectorFieldData = evaluateVectorFieldToBuffer(vectorField, velocityWidth, velocityHeight, paddedDomain);
    vectorFieldBuffer = device.createBuffer({
      label: 'Vector Field',
      size: vectorFieldData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(vectorFieldBuffer, 0, vectorFieldData.buffer);

    // Generate and upload noise texture (scaled for wider streaks, padded dimensions)
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
        // Compute phase: use provided phase for single frame, auto-compute for batched
        const framePhase = totalFrames > 1 ? frameIndex / totalFrames : phase;

        // Create uniform buffer with this frame's phase
        const uniformData = new ArrayBuffer(64);
        const uniformView = new DataView(uniformData);
        uniformView.setUint32(0, paddedWidth, true);          // width (padded)
        uniformView.setUint32(4, paddedHeight, true);         // height (padded)
        uniformView.setUint32(8, integrationSteps, true);     // integrationSteps
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
        uniformView.setFloat32(56, framePhase, true);         // phase (DLIC-specific)
        uniformView.setFloat32(60, wavelength, true);         // wavelength (DLIC-specific)

        const uniformBuffer = device.createBuffer({
          label: `DLIC Uniforms Frame ${frameIndex}`,
          size: uniformData.byteLength,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        device.queue.writeBuffer(uniformBuffer, 0, uniformData);
        uniformBuffers.push(uniformBuffer);

        // Create output buffers for this frame
        const outputBuffer = device.createBuffer({
          label: `DLIC Output Frame ${frameIndex}`,
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
          label: `DLIC Bind Group Frame ${frameIndex}`,
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

      // Yield this batch immediately instead of accumulating
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
    // Clean up shared buffers (only if they were created)
    vectorFieldBuffer?.destroy();
    noiseBuffer?.destroy();

    // Destroy context if we created it
    if (ownContext) {
      ctx.destroy();
    }
  }
}

/**
 * Compute and draw DLIC directly to a canvas context.
 *
 * @param ctx - Canvas 2D rendering context
 * @param options - DLIC computation options
 *
 * @example
 * ```typescript
 * await drawDLIC(ctx, {
 *   vectorField: (x, y) => [y, -x],
 *   domain: { xMin: -2, xMax: 2, yMin: -2, yMax: 2 },
 *   width: canvas.width,
 *   height: canvas.height,
 *   phase: 0.5,
 * });
 * ```
 */
export async function drawDLIC(
  ctx: CanvasRenderingContext2D,
  options: DLICOptions
): Promise<void> {
  // Ensure single-frame mode by omitting frameCount and batchSize
  const { frameCount: _, batchSize: __, ...singleFrameOptions } = options;
  // Consume single-frame generator
  for await (const results of computeDLIC(singleFrameOptions as DLICOptions)) {
    ctx.putImageData(results[0].toImageData(), 0, 0);
    break; // Only need first result for single frame
  }
}
