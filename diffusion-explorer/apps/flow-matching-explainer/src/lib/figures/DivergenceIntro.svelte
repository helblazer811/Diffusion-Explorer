<!-- Introduces the concept of divergence in flow matching with three side-by-side canvases. -->

<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { writable } from "svelte/store";
  import { drawTrajectories, generateStreamlines, resampleStreamlines, Katex, type VectorFieldFn } from "@diffusion-explorer/ui";

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
  export let density: number | [number, number] = 1.0;  // Controls spacing (1.0 = 30x30 grid)
  export let minPathLength = 2.0;  // Minimum streamline path length to keep
  export let segmentLength = 0.01;  // Resample to equal-length segments (in domain units)

  // Styling
  export let streamlineColor = "#e63946";
  export let streamlineWidth = 3.0;
  export let gradientSubdivisions = 5;  // Subdivisions per segment for smooth alpha interpolation
  export let staticMode = false;  // If true, show all streamlines at full opacity without animation
  export let staticOpacity = 0.8;  // Opacity for static streamlines

  // Animation pulse settings
  export let pulseWidth = 0.20;        // Fraction of streamline length each pulse occupies
  export let pulsePauseWidth = 0.05;   // Gap between pulses (fraction of streamline length)
  export let pulseFrequency = 1.0;     // Pulses per second passing a fixed point

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  $: caption = children;

  // Visibility state - exported so parent can bind to it
  export let isActive = writable(false);
  let figureElement;
  let observer = null;

  // Track both scroll visibility and tab visibility
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

  // Random animation offsets per streamline (0-1)
  let offsets1: number[] = [];
  let offsets2: number[] = [];
  let offsets3: number[] = [];

  // Max streamline length for animation timing
  let maxStreamlineLength = 1;

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  function updateActiveState() {
    isActive.set(isInViewport && isTabVisible);
  }

  /**
   * Convert streamlines from domain coords to pixel coords.
   * Streamlines are already in format [streamline][point][x,y].
   */
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

  /**
   * Converging spiral vector field (spiral sink).
   * F(x, y) = (ax - by, bx + ay) with a < 0
   * Divergence: 2a < 0 (volume contracting)
   */
  function convergingSpiralFieldFn(a: number = -0.3, b: number = 1.0): VectorFieldFn {
    return (x: number, y: number): [number, number] => [
      a * x - b * y,
      b * x + a * y
    ];
  }

  /**
   * Diverging spiral vector field (spiral source).
   * F(x, y) = (ax - by, bx + ay) with a > 0
   * Divergence: 2a > 0 (volume expanding)
   */
  function divergingSpiralFieldFn(a: number = 0.3, b: number = 1.0): VectorFieldFn {
    return (x: number, y: number): [number, number] => [
      a * x - b * y,
      b * x + a * y
    ];
  }

  /**
   * Circulating vector field (center, no in/out flow).
   * F(x, y) = (-by, bx) - closed orbits around origin
   * Divergence: 0 (no sources, no sinks)
   */
  function circulatingFieldFn(b: number = 1.0): VectorFieldFn {
    return (x: number, y: number): [number, number] => [
      -b * y,
      b * x
    ];
  }

  // Compute canvas dimensions (each canvas takes 1/3 of available width minus gaps)
  $: canvasWidth = Math.floor((width - 2 * gap) / 3);
  $: canvasHeight = height;

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
      minlength: minPathLength
    };

    const raw1 = generateStreamlines(convergingSpiralFieldFn(-0.5, 1.0), streamlineOptions);
    const raw2 = generateStreamlines(divergingSpiralFieldFn(0.5, 1.0), streamlineOptions);
    const raw3 = generateStreamlines(circulatingFieldFn(0.5), streamlineOptions);

    // Resample to equal-length segments (in domain coordinates)
    const resampled1 = resampleStreamlines(raw1, segmentLength);
    const resampled2 = resampleStreamlines(raw2, segmentLength);
    const resampled3 = resampleStreamlines(raw3, segmentLength);

    // Convert to pixel coordinates
    streamlines1 = streamlinesToPixelCoords(resampled1, domainRange, canvasWidth, canvasHeight);
    streamlines2 = streamlinesToPixelCoords(resampled2, domainRange, canvasWidth, canvasHeight);
    streamlines3 = streamlinesToPixelCoords(resampled3, domainRange, canvasWidth, canvasHeight);

    // Generate random animation offsets for each streamline
    offsets1 = streamlines1.map(() => Math.random());
    offsets2 = streamlines2.map(() => Math.random());
    offsets3 = streamlines3.map(() => Math.random());

    // Calculate max streamline length for animation timing
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

    // Time = spatial phase of wave train [0, 1)
    // speed = spacing * frequency (curve-lengths per second)
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

  /**
   * Compute per-segment alpha values for animated pulses along a streamline.
   *
   * Uses centered pulse blobs with smooth quadratic falloff.
   *
   * @param numSegments - Number of segments in the streamline
   * @param time - Spatial phase of wave train [0, 1)
   * @param offset - Random phase offset for this streamline (0-1)
   * @param pulseWidth - Fraction of streamline length each pulse occupies
   * @param pulsePauseWidth - Gap between pulses (fraction of streamline length)
   * @param baseOpacity - Maximum opacity at pulse center
   */
  function computeAlphaTrail(
    numSegments: number,
    time: number,
    offset: number,
    pulseWidth: number,
    pulsePauseWidth: number,
    baseOpacity: number
  ): number[] {
    const alphas = new Array(numSegments).fill(0);
    if (numSegments === 0) return alphas;

    const spacing = pulseWidth + pulsePauseWidth;
    const posStep = 1 / numSegments;

    const phase = (time + offset) % 1;
    const pulseCount = spacing > 1e-5 ? Math.ceil(1 / spacing) : 1;

    for (let p = 0; p < pulseCount; p++) {
      // Front edge of this pulse (hard leading edge)
      const front = (phase + p * spacing) % 1;
      // Back edge trails behind by pulseWidth
      const back = front - pulseWidth;

      for (let i = 0; i < numSegments; i++) {
        const pos = i * posStep;

        // Check if position is within pulse (handling wrap-around)
        let inPulse = false;
        let distFromFront = 0;

        if (back >= 0) {
          // No wrap-around
          inPulse = pos >= back && pos < front;
          if (inPulse) distFromFront = front - pos;
        } else {
          // Pulse wraps around (back is negative)
          inPulse = pos >= (back + 1) || pos < front;
          if (inPulse) {
            distFromFront = pos < front ? (front - pos) : (front + 1 - pos);
          }
        }

        if (inPulse) {
          // Fade from front (full opacity) to back (zero)
          // distFromFront: 0 at front, pulseWidth at back
          const u = distFromFront / pulseWidth;  // 0 at front → 1 at back
          const alpha = baseOpacity * (1 - u);   // 1 at front → 0 at back
          alphas[i] = Math.max(alphas[i], alpha);
        }
      }
    }

    return alphas;
  }

  function drawStreamlines(
    ctx: CanvasRenderingContext2D,
    streamlines: number[][][],
    offsets: number[],
    time: number  // 0-1 normalized time
  ) {
    if (streamlines.length === 0) return;

    if (staticMode) {
      // Static mode: draw all streamlines at full length with uniform opacity
      drawTrajectories(
        ctx,
        streamlines,
        maxStreamlineLength,  // Show full streamline
        {
          strokeWidth: streamlineWidth,
          color: streamlineColor,
          progressOpacity: staticOpacity,
          pointRadius: 0,
          showPreview: false,
          showHeadMarker: false
        }
      );
      return;
    }

    // Animated mode: draw with multiple animated pulses
    const baseOpacity = 0.8;

    // Compute per-segment alphas for each streamline (multiple simultaneous pulses)
    const perSegmentAlphas: number[][] = streamlines.map((streamline, i) => {
      const numSegments = streamline.length - 1;
      const offset = offsets[i] ?? 0;
      return computeAlphaTrail(numSegments, time, offset, pulseWidth, pulsePauseWidth, baseOpacity);
    });

    // Draw using the per-segment alpha mode
    drawTrajectories(
      ctx,
      streamlines,
      0,  // segmentIndex not used when perSegmentAlphas is provided
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

    // --- Canvas 1: Converging spiral ---
    ctx1.clearRect(0, 0, canvasWidth, canvasHeight);
    drawStreamlines(ctx1, streamlines1, offsets1, t);

    // --- Canvas 2: Diverging spiral ---
    ctx2.clearRect(0, 0, canvasWidth, canvasHeight);
    drawStreamlines(ctx2, streamlines2, offsets2, t);

    // --- Canvas 3: Circulating field ---
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

  onMount(() => {
    // Create IntersectionObserver to track scrolling visibility
    observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          isInViewport = entry.isIntersecting;
          updateActiveState();
        });
      },
      {
        threshold: 0,
        rootMargin: '50px'
      }
    );

    if (figureElement) {
      observer.observe(figureElement);
    }

    // Handle tab visibility changes
    const handleTabVisibility = () => {
      isTabVisible = !document.hidden;
      updateActiveState();
    };

    document.addEventListener('visibilitychange', handleTabVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleTabVisibility);
    };
  });

  onDestroy(() => {
    stopAnimation();
    if (observer) {
      observer.disconnect();
    }
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
  $: if (isInitialized) {
    handleVisibilityChange($isActive);
  }

  // Update drawing when time changes
  $: if (isInitialized && time !== undefined) {
    draw({ time });
  }
</script>

<figure class="triple-figure" bind:this={figureElement} style="width: {width}px;">
  <div class="triple-figure-container" style="gap: {gap}px;">
    <div class="figure-panel">
      <div class="panel-title">Converging</div>
      <div class="figure-content" class:no-background={!backgroundVisible}>
        <canvas
          bind:this={canvas1}
          style="width: 100%; height: auto; aspect-ratio: {canvasWidth}/{canvasHeight};"
        ></canvas>
      </div>
      <div class="panel-label"><Katex math={"\\nabla \\cdot V < 0"} /></div>
    </div>
    <div class="figure-panel">
      <div class="panel-title">Diverging</div>
      <div class="figure-content" class:no-background={!backgroundVisible}>
        <canvas
          bind:this={canvas2}
          style="width: 100%; height: auto; aspect-ratio: {canvasWidth}/{canvasHeight};"
        ></canvas>
      </div>
      <div class="panel-label"><Katex math={"\\nabla \\cdot V > 0"} /></div>
    </div>
    <div class="figure-panel">
      <div class="panel-title">Incompressible</div>
      <div class="figure-content" class:no-background={!backgroundVisible}>
        <canvas
          bind:this={canvas3}
          style="width: 100%; height: auto; aspect-ratio: {canvasWidth}/{canvasHeight};"
        ></canvas>
      </div>
      <div class="panel-label"><Katex math={"\\nabla \\cdot V = 0"} /></div>
    </div>
  </div>
  <figcaption class="figure-caption">
    {@render caption?.()}
  </figcaption>
</figure>

<style>
  .triple-figure {
    position: relative;
    left: 50%;
    transform: translateX(-50%);
    margin: 2rem 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .triple-figure-container {
    width: 100%;
    display: flex;
    flex-direction: row;
    justify-content: space-between;
  }

  .figure-content {
    position: relative;
    flex: 1;
    display: flex;
    justify-content: center;
    align-items: center;
    background-color: #f9f9f9;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    padding: 0.5rem;
    user-select: none;
    -webkit-user-select: none;
  }

  .figure-content.no-background {
    background-color: transparent;
    border: none;
  }

  .figure-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
  }

  .panel-title {
    font-size: 1.5rem;
    font-weight: 600;
    color: #444;
    text-align: center;
    padding-bottom: 0.25rem;
  }

  .panel-label {
    font-size: 1.35rem;
    color: #444;
    text-align: center;
    width: 100%;
    display: flex;
    justify-content: center;
    padding: 0.5rem 0;
  }

  .figure-caption {
    font-size: 1.1rem;
    line-height: 1.5;
    color: #666;
    text-align: left;
  }
</style>
