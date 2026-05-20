<!-- Visualizes Helmholtz decomposition: F_combined = F_curl + F_div, rendered with streamlines. -->

<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { writable, type Writable } from "svelte/store";
  import { Player,
    Katex,
    StreamlineAnimation,
    Timeline,
    drawTrajectories,
    generateStreamlines,
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
  export let density: number | [number, number] = 40.0;
  export let minPathLength = 1.5;
  export let segmentLength = 0.01;

  // Styling
  export let streamlineColor = "#dc2626";
  export let streamlineWidth = 4.5;
  export let gradientSubdivisions = 2;

  // Animation pulse settings (in pixels)
  export let pulseWidthPixels = 400;
  export let pulsePauseWidthPixels = 30;
  /**
   * Gamma on pulse alpha ramp (tail → head). 1 = linear (default).
   *   > 1 — head-loaded comet: trail dies off quickly behind head.
   *   < 1 — tail-loaded: trail stays visible far behind head.
   */
  export let pulseGamma = 2.0;

  // Alpha rendering mode:
  //   'pulse'    — animated GPU pulses traveling along each streamline (default)
  //   'velocity' — static CPU render with per-segment alpha = local |v| / maxV
  export let alphaMode: 'pulse' | 'velocity' = 'pulse';
  export let velocityAlphaFloor = 0.05;
  export let velocityAlphaGamma = 0.7;

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

  let player: Player<StreamlineAnimationState> | null = null;

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

  // Two "curling sources": each location has both a radial source and a vortex,
  // so each point emits flow while also rotating it.
  const sources: { x: number; y: number; strength: number }[] = [
    { x: -0.8, y: 0, strength:  1.5 },
    { x:  0.8, y: 0, strength:  1.5 },
  ];

  const vortices: { x: number; y: number; strength: number }[] = [
    { x: -0.8, y: 0, strength:  1.5 },
    { x:  0.8, y: 0, strength:  1.5 },
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

    // Integrate streamlines over a domain larger than the view so they
    // can flow off-screen at their natural endpoints. toPixel still
    // uses domainRange, so anything outside maps off-canvas and clips.
    const overscan = 1.0;
    const integrationDomain = {
      xMin: domainRange.xMin - overscan,
      xMax: domainRange.xMax + overscan,
      yMin: domainRange.yMin - overscan,
      yMax: domainRange.yMax + overscan,
    };

    const commonOptions = {
      backend: 'gpu' as const,
      dpr,
      domain: integrationDomain,
      toPixel,
      density,
      minPathLength,
      segmentLength,
      integrationDirection: 'both' as const,
      color: streamlineColor,
      strokeWidth: streamlineWidth,
      pulseWidthPixels,
      pulsePauseWidthPixels,
      pulseGamma,
      offsets: 'random' as const,
      duration: 24,
      pulseFrequency: 0.125,
    };

    // Seed points still cover only the visible view domain.
    const uniformStartPoints = generateUniformStartPoints(domainRange, 80);

    animFull = StreamlineAnimation.create({
      vectorFieldFn: fullField(),
      ...commonOptions,
      startPoints: uniformStartPoints,
    });

    animCurl = StreamlineAnimation.create({
      vectorFieldFn: curlComponentField(),
      ...commonOptions,
      startPoints: uniformStartPoints,
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
    const tl = Timeline.from<StreamlineAnimationState>({
      duration: 24,
      initialState: { streamlinePhase: 0 },
      clips: [
        { clip: animFull.clip, ...{ start: 0, end: 1 } },
      ],
    });
    player = new Player(tl, { looping: true });
    player.onTick((_t, state) => draw(state));
  }

  // ----------------------------------------------------------------
  // Velocity-encoded static render (alphaMode = 'velocity')
  // ----------------------------------------------------------------

  function estimateMaxSpeed(
    field: VectorFieldFn,
    domain: typeof domainRange,
    gridSize = 60
  ): number {
    let maxSq = 0;
    for (let i = 0; i <= gridSize; i++) {
      for (let j = 0; j <= gridSize; j++) {
        const x = domain.xMin + (domain.xMax - domain.xMin) * (i / gridSize);
        const y = domain.yMin + (domain.yMax - domain.yMin) * (j / gridSize);
        const [vx, vy] = field(x, y);
        const m2 = vx * vx + vy * vy;
        if (m2 > maxSq) maxSq = m2;
      }
    }
    return Math.sqrt(maxSq);
  }

  function computeVelocityAlphas(
    rawStreamline: number[][],
    field: VectorFieldFn,
    maxV: number
  ): number[] {
    if (maxV <= 0) return rawStreamline.map(() => 1);
    return rawStreamline.map(([x, y]) => {
      const [vx, vy] = field(x, y);
      const m = Math.min(1, Math.sqrt(vx * vx + vy * vy) / maxV);
      return velocityAlphaFloor + (1 - velocityAlphaFloor) * Math.pow(m, velocityAlphaGamma);
    });
  }

  async function renderVelocityPanel(
    canvas: HTMLCanvasElement | null,
    field: VectorFieldFn,
    integrationDomain: typeof domainRange,
    toPixel: (p: [number, number]) => [number, number],
    startPoints: [number, number][] | undefined
  ): Promise<void> {
    if (!canvas) return;
    const rawStreamlines = generateStreamlines(field, {
      domainMin: [integrationDomain.xMin, integrationDomain.yMin],
      domainMax: [integrationDomain.xMax, integrationDomain.yMax],
      density,
      integrationDirection: 'both',
      minlength: minPathLength,
      segmentLength,
      startPoints,
    });
    const maxV = estimateMaxSpeed(field, integrationDomain);
    const perSegmentAlphas = rawStreamlines.map((s) =>
      computeVelocityAlphas(s, field, maxV)
    );
    const pixelStreamlines = rawStreamlines.map((s) =>
      s.map((p) => toPixel(p as [number, number]))
    );
    // Pass the canvas element (pristine, no 2D context attached) to use the
    // GPU rendering path. drawTrajectories caches a GPUTrajectoryRenderer
    // per canvas internally.
    await drawTrajectories(canvas, pixelStreamlines, 0, {
      strokeWidth: streamlineWidth,
      color: streamlineColor,
      opacity: 1.0,
      pointRadius: 0,
      showPreview: false,
      showHeadMarker: false,
      perSegmentAlphas,
      gradientSubdivisions,
    });
  }

  async function runVelocityRender() {
    if (!canvas1 || !canvas2 || !canvas3) return;
    const toPixel = createToPixel(canvasWidth, canvasHeight);
    const overscan = 1.0;
    const integrationDomain = {
      xMin: domainRange.xMin - overscan,
      xMax: domainRange.xMax + overscan,
      yMin: domainRange.yMin - overscan,
      yMax: domainRange.yMax + overscan,
    };
    const uniformStartPoints = generateUniformStartPoints(domainRange, 80);
    await Promise.all([
      renderVelocityPanel(canvas1, fullField(), integrationDomain, toPixel, uniformStartPoints),
      renderVelocityPanel(canvas2, curlComponentField(), integrationDomain, toPixel, undefined),
      renderVelocityPanel(canvas3, divergenceField(), integrationDomain, toPixel, uniformStartPoints),
    ]);
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  function startAnimation() {
    if (player) player.play();
  }

  function stopAnimation() {
    if (player) player.pause();
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
  });

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  // Both modes use WebGPU on pristine canvases — just size them to physical pixels.
  $: if (canvas1 && canvas2 && canvas3 && !canvasesReady) {
    sizeGpuCanvas(canvas1);
    sizeGpuCanvas(canvas2);
    sizeGpuCanvas(canvas3);
    canvasesReady = true;
  }

  $: if (!isInitialized && canvasesReady) {
    isInitialized = true;
    if (alphaMode === 'pulse') {
      runInitialComputation().then(() => {
        setupTimeline();
        if (player) {
          draw(player!.timeline.initialState);
          if (playingByDefault) startAnimation();
        }
      });
    } else {
      // Static, one-shot render — no Timeline, no animation.
      runVelocityRender();
    }
  }

  $: if (isInitialized) handleVisibilityChange($isActive);
</script>

<figure class="hd-figure" bind:this={figureElement} style="width: {width}px;">
  <h2 class="hd-headline">Helmholtz Decomposition</h2>
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
    Any smooth vector field can be written as the sum of a divergence-free rotational part and a curl-free irrotational part.
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
