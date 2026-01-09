<!-- Visualizes divergence and curl concepts with three vector fields. -->

<script lang="ts">
  import { onDestroy } from "svelte";
  import {
    TripleFigure,
    Katex,
    StreamlineAnimation,
    useCanvas2D,
    Timeline,
    type VectorFieldFn,
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

  // Compute canvas dimensions (inline for initial values, reactive for updates)
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
    anim1 = StreamlineAnimation.create({
      vectorFieldFn: pureDivergenceField(),
      ...commonOptions,
      startPoints: uniformStartPoints,
      minPathLength: 0.5,  // Lower minimum length for better coverage
    });

    anim2 = StreamlineAnimation.create({
      vectorFieldFn: pureCurlField(),
      ...commonOptions,
    });

    anim3 = StreamlineAnimation.create({
      vectorFieldFn: combinedField(0.5, 1.0),
      ...commonOptions,
    });
  }

  function setupTimeline() {
    if (!anim1) return;

    // Compute animation duration from pulse settings
    const spacing = pulseWidth + pulsePauseWidth;
    const animationDuration = pulseFrequency * 10;

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

  function draw(state: StreamlineAnimationState) {
    if (!ctx1 || !ctx2 || !ctx3 || !isInitialized) return;
    if (!anim1 || !anim2 || !anim3) return;

    ctx1.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx2.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx3.clearRect(0, 0, canvasWidth, canvasHeight);

    anim1.draw(ctx1, state);
    anim2.draw(ctx2, state);
    anim3.draw(ctx3, state);
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

<div style="width: {width}px;">
  <TripleFigure {gap} {backgroundVisible} bind:isActive>
    {#snippet leftTitle()}
      Pure Divergence
    {/snippet}
    {#snippet left()}
      <canvas
        bind:this={canvas1}
        use:canvas2d1.bindCanvas
        style="width: 100%; height: auto; aspect-ratio: {canvasWidth}/{canvasHeight};"
      ></canvas>
    {/snippet}
    {#snippet leftLabel()}
      <Katex math={"\\nabla \\cdot F > 0, \\; (\\nabla \\times F)_z = 0"} />
    {/snippet}

    {#snippet centerTitle()}
      Pure Curl
    {/snippet}
    {#snippet center()}
      <canvas
        bind:this={canvas2}
        use:canvas2d2.bindCanvas
        style="width: 100%; height: auto; aspect-ratio: {canvasWidth}/{canvasHeight};"
      ></canvas>
    {/snippet}
    {#snippet centerLabel()}
      <Katex math={"\\nabla \\cdot F = 0, \\; (\\nabla \\times F)_z > 0"} />
    {/snippet}

    {#snippet rightTitle()}
      Divergence + Curl
    {/snippet}
    {#snippet right()}
      <canvas
        bind:this={canvas3}
        use:canvas2d3.bindCanvas
        style="width: 100%; height: auto; aspect-ratio: {canvasWidth}/{canvasHeight};"
      ></canvas>
    {/snippet}
    {#snippet rightLabel()}
      <Katex math={"\\nabla \\cdot F > 0, \\; (\\nabla \\times F)_z > 0"} />
    {/snippet}

    {#snippet caption()}
      <strong>Divergence and curl of vector fields.</strong>
      <Katex math={String.raw`\nabla \cdot \mathbf{F}`} /> denotes divergence (expansion/contraction),
      <Katex math={String.raw`(\nabla \times \mathbf{F})_z`} /> denotes curl (rotation).
      <em>Left:</em> A radial source field with pure divergence and no curl.
      <em>Center:</em> A rotational field with pure curl and no divergence.
      <em>Right:</em> A spiral source field with both divergence and curl.
    {/snippet}
  </TripleFigure>
</div>
