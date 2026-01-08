<!-- Visualizes divergence and curl concepts with three vector fields. -->

<script lang="ts">
  import { onDestroy } from "svelte";
  import {
    TripleFigure,
    Katex,
    createStreamlineAnimation,
    type VectorFieldFn,
    type StreamlineAnimation,
    type StreamlineAnimationState,
  } from "@diffusion-explorer/ui";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

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
  export let minPathLength = 2.0;
  export let segmentLength = 0.01;

  // Styling
  export let streamlineColor = "#3b82f6";
  export let streamlineWidth = 3.0;
  export let gradientSubdivisions = 5;

  // Animation pulse settings
  export let pulseWidth = 0.20;
  export let pulsePauseWidth = 0.05;
  export let pulseFrequency = 0.8;

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  // Visibility state from TripleFigure
  let isActive: ReturnType<typeof import('svelte/store').writable<boolean>> | undefined;

  // Three canvases
  let canvas1: HTMLCanvasElement | null = null;
  let canvas2: HTMLCanvasElement | null = null;
  let canvas3: HTMLCanvasElement | null = null;
  let ctx1: CanvasRenderingContext2D | null = null;
  let ctx2: CanvasRenderingContext2D | null = null;
  let ctx3: CanvasRenderingContext2D | null = null;
  let dpr = 1;

  // Animation state
  let isPlaying = playingByDefault;
  let animationFrameId: number | null = null;
  let phase = 0;
  let lastTimestamp: number | null = null;
  let isInitialized = false;

  // Streamline animations
  let anim1: StreamlineAnimation<StreamlineAnimationState> | null = null;
  let anim2: StreamlineAnimation<StreamlineAnimationState> | null = null;
  let anim3: StreamlineAnimation<StreamlineAnimationState> | null = null;

  // ----------------------------------------------------------------
  // Vector Field Functions
  // ----------------------------------------------------------------

  /**
   * Generate uniform grid of starting points for seeding.
   */
  function generateUniformStartPoints(
    range: typeof domainRange,
    gridSize: number = 8
  ): [number, number][] {
    const points: [number, number][] = [];
    const xStep = (range.xMax - range.xMin) / (gridSize + 1);
    const yStep = (range.yMax - range.yMin) / (gridSize + 1);

    for (let i = 1; i <= gridSize; i++) {
      for (let j = 1; j <= gridSize; j++) {
        const x = range.xMin + i * xStep;
        const y = range.yMin + j * yStep;
        points.push([x, y]);
      }
    }
    return points;
  }

  /**
   * Pure divergence field (radial source).
   * F(x, y) = (x, y)
   * Divergence: 2 > 0 (expanding)
   * Curl: 0 (no rotation)
   */
  function pureDivergenceField(): VectorFieldFn {
    return (x: number, y: number): [number, number] => [x, y];
  }

  /**
   * Pure curl field (rotation).
   * F(x, y) = (-y, x)
   * Divergence: 0 (incompressible)
   * Curl: 2 > 0 (counterclockwise rotation)
   */
  function pureCurlField(): VectorFieldFn {
    return (x: number, y: number): [number, number] => [-y, x];
  }

  /**
   * Combined divergence and curl (spiral source).
   * F(x, y) = (ax - by, bx + ay) with a > 0
   * Divergence: 2a > 0 (expanding)
   * Curl: 2b > 0 (rotating)
   */
  function combinedField(a: number = 0.5, b: number = 1.0): VectorFieldFn {
    return (x: number, y: number): [number, number] => [
      a * x - b * y,
      b * x + a * y
    ];
  }

  // Compute canvas dimensions
  $: canvasWidth = Math.floor((width - 2 * gap) / 3);
  $: canvasHeight = height;

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  function createToPixel(cw: number, ch: number): (p: [number, number]) => [number, number] {
    return ([x, y]: [number, number]): [number, number] => [
      ((x - domainRange.xMin) / (domainRange.xMax - domainRange.xMin)) * cw,
      ((domainRange.yMax - y) / (domainRange.yMax - domainRange.yMin)) * ch
    ];
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function initializeCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
    if (!canvas) return null;
    dpr = window.devicePixelRatio || 1;
    canvas.width = canvasWidth * dpr;
    canvas.height = canvasHeight * dpr;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.scale(dpr, dpr);
    return ctx;
  }

  function runInitialComputation() {
    if (!canvas1 || !canvas2 || !canvas3) return;

    ctx1 = initializeCanvas(canvas1);
    ctx2 = initializeCanvas(canvas2);
    ctx3 = initializeCanvas(canvas3);

    const toPixel = createToPixel(canvasWidth, canvasHeight);
    const domain = {
      xMin: domainRange.xMin,
      xMax: domainRange.xMax,
      yMin: domainRange.yMin,
      yMax: domainRange.yMax
    };

    const commonOptions = {
      domain,
      toPixel,
      density,
      minPathLength,
      segmentLength,
      color: streamlineColor,
      strokeWidth: streamlineWidth,
      gradientSubdivisions,
      pulseWidth,
      pulsePauseWidth,
      offsets: 'random' as const,
    };

    // Pure divergence uses uniform grid seeding for better coverage
    const uniformStartPoints = generateUniformStartPoints(domainRange, 8);
    anim1 = createStreamlineAnimation({
      vectorFieldFn: pureDivergenceField(),
      ...commonOptions,
      startPoints: uniformStartPoints,
      minPathLength: 0.5,  // Lower minimum length for better coverage
    });

    anim2 = createStreamlineAnimation({
      vectorFieldFn: pureCurlField(),
      ...commonOptions,
    });

    anim3 = createStreamlineAnimation({
      vectorFieldFn: combinedField(0.5, 1.0),
      ...commonOptions,
    });
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  function animate(timestamp: number) {
    if (!isPlaying) {
      animationFrameId = null;
      return;
    }

    if (lastTimestamp === null) {
      lastTimestamp = timestamp;
    }

    const elapsed = timestamp - lastTimestamp;

    const spacing = pulseWidth + pulsePauseWidth;
    phase += (elapsed / 1000) * pulseFrequency * spacing;
    phase %= 1.0;

    draw(phase);
    lastTimestamp = timestamp;

    animationFrameId = requestAnimationFrame(animate);
  }

  function startAnimation() {
    if (animationFrameId !== null) return;
    lastTimestamp = null;
    animationFrameId = requestAnimationFrame(animate);
  }

  function stopAnimation() {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function draw(currentPhase: number) {
    if (!ctx1 || !ctx2 || !ctx3 || !isInitialized) return;
    if (!anim1 || !anim2 || !anim3) return;

    ctx1.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx2.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx3.clearRect(0, 0, canvasWidth, canvasHeight);

    anim1.draw(ctx1, currentPhase);
    anim2.draw(ctx2, currentPhase);
    anim3.draw(ctx3, currentPhase);
  }

  // ----------------------------------------------------------------
  // Event Handlers
  // ----------------------------------------------------------------

  function handleVisibilityChange(active: boolean) {
    if (!active && isPlaying) {
      stopAnimation();
    } else if (active && isPlaying && isInitialized) {
      startAnimation();
    }
  }

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  onDestroy(() => {
    stopAnimation();
  });

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  // Initialize when canvases are ready
  $: if (!isInitialized && canvas1 && canvas2 && canvas3) {
    runInitialComputation();
    isInitialized = true;
    draw(0);
    if (playingByDefault) startAnimation();
  }

  // Handle visibility changes
  $: if (isActive !== undefined && isInitialized && $isActive !== undefined) {
    handleVisibilityChange($isActive);
  }

  // Update drawing when phase changes
  $: if (isInitialized && phase !== undefined) {
    draw(phase);
  }
</script>

<div style="width: {width}px;">
  <TripleFigure {gap} {backgroundVisible} bind:isActive>
    {#snippet leftTitle()}
      Pure Divergence
    {/snippet}
    {#snippet left()}
      <canvas
        bind:this={canvas1}
        style="width: 100%; height: auto; aspect-ratio: {canvasWidth}/{canvasHeight};"
      ></canvas>
    {/snippet}
    {#snippet leftLabel()}
      <Katex math={"\\nabla \\cdot F > 0, \\; \\nabla \\times F = 0"} />
    {/snippet}

    {#snippet centerTitle()}
      Pure Curl
    {/snippet}
    {#snippet center()}
      <canvas
        bind:this={canvas2}
        style="width: 100%; height: auto; aspect-ratio: {canvasWidth}/{canvasHeight};"
      ></canvas>
    {/snippet}
    {#snippet centerLabel()}
      <Katex math={"\\nabla \\cdot F = 0, \\; \\nabla \\times F > 0"} />
    {/snippet}

    {#snippet rightTitle()}
      Divergence + Curl
    {/snippet}
    {#snippet right()}
      <canvas
        bind:this={canvas3}
        style="width: 100%; height: auto; aspect-ratio: {canvasWidth}/{canvasHeight};"
      ></canvas>
    {/snippet}
    {#snippet rightLabel()}
      <Katex math={"\\nabla \\cdot F > 0, \\; \\nabla \\times F > 0"} />
    {/snippet}

    {#snippet caption()}
      Three vector fields demonstrating divergence and curl: a radial source (pure divergence),
      a rotational field (pure curl), and a spiral source (both divergence and curl).
    {/snippet}
  </TripleFigure>
</div>
