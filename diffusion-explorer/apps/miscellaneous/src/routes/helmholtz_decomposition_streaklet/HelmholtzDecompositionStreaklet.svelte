<!-- Helmholtz decomposition (F_combined = F_curl + F_div), wind-map-style. -->

<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { writable, type Writable } from "svelte/store";
  import {
    Katex,
    StatelessStreakletAnimation,
    Timeline,
    type VectorFieldFn,
    type StreakletAnimationState,
    type StatelessStreakletSeedingBias,
    type StatelessStreakletSpeedColorMode,
    type StatelessStreakletBackend,
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

  // Vector field
  export let domainRange = { xMin: -2, xMax: 2, yMin: -2, yMax: 2 };

  // Streaklet params
  export let numParticles = 600;
  export let trailLength = 160;
  export let baseLifetimeFrames = 500;
  export let speedScale = 0.01;
  export let seedingBias: StatelessStreakletSeedingBias = 'uniform';
  export let speedColorMode: StatelessStreakletSpeedColorMode = 'alpha';
  export let speedGamma = 0.7;
  export let alphaFloor = 0.05;
  export let gradientSubdivisions = 1;
  export let trailAlphaGamma = 1;
  export let backend: StatelessStreakletBackend = 'cpu';

  // Styling
  export let streamlineColor = "#dc2626";
  export let strokeWidth = 4.5;
  export let background = "rgb(255,255,255)";

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

  let isInitialized = false;
  let wasPlayingBeforeHidden = false;

  let timeline: Timeline<StreakletAnimationState> | null = null;
  let animFull: StatelessStreakletAnimation<StreakletAnimationState> | null = null;
  let animCurl: StatelessStreakletAnimation<StreakletAnimationState> | null = null;
  let animDiv: StatelessStreakletAnimation<StreakletAnimationState> | null = null;

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

  function setupCanvasForBackend(canvas: HTMLCanvasElement): void {
    canvas.width = canvasWidth * dpr;
    canvas.height = canvasHeight * dpr;
    if (backend === 'cpu') {
      // CPU backend: grab a 2D context and pre-scale so drawing uses CSS pixels.
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.scale(dpr, dpr);
    }
    // GPU backend: leave the canvas pristine so the WebGPU renderer can attach.
    // The CSS background-color on the canvas element provides the visible background.
  }

  function createToPixel(cw: number, ch: number): (p: [number, number]) => [number, number] {
    return ([x, y]: [number, number]): [number, number] => [
      ((x - domainRange.xMin) / (domainRange.xMax - domainRange.xMin)) * cw,
      ((domainRange.yMax - y) / (domainRange.yMax - domainRange.yMin)) * ch,
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
    const commonOptions = {
      domain: domainRange,
      toPixel,
      numParticles,
      trailLength,
      baseLifetimeFrames,
      speedScale,
      seedingBias,
      backend,
      color: streamlineColor,
      strokeWidth,
      background,
      speedColorMode,
      speedGamma,
      alphaFloor,
      gradientSubdivisions,
      trailAlphaGamma,
    };

    animFull = StatelessStreakletAnimation.create({ ...commonOptions, vectorFieldFn: fullField() });
    animCurl = StatelessStreakletAnimation.create({ ...commonOptions, vectorFieldFn: curlComponentField() });
    animDiv  = StatelessStreakletAnimation.create({ ...commonOptions, vectorFieldFn: divergenceField() });

    await Promise.all([
      animFull.init(canvas1),
      animCurl.init(canvas2),
      animDiv.init(canvas3),
    ]);
  }

  function setupTimeline() {
    if (!animFull || !animCurl || !animDiv) return;
    timeline = new Timeline<StreakletAnimationState>();
    timeline.initialState = { dt: 0 };
    // Duration is arbitrary — streaklets have no phase and no loop period.
    // We just want the Timeline to keep ticking and to support play/pause.
    timeline.duration = 1;
    timeline.looping = true;

    // No-op clips (the animations' own clips return empty partial state).
    timeline.add(animFull.clip, { start: 0, end: 1 });

    let lastReal = performance.now();
    timeline.onTick(() => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastReal) / 1000);
      lastReal = now;
      // Each animation advects its own particles using its own field, draws
      // one segment per particle onto its own canvas.
      animFull!.draw({ dt });
      animCurl!.draw({ dt });
      animDiv!.draw({ dt });
    });
  }

  function startAnimation() {
    if (timeline) timeline.play();
  }

  function stopAnimation() {
    if (timeline) timeline.pause();
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
    animFull?.destroy();
    animCurl?.destroy();
    animDiv?.destroy();
  });

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  $: if (canvas1 && canvas2 && canvas3 && !canvasesReady) {
    setupCanvasForBackend(canvas1);
    setupCanvasForBackend(canvas2);
    setupCanvasForBackend(canvas3);
    canvasesReady = true;
  }

  $: if (!isInitialized && canvasesReady) {
    isInitialized = true;
    runInitialComputation().then(() => {
      setupTimeline();
      if (timeline && playingByDefault) startAnimation();
    });
  }

  $: if (isInitialized) handleVisibilityChange($isActive);
</script>

<figure class="hd-figure" bind:this={figureElement} style="width: {width}px;">
  <h2 class="hd-headline">Helmholtz Decomposition</h2>
  <div class="hd-grid" style="--canvas-aspect: {canvasWidth} / {canvasHeight}; --gap: {gap}px;">
    <div class="hd-title hd-col-1"><Katex math={String.raw`\mathbf{F}_{\text{combined}}`} /></div>
    <div class="hd-title hd-col-2"><Katex math={String.raw`\mathbf{F}_{\text{curl}}`} /></div>
    <div class="hd-title hd-col-3"><Katex math={String.raw`\mathbf{F}_{\text{div}}`} /></div>

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

    <div class="hd-sub hd-col-1"></div>
    <div class="hd-sub hd-col-2"><Katex math={String.raw`\nabla \cdot \mathbf{F}_{\text{curl}} = 0`} /></div>
    <div class="hd-sub hd-col-3"><Katex math={String.raw`\nabla \times \mathbf{F}_{\text{div}} = \mathbf{0}`} /></div>
  </div>

  <figcaption class="hd-caption">
    The same decomposition rendered with live particle advection: thousands of particles flow through each field, leaving short fading trails.
  </figcaption>
</figure>

<style>
  .hd-figure {
    margin: 2rem auto;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .hd-headline {
    text-align: center;
    font-size: 4.5rem;
    font-weight: 450;
    color: #444;
    margin: 0 0 1rem 0;
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
    font-size: 3.0rem;
    color: #444;
    padding-bottom: 0.1rem;
  }
  .hd-canvas {
    grid-row: 2;
    width: 100%;
    height: auto;
    aspect-ratio: var(--canvas-aspect);
    border-radius: 12px;
    /* GPU backend clears to transparent each frame; this CSS provides the
       visible background. CPU backend paints the same color via fillRect. */
    background-color: rgb(255, 255, 255);
  }
  .hd-op {
    grid-row: 2;
    font-size: 3.5rem;
    font-weight: 300;
    color: #444;
    line-height: 1;
  }
  .hd-sub {
    grid-row: 3;
    font-size: 2.5rem;
    color: #888;
    min-height: 2.8rem;
    padding-top: 0.25rem;
  }
  .hd-col-1 { grid-column: 1; }
  .hd-col-2 { grid-column: 3; }
  .hd-col-3 { grid-column: 5; }
  .hd-op-1 { grid-column: 2; }
  .hd-op-2 { grid-column: 4; }

  .hd-caption {
    font-size: 2.25rem;
    line-height: 1.5;
    color: #999;
    text-align: center;
    margin-top: 0.5rem;
  }
</style>
