<!-- Line Integral Convolution (LIC) visualization demo using WebGPU compute shaders. -->

<script lang="ts">
  import { onMount } from "svelte";
  import {
    DoubleFigure,
    Katex,
    isWebGPUAvailable,
    computeLIC,
    viridis,
    plasma,
    inferno,
    coolwarm,
    turbo,
    type VectorFieldFn,
    type LICDomain,
    type ColorPalette,
  } from "@diffusion-explorer/ui";

  // Available palette presets
  const PALETTES = { viridis, plasma, inferno, coolwarm, turbo } as const;
  type PaletteName = keyof typeof PALETTES;

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  // Layout
  export let width = 900;
  export let height = 450;
  export let gap = 20;
  export let backgroundVisible = false;

  // LIC parameters
  export let domainRange: LICDomain = { xMin: -2, xMax: 2, yMin: -2, yMax: 2 };
  export let integrationSteps = 128;
  export let stepSize = 1.0;
  export let contrast = 5.0;
  export let seed = 12345;

  // Color options
  /** Color palette for magnitude coloring. Set to null for grayscale. */
  export let colorPalette: ColorPalette | PaletteName | null = "inferno";

  // Resolve palette from name or function
  $: resolvedPalette =
    colorPalette === null
      ? null
      : typeof colorPalette === "string"
        ? PALETTES[colorPalette]
        : colorPalette;

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  // Target 300 DPI (standard screen is 96 DPI)
  const dpr = 300 / 96;

  // Compute canvas dimensions (CSS pixels)
  $: canvasWidth = Math.floor((width - gap) / 2);
  $: canvasHeight = height;

  // Physical pixel dimensions for maximum DPI
  $: physicalWidth = Math.floor(canvasWidth * dpr);
  $: physicalHeight = Math.floor(canvasHeight * dpr);

  // Two canvases
  let canvas1: HTMLCanvasElement | null = null;
  let canvas2: HTMLCanvasElement | null = null;
  let ctx1: CanvasRenderingContext2D | null = null;
  let ctx2: CanvasRenderingContext2D | null = null;

  // Loading/error state
  let isLoading = true;
  let errorMessage: string | null = null;

  // Setup canvas with maximum DPI
  function setupCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
    canvas.width = physicalWidth;
    canvas.height = physicalHeight;
    const ctx = canvas.getContext("2d");
    return ctx;
  }

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

  // ----------------------------------------------------------------
  // LIC Computation
  // ----------------------------------------------------------------

  /**
   * Draw LIC result directly to canvas at full resolution.
   */
  function drawLICResult(ctx: CanvasRenderingContext2D, imageData: ImageData) {
    ctx.putImageData(imageData, 0, 0);
  }

  async function computeAllLIC() {
    if (!ctx1 || !ctx2 || !canvas1 || !canvas2) return;

    // Check WebGPU availability
    const webgpuAvailable = await isWebGPUAvailable();
    if (!webgpuAvailable) {
      errorMessage = "WebGPU is not available in this browser. Try Chrome 113+ or Edge 113+.";
      isLoading = false;
      return;
    }

    // Compute at full physical resolution for maximum DPI
    const commonOptions = {
      domain: domainRange,
      width: physicalWidth,
      height: physicalHeight,
      integrationSteps,
      stepSize,
      contrast,
      seed,
      noiseScale: 2 * dpr, // Scale noise with DPR to maintain visual streak width
      nearestNeighborVelocity: true,
      maxArcLength: 80.0,
      useEuler: true,
      velocityScale: 0.1,
    };

    try {
      // Compute LIC for both fields in parallel
      const [result1, result2] = await Promise.all([
        computeLIC({ vectorField: rotationField, ...commonOptions }),
        computeLIC({ vectorField: saddleField, ...commonOptions }),
      ]);

      // Draw results directly at full resolution
      if (resolvedPalette) {
        const colorOptions = {
          palette: resolvedPalette,
          backgroundColor: [255, 255, 255] as [number, number, number],
        };
        drawLICResult(ctx1, result1.toColoredImageData(colorOptions));
        drawLICResult(ctx2, result2.toColoredImageData(colorOptions));
      } else {
        drawLICResult(ctx1, result1.toImageData());
        drawLICResult(ctx2, result2.toImageData());
      }

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
    // Setup canvases with maximum DPI
    if (canvas1) ctx1 = setupCanvas(canvas1);
    if (canvas2) ctx2 = setupCanvas(canvas2);

    // Compute LIC after canvas setup
    if (ctx1 && ctx2) {
      computeAllLIC();
    }
  });
</script>

<div style="width: {width}px;">
  <DoubleFigure {gap} {backgroundVisible}>
    {#snippet leftTitle()}
      Rotation
    {/snippet}
    {#snippet left()}
      <div class="canvas-container" style="aspect-ratio: {canvasWidth}/{canvasHeight};">
        <canvas
          bind:this={canvas1}
          width={physicalWidth}
          height={physicalHeight}
          style="width: {canvasWidth}px; height: {canvasHeight}px;"
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

    {#snippet rightTitle()}
      Saddle
    {/snippet}
    {#snippet right()}
      <div class="canvas-container" style="aspect-ratio: {canvasWidth}/{canvasHeight};">
        <canvas
          bind:this={canvas2}
          width={physicalWidth}
          height={physicalHeight}
          style="width: {canvasWidth}px; height: {canvasHeight}px;"
        ></canvas>
        {#if isLoading}
          <div class="loading-overlay">Computing LIC...</div>
        {/if}
      </div>
    {/snippet}
    {#snippet rightLabel()}
      <Katex math={"\\mathbf{F}(x,y) = (x, -y)"} />
    {/snippet}

    {#snippet caption()}
      <strong>Line Integral Convolution (LIC) visualization.</strong>
      LIC convolves a noise texture along streamlines to reveal flow structure.
      Color indicates vector field magnitude.
      <em>Left:</em> Rotation field with circular streamlines.
      <em>Right:</em> Saddle point with hyperbolic flow.
      Computed using WebGPU compute shaders.
    {/snippet}
  </DoubleFigure>
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
