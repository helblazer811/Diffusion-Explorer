<!-- Helmholtz decomposition (F_combined = F_curl + F_div) visualized with Dynamic LIC. -->

<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { writable, type Writable } from "svelte/store";
  import { Player,
    Katex,
    Timeline,
    initWebGPUContext,
    isWebGPUAvailable,
    computeDLIC,
    type Clip,
    type VectorFieldFn,
    type WebGPUContext,
  } from "@diffusion-explorer/ui";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  // Layout
  export let width = 1400;
  export let height = 450;
  export let gap = 20;
  export let margin = 8;

  // Animation
  export let playingByDefault = true;
  export let animationDurationMs = 12000;
  export let fps = 15;

  // Vector field domain
  export let domainRange = { xMin: -2, xMax: 2, yMin: -2, yMax: 2 };

  // DLIC parameters
  export let integrationSteps = 256;
  export let stepSize = 2.0;
  export let contrast = 5.0;
  export let noiseScale = 4;
  export let maxArcLength = 250.0;
  export let velocityScale = 0.8;
  export let dlicPadding = 80;
  export let wavelengthPixels = 60;

  // Rendering
  export let dpiScale = 2;
  export let seed = 12345;
  export let streamlineColor = "#dc2626";
  export let backgroundColor: [number, number, number] = [255, 255, 255];

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  type AnimationState = { dlicFrameIndex: number };

  const canvasW = Math.floor((width - 2 * gap) / 3);
  const canvasH = height;

  const physicalWidth = canvasW * dpiScale;
  const physicalHeight = canvasH * dpiScale;

  const dlicWidth = (canvasW - 2 * margin) * dpiScale;
  const dlicHeight = (canvasH - 2 * margin) * dpiScale;
  const dlicOffset = margin * dpiScale;

  const frameCount = Math.round((animationDurationMs / 1000) * fps);

  let canvas1: HTMLCanvasElement | null = null;
  let canvas2: HTMLCanvasElement | null = null;
  let canvas3: HTMLCanvasElement | null = null;
  let ctx1: CanvasRenderingContext2D | null = null;
  let ctx2: CanvasRenderingContext2D | null = null;
  let ctx3: CanvasRenderingContext2D | null = null;

  let cachedFramesFull: ImageData[] = [];
  let cachedFramesCurl: ImageData[] = [];
  let cachedFramesDiv: ImageData[] = [];

  let webgpuContext: WebGPUContext | null = null;
  let webgpuAvailable = true;
  let dlicError: string | null = null;
  let isPrecomputing = false;
  let precomputeProgress = 0;
  let player: Player<AnimationState> | null = null;
  let isInitialized = false;
  let wasPlayingBeforeHidden = false;

  // Inline visibility tracking
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

  function parseHexColor(hex: string): [number, number, number] {
    const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (match) {
      return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
    }
    return [220, 38, 38];
  }

  function setupCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
    canvas.width = physicalWidth;
    canvas.height = physicalHeight;
    return canvas.getContext("2d");
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

  async function precomputeFor(
    vectorField: VectorFieldFn,
    cache: ImageData[]
  ): Promise<void> {
    if (!webgpuContext) return;
    const palette = () => parseHexColor(streamlineColor);
    for await (const batch of computeDLIC(
      {
        vectorField,
        domain: domainRange,
        width: dlicWidth,
        height: dlicHeight,
        phase: 0,
        frameCount,
        batchSize: 8,
        wavelength: wavelengthPixels * dpiScale,
        integrationSteps,
        stepSize,
        contrast,
        noiseScale: noiseScale * dpiScale,
        nearestNeighborVelocity: true,
        maxArcLength: maxArcLength * dpiScale,
        useEuler: true,
        velocityScale,
        seed,
        padding: Math.ceil(dlicPadding * dpiScale),
      },
      webgpuContext
    )) {
      for (const result of batch) {
        cache.push(
          result.toColoredImageData({
            palette,
            backgroundColor,
          })
        );
      }
    }
  }

  async function runInitialComputation() {
    if (!ctx1 || !ctx2 || !ctx3) return;

    webgpuAvailable = await isWebGPUAvailable();
    if (!webgpuAvailable) {
      dlicError = "WebGPU not available";
      return;
    }

    try {
      webgpuContext = await initWebGPUContext();
    } catch (err) {
      dlicError = `WebGPU init failed: ${err}`;
      webgpuAvailable = false;
      return;
    }

    isPrecomputing = true;
    precomputeProgress = 0;

    const tasks: { field: VectorFieldFn; cache: ImageData[] }[] = [
      { field: fullField(),          cache: cachedFramesFull },
      { field: curlComponentField(), cache: cachedFramesCurl },
      { field: divergenceField(),    cache: cachedFramesDiv },
    ];

    for (let i = 0; i < tasks.length; i++) {
      await precomputeFor(tasks[i].field, tasks[i].cache);
      precomputeProgress = (i + 1) / tasks.length;
      drawLoading();
    }

    isPrecomputing = false;

    if (webgpuContext) {
      webgpuContext.destroy();
      webgpuContext = null;
    }
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  const dlicFrameClip: Clip<AnimationState> = {
    name: "dlicFrame",
    reduce: function (t: number) {
      const idx = Math.min(Math.floor(t * frameCount), frameCount - 1);
      return { dlicFrameIndex: idx };
    },
  };

  function setupTimeline() {
    const tl = Timeline.from<AnimationState>({
      duration: animationDurationMs / 1000,
      initialState: { dlicFrameIndex: 0 },
      clips: [
        { clip: dlicFrameClip, ...{ start: 0, end: 1 } },
      ],
    });
    player = new Player(tl, { looping: true });
    player.onTick((_t, state) => draw(state));
  }

  function startAnimation() {
    if (player) player.play();
  }

  function stopAnimation() {
    if (player) player.pause();
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function drawPanel(
    ctx: CanvasRenderingContext2D | null,
    cache: ImageData[],
    frameIndex: number
  ) {
    if (!ctx) return;
    ctx.clearRect(0, 0, physicalWidth, physicalHeight);
    if (cache.length > 0) {
      const idx = Math.min(frameIndex, cache.length - 1);
      ctx.putImageData(cache[idx], dlicOffset, dlicOffset);
    }
  }

  function drawLoadingPanel(ctx: CanvasRenderingContext2D | null, label: string) {
    if (!ctx) return;
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, physicalWidth, physicalHeight);
    ctx.fillStyle = "#ffffff";
    ctx.font = `${14 * dpiScale}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, physicalWidth / 2, physicalHeight / 2);
  }

  function drawLoading() {
    const pct = Math.round(precomputeProgress * 100);
    const msg = dlicError
      ? dlicError
      : isPrecomputing
        ? `Computing DLIC... ${pct}%`
        : "Preparing...";
    drawLoadingPanel(ctx1, msg);
    drawLoadingPanel(ctx2, msg);
    drawLoadingPanel(ctx3, msg);
  }

  function draw(state: AnimationState) {
    if (!isInitialized) return;
    drawPanel(ctx1, cachedFramesFull, state.dlicFrameIndex);
    drawPanel(ctx2, cachedFramesCurl, state.dlicFrameIndex);
    drawPanel(ctx3, cachedFramesDiv,  state.dlicFrameIndex);
  }

  // ----------------------------------------------------------------
  // Event Handlers
  // ----------------------------------------------------------------

  function handleVisibilityChange(active: boolean) {
    if (!player) return;
    if (!active && player.isPlaying) {
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
    if (player) player?.dispose();
    if (observer) observer.disconnect();
    if (webgpuContext) {
      webgpuContext.destroy();
      webgpuContext = null;
    }
  });

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  $: if (canvas1 && !ctx1) ctx1 = setupCanvas(canvas1);
  $: if (canvas2 && !ctx2) ctx2 = setupCanvas(canvas2);
  $: if (canvas3 && !ctx3) ctx3 = setupCanvas(canvas3);

  $: if (!isInitialized && ctx1 && ctx2 && ctx3) {
    isInitialized = true;
    drawLoading();
    runInitialComputation().then(() => {
      setupTimeline();
      if (player) {
        draw(player!.timeline.initialState);
        if (playingByDefault && webgpuAvailable) startAnimation();
      } else if (!webgpuAvailable) {
        drawLoading();
      }
    });
  }

  $: if (isInitialized) handleVisibilityChange($isActive);
</script>

<figure class="hd-figure" bind:this={figureElement} style="width: {width}px;">
  <h2 class="hd-headline">Helmholtz Decomposition</h2>
  <div class="hd-grid" style="--canvas-aspect: {canvasW} / {canvasH}; --gap: {gap}px;">
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
    The same decomposition rendered with Dynamic LIC, advecting noise along the field to convey local direction and magnitude.
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
  }
  .hd-op {
    grid-row: 2;
    font-size: 3.5rem;
    font-weight: 300;
    color: #444;
    line-height: 1;
  }
  .hd-op-row-title {
    grid-row: 1;
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
