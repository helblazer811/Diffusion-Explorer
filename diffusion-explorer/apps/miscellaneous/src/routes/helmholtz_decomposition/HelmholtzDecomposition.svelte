<!-- Visualizes Helmholtz decomposition: F_combined = F_curl + F_div, rendered with streamlines. -->

<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { writable, type Writable } from "svelte/store";
  import {
    Katex,
    StreamlineAnimation,
    Timeline,
    type VectorFieldFn,
    type StreamlineAnimationState,
  } from "@diffusion-explorer/ui";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  // Layout
  export let width = 1400;
  export let height = 450;
  export let gap = 20;

  // Animation
  export let playingByDefault = true;

  // Streamline generation
  export let domainRange = { xMin: -2, xMax: 2, yMin: -2, yMax: 2 };
  export let density: number | [number, number] = 11.0;
  export let minPathLength = 0.25;
  export let segmentLength = 0.01;

  // Styling
  export let streamlineColor = "#dc2626";
  export let streamlineWidth = 3.0;
  export let gradientSubdivisions = 2;

  // Animation pulse settings (in pixels)
  export let pulseWidthPixels = 300;
  export let pulsePauseWidthPixels = 0;

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  const canvasWidth = Math.floor((width - 2 * gap) / 3);
  const canvasHeight = height;
  const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;

  let canvas1: HTMLCanvasElement | null = null;
  let canvas2: HTMLCanvasElement | null = null;
  let canvas3: HTMLCanvasElement | null = null;
  let canvasesReady = false;

  function sizeGpuCanvas(canvas: HTMLCanvasElement): void {
    canvas.width = canvasWidth * dpr;
    canvas.height = canvasHeight * dpr;
  }

  let isInitialized = false;
  let wasPlayingBeforeHidden = false;

  let timeline: Timeline<StreamlineAnimationState> | null = null;

  let animFull: StreamlineAnimation<StreamlineAnimationState> | null = null;
  let animCurl: StreamlineAnimation<StreamlineAnimationState> | null = null;
  let animDiv: StreamlineAnimation<StreamlineAnimationState> | null = null;

  // Inline visibility tracking (replaces TripleFigure's built-in tracker)
  let figureElement: HTMLElement | null = null;
  let observer: IntersectionObserver | null = null;
  const isActive: Writable<boolean> = writable(false);
  let isInViewport = false;
  let isTabVisible = true;

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  // Three "curling sources" arranged in a triangle: each location has both
  // a radial source and a vortex, so each point emits flow while also rotating it.
  const sources: { x: number; y: number; strength: number }[] = [
    { x:  0.00, y:  0.95, strength:  1.5 },
    { x: -0.82, y: -0.48, strength:  1.5 },
    { x:  0.82, y: -0.48, strength:  1.5 },
  ];

  const vortices: { x: number; y: number; strength: number }[] = [
    { x:  0.00, y:  0.95, strength:  1.5 },
    { x: -0.82, y: -0.48, strength: -1.5 },
    { x:  0.82, y: -0.48, strength:  1.5 },
  ];

  const EPS_SQ = 0.05;
  const INV_TWO_PI = 1 / (2 * Math.PI);

  function generateUniformStartPoints(
    range: typeof domainRange,
    gridSize: number = 10
  ): [number, number][] {
    const points: [number, number][] = [];
    const xStep = (range.xMax - range.xMin) / (gridSize + 1);
    const yStep = (range.yMax - range.yMin) / (gridSize + 1);
    for (let i = 1; i <= gridSize; i++) {
      for (let j = 1; j <= gridSize; j++) {
        points.push([range.xMin + i * xStep, range.yMin + j * yStep]);
      }
    }
    return points;
  }

  function createToPixel(cw: number, ch: number): (p: [number, number]) => [number, number] {
    return ([x, y]: [number, number]): [number, number] => [
      ((x - domainRange.xMin) / (domainRange.xMax - domainRange.xMin)) * cw,
      ((domainRange.yMax - y) / (domainRange.yMax - domainRange.yMin)) * ch
    ];
  }

  function updateActiveState() {
    isActive.set(isInViewport && isTabVisible);
  }

  // ----------------------------------------------------------------
  // Vector Field Functions
  // ----------------------------------------------------------------

  function divergenceField(): VectorFieldFn {
    return (x: number, y: number): [number, number] => {
      let vx = 0, vy = 0;
      for (const s of sources) {
        const dx = x - s.x;
        const dy = y - s.y;
        const inv = (s.strength * INV_TWO_PI) / (dx * dx + dy * dy + EPS_SQ);
        vx += dx * inv;
        vy += dy * inv;
      }
      return [vx, vy];
    };
  }

  function curlComponentField(): VectorFieldFn {
    return (x: number, y: number): [number, number] => {
      let vx = 0, vy = 0;
      for (const v of vortices) {
        const dx = x - v.x;
        const dy = y - v.y;
        const inv = (v.strength * INV_TWO_PI) / (dx * dx + dy * dy + EPS_SQ);
        vx += -dy * inv;
        vy +=  dx * inv;
      }
      return [vx, vy];
    };
  }

  function fullField(): VectorFieldFn {
    const fDiv = divergenceField();
    const fCurl = curlComponentField();
    return (x: number, y: number): [number, number] => {
      const [dvx, dvy] = fDiv(x, y);
      const [cvx, cvy] = fCurl(x, y);
      return [dvx + cvx, dvy + cvy];
    };
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  async function runInitialComputation() {
    if (!canvas1 || !canvas2 || !canvas3) return;

    const toPixel = createToPixel(canvasWidth, canvasHeight);
    const domain = { ...domainRange };

    const commonOptions = {
      backend: 'gpu' as const,
      dpr,
      domain,
      toPixel,
      density,
      minPathLength,
      segmentLength,
      color: streamlineColor,
      strokeWidth: streamlineWidth,
      pulseWidthPixels,
      pulsePauseWidthPixels,
      offsets: 'random' as const,
      duration: 24,
      pulseFrequency: 0.125,
    };

    const uniformStartPoints = generateUniformStartPoints(domainRange, 80);

    animFull = StreamlineAnimation.create({
      vectorFieldFn: fullField(),
      ...commonOptions,
      startPoints: uniformStartPoints,
    });

    animCurl = StreamlineAnimation.create({
      vectorFieldFn: curlComponentField(),
      ...commonOptions,
    });

    animDiv = StreamlineAnimation.create({
      vectorFieldFn: divergenceField(),
      ...commonOptions,
      startPoints: uniformStartPoints,
    });

    await Promise.all([
      animFull.init(canvas1),
      animCurl.init(canvas2),
      animDiv.init(canvas3),
    ]);
  }

  function setupTimeline() {
    if (!animFull) return;
    timeline = new Timeline<StreamlineAnimationState>();
    timeline.initialState = { streamlinePhase: 0 };
    timeline.duration = 24;
    timeline.looping = true;
    timeline.add(animFull.clip, { start: 0, end: 1 });
    timeline.onTick((_t, state) => draw(state));
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
    if (!isInitialized) return;
    if (!animFull || !animCurl || !animDiv) return;

    animFull.draw(state);
    animCurl.draw(state);
    animDiv.draw(state);
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
    observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          isInViewport = entry.isIntersecting;
          updateActiveState();
        });
      },
      { threshold: 0, rootMargin: '50px' }
    );
    if (figureElement) observer.observe(figureElement);

    const tabVisHandler = () => {
      isTabVisible = !document.hidden;
      updateActiveState();
    };
    document.addEventListener('visibilitychange', tabVisHandler);

    return () => {
      document.removeEventListener('visibilitychange', tabVisHandler);
    };
  });

  onDestroy(() => {
    if (timeline) timeline.dispose();
    if (observer) observer.disconnect();
  });

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  $: if (canvas1 && canvas2 && canvas3 && !canvasesReady) {
    sizeGpuCanvas(canvas1);
    sizeGpuCanvas(canvas2);
    sizeGpuCanvas(canvas3);
    canvasesReady = true;
  }

  $: if (!isInitialized && canvasesReady) {
    isInitialized = true;
    runInitialComputation().then(() => {
      setupTimeline();
      if (timeline) {
        draw(timeline.initialState);
        if (playingByDefault) startAnimation();
      }
    });
  }

  $: if (isInitialized) handleVisibilityChange($isActive);
</script>

<figure class="hd-figure" bind:this={figureElement} style="width: {width}px;">
  <div class="hd-grid" style="--canvas-aspect: {canvasWidth} / {canvasHeight}; --gap: {gap}px;">
    <div class="hd-title hd-col-1"><Katex math={String.raw`\mathbf{F}_{\text{combined}}`} /></div>
    <div class="hd-title hd-col-2"><Katex math={String.raw`\mathbf{F}_{\text{curl}}`} /></div>
    <div class="hd-title hd-col-3"><Katex math={String.raw`\mathbf{F}_{\text{div}}`} /></div>

    <div class="hd-sub hd-col-1"></div>
    <div class="hd-sub hd-col-2"><Katex math={String.raw`\nabla \cdot \mathbf{F}_{\text{curl}} = 0`} /></div>
    <div class="hd-sub hd-col-3"><Katex math={String.raw`\nabla \times \mathbf{F}_{\text{div}} = \mathbf{0}`} /></div>

    <canvas
      class="hd-canvas hd-col-1"
      bind:this={canvas1}
    ></canvas>
    <div class="hd-op hd-op-1">=</div>
    <canvas
      class="hd-canvas hd-col-2"
      bind:this={canvas2}
    ></canvas>
    <div class="hd-op hd-op-2">+</div>
    <canvas
      class="hd-canvas hd-col-3"
      bind:this={canvas3}
    ></canvas>
  </div>

  <figcaption class="hd-caption">
    <strong>Helmholtz decomposition.</strong>
    Any smooth vector field decomposes into a divergence-free (rotational) part and a curl-free (irrotational) part:
    <Katex math={String.raw`\mathbf{F}_{\text{combined}} = \mathbf{F}_{\text{curl}} + \mathbf{F}_{\text{div}}`} />.
    The full field on the <em>left</em> is built from multiple point vortices and point sources/sinks. The <em>middle</em> shows the sum of just the vortices (carries all the curl), and the <em>right</em> shows the sum of just the sources and sinks (carries all the divergence).
  </figcaption>
</figure>

<style>
  .hd-figure {
    margin: 2rem 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .hd-grid {
    display: grid;
    grid-template-columns: 1fr auto 1fr auto 1fr;
    grid-template-rows: auto auto 1fr;
    column-gap: var(--gap);
    row-gap: 0.5rem;
    align-items: center;
    justify-items: center;
  }

  .hd-title {
    grid-row: 1;
    font-size: 2.25rem;
    color: #444;
    padding-bottom: 0.1rem;
  }
  .hd-canvas {
    grid-row: 2;
    width: 100%;
    height: auto;
    aspect-ratio: var(--canvas-aspect);
  }
  .hd-op {
    grid-row: 2;
    font-size: 2.25rem;
    font-weight: 300;
    color: #444;
    line-height: 1;
  }
  .hd-sub {
    grid-row: 3;
    font-size: 1.725rem;
    color: #444;
    min-height: 2.1rem;
    padding-top: 0.25rem;
  }
  .hd-col-1 { grid-column: 1; }
  .hd-col-2 { grid-column: 3; }
  .hd-col-3 { grid-column: 5; }
  .hd-op-1 { grid-column: 2; }
  .hd-op-2 { grid-column: 4; }

  .hd-caption {
    font-size: 1.5rem;
    line-height: 1.5;
    color: #666;
    text-align: left;
  }
</style>
