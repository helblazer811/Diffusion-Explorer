<!-- Introduces the concept of divergence in flow matching with three side-by-side canvases. -->
<!-- Uses GPU-accelerated WebGPU streamline rendering with bloom post-processing. -->

<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import {
    TripleFigure,
    Katex,
    StreamlineRenderer,
    prepareStreamlineData,
    generateStreamlines,
    type VectorFieldFn,
    type StreamlineGPUData,
  } from "@diffusion-explorer/ui";
  import { BloomEffect, type BloomOptions } from "@diffusion-explorer/ui/plotting/post-processing";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  // Caption slot
  export let children = undefined;

  // Layout
  export let width = 800;
  export let height = 250;
  export let gap = 20;
  export let backgroundVisible = false;

  // Animation
  export let playingByDefault = true;

  // Streamline generation
  // Use a larger domain than visible area so streamlines extend to edges
  export let domainRange = { xMin: -2.5, xMax: 2.5, yMin: -2.5, yMax: 2.5 };
  export let visibleRange = { xMin: -2, xMax: 2, yMin: -2, yMax: 2 };
  export let density: number | [number, number] = 1.0;
  export let minPathLength = 0.5;

  // Styling
  export let streamlineColor = "#3b82f6";
  export let streamlineWidth = 4.0;
  export let edgeFadeSize = 10; // Size of edge fade in pixels

  // Animation pulse settings (pixel-based)
  export let pulseWidthPixels = 40;       // Width of pulse in pixels
  export let pulsePauseWidthPixels = 10;  // Gap between pulses in pixels
  export let animationDuration = 6;       // Seconds for one animation cycle
  export let binaryPulse = false;         // true = solid pulses, false = gradient alpha

  // Bloom settings
  export let bloomEnabled = false;
  export let bloomThreshold = 0.3;
  export let bloomIntensity = 1.2;
  export let bloomRadius = 6;

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  // Visibility state from TripleFigure
  let isActive: ReturnType<typeof import('svelte/store').writable<boolean>> | undefined;

  // Compute canvas dimensions
  $: canvasWidth = 230;
  $: canvasHeight = height;

  // Three canvases
  let canvas1: HTMLCanvasElement | null = null;
  let canvas2: HTMLCanvasElement | null = null;
  let canvas3: HTMLCanvasElement | null = null;

  // GPU renderers
  let renderer1: StreamlineRenderer | null = null;
  let renderer2: StreamlineRenderer | null = null;
  let renderer3: StreamlineRenderer | null = null;

  // Shared WebGPU device (all renderers must use same device)
  let sharedDevice: GPUDevice | null = null;

  // Bloom effects
  let bloom1: BloomEffect | null = null;
  let bloom2: BloomEffect | null = null;
  let bloom3: BloomEffect | null = null;

  // Source textures for offscreen rendering
  let sourceTexture1: GPUTexture | null = null;
  let sourceTexture2: GPUTexture | null = null;
  let sourceTexture3: GPUTexture | null = null;

  // Animation state
  let isInitialized = false;
  let isPlaying = false;
  let wasPlayingBeforeHidden = false;
  let animationFrameId: number | null = null;
  let startTime: number | null = null;

  // WebGPU availability
  let webgpuAvailable = false;
  let initError: string | null = null;

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  /**
   * Converging vector field (pure sink, no curl).
   */
  function convergingFieldFn(k: number = 0.5): VectorFieldFn {
    return (x: number, y: number): [number, number] => [
      -k * x,
      -k * y
    ];
  }

  /**
   * Diverging vector field (pure source, no curl).
   */
  function divergingFieldFn(k: number = 0.5): VectorFieldFn {
    return (x: number, y: number): [number, number] => [
      k * x,
      k * y
    ];
  }

  /**
   * Diagonal uniform vector field (incompressible).
   */
  function diagonalFieldFn(c: number = 1.0): VectorFieldFn {
    return (_x: number, _y: number): [number, number] => [
      c,
      c
    ];
  }

  function createToPixel(cw: number, ch: number): (p: [number, number]) => [number, number] {
    // Map visible range to canvas (streamlines outside visible range will extend beyond canvas edges)
    return ([x, y]: [number, number]): [number, number] => [
      ((x - visibleRange.xMin) / (visibleRange.xMax - visibleRange.xMin)) * cw,
      ((visibleRange.yMax - y) / (visibleRange.yMax - visibleRange.yMin)) * ch
    ];
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function generateStreamlinesForField(vectorFieldFn: VectorFieldFn, cw: number, ch: number): number[][][] {
    const toPixel = createToPixel(cw, ch);

    // Generate streamlines in domain coordinates
    const rawStreamlines = generateStreamlines(vectorFieldFn, {
      domainMin: [domainRange.xMin, domainRange.yMin],
      domainMax: [domainRange.xMax, domainRange.yMax],
      density,
      integrationDirection: 'both',
      minlength: minPathLength,
    });

    // Convert to pixel coordinates
    return rawStreamlines.map((streamline) =>
      streamline.map((point) => toPixel(point as [number, number]))
    );
  }

  async function initializeRenderers() {
    if (!canvas1 || !canvas2 || !canvas3) return;

    // Check WebGPU availability
    if (!navigator.gpu) {
      initError = "WebGPU is not supported in this browser";
      return;
    }

    try {
      const dpr = window.devicePixelRatio || 1;

      // Set canvas sizes (physical pixels)
      canvas1.width = canvasWidth * dpr;
      canvas1.height = canvasHeight * dpr;
      canvas2.width = canvasWidth * dpr;
      canvas2.height = canvasHeight * dpr;
      canvas3.width = canvasWidth * dpr;
      canvas3.height = canvasHeight * dpr;

      // Create shared WebGPU device (all renderers must use the same device)
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        throw new Error('Failed to get WebGPU adapter');
      }
      sharedDevice = await adapter.requestDevice();

      const gpuContext = {
        adapter,
        device: sharedDevice,
        destroy: () => sharedDevice?.destroy(),
      };

      const rendererOptions = {
        dpr,
        thickness: streamlineWidth,
        pulseWidth: pulseWidthPixels,
        pulseGap: pulsePauseWidthPixels,
        baseOpacity: 0.8,
        color: streamlineColor,
        binaryPulse: binaryPulse ? 1.0 : 0.0,
        useSimpleSDF: true,
      };

      // Create renderers with shared device
      [renderer1, renderer2, renderer3] = await Promise.all([
        StreamlineRenderer.create(canvas1, rendererOptions, gpuContext),
        StreamlineRenderer.create(canvas2, rendererOptions, gpuContext),
        StreamlineRenderer.create(canvas3, rendererOptions, gpuContext),
      ]);

      // Generate streamlines for each field (in CSS pixels)
      const streamlines1 = generateStreamlinesForField(convergingFieldFn(0.5), canvasWidth, canvasHeight);
      const streamlines2 = generateStreamlinesForField(divergingFieldFn(0.5), canvasWidth, canvasHeight);
      const streamlines3 = generateStreamlinesForField(diagonalFieldFn(1.0), canvasWidth, canvasHeight);

      // Upload to GPU with random offsets
      renderer1.setStreamlines(streamlines1, 'random');
      renderer2.setStreamlines(streamlines2, 'random');
      renderer3.setStreamlines(streamlines3, 'random');

      // Create bloom effects if enabled
      if (bloomEnabled && sharedDevice) {
        const format = renderer1.getFormat();
        const physicalWidth = canvasWidth * dpr;
        const physicalHeight = canvasHeight * dpr;

        // Create source textures for offscreen rendering (using shared device)
        const textureDesc: GPUTextureDescriptor = {
          size: { width: physicalWidth, height: physicalHeight },
          format,
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
        };

        sourceTexture1 = sharedDevice.createTexture({ ...textureDesc, label: 'Divergence Intro Source 1' });
        sourceTexture2 = sharedDevice.createTexture({ ...textureDesc, label: 'Divergence Intro Source 2' });
        sourceTexture3 = sharedDevice.createTexture({ ...textureDesc, label: 'Divergence Intro Source 3' });

        // Create bloom effects (using shared device)
        [bloom1, bloom2, bloom3] = await Promise.all([
          BloomEffect.create(sharedDevice, format, physicalWidth, physicalHeight),
          BloomEffect.create(sharedDevice, format, physicalWidth, physicalHeight),
          BloomEffect.create(sharedDevice, format, physicalWidth, physicalHeight),
        ]);
      }

      webgpuAvailable = true;
      isInitialized = true;

      // Initial draw
      draw(0);

      if (playingByDefault) {
        startAnimation();
      }
    } catch (e) {
      initError = e instanceof Error ? e.message : "Failed to initialize WebGPU";
      console.error("WebGPU initialization error:", e);
    }
  }

  // ----------------------------------------------------------------
  // Animation
  // ----------------------------------------------------------------

  function draw(phase: number) {
    if (!renderer1 || !renderer2 || !renderer3) return;

    // Clear with transparent background
    const clearColor: [number, number, number, number] = [0, 0, 0, 0];

    // If bloom is enabled, render to offscreen texture then apply bloom
    if (bloomEnabled && bloom1 && bloom2 && bloom3 && sourceTexture1 && sourceTexture2 && sourceTexture3 && sharedDevice) {
      const device = sharedDevice;
      const bloomOptions: BloomOptions = {
        threshold: bloomThreshold,
        intensity: bloomIntensity,
        radius: bloomRadius,
      };

      // Render each canvas with bloom
      const renderWithBloom = (
        renderer: StreamlineRenderer,
        bloom: BloomEffect,
        sourceTexture: GPUTexture
      ) => {
        // Render streamlines to offscreen texture
        const renderCmd = renderer.renderToTexture({ phase }, sourceTexture.createView(), clearColor);
        device.queue.submit([renderCmd]);

        // Apply bloom and output to canvas
        const bloomEncoder = device.createCommandEncoder();
        const canvasView = renderer.getContext().getCurrentTexture().createView();
        bloom.apply(bloomEncoder, sourceTexture, canvasView, bloomOptions);
        device.queue.submit([bloomEncoder.finish()]);
      };

      renderWithBloom(renderer1, bloom1, sourceTexture1);
      renderWithBloom(renderer2, bloom2, sourceTexture2);
      renderWithBloom(renderer3, bloom3, sourceTexture3);
    } else {
      // No bloom - render directly to canvas
      renderer1.render({ phase }, clearColor);
      renderer2.render({ phase }, clearColor);
      renderer3.render({ phase }, clearColor);
    }
  }

  function animate(timestamp: number) {
    if (!isPlaying) return;

    if (startTime === null) {
      startTime = timestamp;
    }

    const elapsed = (timestamp - startTime) / 1000; // seconds
    const phase = (elapsed / animationDuration) % 1;

    draw(phase);

    animationFrameId = requestAnimationFrame(animate);
  }

  function startAnimation() {
    if (isPlaying || !isInitialized) return;
    isPlaying = true;
    startTime = null;
    animationFrameId = requestAnimationFrame(animate);
  }

  function stopAnimation() {
    if (!isPlaying) return;
    isPlaying = false;
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  }

  // ----------------------------------------------------------------
  // Event Handlers
  // ----------------------------------------------------------------

  function handleVisibilityChange(active: boolean) {
    if (!isInitialized) return;
    if (!active && isPlaying) {
      wasPlayingBeforeHidden = true;
      stopAnimation();
    } else if (active && wasPlayingBeforeHidden) {
      wasPlayingBeforeHidden = false;
      startAnimation();
    }
  }

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  onMount(() => {
    // Initialize after canvas elements are available
    if (canvas1 && canvas2 && canvas3) {
      initializeRenderers();
    }
  });

  onDestroy(() => {
    stopAnimation();
    // Clean up bloom effects
    if (bloom1) bloom1.destroy();
    if (bloom2) bloom2.destroy();
    if (bloom3) bloom3.destroy();
    // Clean up source textures
    if (sourceTexture1) sourceTexture1.destroy();
    if (sourceTexture2) sourceTexture2.destroy();
    if (sourceTexture3) sourceTexture3.destroy();
    // Clean up renderers
    if (renderer1) renderer1.destroy();
    if (renderer2) renderer2.destroy();
    if (renderer3) renderer3.destroy();
  });

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  // Initialize when canvases become available
  $: if (!isInitialized && canvas1 && canvas2 && canvas3) {
    initializeRenderers();
  }

  // Handle visibility changes
  $: if (isActive !== undefined && isInitialized && $isActive !== undefined) {
    handleVisibilityChange($isActive);
  }
</script>

<div style="width: 100%; max-width: {width}px;">
  {#if initError}
    <div style="padding: 20px; text-align: center; color: #e63946;">
      <p>WebGPU Error: {initError}</p>
      <p style="font-size: 0.9em; color: #666;">
        WebGPU requires a modern browser with GPU support enabled.
      </p>
    </div>
  {:else}
    <TripleFigure {gap} {backgroundVisible} bind:isActive>
      {#snippet leftTitle()}
        Converging
      {/snippet}
      {#snippet left()}
        <canvas
          bind:this={canvas1}
          class="edge-fade"
          style="width: {canvasWidth}px; height: {canvasHeight}px; --fade-size: {edgeFadeSize}px;"
        ></canvas>
      {/snippet}
      {#snippet leftLabel()}
        <Katex math={"\\nabla \\cdot F < 0"} />
      {/snippet}

      {#snippet centerTitle()}
        Diverging
      {/snippet}
      {#snippet center()}
        <canvas
          bind:this={canvas2}
          class="edge-fade"
          style="width: {canvasWidth}px; height: {canvasHeight}px; --fade-size: {edgeFadeSize}px;"
        ></canvas>
      {/snippet}
      {#snippet centerLabel()}
        <Katex math={"\\nabla \\cdot F > 0"} />
      {/snippet}

      {#snippet rightTitle()}
        Incompressible
      {/snippet}
      {#snippet right()}
        <canvas
          bind:this={canvas3}
          class="edge-fade"
          style="width: {canvasWidth}px; height: {canvasHeight}px; --fade-size: {edgeFadeSize}px;"
        ></canvas>
      {/snippet}
      {#snippet rightLabel()}
        <Katex math={"\\nabla \\cdot F = 0"} />
      {/snippet}

      {#snippet caption()}
        {@render children?.()}
      {/snippet}
    </TripleFigure>
  {/if}
</div>

<style>
  .edge-fade {
    mask-image: linear-gradient(
      to right,
      transparent 0%,
      white var(--fade-size),
      white calc(100% - var(--fade-size)),
      transparent 100%
    ),
    linear-gradient(
      to bottom,
      transparent 0%,
      white var(--fade-size),
      white calc(100% - var(--fade-size)),
      transparent 100%
    );
    mask-composite: intersect;
    -webkit-mask-image: linear-gradient(
      to right,
      transparent 0%,
      white var(--fade-size),
      white calc(100% - var(--fade-size)),
      transparent 100%
    ),
    linear-gradient(
      to bottom,
      transparent 0%,
      white var(--fade-size),
      white calc(100% - var(--fade-size)),
      transparent 100%
    );
    -webkit-mask-composite: source-in;
  }
</style>
