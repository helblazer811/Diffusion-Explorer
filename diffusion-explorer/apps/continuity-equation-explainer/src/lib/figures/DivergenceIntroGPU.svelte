<!-- GPU-accelerated version of DivergenceIntro using WebGPU streamline renderer. -->

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

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  // Caption slot
  export let children = undefined;

  // Layout
  export let width = 900;
  export let height = 300;
  export let gap = 20;
  export let backgroundVisible = true;

  // Animation
  export let playingByDefault = true;

  // Streamline generation
  export let domainRange = { xMin: -2, xMax: 2, yMin: -2, yMax: 2 };
  export let density: number | [number, number] = 1.0;
  export let minPathLength = 0.5;

  // Styling
  export let streamlineColor = "#e63946";
  export let streamlineWidth = 3.0;

  // Animation pulse settings (pixel-based)
  export let pulseWidthPixels = 40;       // Width of pulse in pixels
  export let pulsePauseWidthPixels = 10;  // Gap between pulses in pixels
  export let animationDuration = 4;       // Seconds for one animation cycle

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  // Visibility state from TripleFigure
  let isActive: ReturnType<typeof import('svelte/store').writable<boolean>> | undefined;

  // Compute canvas dimensions
  $: canvasWidth = Math.floor((width - 2 * gap) / 3);
  $: canvasHeight = height;

  // Three canvases
  let canvas1: HTMLCanvasElement | null = null;
  let canvas2: HTMLCanvasElement | null = null;
  let canvas3: HTMLCanvasElement | null = null;

  // GPU renderers
  let renderer1: StreamlineRenderer | null = null;
  let renderer2: StreamlineRenderer | null = null;
  let renderer3: StreamlineRenderer | null = null;

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
    return ([x, y]: [number, number]): [number, number] => [
      ((x - domainRange.xMin) / (domainRange.xMax - domainRange.xMin)) * cw,
      ((domainRange.yMax - y) / (domainRange.yMax - domainRange.yMin)) * ch
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

      const rendererOptions = {
        dpr,
        thickness: streamlineWidth,
        pulseWidth: pulseWidthPixels,
        pulseGap: pulsePauseWidthPixels,
        baseOpacity: 0.8,
        color: streamlineColor,
      };

      // Create renderers
      [renderer1, renderer2, renderer3] = await Promise.all([
        StreamlineRenderer.create(canvas1, rendererOptions),
        StreamlineRenderer.create(canvas2, rendererOptions),
        StreamlineRenderer.create(canvas3, rendererOptions),
      ]);

      // Generate streamlines for each field (in CSS pixels)
      const streamlines1 = generateStreamlinesForField(convergingFieldFn(0.5), canvasWidth, canvasHeight);
      const streamlines2 = generateStreamlinesForField(divergingFieldFn(0.5), canvasWidth, canvasHeight);
      const streamlines3 = generateStreamlinesForField(diagonalFieldFn(1.0), canvasWidth, canvasHeight);

      // Upload to GPU with random offsets
      renderer1.setStreamlines(streamlines1, 'random');
      renderer2.setStreamlines(streamlines2, 'random');
      renderer3.setStreamlines(streamlines3, 'random');

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

    renderer1.render({ phase }, clearColor);
    renderer2.render({ phase }, clearColor);
    renderer3.render({ phase }, clearColor);
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

<div style="width: {width}px; position: relative; left: 50%; transform: translateX(-50%);">
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
        Converging (GPU)
      {/snippet}
      {#snippet left()}
        <canvas
          bind:this={canvas1}
          style="width: {canvasWidth}px; height: {canvasHeight}px;"
        ></canvas>
      {/snippet}
      {#snippet leftLabel()}
        <Katex math={"\\nabla \\cdot F < 0"} />
      {/snippet}

      {#snippet centerTitle()}
        Diverging (GPU)
      {/snippet}
      {#snippet center()}
        <canvas
          bind:this={canvas2}
          style="width: {canvasWidth}px; height: {canvasHeight}px;"
        ></canvas>
      {/snippet}
      {#snippet centerLabel()}
        <Katex math={"\\nabla \\cdot F > 0"} />
      {/snippet}

      {#snippet rightTitle()}
        Incompressible (GPU)
      {/snippet}
      {#snippet right()}
        <canvas
          bind:this={canvas3}
          style="width: {canvasWidth}px; height: {canvasHeight}px;"
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
