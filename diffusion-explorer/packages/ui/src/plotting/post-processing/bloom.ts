/**
 * Bloom Post-Processing Effect
 *
 * Applies a multi-pass bloom effect:
 * 1. Threshold: Extract bright pixels
 * 2. Blur: Multi-pass separable Gaussian blur
 * 3. Composite: Additive blend with original
 */

import type { PostProcessEffect, BloomOptions } from './types';
import { DEFAULT_BLOOM_OPTIONS } from './types';
import bloomShaderSource from './shaders/bloom.wgsl?raw';

// Uniform buffer sizes (16-byte aligned)
const THRESHOLD_UNIFORM_SIZE = 16; // 4 floats
const BLUR_UNIFORM_SIZE = 32;      // 8 floats
const COMPOSITE_UNIFORM_SIZE = 16; // 4 floats

/**
 * Bloom post-processing effect.
 *
 * Usage:
 * ```typescript
 * const bloom = await BloomEffect.create(device, format, width, height);
 *
 * // Per frame:
 * const encoder = device.createCommandEncoder();
 * bloom.apply(encoder, sourceTexture, canvasView, { intensity: 1.5 });
 * device.queue.submit([encoder.finish()]);
 * ```
 */
export class BloomEffect implements PostProcessEffect {
  readonly name = 'bloom';

  private device: GPUDevice;
  private format: GPUTextureFormat;
  private width: number;
  private height: number;

  // Pipelines
  private thresholdPipeline: GPURenderPipeline;
  private blurPipeline: GPURenderPipeline;
  private compositePipeline: GPURenderPipeline;

  // Bind group layouts
  private thresholdBindGroupLayout: GPUBindGroupLayout;
  private blurBindGroupLayout: GPUBindGroupLayout;
  private compositeBindGroupLayout: GPUBindGroupLayout;

  // Uniform buffers
  private thresholdUniformBuffer: GPUBuffer;
  private blurUniformBuffer: GPUBuffer;
  private compositeUniformBuffer: GPUBuffer;

  // Ping-pong textures for blur
  private pingPongTextures: [GPUTexture, GPUTexture];

  // Sampler
  private sampler: GPUSampler;

  private constructor(
    device: GPUDevice,
    format: GPUTextureFormat,
    width: number,
    height: number,
    thresholdPipeline: GPURenderPipeline,
    blurPipeline: GPURenderPipeline,
    compositePipeline: GPURenderPipeline,
    thresholdBindGroupLayout: GPUBindGroupLayout,
    blurBindGroupLayout: GPUBindGroupLayout,
    compositeBindGroupLayout: GPUBindGroupLayout,
    thresholdUniformBuffer: GPUBuffer,
    blurUniformBuffer: GPUBuffer,
    compositeUniformBuffer: GPUBuffer,
    pingPongTextures: [GPUTexture, GPUTexture],
    sampler: GPUSampler
  ) {
    this.device = device;
    this.format = format;
    this.width = width;
    this.height = height;
    this.thresholdPipeline = thresholdPipeline;
    this.blurPipeline = blurPipeline;
    this.compositePipeline = compositePipeline;
    this.thresholdBindGroupLayout = thresholdBindGroupLayout;
    this.blurBindGroupLayout = blurBindGroupLayout;
    this.compositeBindGroupLayout = compositeBindGroupLayout;
    this.thresholdUniformBuffer = thresholdUniformBuffer;
    this.blurUniformBuffer = blurUniformBuffer;
    this.compositeUniformBuffer = compositeUniformBuffer;
    this.pingPongTextures = pingPongTextures;
    this.sampler = sampler;
  }

  /**
   * Create a new BloomEffect.
   *
   * @param device - WebGPU device
   * @param format - Texture format (should match canvas format)
   * @param width - Texture width in pixels
   * @param height - Texture height in pixels
   * @returns Promise resolving to BloomEffect instance
   */
  static async create(
    device: GPUDevice,
    format: GPUTextureFormat,
    width: number,
    height: number
  ): Promise<BloomEffect> {
    // Create shader module
    const shaderModule = device.createShaderModule({
      label: 'Bloom Shader',
      code: bloomShaderSource,
    });

    // Create sampler
    const sampler = device.createSampler({
      label: 'Bloom Sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });

    // Create uniform buffers
    const thresholdUniformBuffer = device.createBuffer({
      label: 'Bloom Threshold Uniforms',
      size: THRESHOLD_UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const blurUniformBuffer = device.createBuffer({
      label: 'Bloom Blur Uniforms',
      size: BLUR_UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const compositeUniformBuffer = device.createBuffer({
      label: 'Bloom Composite Uniforms',
      size: COMPOSITE_UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Create bind group layouts
    // Threshold: source texture, sampler, threshold uniforms
    const thresholdBindGroupLayout = device.createBindGroupLayout({
      label: 'Bloom Threshold Bind Group Layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: 'filtering' },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
      ],
    });

    // Blur: source texture, sampler, threshold uniforms (unused), blur uniforms
    const blurBindGroupLayout = device.createBindGroupLayout({
      label: 'Bloom Blur Bind Group Layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: 'filtering' },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
      ],
    });

    // Composite: source texture, sampler, threshold uniforms (unused), blur uniforms (unused),
    // bloom texture, bloom sampler, composite uniforms
    const compositeBindGroupLayout = device.createBindGroupLayout({
      label: 'Bloom Composite Bind Group Layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: 'filtering' },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
        {
          binding: 4,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float' },
        },
        {
          binding: 5,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: 'filtering' },
        },
        {
          binding: 6,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
      ],
    });

    // Create pipeline layouts
    const thresholdPipelineLayout = device.createPipelineLayout({
      label: 'Bloom Threshold Pipeline Layout',
      bindGroupLayouts: [thresholdBindGroupLayout],
    });

    const blurPipelineLayout = device.createPipelineLayout({
      label: 'Bloom Blur Pipeline Layout',
      bindGroupLayouts: [blurBindGroupLayout],
    });

    const compositePipelineLayout = device.createPipelineLayout({
      label: 'Bloom Composite Pipeline Layout',
      bindGroupLayouts: [compositeBindGroupLayout],
    });

    // Create pipelines
    const thresholdPipeline = device.createRenderPipeline({
      label: 'Bloom Threshold Pipeline',
      layout: thresholdPipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_fullscreen',
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_threshold',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-list' },
    });

    const blurPipeline = device.createRenderPipeline({
      label: 'Bloom Blur Pipeline',
      layout: blurPipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_fullscreen',
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_blur',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-list' },
    });

    const compositePipeline = device.createRenderPipeline({
      label: 'Bloom Composite Pipeline',
      layout: compositePipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_fullscreen',
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_composite',
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
      primitive: { topology: 'triangle-list' },
    });

    // Create ping-pong textures for blur
    const pingPongTextures = BloomEffect.createPingPongTextures(
      device,
      format,
      width,
      height
    );

    return new BloomEffect(
      device,
      format,
      width,
      height,
      thresholdPipeline,
      blurPipeline,
      compositePipeline,
      thresholdBindGroupLayout,
      blurBindGroupLayout,
      compositeBindGroupLayout,
      thresholdUniformBuffer,
      blurUniformBuffer,
      compositeUniformBuffer,
      pingPongTextures,
      sampler
    );
  }

  /**
   * Create ping-pong textures for blur passes.
   */
  private static createPingPongTextures(
    device: GPUDevice,
    format: GPUTextureFormat,
    width: number,
    height: number
  ): [GPUTexture, GPUTexture] {
    const createTexture = (label: string) =>
      device.createTexture({
        label,
        size: { width, height },
        format,
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });

    return [
      createTexture('Bloom Ping Texture'),
      createTexture('Bloom Pong Texture'),
    ];
  }

  /**
   * Apply bloom effect to a source texture.
   *
   * @param encoder - GPU command encoder
   * @param source - Source texture to apply bloom to
   * @param target - Target texture view for final output
   * @param options - Bloom parameters
   */
  apply(
    encoder: GPUCommandEncoder,
    source: GPUTexture,
    target: GPUTextureView,
    options?: BloomOptions
  ): void {
    const opts = { ...DEFAULT_BLOOM_OPTIONS, ...options };

    // Update uniforms
    this.updateUniforms(opts);

    // Pass 1: Threshold - extract bright pixels to pingPongTextures[0]
    this.renderThreshold(encoder, source);

    // Pass 2: Blur - ping-pong between textures
    this.renderBlur(encoder, opts.iterations!, opts.radius!);

    // Pass 3: Composite - blend original + bloom to target
    this.renderComposite(encoder, source, target);
  }

  /**
   * Update uniform buffers with current options.
   */
  private updateUniforms(opts: Required<BloomOptions>): void {
    // Threshold uniforms
    const thresholdData = new Float32Array([
      opts.threshold,
      opts.softKnee,
      0, // padding
      0, // padding
    ]);
    this.device.queue.writeBuffer(this.thresholdUniformBuffer, 0, thresholdData);

    // Composite uniforms
    const compositeData = new Float32Array([
      opts.intensity,
      0, // padding
      0, // padding
      0, // padding
    ]);
    this.device.queue.writeBuffer(this.compositeUniformBuffer, 0, compositeData);
  }

  /**
   * Render threshold pass.
   */
  private renderThreshold(encoder: GPUCommandEncoder, source: GPUTexture): void {
    const bindGroup = this.device.createBindGroup({
      label: 'Bloom Threshold Bind Group',
      layout: this.thresholdBindGroupLayout,
      entries: [
        { binding: 0, resource: source.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: this.thresholdUniformBuffer } },
      ],
    });

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.pingPongTextures[0].createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });

    pass.setPipeline(this.thresholdPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(6);
    pass.end();
  }

  /**
   * Render blur passes.
   */
  private renderBlur(
    encoder: GPUCommandEncoder,
    iterations: number,
    radius: number
  ): void {
    const texelSize = [1.0 / this.width, 1.0 / this.height];

    for (let i = 0; i < iterations; i++) {
      // Horizontal blur: pingPongTextures[0] -> pingPongTextures[1]
      this.renderBlurPass(
        encoder,
        this.pingPongTextures[0],
        this.pingPongTextures[1],
        [1, 0], // horizontal
        texelSize,
        radius
      );

      // Vertical blur: pingPongTextures[1] -> pingPongTextures[0]
      this.renderBlurPass(
        encoder,
        this.pingPongTextures[1],
        this.pingPongTextures[0],
        [0, 1], // vertical
        texelSize,
        radius
      );
    }
  }

  /**
   * Render a single blur pass.
   */
  private renderBlurPass(
    encoder: GPUCommandEncoder,
    source: GPUTexture,
    target: GPUTexture,
    direction: [number, number],
    texelSize: number[],
    radius: number
  ): void {
    // Update blur uniforms
    const blurData = new Float32Array([
      direction[0],
      direction[1],
      texelSize[0],
      texelSize[1],
      radius,
      0, // padding
      0, // padding
      0, // padding
    ]);
    this.device.queue.writeBuffer(this.blurUniformBuffer, 0, blurData);

    const bindGroup = this.device.createBindGroup({
      label: 'Bloom Blur Bind Group',
      layout: this.blurBindGroupLayout,
      entries: [
        { binding: 0, resource: source.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: this.thresholdUniformBuffer } },
        { binding: 3, resource: { buffer: this.blurUniformBuffer } },
      ],
    });

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: target.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });

    pass.setPipeline(this.blurPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(6);
    pass.end();
  }

  /**
   * Render composite pass.
   */
  private renderComposite(
    encoder: GPUCommandEncoder,
    source: GPUTexture,
    target: GPUTextureView
  ): void {
    const bindGroup = this.device.createBindGroup({
      label: 'Bloom Composite Bind Group',
      layout: this.compositeBindGroupLayout,
      entries: [
        { binding: 0, resource: source.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: this.thresholdUniformBuffer } },
        { binding: 4, resource: this.pingPongTextures[0].createView() },
        { binding: 5, resource: this.sampler },
        { binding: 6, resource: { buffer: this.compositeUniformBuffer } },
      ],
    });

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: target,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });

    pass.setPipeline(this.compositePipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(6);
    pass.end();
  }

  /**
   * Resize internal textures when canvas size changes.
   *
   * @param width - New width in pixels
   * @param height - New height in pixels
   */
  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) {
      return;
    }

    this.width = width;
    this.height = height;

    // Destroy old textures
    this.pingPongTextures[0].destroy();
    this.pingPongTextures[1].destroy();

    // Create new textures
    this.pingPongTextures = BloomEffect.createPingPongTextures(
      this.device,
      this.format,
      width,
      height
    );
  }

  /**
   * Release all GPU resources.
   */
  destroy(): void {
    this.thresholdUniformBuffer.destroy();
    this.blurUniformBuffer.destroy();
    this.compositeUniformBuffer.destroy();
    this.pingPongTextures[0].destroy();
    this.pingPongTextures[1].destroy();
  }
}
