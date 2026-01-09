<!-- Introduces the concept of divergence in flow matching with three side-by-side canvases. -->

<script lang="ts">
  import { onDestroy } from "svelte";
  import {
    TripleFigure,
    Katex,
    drawTrajectories,
    StreamlineAnimation,
    useCanvas2D,
    Timeline,
    type VectorFieldFn,
    type StreamlineAnimationState,
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
  export let gradientSubdivisions = 1;
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
  const initialCanvasWidth = Math.floor((width - 2 * gap) / 3);
  const initialCanvasHeight = height;
  $: canvasWidth = Math.floor((width - 2 * gap) / 3);
  $: canvasHeight = height;

  // Three canvases with DPR-aware initialization
  let canvas1: HTMLCanvasElement | null = null;
  let canvas2: HTMLCanvasElement | null = null;
  let canvas3: HTMLCanvasElement | null = null;
  const canvas2d1 = useCanvas2D(initialCanvasWidth, initialCanvasHeight);
  const canvas2d2 = useCanvas2D(initialCanvasWidth, initialCanvasHeight);
  const canvas2d3 = useCanvas2D(initialCanvasWidth, initialCanvasHeight);
  $: ctx1 = canvas1 && canvas2d1.ctx;
  $: ctx2 = canvas2 && canvas2d2.ctx;
  $: ctx3 = canvas3 && canvas2d3.ctx;

  // Animation state
  let isInitialized = false;
  let wasPlayingBeforeHidden = false;

  // Timeline for animation
  let timeline: Timeline<StreamlineAnimationState> | null = null;

  // Streamline animations
  let anim1: StreamlineAnimation<StreamlineAnimationState> | null = null;
  let anim2: StreamlineAnimation<StreamlineAnimationState> | null = null;
  let anim3: StreamlineAnimation<StreamlineAnimationState> | null = null;

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  /**
   * Converging vector field (pure sink, no curl).
   * F(x, y) = (-kx, -ky) - points radially inward
   * Divergence: -2k < 0 (volume contracting)
   * Curl: 0
   */
  function convergingFieldFn(k: number = 0.5): VectorFieldFn {
    return (x: number, y: number): [number, number] => [
      -k * x,
      -k * y
    ];
  }

  /**
   * Diverging vector field (pure source, no curl).
   * F(x, y) = (kx, ky) - points radially outward
   * Divergence: 2k > 0 (volume expanding)
   * Curl: 0
   */
  function divergingFieldFn(k: number = 0.5): VectorFieldFn {
    return (x: number, y: number): [number, number] => [
      k * x,
      k * y
    ];
  }

  /**
   * Diagonal uniform vector field (incompressible).
   * F(x, y) = (c, c) - constant diagonal direction
   * Divergence: 0 (incompressible)
   * Curl: 0
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

  function runInitialComputation() {
    if (!ctx1 || !ctx2 || !ctx3) return;

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
      subdivisionFactor: 8,
      color: streamlineColor,
      strokeWidth: streamlineWidth,
      gradientSubdivisions,
      // Pixel-based pulse animation
      pulseWidthPixels,
      pulsePauseWidthPixels,
      offsets: 'random' as const,
    };

    anim1 = StreamlineAnimation.create({
      vectorFieldFn: convergingFieldFn(0.5),
      ...commonOptions,
    });

    anim2 = StreamlineAnimation.create({
      vectorFieldFn: divergingFieldFn(0.5),
      ...commonOptions,
    });

    anim3 = StreamlineAnimation.create({
      vectorFieldFn: diagonalFieldFn(1.0),
      ...commonOptions,
    });
  }

  function setupTimeline() {
    if (!anim1) return;

    timeline = new Timeline<StreamlineAnimationState>();
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

  function drawStatic(ctx: CanvasRenderingContext2D, anim: StreamlineAnimation<StreamlineAnimationState>) {
    drawTrajectories(ctx, anim.data.streamlines, anim.data.streamlines[0]?.length ?? 0, {
      strokeWidth: streamlineWidth,
      color: streamlineColor,
      progressOpacity: staticOpacity,
      pointRadius: 0,
      showPreview: false,
      showHeadMarker: false
    });
  }

  function draw(state: StreamlineAnimationState) {
    if (!ctx1 || !ctx2 || !ctx3 || !isInitialized) return;
    if (!anim1 || !anim2 || !anim3) return;

    const { streamlinePhase } = state;

    ctx1.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx2.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx3.clearRect(0, 0, canvasWidth, canvasHeight);

    if (staticMode) {
      drawStatic(ctx1, anim1);
      drawStatic(ctx2, anim2);
      drawStatic(ctx3, anim3);
    } else {
      anim1.draw(ctx1, state);
      anim2.draw(ctx2, state);
      anim3.draw(ctx3, state);
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

  onDestroy(() => {
    if (timeline) timeline.dispose();
  });

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  // Initialize when canvases are ready
  $: if (!isInitialized && ctx1 && ctx2 && ctx3) {
    runInitialComputation();
    setupTimeline();
    isInitialized = true;
    if (timeline) {
      draw(timeline.initialState);
      if (playingByDefault) startAnimation();
    }
  }

  // Handle visibility changes
  $: if (isActive !== undefined && isInitialized && $isActive !== undefined) {
    handleVisibilityChange($isActive);
  }
</script>

<div style="width: {width}px; position: relative; left: 50%; transform: translateX(-50%);">
  <TripleFigure {gap} {backgroundVisible} bind:isActive>
    {#snippet leftTitle()}
      Converging
    {/snippet}
    {#snippet left()}
      <canvas
        bind:this={canvas1}
        use:canvas2d1.bindCanvas
        style="width: 100%; height: auto; aspect-ratio: {canvasWidth}/{canvasHeight};"
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
        use:canvas2d2.bindCanvas
        style="width: 100%; height: auto; aspect-ratio: {canvasWidth}/{canvasHeight};"
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
        use:canvas2d3.bindCanvas
        style="width: 100%; height: auto; aspect-ratio: {canvasWidth}/{canvasHeight};"
      ></canvas>
    {/snippet}
    {#snippet rightLabel()}
      <Katex math={"\\nabla \\cdot F = 0"} />
    {/snippet}

    {#snippet caption()}
      {@render children?.()}
    {/snippet}
  </TripleFigure>
</div>
