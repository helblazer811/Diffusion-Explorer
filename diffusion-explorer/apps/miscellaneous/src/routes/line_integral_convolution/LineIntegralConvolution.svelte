<!-- Line Integral Convolution (LIC) visualization demo using WebGPU compute shaders. -->

<script lang="ts">
  import { onMount } from "svelte";
  import {
    TripleFigure,
    Katex,
    useCanvas2D,
    isWebGPUAvailable,
    computeLIC,
    type VectorFieldFn,
    type LICDomain,
  } from "@diffusion-explorer/ui";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  // Layout
  export let width = 900;
  export let height = 300;
  export let gap = 20;
  export let backgroundVisible = true;

  // LIC parameters
  export let domainRange: LICDomain = { xMin: -2, xMax: 2, yMin: -2, yMax: 2 };
  export let integrationSteps = 25;
  export let stepSize = 0.5;
  export let contrast = 1.5;
  export let seed = 12345;

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  // Compute canvas dimensions
  const initialCanvasWidth = Math.floor((width - 2 * gap) / 3);
  const initialCanvasHeight = height;
  $: canvasWidth = Math.floor((width - 2 * gap) / 3);
  $: canvasHeight = height;

  // Three canvases
  let canvas1: HTMLCanvasElement | null = null;
  let canvas2: HTMLCanvasElement | null = null;
  let canvas3: HTMLCanvasElement | null = null;
  const canvas2d1 = useCanvas2D(initialCanvasWidth, initialCanvasHeight);
  const canvas2d2 = useCanvas2D(initialCanvasWidth, initialCanvasHeight);
  const canvas2d3 = useCanvas2D(initialCanvasWidth, initialCanvasHeight);
  $: ctx1 = canvas1 && canvas2d1.ctx;
  $: ctx2 = canvas2 && canvas2d2.ctx;
  $: ctx3 = canvas3 && canvas2d3.ctx;

  // Loading/error state
  let isLoading = true;
  let errorMessage: string | null = null;

  // ----------------------------------------------------------------
  // Vector Field Functions
  // ----------------------------------------------------------------

  /**
   * Rotation field (counterclockwise).
   * F(x, y) = (-y, x)
   */
  const rotationField: VectorFieldFn = (x, y) => [-y, x];

  /**
   * Saddle field.
   * F(x, y) = (x, -y)
   */
  const saddleField: VectorFieldFn = (x, y) => [x, -y];

  /**
   * Source/sink field (radial outward).
   * F(x, y) = (x, y)
   */
  const sourceField: VectorFieldFn = (x, y) => [x, y];

  // ----------------------------------------------------------------
  // LIC Computation
  // ----------------------------------------------------------------

  /**
   * Draw LIC result to canvas using drawImage for proper scaling.
   * This computes at CSS dimensions and scales up, giving a coarser texture.
   */
  function drawLICResult(ctx: CanvasRenderingContext2D, imageData: ImageData) {
    // Create offscreen canvas at LIC resolution
    const offscreen = document.createElement("canvas");
    offscreen.width = imageData.width;
    offscreen.height = imageData.height;
    const offCtx = offscreen.getContext("2d");
    if (!offCtx) return;

    // Put ImageData on offscreen canvas
    offCtx.putImageData(imageData, 0, 0);

    // Draw scaled to main canvas (respects the DPR transform)
    ctx.drawImage(offscreen, 0, 0, canvasWidth, canvasHeight);
  }

  async function computeAllLIC() {
    if (!ctx1 || !ctx2 || !ctx3 || !canvas1 || !canvas2 || !canvas3) return;

    // Check WebGPU availability
    const webgpuAvailable = await isWebGPUAvailable();
    if (!webgpuAvailable) {
      errorMessage = "WebGPU is not available in this browser. Try Chrome 113+ or Edge 113+.";
      isLoading = false;
      return;
    }

    // Compute at CSS dimensions for coarser, more visible texture
    const commonOptions = {
      domain: domainRange,
      width: canvasWidth,
      height: canvasHeight,
      integrationSteps,
      stepSize,
      contrast,
      seed,
    };

    try {
      // Compute LIC for all three fields in parallel
      const [result1, result2, result3] = await Promise.all([
        computeLIC({ vectorField: rotationField, ...commonOptions }),
        computeLIC({ vectorField: saddleField, ...commonOptions }),
        computeLIC({ vectorField: sourceField, ...commonOptions }),
      ]);

      // Draw results with scaling
      drawLICResult(ctx1, result1.toImageData());
      drawLICResult(ctx2, result2.toImageData());
      drawLICResult(ctx3, result3.toImageData());

      isLoading = false;
    } catch (err) {
      errorMessage = `LIC computation failed: ${err instanceof Error ? err.message : String(err)}`;
      isLoading = false;
    }
  }

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  onMount(() => {
    // Wait for next tick to ensure canvases are bound
    setTimeout(() => {
      computeAllLIC();
    }, 0);
  });

  // Re-compute if contexts become available
  $: if (ctx1 && ctx2 && ctx3 && isLoading && !errorMessage) {
    computeAllLIC();
  }
</script>

<div style="width: {width}px;">
  <TripleFigure {gap} {backgroundVisible}>
    {#snippet leftTitle()}
      Rotation
    {/snippet}
    {#snippet left()}
      <div class="canvas-container" style="aspect-ratio: {canvasWidth}/{canvasHeight};">
        <canvas
          bind:this={canvas1}
          use:canvas2d1.bindCanvas
          style="width: 100%; height: 100%;"
        ></canvas>
        {#if isLoading}
          <div class="loading-overlay">Computing LIC...</div>
        {/if}
        {#if errorMessage}
          <div class="error-overlay">{errorMessage}</div>
        {/if}
      </div>
    {/snippet}
    {#snippet leftLabel()}
      <Katex math={"\\mathbf{F}(x,y) = (-y, x)"} />
    {/snippet}

    {#snippet centerTitle()}
      Saddle
    {/snippet}
    {#snippet center()}
      <div class="canvas-container" style="aspect-ratio: {canvasWidth}/{canvasHeight};">
        <canvas
          bind:this={canvas2}
          use:canvas2d2.bindCanvas
          style="width: 100%; height: 100%;"
        ></canvas>
        {#if isLoading}
          <div class="loading-overlay">Computing LIC...</div>
        {/if}
      </div>
    {/snippet}
    {#snippet centerLabel()}
      <Katex math={"\\mathbf{F}(x,y) = (x, -y)"} />
    {/snippet}

    {#snippet rightTitle()}
      Source
    {/snippet}
    {#snippet right()}
      <div class="canvas-container" style="aspect-ratio: {canvasWidth}/{canvasHeight};">
        <canvas
          bind:this={canvas3}
          use:canvas2d3.bindCanvas
          style="width: 100%; height: 100%;"
        ></canvas>
        {#if isLoading}
          <div class="loading-overlay">Computing LIC...</div>
        {/if}
      </div>
    {/snippet}
    {#snippet rightLabel()}
      <Katex math={"\\mathbf{F}(x,y) = (x, y)"} />
    {/snippet}

    {#snippet caption()}
      <strong>Line Integral Convolution (LIC) visualization.</strong>
      LIC convolves a noise texture along streamlines to reveal flow structure.
      <em>Left:</em> Rotation field with circular streamlines.
      <em>Center:</em> Saddle point with hyperbolic flow.
      <em>Right:</em> Source field with radial outward flow.
      Computed using WebGPU compute shaders.
    {/snippet}
  </TripleFigure>
</div>

<style>
  .canvas-container {
    position: relative;
    width: 100%;
  }

  .loading-overlay,
  .error-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.7);
    color: white;
    font-size: 14px;
  }

  .error-overlay {
    background: rgba(139, 0, 0, 0.8);
    padding: 10px;
    text-align: center;
  }
</style>
