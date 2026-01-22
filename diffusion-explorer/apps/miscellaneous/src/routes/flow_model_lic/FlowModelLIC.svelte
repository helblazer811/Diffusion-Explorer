<!--
  Flow Model LIC Visualization

  Visualizes a trained flow matching model using Dynamic Line Integral Convolution
  with time-varying vector fields. Shows how the learned velocity field evolves
  from noise (t=0) to data (t=1).
-->

<script lang="ts">
  import { onDestroy } from "svelte";
  import type { Writable } from "svelte/store";
  import {
    Figure,
    Timeline,
    TimeSlider,
    useVisibilityHandler,
    initWebGPUContext,
    computeDLIC,
    isWebGPUAvailable,
    type Clip,
    type WebGPUContext,
    type DLICResult,
  } from "@diffusion-explorer/ui";
  import type { FlowModelClient, VectorFieldResult } from "@diffusion-explorer/diffusion";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  interface Props {
    /** Flow model client for evaluating vector field */
    flowModelClient: FlowModelClient;
    /** Canvas width in CSS pixels */
    canvasWidth?: number;
    /** Canvas height in CSS pixels */
    canvasHeight?: number;
    /** Margin around the DLIC visualization */
    margin?: number;
    /** Number of time steps for vector field (equals frame count) */
    numTimeSteps?: number;
    /** Animation duration in ms */
    animationDurationMs?: number;
    /** Auto-play on load */
    playingByDefault?: boolean;
    /** Domain bounds for vector field evaluation */
    domain?: { xMin: number; xMax: number; yMin: number; yMax: number };
    /** DPI scale for high-resolution rendering */
    dpiScale?: number;
    /** Random seed for noise */
    seed?: number;
    /** DLIC contrast */
    contrast?: number;
    /** DLIC noise scale */
    noiseScale?: number;
    /** DLIC integration steps */
    integrationSteps?: number;
    /** DLIC step size */
    stepSize?: number;
    /** DLIC max arc length */
    maxArcLength?: number;
    /** DLIC wavelength */
    wavelength?: number;
    /** DLIC padding */
    dlicPadding?: number;
    /** Velocity field resolution scale (0-1) */
    velocityScale?: number;
    /** Streamline color */
    streamlineColor?: string;
    /** Background color */
    backgroundColor?: [number, number, number];
  }

  let {
    flowModelClient,
    canvasWidth = 500,
    canvasHeight = 500,
    margin = 15,
    numTimeSteps = 200,
    animationDurationMs = 6000,
    playingByDefault = true,
    domain = { xMin: -2.5, xMax: 2.5, yMin: -2.5, yMax: 2.5 },
    dpiScale = 2,
    seed = 42,
    contrast = 5.0,
    noiseScale = 4,
    integrationSteps = 256,
    stepSize = 2.0,
    maxArcLength = 80.0,
    wavelength = 160,
    dlicPadding = 150,
    velocityScale = 0.1,
    streamlineColor = "#3b82f6",
    backgroundColor = [255, 255, 255] as [number, number, number],
  }: Props = $props();

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  // Physical canvas dimensions
  const physicalWidth = canvasWidth * dpiScale;
  const physicalHeight = canvasHeight * dpiScale;

  // DLIC dimensions (within margin)
  const dlicWidth = (canvasWidth - 2 * margin) * dpiScale;
  const dlicHeight = (canvasHeight - 2 * margin) * dpiScale;
  const dlicOffset = margin * dpiScale;

  // Velocity grid dimensions
  const velocityWidth = Math.max(1, Math.round(dlicWidth * velocityScale));
  const velocityHeight = Math.max(1, Math.round(dlicHeight * velocityScale));

  // Animation state
  type AnimationState = {
    frameIndex: number;
  };

  // Canvas and context
  let canvas: HTMLCanvasElement | null = $state(null);
  let ctx: CanvasRenderingContext2D | null = $state(null);

  // Timeline
  let timeline: Timeline<AnimationState> | null = $state(null);
  let isInitialized = $state(false);

  // WebGPU
  let webgpuContext: WebGPUContext | null = $state(null);
  let webgpuAvailable = $state(true);

  // Loading state
  let isPrecomputingVelocity = $state(false);
  let isPrecomputingDLIC = $state(false);
  let velocityProgress = $state(0);
  let dlicProgress = $state(0);
  let errorMessage: string | null = $state(null);

  // Cached frames
  let cachedFrames: ImageData[] = $state([]);

  // Visibility
  let figureIsActive: Writable<boolean> | undefined = $state(undefined);
  const { handleVisibilityChange } = useVisibilityHandler(() => timeline);

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  function parseHexColor(hex: string): [number, number, number] {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (result) {
      return [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)];
    }
    return [59, 130, 246];
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

  // ----------------------------------------------------------------
  // Setup - Precompute velocity buffer
  // ----------------------------------------------------------------

  async function precomputeVelocityBuffer(): Promise<Float32Array> {
    console.log(`[FlowModelLIC] Precomputing velocity buffer for ${numTimeSteps} time steps...`);
    isPrecomputingVelocity = true;
    velocityProgress = 0;

    // Expand domain to cover padding
    const padFracX = (dlicPadding * dpiScale) / dlicWidth;
    const padFracY = (dlicPadding * dpiScale) / dlicHeight;
    const domainWidth = domain.xMax - domain.xMin;
    const domainHeight = domain.yMax - domain.yMin;
    const paddedDomain = {
      xMin: domain.xMin - padFracX * domainWidth,
      xMax: domain.xMax + padFracX * domainWidth,
      yMin: domain.yMin - padFracY * domainHeight,
      yMax: domain.yMax + padFracY * domainHeight,
    };

    // Padded velocity dimensions
    const paddedVelWidth = Math.max(1, Math.round((dlicWidth + 2 * dlicPadding * dpiScale) * velocityScale));
    const paddedVelHeight = Math.max(1, Math.round((dlicHeight + 2 * dlicPadding * dpiScale) * velocityScale));

    // Allocate buffer: [numTimeSlices, height, width, 2]
    const buffer = new Float32Array(numTimeSteps * paddedVelHeight * paddedVelWidth * 2);

    // Batch requests for better performance
    const batchSize = 10;
    for (let batchStart = 0; batchStart < numTimeSteps; batchStart += batchSize) {
      const batchEnd = Math.min(batchStart + batchSize, numTimeSteps);
      const promises: Promise<{ t: number; result: VectorFieldResult }>[] = [];

      for (let t = batchStart; t < batchEnd; t++) {
        const timeValue = t / (numTimeSteps - 1); // t in [0, 1]
        promises.push(
          flowModelClient.vectorFieldGrid(paddedVelWidth, paddedDomain, timeValue)
            .promise.then(result => ({ t, result }))
        );
      }

      const results = await Promise.all(promises);

      for (const { t, result } of results) {
        const sliceOffset = t * paddedVelHeight * paddedVelWidth * 2;
        // The velocities come back as array of [vx, vy] pairs
        // We need to flatten them into the buffer in row-major order
        for (let i = 0; i < result.velocities.length; i++) {
          buffer[sliceOffset + i * 2] = result.velocities[i][0];
          buffer[sliceOffset + i * 2 + 1] = result.velocities[i][1];
        }
      }

      velocityProgress = batchEnd / numTimeSteps;
      console.log(`[FlowModelLIC] Velocity buffer: ${batchEnd}/${numTimeSteps} time steps`);
    }

    isPrecomputingVelocity = false;
    console.log(`[FlowModelLIC] Velocity buffer complete: ${buffer.length * 4 / (1024 * 1024)} MB`);
    return buffer;
  }

  // ----------------------------------------------------------------
  // Setup - Main initialization
  // ----------------------------------------------------------------

  async function runInitialComputation() {
    console.log("[FlowModelLIC] Starting initialization...");

    // Check WebGPU
    webgpuAvailable = await isWebGPUAvailable();
    if (!webgpuAvailable) {
      errorMessage = "WebGPU not available in this browser";
      console.warn("[FlowModelLIC] WebGPU not available");
      return;
    }

    try {
      webgpuContext = await initWebGPUContext();
      console.log("[FlowModelLIC] WebGPU context initialized");
    } catch (err) {
      errorMessage = `WebGPU init failed: ${err}`;
      webgpuAvailable = false;
      return;
    }

    // Step 1: Precompute velocity buffer from flow model
    let velocityBuffer: Float32Array;
    try {
      velocityBuffer = await precomputeVelocityBuffer();
    } catch (err) {
      errorMessage = `Failed to compute velocity field: ${err}`;
      console.error("[FlowModelLIC] Velocity computation failed:", err);
      return;
    }

    // Step 2: Compute DLIC frames
    isPrecomputingDLIC = true;
    dlicProgress = 0;
    cachedFrames = [];

    console.log(`[FlowModelLIC] Computing ${numTimeSteps} DLIC frames...`);

    try {
      let loadedFrameCount = 0;
      for await (const batchResults of computeDLIC(
        {
          vectorField: () => [0, 0], // Dummy, not used when buffer provided
          domain,
          width: dlicWidth,
          height: dlicHeight,
          phase: 0,
          frameCount: numTimeSteps,
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
          // New time-varying options
          timeVaryingVelocityBuffer: velocityBuffer,
          numTimeSlices: numTimeSteps,
        },
        webgpuContext
      )) {
        for (const result of batchResults) {
          cachedFrames.push(
            result.toColoredImageData({
              palette: () => parseHexColor(streamlineColor),
              backgroundColor,
            })
          );
          loadedFrameCount++;
        }
        dlicProgress = loadedFrameCount / numTimeSteps;
        console.log(`[FlowModelLIC] DLIC frames: ${loadedFrameCount}/${numTimeSteps}`);
      }
    } catch (err) {
      errorMessage = `Failed to compute DLIC: ${err}`;
      console.error("[FlowModelLIC] DLIC computation failed:", err);
      return;
    }

    isPrecomputingDLIC = false;
    console.log("[FlowModelLIC] DLIC computation complete");

    // Clean up WebGPU
    if (webgpuContext) {
      webgpuContext.destroy();
      webgpuContext = null;
    }
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  const frameClip: Clip<AnimationState> = {
    name: "frame",
    reduce: (t) => ({
      frameIndex: Math.min(Math.floor(t * numTimeSteps), numTimeSteps - 1),
    }),
  };

  function setupTimeline() {
    console.log("[FlowModelLIC] Setting up timeline...");

    const initialState: AnimationState = { frameIndex: 0 };

    timeline = new Timeline<AnimationState>();
    timeline.initialState = initialState;
    timeline.duration = animationDurationMs / 1000;
    timeline.looping = true;

    timeline.add(frameClip, { start: 0, end: 1 });

    timeline.onTick((_, state) => {
      draw(state);
    });

    console.log("[FlowModelLIC] Timeline setup complete");
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function draw(state: AnimationState) {
    if (!ctx) return;

    // Clear and fill background
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = `rgb(${backgroundColor.join(",")})`;
    ctx.fillRect(0, 0, physicalWidth, physicalHeight);

    if (cachedFrames.length > 0) {
      const frameIndex = Math.min(state.frameIndex, cachedFrames.length - 1);
      ctx.putImageData(cachedFrames[frameIndex], dlicOffset, dlicOffset);
    }

    ctx.restore();

    // Draw time indicator
    if (cachedFrames.length > 0) {
      const t = state.frameIndex / (numTimeSteps - 1);
      ctx.fillStyle = "#333";
      ctx.font = "14px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(`t = ${t.toFixed(2)}`, 10, 20);
    }
  }

  function drawLoading() {
    if (!ctx) return;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#f5f5f5";
    ctx.fillRect(0, 0, physicalWidth, physicalHeight);
    ctx.restore();

    ctx.fillStyle = "#333";
    ctx.font = "14px sans-serif";
    ctx.textAlign = "center";

    if (isPrecomputingVelocity) {
      ctx.fillText(
        `Computing velocity field: ${Math.round(velocityProgress * 100)}%`,
        canvasWidth / 2,
        canvasHeight / 2
      );
    } else if (isPrecomputingDLIC) {
      ctx.fillText(
        `Computing DLIC frames: ${Math.round(dlicProgress * 100)}%`,
        canvasWidth / 2,
        canvasHeight / 2
      );
    } else if (errorMessage) {
      ctx.fillStyle = "#c00";
      ctx.fillText(errorMessage, canvasWidth / 2, canvasHeight / 2);
    }
  }

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  onDestroy(() => {
    if (timeline) {
      timeline.dispose();
    }
    if (webgpuContext) {
      webgpuContext.destroy();
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
    if (ctx && !isInitialized && flowModelClient) {
      runInitialComputation().then(() => {
        if (!errorMessage) {
          setupTimeline();
          isInitialized = true;

          if (playingByDefault && timeline) {
            draw(timeline.initialState);
            timeline.play();
          }
        }
      });
    }
  });

  $effect(() => {
    if (ctx && (isPrecomputingVelocity || isPrecomputingDLIC || errorMessage)) {
      drawLoading();
    }
  });

  $effect(() => {
    if (figureIsActive !== undefined && isInitialized) {
      handleVisibilityChange($figureIsActive);
    }
  });
</script>

<Figure bind:isActive={figureIsActive} backgroundVisible={false}>
  {#snippet content()}
    <div class="canvas-container">
      <canvas
        bind:this={canvas}
        width={physicalWidth}
        height={physicalHeight}
        style="width: {canvasWidth}px; height: {canvasHeight}px;"
      ></canvas>
    </div>
  {/snippet}

  {#snippet footer()}
    <TimeSlider {timeline} showTicks={false} showTimeLabel={false} />
  {/snippet}

  {#snippet caption()}
    <strong>Flow Matching Vector Field Evolution.</strong>
    Dynamic Line Integral Convolution visualization of a trained flow matching model
    on the smiley face distribution. The animation shows how the learned velocity field
    evolves from t=0 (noise) to t=1 (data).
  {/snippet}
</Figure>

<style>
  .canvas-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
  }
</style>
