<!-- Introduces the concept of divergence in flow matching with three side-by-side canvases. -->
<!-- Uses GPU-accelerated WebGPU streamline rendering. -->

<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import {
    TripleFigure,
    Katex,
    drawTrajectories,
    StreamlineAnimationGPU,
    Timeline,
    type VectorFieldFn,
    type StreamlineAnimationGPUState,
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
  export let staticMode = false;
  export let staticOpacity = 0.8;

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

  // DPR for high-DPI displays
  let dpr = 1;

  // Three canvases (WebGPU)
  let canvas1: HTMLCanvasElement | null = null;
  let canvas2: HTMLCanvasElement | null = null;
  let canvas3: HTMLCanvasElement | null = null;

  // Animation state
  let isInitialized = false;
  let initPromise: Promise<void> | null = null;
  let wasPlayingBeforeHidden = false;
  let initError: string | null = null;

  // Timeline for animation
  let timeline: Timeline<StreamlineAnimationGPUState> | null = null;

  // Streamline animations (GPU)
  let anim1: StreamlineAnimationGPU<StreamlineAnimationGPUState> | null = null;
  let anim2: StreamlineAnimationGPU<StreamlineAnimationGPUState> | null = null;
  let anim3: StreamlineAnimationGPU<StreamlineAnimationGPUState> | null = null;

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

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function createToPixel(cw: number, ch: number): (p: [number, number]) => [number, number] {
    return ([x, y]: [number, number]): [number, number] => [
      ((x - domainRange.xMin) / (domainRange.xMax - domainRange.xMin)) * cw,
      ((domainRange.yMax - y) / (domainRange.yMax - domainRange.yMin)) * ch
    ];
  }

  function setupCanvasSize(canvas: HTMLCanvasElement) {
    canvas.width = canvasWidth * dpr;
    canvas.height = canvasHeight * dpr;
  }

  async function runInitialComputation() {
    if (!canvas1 || !canvas2 || !canvas3) return;

    // Check WebGPU availability
    if (typeof navigator === 'undefined' || !navigator.gpu) {
      initError = "WebGPU is not supported in this browser";
      return;
    }

    try {
      // Set up canvas sizes
      setupCanvasSize(canvas1);
      setupCanvasSize(canvas2);
      setupCanvasSize(canvas3);

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
        color: streamlineColor,
        strokeWidth: streamlineWidth,
        // Pixel-based pulse animation
        pulseWidthPixels,
        pulsePauseWidthPixels,
        baseOpacity: 0.8,
        offsets: 'random' as const,
        dpr,
      };

      // Create animation objects (synchronous)
      anim1 = StreamlineAnimationGPU.create({
        vectorFieldFn: convergingFieldFn(0.5),
        ...commonOptions,
      });

      anim2 = StreamlineAnimationGPU.create({
        vectorFieldFn: divergingFieldFn(0.5),
        ...commonOptions,
      });

      anim3 = StreamlineAnimationGPU.create({
        vectorFieldFn: diagonalFieldFn(1.0),
        ...commonOptions,
      });

      // Initialize GPU renderers (async)
      await Promise.all([
        anim1.init(canvas1),
        anim2.init(canvas2),
        anim3.init(canvas3),
      ]);

      isInitialized = true;
      setupTimeline();

      if (timeline) {
        draw(timeline.initialState);
        if (playingByDefault) startAnimation();
      }
    } catch (e) {
      initError = e instanceof Error ? e.message : "Failed to initialize WebGPU";
      console.error("WebGPU initialization error:", e);
    }
  }

  function setupTimeline() {
    if (!anim1) return;

    timeline = new Timeline<StreamlineAnimationGPUState>();
    timeline.initialState = { streamlinePhase: 0 };
    timeline.duration = animationDuration;
    timeline.looping = true;

    // Add the streamline phase clip (all animations share the same phase)
    timeline.add(anim1.clip, 0);

    // Register draw callback
    timeline.onTick((_t, state) => {
      draw(state);
    });
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  function startAnimation() {
    if (timeline) timeline.play();
  }

  function stopAnimation() {
    if (timeline) timeline.pause();
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function draw(state: StreamlineAnimationGPUState) {
    if (!isInitialized) return;
    if (!anim1 || !anim2 || !anim3) return;

    // Clear with transparent background
    const clearColor: [number, number, number, number] = [0, 0, 0, 0];

    if (staticMode) {
      // For static mode, render at full opacity with phase 0
      anim1.render({ streamlinePhase: 0 }, clearColor);
      anim2.render({ streamlinePhase: 0 }, clearColor);
      anim3.render({ streamlinePhase: 0 }, clearColor);
    } else {
      anim1.render(state, clearColor);
      anim2.render(state, clearColor);
      anim3.render(state, clearColor);
    }
  }

  // ----------------------------------------------------------------
  // Event Handlers
  // ----------------------------------------------------------------

  function handleVisibilityChange(active: boolean) {
    if (!timeline) return;
    if (!active && timeline.isPlaying) {
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
    dpr = window.devicePixelRatio || 1;
  });

  onDestroy(() => {
    if (timeline) timeline.dispose();
    if (anim1) anim1.destroy();
    if (anim2) anim2.destroy();
    if (anim3) anim3.destroy();
  });

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  // Initialize when canvases are ready
  $: if (!isInitialized && !initPromise && canvas1 && canvas2 && canvas3 && dpr > 0) {
    initPromise = runInitialComputation();
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
        Converging
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
        Diverging
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
        Incompressible
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
