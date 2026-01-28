<!--
  Dynamic LIC Visualization

  Compares animated streamlines (left) with Dynamic Line Integral Convolution (right)
  for the same vector field.
-->

<script lang="ts">
  import { onDestroy } from "svelte";
  import type { Writable } from "svelte/store";
  import {
    DoubleFigure,
    Timeline,
    TimeSlider,
    useVisibilityHandler,
    StreamlineAnimation,
    initWebGPUContext,
    computeDLIC,
    isWebGPUAvailable,
    exportAnimation,
    downloadBlob,
    type Clip,
    type VectorFieldFn,
    type WebGPUContext,
    type StreamlineAnimationState,
    type DLICResult,
  } from "@diffusion-explorer/ui";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  let {
    // Layout
    canvasWidth = 450,
    canvasHeight = 450,
    gap = 20,
    margin = 15,

    // Animation
    animationDurationMs = 1500,
    playingByDefault = true,

    // Streamline Appearance
    pulseWidthPixels = 40,
    pulsePauseWidthPixels = 7,
    streamlineColor = "#3b82f6",
    strokeWidth = 3.5,
    baseOpacity = 0.9,
    loopMultiplier = 1.5,
    gridSize = 16,
    subdivisionFactor = 16,
    minPathLength = 0.5,

    // DLIC Parameters
    integrationSteps = 256,
    stepSize = 2.0,
    contrast = 5.0,
    noiseScale = 4,
    maxArcLength = 80.0,
    velocityScale = 0.1,
    dlicPadding = 150,

    // Vector Field
    vectorField = ((x: number, y: number) => [-y - 0.5 * x, x - 0.5 * y]) as VectorFieldFn,
    domain = { xMin: -2, xMax: 2, yMin: -2, yMax: 2 },

    // Rendering
    dpiScale = 3,
    seed = 12345,
    backgroundColor = [255, 255, 255] as [number, number, number],
  } = $props();

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  // Derived constants
  const wavelength = 4 * pulseWidthPixels + pulsePauseWidthPixels;
  const frameCount = Math.round((animationDurationMs / 1000) * 30);

  // Animation state includes both streamline phase and DLIC frame index
  type AnimationState = StreamlineAnimationState & {
    dlicFrameIndex: number;
  };

  // Physical canvas dimensions (scaled for high-DPI rendering)
  const physicalWidth = canvasWidth * dpiScale;
  const physicalHeight = canvasHeight * dpiScale;

  // DLIC dimensions (smaller to fit within margin)
  const dlicWidth = (canvasWidth - 2 * margin) * dpiScale;
  const dlicHeight = (canvasHeight - 2 * margin) * dpiScale;
  const dlicOffset = margin * dpiScale;

  // Canvas contexts
  let canvasLeft: HTMLCanvasElement | null = $state(null);
  let canvasRight: HTMLCanvasElement | null = $state(null);
  let ctxLeft: CanvasRenderingContext2D | null = $state(null);
  let ctxRight: CanvasRenderingContext2D | null = $state(null);

  // Timeline and animation
  let timeline: Timeline<AnimationState> | null = $state(null);
  let isInitialized = $state(false);

  // WebGPU context for DLIC (used during pre-computation)
  let webgpuContext: WebGPUContext | null = $state(null);
  let webgpuAvailable = $state(true);
  let dlicError: string | null = $state(null);

  // DLIC frame caching
  let cachedFrames: ImageData[] = $state([]);
  let isPrecomputing = $state(false);

  // Streamline animation
  let streamlineAnimation: StreamlineAnimation<AnimationState> | null = $state(null);

  // Visibility
  let figureIsActive: Writable<boolean> | undefined = $state(undefined);
  const { handleVisibilityChange } = useVisibilityHandler(() => timeline);

  // Export state
  let isExporting = $state(false);
  let exportProgress = $state(0);

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  function parseHexColor(hex: string): [number, number, number] {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (result) {
      return [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)];
    }
    return [59, 130, 246]; // Default blue fallback
  }

  function setupCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
    canvas.width = physicalWidth;
    canvas.height = physicalHeight;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(dpiScale, dpiScale);
    }
    return ctx;
  }

  /**
   * Generate uniform grid of starting points for seeding.
   */
  function generateUniformStartPoints(gridSize: number = 8): [number, number][] {
    const points: [number, number][] = [];
    const xStep = (domain.xMax - domain.xMin) / (gridSize + 1);
    const yStep = (domain.yMax - domain.yMin) / (gridSize + 1);

    for (let i = 1; i <= gridSize; i++) {
      for (let j = 1; j <= gridSize; j++) {
        const x = domain.xMin + i * xStep;
        const y = domain.yMin + j * yStep;
        points.push([x, y]);
      }
    }
    return points;
  }

  function toPixel(p: [number, number]): [number, number] {
    const gridWidth = canvasWidth - 2 * margin;
    const gridHeight = canvasHeight - 2 * margin;
    return [
      margin + ((p[0] - domain.xMin) / (domain.xMax - domain.xMin)) * gridWidth,
      margin + ((p[1] - domain.yMin) / (domain.yMax - domain.yMin)) * gridHeight,
    ];
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  async function runInitialComputation() {
    console.log("[DynamicLIC] Running initial computation...");

    // Check WebGPU availability
    webgpuAvailable = await isWebGPUAvailable();
    if (!webgpuAvailable) {
      dlicError = "WebGPU not available";
      console.warn("[DynamicLIC] WebGPU not available");
    } else {
      // Initialize WebGPU context for reuse
      try {
        webgpuContext = await initWebGPUContext();
        console.log("[DynamicLIC] WebGPU context initialized");
      } catch (err) {
        dlicError = `WebGPU init failed: ${err}`;
        webgpuAvailable = false;
      }
    }

    // Create streamline animation with uniform grid seeding
    const uniformStartPoints = generateUniformStartPoints(gridSize);
    streamlineAnimation = StreamlineAnimation.create<AnimationState>({
      vectorFieldFn: vectorField,
      domain,
      toPixel,
      startPoints: uniformStartPoints,
      minPathLength,
      integrationDirection: "both",
      pulseWidthPixels,
      pulsePauseWidthPixels,
      baseOpacity,
      offsets: "synchronized",
      color: streamlineColor,
      strokeWidth,
      subdivisionFactor,
      loopMultiplier,
    });

    // Initialize the animation with the left canvas
    if (canvasLeft) {
      await streamlineAnimation.init(canvasLeft);
    }

    console.log(
      `[DynamicLIC] Created streamline animation with ${streamlineAnimation.data.streamlines.length} streamlines`
    );

    // Pre-compute DLIC frames progressively using batched multi-frame API
    if (webgpuContext) {
      isPrecomputing = true;
      cachedFrames = []; // Reset cache

      console.log(`[DynamicLIC] Pre-computing ${frameCount} DLIC frames (progressive)...`);
      let loadedFrameCount = 0;

      for await (const batchResults of computeDLIC(
        {
          vectorField,
          domain,
          width: dlicWidth,
          height: dlicHeight,
          phase: 0, // ignored when frameCount is set
          frameCount,
          batchSize: 8,
          wavelength: wavelength * dpiScale,
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
        // Process each batch as it arrives
        for (const result of batchResults) {
          cachedFrames.push(
            result.toColoredImageData({
              palette: () => parseHexColor(streamlineColor),
              backgroundColor,
            })
          );
          loadedFrameCount++;
          console.log(`[DynamicLIC] Frame ${loadedFrameCount}/${frameCount} loaded`);
        }
      }

      isPrecomputing = false;
      console.log(`[DynamicLIC] Pre-computation complete`);

      // WebGPU context no longer needed - destroy to free resources
      webgpuContext.destroy();
      webgpuContext = null;
    }
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  // Clip that updates dlicFrameIndex based on normalized time
  const dlicFrameClip: Clip<AnimationState> = {
    name: "dlicFrame",
    reduce: function (t){
      const idx = Math.min(Math.floor(t * frameCount), frameCount - 1);
      // Debug: log occasionally to avoid spam
      if (Math.random() < 0.01) {
        console.log(`[dlicFrameClip] t=${t.toFixed(3)}, frameCount=${frameCount}, idx=${idx}`);
      }
      return {
        dlicFrameIndex: idx,
      };
    },
  };

  function setupTimeline() {
    console.log("[DynamicLIC] Setting up timeline...");

    if (!streamlineAnimation) return;

    const initialState: AnimationState = {
      streamlinePhase: 0,
      dlicFrameIndex: 0,
    };

    timeline = new Timeline<AnimationState>();
    timeline.initialState = initialState;
    timeline.duration = animationDurationMs / 1000;
    timeline.looping = true;

    // Two parallel clips, both [0, 1]
    timeline.add(streamlineAnimation.clip, { start: 0, end: 1 });
    timeline.add(dlicFrameClip, { start: 0, end: 1 });

    timeline.onTick((_, state) => {
      draw(state);
    });

    console.log(`[DynamicLIC] Timeline setup complete`);
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function draw(state: AnimationState) {
    // Draw streamlines on left canvas
    if (ctxLeft && streamlineAnimation) {
      ctxLeft.clearRect(0, 0, canvasWidth, canvasHeight);

      // White background
      ctxLeft.fillStyle = "#ffffff";
      ctxLeft.fillRect(0, 0, canvasWidth, canvasHeight);

      streamlineAnimation.draw(state);
    }

    // Draw DLIC on right canvas (from cache)
    if (ctxRight && cachedFrames.length > 0) {
      // Clear and fill background
      ctxRight.save();
      ctxRight.setTransform(1, 0, 0, 1, 0, 0);
      ctxRight.fillStyle = "#ffffff";
      ctxRight.fillRect(0, 0, physicalWidth, physicalHeight);

      // Clamp to available frames (handles progressive loading)
      const frameIndex = Math.min(state.dlicFrameIndex, cachedFrames.length - 1);
      ctxRight.putImageData(cachedFrames[frameIndex], dlicOffset, dlicOffset);
      ctxRight.restore();
    } else if (ctxRight && isPrecomputing) {
      // Show loading state
      ctxRight.fillStyle = "#1a1a1a";
      ctxRight.fillRect(0, 0, canvasWidth, canvasHeight);
      ctxRight.fillStyle = "#ffffff";
      ctxRight.font = "14px sans-serif";
      ctxRight.textAlign = "center";
      ctxRight.fillText("Pre-computing DLIC frames...", canvasWidth / 2, canvasHeight / 2);
    } else if (ctxRight && !webgpuAvailable) {
      // Show error message
      ctxRight.fillStyle = "#1a1a1a";
      ctxRight.fillRect(0, 0, canvasWidth, canvasHeight);
      ctxRight.fillStyle = "#ffffff";
      ctxRight.font = "14px sans-serif";
      ctxRight.textAlign = "center";
      ctxRight.fillText(dlicError || "WebGPU not available", canvasWidth / 2, canvasHeight / 2);
    }
  }

  // ----------------------------------------------------------------
  // Export
  // ----------------------------------------------------------------

  async function handleExport() {
    if (!timeline || !canvasLeft || !canvasRight || isExporting) return;

    isExporting = true;
    exportProgress = 0;

    try {
      const videos = await exportAnimation(
        {
          timeline,
          draw,
          canvas: [canvasLeft, canvasRight],
        },
        {
          fps: 30,
          format: 'mp4',
          bitrate: 20_000_000, // 20 Mbps for high quality
          onProgress: (p) => {
            exportProgress = p;
          },
        }
      ) as Blob[];

      // Download both videos
      downloadBlob(videos[0], 'streamlines.mp4');
      // Small delay between downloads
      await new Promise(resolve => setTimeout(resolve, 100));
      downloadBlob(videos[1], 'dlic.mp4');
    } catch (err) {
      console.error('[DynamicLIC] Export failed:', err);
    } finally {
      isExporting = false;
      exportProgress = 0;
    }
  }

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  onDestroy(() => {
    if (timeline) {
      timeline.dispose();
    }
    // Note: webgpuContext is destroyed after pre-computation, so no cleanup needed here
  });

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  $effect(() => {
    if (canvasLeft && !ctxLeft) {
      ctxLeft = setupCanvas(canvasLeft);
    }
  });

  $effect(() => {
    if (canvasRight && !ctxRight) {
      ctxRight = setupCanvas(canvasRight);
    }
  });

  $effect(() => {
    if (!isInitialized && ctxLeft && ctxRight) {
      runInitialComputation().then(() => {
        setupTimeline();
        isInitialized = true;

        if (playingByDefault && timeline) {
          draw(timeline.initialState);
          timeline.play();
        }
      });
    }
  });

  $effect(() => {
    if (figureIsActive !== undefined && isInitialized) {
      handleVisibilityChange($figureIsActive);
    }
  });
</script>

<DoubleFigure {gap} bind:isActive={figureIsActive} backgroundVisible={false}>
  {#snippet left()}
    <div class="canvas-container">
      <h3 class="canvas-title">Streamlines</h3>
      <canvas
        bind:this={canvasLeft}
        width={physicalWidth}
        height={physicalHeight}
        style="width: {canvasWidth}px; height: {canvasHeight}px;"
      ></canvas>
    </div>
  {/snippet}

  {#snippet right()}
    <div class="canvas-container">
      <h3 class="canvas-title">Dynamic Line Integral Convolution</h3>
      <canvas
        bind:this={canvasRight}
        width={physicalWidth}
        height={physicalHeight}
        style="width: {canvasWidth}px; height: {canvasHeight}px;"
      ></canvas>
    </div>
  {/snippet}

  {#snippet footer()}
    <div class="footer-controls">
      <TimeSlider {timeline} showTicks={false} showTimeLabel={false} />
      <button
        class="export-button"
        onclick={handleExport}
        disabled={isExporting || !isInitialized}
      >
        {#if isExporting}
          Exporting... {Math.round(exportProgress * 100)}%
        {:else}
          Export MP4
        {/if}
      </button>
    </div>
  {/snippet}

  {#snippet caption()}
    <strong>Two approaches to animated vector field visualization.</strong>
    <em>Left:</em> Animated streamlines with pulses traveling along flow paths.
    <em>Right:</em> Dynamic Line Integral Convolution (DLIC) creates a flowing texture effect
    by advecting noise along streamlines. Both visualize the same rotation field F(x,y) = (-y, x).
  {/snippet}
</DoubleFigure>

<style>
  .canvas-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
  }

  .canvas-title {
    font-size: 2.0rem;
    font-weight: 600;
    color: #666;
    text-align: center;
    margin: 0 0 1rem 0;
    width: 100%;
    word-wrap: break-word;
    min-height: 5rem;
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }

  .footer-controls {
    display: flex;
    align-items: center;
    gap: 1rem;
    width: 100%;
  }

  .footer-controls :global(.time-slider) {
    flex: 1;
  }

  .export-button {
    padding: 0.5rem 1rem;
    font-size: 0.875rem;
    font-weight: 500;
    color: white;
    background-color: #3b82f6;
    border: none;
    border-radius: 0.375rem;
    cursor: pointer;
    white-space: nowrap;
    min-width: 120px;
  }

  .export-button:hover:not(:disabled) {
    background-color: #2563eb;
  }

  .export-button:disabled {
    background-color: #9ca3af;
    cursor: not-allowed;
  }
</style>
