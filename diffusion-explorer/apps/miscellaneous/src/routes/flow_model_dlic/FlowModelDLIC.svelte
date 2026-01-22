<!--
  Flow Model DLIC Visualization

  Visualizes a flow model's time-varying vector field using Dynamic Line Integral Convolution.
  The vector field changes over time (t from 0 to 1) as the flow model transforms
  the source distribution to the target distribution.
-->

<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type { Writable } from "svelte/store";
  import {
    Figure,
    Timeline,
    TimeSlider,
    useVisibilityHandler,
    initWebGPUContext,
    computeTimeVaryingDLIC,
    isWebGPUAvailable,
    exportAnimation,
    downloadBlob,
    type Clip,
    type WebGPUContext,
    type DLICResult,
    type TimeVaryingVectorFieldFn,
  } from "@diffusion-explorer/ui";
  import { FlowModelClient } from "@diffusion-explorer/diffusion";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  let {
    // Layout
    canvasWidth = 500,
    canvasHeight = 500,
    margin = 15,

    // Animation
    animationDurationMs = 3000,
    playingByDefault = true,

    // DLIC Parameters
    integrationSteps = 256,
    stepSize = 2.0,
    contrast = 5.0,
    noiseScale = 4,
    maxArcLength = 80.0,
    velocityScale = 0.1,
    dlicPadding = 150,
    wavelength = 160,
    timeSlices = 32,

    // Flow Model
    modelPath = "/flow_model_dlic/models/model.json",
    workerPath = "/flow_model_dlic/workers/flow_model.worker.js",
    domain = { xMin: -3, xMax: 3, yMin: -3, yMax: 3 },

    // Rendering
    dpiScale = 3,
    seed = 12345,
    backgroundColor = [255, 255, 255] as [number, number, number],
    streamlineColor = "#3b82f6", // Blue
  } = $props();

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  // Derived constants
  const frameCount = Math.round((animationDurationMs / 1000) * 30);

  // Animation state
  type AnimationState = {
    dlicFrameIndex: number;
    flowTime: number;
  };

  // Physical canvas dimensions (scaled for high-DPI rendering)
  const physicalWidth = canvasWidth * dpiScale;
  const physicalHeight = canvasHeight * dpiScale;

  // DLIC dimensions (smaller to fit within margin)
  const dlicWidth = (canvasWidth - 2 * margin) * dpiScale;
  const dlicHeight = (canvasHeight - 2 * margin) * dpiScale;
  const dlicOffset = margin * dpiScale;

  // Canvas context
  let canvas: HTMLCanvasElement | null = $state(null);
  let ctx: CanvasRenderingContext2D | null = $state(null);

  // Timeline and animation
  let timeline: Timeline<AnimationState> | null = $state(null);
  let isInitialized = $state(false);

  // WebGPU context for DLIC
  let webgpuContext: WebGPUContext | null = $state(null);
  let webgpuAvailable = $state(true);
  let dlicError: string | null = $state(null);

  // DLIC frame caching
  let cachedFrames: ImageData[] = $state([]);
  let isPrecomputing = $state(false);
  let precomputeProgress = $state(0);

  // Flow model client
  let flowModelClient: FlowModelClient | null = $state(null);
  let modelLoaded = $state(false);
  let loadError: string | null = $state(null);

  // Pre-computed velocity field for DLIC
  let velocityFieldCache: Map<string, [number, number]> = new Map();

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

  function setupCanvas(canvasEl: HTMLCanvasElement): CanvasRenderingContext2D | null {
    canvasEl.width = physicalWidth;
    canvasEl.height = physicalHeight;
    const context = canvasEl.getContext("2d");
    if (context) {
      context.scale(dpiScale, dpiScale);
    }
    return context;
  }

  /**
   * Create a time-varying vector field function from the flow model.
   * This function queries the velocity field at any (x, y, t) position.
   */
  function createTimeVaryingVectorField(): TimeVaryingVectorFieldFn {
    // We'll use a pre-computed grid and interpolate
    // The grid is computed during initialization
    return (x: number, y: number, t: number): [number, number] => {
      const key = `${x.toFixed(4)},${y.toFixed(4)},${t.toFixed(4)}`;
      const cached = velocityFieldCache.get(key);
      if (cached) return cached;

      // If not cached, return zero (should not happen after pre-computation)
      return [0, 0];
    };
  }

  /**
   * Pre-compute velocity field grid at multiple time slices for DLIC.
   */
  async function precomputeVelocityField(): Promise<void> {
    if (!flowModelClient) return;

    console.log(`[FlowModelDLIC] Pre-computing velocity field at ${timeSlices} time slices...`);

    const gridResolution = Math.max(32, Math.round(dlicWidth * velocityScale / dpiScale));

    for (let t = 0; t < timeSlices; t++) {
      const timeValue = timeSlices > 1 ? t / (timeSlices - 1) : 0.5;

      try {
        const { promise } = flowModelClient.vectorFieldGrid(
          gridResolution,
          domain,
          timeValue
        );

        const result = await promise;

        // Cache the velocities
        for (let i = 0; i < result.gridPoints.length; i++) {
          const [px, py] = result.gridPoints[i];
          const [vx, vy] = result.velocities[i];
          const key = `${px.toFixed(4)},${py.toFixed(4)},${timeValue.toFixed(4)}`;
          velocityFieldCache.set(key, [vx, vy]);
        }

        console.log(`[FlowModelDLIC] Time slice ${t + 1}/${timeSlices} computed`);
      } catch (err) {
        console.error(`[FlowModelDLIC] Error computing velocity field at t=${timeValue}:`, err);
      }
    }

    console.log(`[FlowModelDLIC] Velocity field cache size: ${velocityFieldCache.size}`);
  }

  /**
   * Create vector field function that evaluates at any (x, y, t) using bilinear interpolation.
   */
  function createInterpolatedVectorField(): TimeVaryingVectorFieldFn {
    if (!flowModelClient) {
      return (_x, _y, _t) => [0, 0];
    }

    // Grid parameters for interpolation
    const xStep = (domain.xMax - domain.xMin) / 31;
    const yStep = (domain.yMax - domain.yMin) / 31;
    const tStep = timeSlices > 1 ? 1 / (timeSlices - 1) : 1;

    return (x: number, y: number, t: number): [number, number] => {
      // Find grid cell indices
      const xi = (x - domain.xMin) / xStep;
      const yi = (y - domain.yMin) / yStep;
      const ti = t / tStep;

      const x0 = Math.floor(xi);
      const y0 = Math.floor(yi);
      const t0 = Math.floor(ti);

      const x1 = Math.min(x0 + 1, 31);
      const y1 = Math.min(y0 + 1, 31);
      const t1 = Math.min(t0 + 1, timeSlices - 1);

      const fx = xi - x0;
      const fy = yi - y0;
      const ft = ti - t0;

      // Get grid coordinates
      const px0 = domain.xMin + x0 * xStep;
      const py0 = domain.yMin + y0 * yStep;
      const px1 = domain.xMin + x1 * xStep;
      const py1 = domain.yMin + y1 * yStep;
      const pt0 = t0 * tStep;
      const pt1 = t1 * tStep;

      // Helper to get cached velocity
      const getV = (px: number, py: number, pt: number): [number, number] => {
        const key = `${px.toFixed(4)},${py.toFixed(4)},${pt.toFixed(4)}`;
        return velocityFieldCache.get(key) ?? [0, 0];
      };

      // Trilinear interpolation
      const v000 = getV(px0, py0, pt0);
      const v100 = getV(px1, py0, pt0);
      const v010 = getV(px0, py1, pt0);
      const v110 = getV(px1, py1, pt0);
      const v001 = getV(px0, py0, pt1);
      const v101 = getV(px1, py0, pt1);
      const v011 = getV(px0, py1, pt1);
      const v111 = getV(px1, py1, pt1);

      // Interpolate in x
      const v00: [number, number] = [
        v000[0] * (1 - fx) + v100[0] * fx,
        v000[1] * (1 - fx) + v100[1] * fx,
      ];
      const v10: [number, number] = [
        v010[0] * (1 - fx) + v110[0] * fx,
        v010[1] * (1 - fx) + v110[1] * fx,
      ];
      const v01: [number, number] = [
        v001[0] * (1 - fx) + v101[0] * fx,
        v001[1] * (1 - fx) + v101[1] * fx,
      ];
      const v11: [number, number] = [
        v011[0] * (1 - fx) + v111[0] * fx,
        v011[1] * (1 - fx) + v111[1] * fx,
      ];

      // Interpolate in y
      const v0: [number, number] = [
        v00[0] * (1 - fy) + v10[0] * fy,
        v00[1] * (1 - fy) + v10[1] * fy,
      ];
      const v1: [number, number] = [
        v01[0] * (1 - fy) + v11[0] * fy,
        v01[1] * (1 - fy) + v11[1] * fy,
      ];

      // Interpolate in t
      return [
        v0[0] * (1 - ft) + v1[0] * ft,
        v0[1] * (1 - ft) + v1[1] * ft,
      ];
    };
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  async function runInitialComputation() {
    console.log("[FlowModelDLIC] Running initial computation...");

    // Check WebGPU availability
    webgpuAvailable = await isWebGPUAvailable();
    if (!webgpuAvailable) {
      dlicError = "WebGPU not available";
      console.warn("[FlowModelDLIC] WebGPU not available");
      return;
    }

    // Initialize WebGPU context
    try {
      webgpuContext = await initWebGPUContext();
      console.log("[FlowModelDLIC] WebGPU context initialized");
    } catch (err) {
      dlicError = `WebGPU init failed: ${err}`;
      webgpuAvailable = false;
      return;
    }

    // Initialize flow model client
    try {
      flowModelClient = new FlowModelClient(
        workerPath,
        modelPath,
        "Flow Matching",
        { dim: 2, hidden: 64 }
      );
      modelLoaded = true;
      console.log("[FlowModelDLIC] Flow model client initialized");
    } catch (err) {
      loadError = `Failed to load model: ${err}`;
      console.error("[FlowModelDLIC] Failed to load model:", err);
      return;
    }

    // Pre-compute velocity field
    await precomputeVelocityField();

    // Create interpolated vector field function
    const vectorField = createInterpolatedVectorField();

    // Pre-compute DLIC frames
    if (webgpuContext) {
      isPrecomputing = true;
      cachedFrames = [];

      console.log(`[FlowModelDLIC] Pre-computing ${frameCount} DLIC frames...`);
      let loadedFrameCount = 0;

      // Generate time values for each frame
      const timeValues = Array.from({ length: frameCount }, (_, i) => i / (frameCount - 1));

      for await (const batchResults of computeTimeVaryingDLIC(
        {
          timeVaryingVectorField: vectorField,
          domain,
          width: dlicWidth,
          height: dlicHeight,
          phase: 0,
          frameCount,
          batchSize: 4,
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
          timeSlices,
          timeValues,
        },
        webgpuContext
      )) {
        // Process each batch
        for (const result of batchResults) {
          cachedFrames.push(
            result.toColoredImageData({
              palette: () => parseHexColor(streamlineColor),
              backgroundColor,
            })
          );
          loadedFrameCount++;
          precomputeProgress = loadedFrameCount / frameCount;
          console.log(`[FlowModelDLIC] Frame ${loadedFrameCount}/${frameCount} loaded`);
        }
      }

      isPrecomputing = false;
      console.log("[FlowModelDLIC] Pre-computation complete");

      // Clean up WebGPU context
      webgpuContext.destroy();
      webgpuContext = null;
    }
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  // Clip that updates frame index and flow time based on normalized time
  const dlicFrameClip: Clip<AnimationState> = {
    name: "dlicFrame",
    reduce: function (t) {
      const idx = Math.min(Math.floor(t * frameCount), frameCount - 1);
      return {
        dlicFrameIndex: idx,
        flowTime: t,
      };
    },
  };

  function setupTimeline() {
    console.log("[FlowModelDLIC] Setting up timeline...");

    const initialState: AnimationState = {
      dlicFrameIndex: 0,
      flowTime: 0,
    };

    timeline = new Timeline<AnimationState>();
    timeline.initialState = initialState;
    timeline.duration = animationDurationMs / 1000;
    timeline.looping = true;

    timeline.add(dlicFrameClip, { start: 0, end: 1 });

    timeline.onTick((_, state) => {
      draw(state);
    });

    console.log("[FlowModelDLIC] Timeline setup complete");
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function draw(state: AnimationState) {
    if (!ctx) return;

    if (cachedFrames.length > 0) {
      // Clear and fill background
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, physicalWidth, physicalHeight);

      // Clamp to available frames
      const frameIndex = Math.min(state.dlicFrameIndex, cachedFrames.length - 1);
      ctx.putImageData(cachedFrames[frameIndex], dlicOffset, dlicOffset);
      ctx.restore();

      // Draw time indicator
      ctx.fillStyle = streamlineColor;
      ctx.font = "16px Inter, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(`t = ${state.flowTime.toFixed(2)}`, margin + 10, canvasHeight - margin - 10);
    } else if (isPrecomputing) {
      // Show loading state
      ctx.fillStyle = "#1a1a1a";
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      ctx.fillStyle = "#ffffff";
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(
        `Pre-computing DLIC frames... ${Math.round(precomputeProgress * 100)}%`,
        canvasWidth / 2,
        canvasHeight / 2
      );
    } else if (!webgpuAvailable || loadError) {
      // Show error message
      ctx.fillStyle = "#1a1a1a";
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      ctx.fillStyle = "#ffffff";
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(
        dlicError || loadError || "Error loading visualization",
        canvasWidth / 2,
        canvasHeight / 2
      );
    }
  }

  // ----------------------------------------------------------------
  // Export
  // ----------------------------------------------------------------

  async function handleExport() {
    if (!timeline || !canvas || isExporting) return;

    isExporting = true;
    exportProgress = 0;

    try {
      const video = await exportAnimation(
        {
          timeline,
          draw,
          canvas,
        },
        {
          fps: 30,
          format: "mp4",
          bitrate: 20_000_000,
          onProgress: (p) => {
            exportProgress = p;
          },
        }
      ) as Blob;

      downloadBlob(video, "flow_model_dlic.mp4");
    } catch (err) {
      console.error("[FlowModelDLIC] Export failed:", err);
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
  });

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  $effect(() => {
    if (canvas && !ctx) {
      ctx = setupCanvas(canvas);
    }
  });

  $effect(() => {
    if (!isInitialized && ctx) {
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

<Figure bind:isActive={figureIsActive} backgroundVisible={false}>
  {#snippet children()}
    <div class="canvas-container">
      <h3 class="canvas-title">Flow Model DLIC</h3>
      <canvas
        bind:this={canvas}
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
    <strong>Flow model vector field visualization using Dynamic Line Integral Convolution.</strong>
    The vector field evolves over time (t = 0 to 1) as the flow model transforms
    a Gaussian source distribution to the smiley face target distribution.
    The flowing texture shows the direction of the learned velocity field at each time step.
  {/snippet}
</Figure>

<style>
  .canvas-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
  }

  .canvas-title {
    font-size: 2rem;
    font-weight: 600;
    color: #3b82f6;
    text-align: center;
    margin: 0 0 1rem 0;
    width: 100%;
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
