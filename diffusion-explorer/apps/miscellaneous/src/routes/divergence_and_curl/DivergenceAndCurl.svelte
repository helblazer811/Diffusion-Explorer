<!-- Visualizes divergence and curl concepts with three vector fields. -->

<script lang="ts">
  import { onDestroy } from "svelte";
  import {
    TripleFigure,
    Katex,
    drawTrajectories,
    generateStreamlines,
    computeAlphaTrail,
    type VectorFieldFn
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
  let isActive;

  // Track visibility for animation control
  let isInViewport = false;
  let isTabVisible = true;

  // Three canvases
  let canvas1, canvas2, canvas3;
  let ctx1, ctx2, ctx3;
  let dpr = 1;

  // Animation state
  let isPlaying = playingByDefault;
  let animationFrameId = null;
  let time = 0;
  let lastTimestamp = null;
  let isInitialized = false;

  // Animation state type
  type AnimationState = {
    time: number;
  };

  // Streamline data (in pixel coordinates)
  let streamlines1: number[][][] = [];
  let streamlines2: number[][][] = [];
  let streamlines3: number[][][] = [];

  // Random animation offsets per streamline
  let offsets1: number[] = [];
  let offsets2: number[] = [];
  let offsets3: number[] = [];

  // Max streamline length for animation timing
  let maxStreamlineLength = 1;

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

  function streamlinesToPixelCoords(
    streamlines: number[][][],
    range: typeof domainRange,
    canvasW: number,
    canvasH: number
  ): number[][][] {
    return streamlines.map(streamline =>
      streamline.map(([x, y]) => [
        ((x - range.xMin) / (range.xMax - range.xMin)) * canvasW,
        ((range.yMax - y) / (range.yMax - range.yMin)) * canvasH
      ])
    );
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function initializeCanvas(canvas) {
    if (!canvas) return null;
    dpr = window.devicePixelRatio || 1;
    canvas.width = canvasWidth * dpr;
    canvas.height = canvasHeight * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    return ctx;
  }

  function runInitialComputation() {
    if (!canvas1 || !canvas2 || !canvas3) return;

    ctx1 = initializeCanvas(canvas1);
    ctx2 = initializeCanvas(canvas2);
    ctx3 = initializeCanvas(canvas3);

    const streamlineOptions = {
      domainMin: [domainRange.xMin, domainRange.yMin] as [number, number],
      domainMax: [domainRange.xMax, domainRange.yMax] as [number, number],
      density,
      integrationDirection: 'both' as const,
      minlength: minPathLength,
      segmentLength
    };

    // Pure divergence uses uniform grid seeding for better coverage
    const uniformStartPoints = generateUniformStartPoints(domainRange, 8);
    const raw1 = generateStreamlines(pureDivergenceField(), {
      ...streamlineOptions,
      startPoints: uniformStartPoints,
      integrationDirection: 'both' as const,  // Both directions for sunburst pattern
      minlength: 0.5  // Lower minimum length for better coverage
    });
    const raw2 = generateStreamlines(pureCurlField(), streamlineOptions);
    const raw3 = generateStreamlines(combinedField(0.5, 1.0), streamlineOptions);

    // Convert to pixel coordinates
    streamlines1 = streamlinesToPixelCoords(raw1, domainRange, canvasWidth, canvasHeight);
    streamlines2 = streamlinesToPixelCoords(raw2, domainRange, canvasWidth, canvasHeight);
    streamlines3 = streamlinesToPixelCoords(raw3, domainRange, canvasWidth, canvasHeight);

    // Generate random animation offsets
    offsets1 = streamlines1.map(() => Math.random());
    offsets2 = streamlines2.map(() => Math.random());
    offsets3 = streamlines3.map(() => Math.random());

    // Calculate max streamline length
    const allLengths = [...streamlines1, ...streamlines2, ...streamlines3].map(s => s.length);
    maxStreamlineLength = Math.max(...allLengths, 1);
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  function animate(timestamp) {
    if (!isPlaying) {
      animationFrameId = null;
      return;
    }

    if (lastTimestamp === null) {
      lastTimestamp = timestamp;
    }

    const elapsed = timestamp - lastTimestamp;

    const spacing = pulseWidth + pulsePauseWidth;
    time += (elapsed / 1000) * pulseFrequency * spacing;
    time %= 1.0;

    draw({ time });
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

  function drawStreamlines(
    ctx: CanvasRenderingContext2D,
    streamlines: number[][][],
    offsets: number[],
    time: number
  ) {
    if (streamlines.length === 0) return;

    const baseOpacity = 0.8;

    const perSegmentAlphas: number[][] = streamlines.map((streamline, i) => {
      const numSegments = streamline.length - 1;
      const offset = offsets[i] ?? 0;
      return computeAlphaTrail(numSegments, time, offset, pulseWidth, pulsePauseWidth, baseOpacity);
    });

    drawTrajectories(
      ctx,
      streamlines,
      0,
      {
        strokeWidth: streamlineWidth,
        color: streamlineColor,
        progressOpacity: baseOpacity,
        pointRadius: 0,
        showPreview: false,
        showHeadMarker: false,
        perSegmentAlphas,
        gradientSubdivisions
      }
    );
  }

  function draw(state: AnimationState) {
    if (!ctx1 || !ctx2 || !ctx3 || !isInitialized) return;

    const { time: t } = state;

    ctx1.clearRect(0, 0, canvasWidth, canvasHeight);
    drawStreamlines(ctx1, streamlines1, offsets1, t);

    ctx2.clearRect(0, 0, canvasWidth, canvasHeight);
    drawStreamlines(ctx2, streamlines2, offsets2, t);

    ctx3.clearRect(0, 0, canvasWidth, canvasHeight);
    drawStreamlines(ctx3, streamlines3, offsets3, t);
  }

  // ----------------------------------------------------------------
  // Event Handlers
  // ----------------------------------------------------------------

  function handleVisibilityChange(active) {
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
    draw({ time: 0 });
    if (playingByDefault) startAnimation();
  }

  // Handle visibility changes
  $: if (isActive !== undefined && isInitialized) {
    handleVisibilityChange($isActive);
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
