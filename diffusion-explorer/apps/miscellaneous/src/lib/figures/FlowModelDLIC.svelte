<!--
  Flow Model DLIC Visualization

  Displays a trained flow model using Dynamic Line Integral Convolution (left)
  and animated trajectories (right), fully synchronized with a shared time slider.
-->

<script lang="ts">
  import { onDestroy } from "svelte";
  import type { Writable } from "svelte/store";
  import {
    DoubleFigure,
    Timeline,
    TimeSlider,
    useVisibilityHandler,
    initWebGPUContext,
    computeDLIC,
    isWebGPUAvailable,
    exportAnimation,
    downloadBlob,
    drawScatterPlot,
    drawTrajectories,
    type Clip,
    type WebGPUContext,
    type DLICResult,
    type TrajectoryStyleOptions,
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
    animationDurationMs = 10000,
    playingByDefault = true,

    // DLIC Parameters
    dlicIntegrationSteps = 256,
    dlicStepSize = 2.0,
    dlicContrast = 5.0,
    dlicNoiseScale = 4,
    dlicMaxArcLength = 80.0,
    dlicVelocityScale = 0.1,
    dlicPadding = 150,
    dlicWavelength = 160,

    // Rendering
    dpiScale = 3,
    seed = 12345,
    backgroundColor = [255, 255, 255] as [number, number, number],

    // Colors
    dlicColor = "#3b82f6",
    trajectoryColor = "#f97316",
    targetColor = "#3b82f6",
  } = $props();

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  // Animation state
  type AnimationState = {
    time: number;
    dlicFrameIndex: number;
    segmentIndex: number;
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

  // WebGPU context for DLIC
  let webgpuContext: WebGPUContext | null = $state(null);
  let webgpuAvailable = $state(true);
  let dlicError: string | null = $state(null);

  // DLIC frame caching
  let cachedDLICFrames: ImageData[] = $state([]);
  let isPrecomputing = $state(false);
  let precomputeProgress = $state(0);

  // Pre-computed data
  let velocityGrids: Float32Array | null = $state(null);
  let gridMetadata: {
    numTimesteps: number;
    gridSize: number;
    domain: { xMin: number; xMax: number; yMin: number; yMax: number };
  } | null = $state(null);

  let trajectories: number[][][] | null = $state(null);
  let scaledTrajectories: number[][][] | null = $state(null);
  let targetDistribution: number[][] | null = $state(null);
  let scaledTargetDistribution: number[][] | null = $state(null);

  // Number of frames and steps
  const frameCount = 100;
  const numSteps = 100;

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
    return [59, 130, 246];
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

  // Transform domain coordinates to pixel coordinates
  function toPixel(point: number[], domain: { xMin: number; xMax: number; yMin: number; yMax: number }): number[] {
    const gridWidth = canvasWidth - 2 * margin;
    const gridHeight = canvasHeight - 2 * margin;
    return [
      margin + ((point[0] - domain.xMin) / (domain.xMax - domain.xMin)) * gridWidth,
      margin + ((point[1] - domain.yMin) / (domain.yMax - domain.yMin)) * gridHeight, // No flip - positive Y goes down
    ];
  }

  // Scale all trajectories to pixel coordinates
  function scaleTrajectories(
    trajs: number[][][],
    domain: { xMin: number; xMax: number; yMin: number; yMax: number }
  ): number[][][] {
    return trajs.map((traj) => traj.map((point) => toPixel(point, domain)));
  }

  // Scale all target distribution points to pixel coordinates
  function scaleTargetDistribution(
    points: number[][],
    domain: { xMin: number; xMax: number; yMin: number; yMax: number }
  ): number[][] {
    return points.map((point) => toPixel(point, domain));
  }

  // Bilinear interpolation for velocity grid lookup
  function bilinearInterpolate(
    grids: Float32Array,
    timeIndex: number,
    x: number,
    y: number,
    meta: { numTimesteps: number; gridSize: number; domain: { xMin: number; xMax: number; yMin: number; yMax: number } }
  ): [number, number] {
    const { gridSize, domain } = meta;

    // Map x, y to grid coordinates (0 to gridSize-1)
    const gx = ((x - domain.xMin) / (domain.xMax - domain.xMin)) * gridSize - 0.5;
    const gy = ((y - domain.yMin) / (domain.yMax - domain.yMin)) * gridSize - 0.5;

    // Get integer and fractional parts
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const x1 = x0 + 1;
    const y1 = y0 + 1;
    const fx = gx - x0;
    const fy = gy - y0;

    // Clamp to grid bounds
    const cx0 = Math.max(0, Math.min(gridSize - 1, x0));
    const cy0 = Math.max(0, Math.min(gridSize - 1, y0));
    const cx1 = Math.max(0, Math.min(gridSize - 1, x1));
    const cy1 = Math.max(0, Math.min(gridSize - 1, y1));

    // Offset into buffer for this timestep
    const timeOffset = timeIndex * gridSize * gridSize * 2;

    // Get velocity values at four corners
    const v00x = grids[timeOffset + (cy0 * gridSize + cx0) * 2];
    const v00y = grids[timeOffset + (cy0 * gridSize + cx0) * 2 + 1];
    const v10x = grids[timeOffset + (cy0 * gridSize + cx1) * 2];
    const v10y = grids[timeOffset + (cy0 * gridSize + cx1) * 2 + 1];
    const v01x = grids[timeOffset + (cy1 * gridSize + cx0) * 2];
    const v01y = grids[timeOffset + (cy1 * gridSize + cx0) * 2 + 1];
    const v11x = grids[timeOffset + (cy1 * gridSize + cx1) * 2];
    const v11y = grids[timeOffset + (cy1 * gridSize + cx1) * 2 + 1];

    // Bilinear interpolation
    const vx = (1 - fx) * (1 - fy) * v00x + fx * (1 - fy) * v10x + (1 - fx) * fy * v01x + fx * fy * v11x;
    const vy = (1 - fx) * (1 - fy) * v00y + fx * (1 - fy) * v10y + (1 - fx) * fy * v01y + fx * fy * v11y;

    return [vx, vy];
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  async function runInitialComputation() {
    console.log("[FlowModelDLIC] Running initial computation...");

    // Load velocity grids
    try {
      console.log("[FlowModelDLIC] Loading velocity grids...");
      const [metaResponse, binResponse] = await Promise.all([
        fetch("/flow_model_dlic/velocity_grids_meta.json"),
        fetch("/flow_model_dlic/velocity_grids.bin"),
      ]);

      if (!metaResponse.ok || !binResponse.ok) {
        throw new Error("Failed to load velocity grid files. Run the preparation scripts first.");
      }

      gridMetadata = await metaResponse.json();
      const binData = await binResponse.arrayBuffer();
      velocityGrids = new Float32Array(binData);
      console.log(`[FlowModelDLIC] Loaded velocity grids: ${velocityGrids.length} floats`);
    } catch (err) {
      console.error("[FlowModelDLIC] Failed to load velocity grids:", err);
      dlicError = "Failed to load velocity grids";
      return;
    }

    // Load trajectories
    try {
      console.log("[FlowModelDLIC] Loading trajectories...");
      const trajResponse = await fetch("/flow_model_dlic/trajectories.json");
      if (!trajResponse.ok) {
        throw new Error("Failed to load trajectories. Run the preparation scripts first.");
      }

      const trajData = await trajResponse.json();
      // Transpose from [step][sample][dim] to [sample][step][dim]
      const rawTrajectories = trajData.trajectories as number[][][];
      const numStepsLoaded = rawTrajectories.length;
      const numSamples = rawTrajectories[0].length;

      trajectories = [];
      for (let s = 0; s < numSamples; s++) {
        const traj: number[][] = [];
        for (let t = 0; t < numStepsLoaded; t++) {
          traj.push(rawTrajectories[t][s]);
        }
        trajectories.push(traj);
      }

      targetDistribution = trajData.targetDistribution;
      console.log(`[FlowModelDLIC] Loaded ${trajectories.length} trajectories, ${targetDistribution?.length} target points`);

      // Scale to pixel coordinates
      if (gridMetadata) {
        scaledTrajectories = scaleTrajectories(trajectories, gridMetadata.domain);
        scaledTargetDistribution = scaleTargetDistribution(targetDistribution!, gridMetadata.domain);
      }
    } catch (err) {
      console.error("[FlowModelDLIC] Failed to load trajectories:", err);
      return;
    }

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

    // Pre-compute DLIC frames
    if (webgpuContext && velocityGrids && gridMetadata) {
      isPrecomputing = true;
      cachedDLICFrames = [];

      console.log(`[FlowModelDLIC] Pre-computing ${frameCount} DLIC frames...`);

      for (let frameIdx = 0; frameIdx < frameCount; frameIdx++) {
        const t = frameIdx / frameCount;
        const timeIndex = Math.min(Math.floor(t * gridMetadata.numTimesteps), gridMetadata.numTimesteps - 1);

        // Create time-varying vector field for this timestep
        const timeVaryingVectorField = (x: number, y: number): [number, number] => {
          return bilinearInterpolate(velocityGrids!, timeIndex, x, y, gridMetadata!);
        };

        // Compute DLIC for this frame
        for await (const results of computeDLIC(
          {
            vectorField: timeVaryingVectorField,
            domain: gridMetadata.domain,
            width: dlicWidth,
            height: dlicHeight,
            phase: t,
            wavelength: dlicWavelength * dpiScale,
            integrationSteps: dlicIntegrationSteps,
            stepSize: dlicStepSize,
            contrast: dlicContrast,
            noiseScale: dlicNoiseScale * dpiScale,
            nearestNeighborVelocity: true,
            maxArcLength: dlicMaxArcLength * dpiScale,
            useEuler: true,
            velocityScale: dlicVelocityScale,
            seed,
            padding: Math.ceil(dlicPadding * dpiScale),
          },
          webgpuContext
        )) {
          for (const result of results) {
            cachedDLICFrames.push(
              result.toColoredImageData({
                palette: () => parseHexColor(dlicColor),
                backgroundColor,
              })
            );
          }
        }

        precomputeProgress = (frameIdx + 1) / frameCount;
        if ((frameIdx + 1) % 10 === 0) {
          console.log(`[FlowModelDLIC] Frame ${frameIdx + 1}/${frameCount} computed`);
        }
      }

      isPrecomputing = false;
      console.log("[FlowModelDLIC] Pre-computation complete");

      // Cleanup WebGPU context
      webgpuContext.destroy();
      webgpuContext = null;
    }
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  const syncClip: Clip<AnimationState> = {
    name: "sync",
    reduce: (t) => ({
      time: t,
      dlicFrameIndex: Math.min(Math.floor(t * frameCount), frameCount - 1),
      segmentIndex: Math.min(Math.floor(t * numSteps), numSteps - 1),
    }),
  };

  function setupTimeline() {
    console.log("[FlowModelDLIC] Setting up timeline...");

    const initialState: AnimationState = {
      time: 0,
      dlicFrameIndex: 0,
      segmentIndex: 0,
    };

    timeline = new Timeline<AnimationState>();
    timeline.initialState = initialState;
    timeline.duration = animationDurationMs / 1000;
    timeline.looping = true;

    timeline.add(syncClip, { start: 0, end: 1 });

    timeline.onTick((_, state) => {
      draw(state);
    });

    console.log("[FlowModelDLIC] Timeline setup complete");
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  const trajectoryStyle: TrajectoryStyleOptions = {
    strokeWidth: 2,
    color: trajectoryColor,
    progressOpacity: 0.9,
    pointRadius: 4,
    showPreview: true,
    previewOpacity: 0.15,
  };

  function draw(state: AnimationState) {
    const { dlicFrameIndex, segmentIndex } = state;

    // --- Left Panel: DLIC ---
    if (ctxLeft && cachedDLICFrames.length > 0) {
      // Clear and fill background
      ctxLeft.save();
      ctxLeft.setTransform(1, 0, 0, 1, 0, 0);
      ctxLeft.fillStyle = "#ffffff";
      ctxLeft.fillRect(0, 0, physicalWidth, physicalHeight);

      // Clamp to available frames
      const frameIndex = Math.min(dlicFrameIndex, cachedDLICFrames.length - 1);
      ctxLeft.putImageData(cachedDLICFrames[frameIndex], dlicOffset, dlicOffset);
      ctxLeft.restore();
    } else if (ctxLeft && isPrecomputing) {
      ctxLeft.fillStyle = "#1a1a1a";
      ctxLeft.fillRect(0, 0, canvasWidth, canvasHeight);
      ctxLeft.fillStyle = "#ffffff";
      ctxLeft.font = "14px sans-serif";
      ctxLeft.textAlign = "center";
      ctxLeft.fillText(
        `Pre-computing DLIC frames... ${Math.round(precomputeProgress * 100)}%`,
        canvasWidth / 2,
        canvasHeight / 2
      );
    } else if (ctxLeft && dlicError) {
      ctxLeft.fillStyle = "#1a1a1a";
      ctxLeft.fillRect(0, 0, canvasWidth, canvasHeight);
      ctxLeft.fillStyle = "#ffffff";
      ctxLeft.font = "14px sans-serif";
      ctxLeft.textAlign = "center";
      ctxLeft.fillText(dlicError, canvasWidth / 2, canvasHeight / 2);
    }

    // --- Right Panel: Trajectories ---
    if (ctxRight) {
      ctxRight.clearRect(0, 0, canvasWidth, canvasHeight);

      // White background
      ctxRight.fillStyle = "#ffffff";
      ctxRight.fillRect(0, 0, canvasWidth, canvasHeight);

      // --- Static Background: Target distribution (blue points) ---
      if (scaledTargetDistribution) {
        drawScatterPlot(ctxRight, scaledTargetDistribution, 3, targetColor, 0.3);
      }

      // --- Dynamic Foreground: Animated trajectories ---
      if (scaledTrajectories) {
        drawTrajectories(ctxRight, scaledTrajectories, segmentIndex, trajectoryStyle);
      }
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
          format: "webm",
          bitrate: 8_000_000,
          onProgress: (p) => {
            exportProgress = p;
          },
        }
      ) as Blob[];

      downloadBlob(videos[0], "flow_model_dlic_left.webm");
      await new Promise((resolve) => setTimeout(resolve, 100));
      downloadBlob(videos[1], "flow_model_dlic_right.webm");
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
    if (figureIsActive !== undefined && isInitialized && $figureIsActive !== undefined) {
      handleVisibilityChange($figureIsActive);
    }
  });
</script>

<DoubleFigure {gap} bind:isActive={figureIsActive} backgroundVisible={false}>
  {#snippet left()}
    <div class="canvas-container">
      <h3 class="canvas-title">Dynamic Line Integral Convolution</h3>
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
      <h3 class="canvas-title">Flow Model Trajectories</h3>
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
      <TimeSlider timeline={timeline as any} showTicks={false} showTimeLabel={false} />
      <button
        class="export-button"
        onclick={handleExport}
        disabled={isExporting || !isInitialized}
      >
        {#if isExporting}
          Exporting... {Math.round(exportProgress * 100)}%
        {:else}
          Export WebM
        {/if}
      </button>
    </div>
  {/snippet}

  {#snippet caption()}
    <strong>Flow model trained on smiley face distribution.</strong>
    <em>Left:</em> Dynamic Line Integral Convolution visualizes the learned velocity field,
    showing how particles would flow from noise to the target distribution.
    <em>Right:</em> Blue points show the target smiley face distribution.
    Orange trajectories trace 20 sample paths from random noise (t=0) to the target (t=1).
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
    font-size: 1.25rem;
    font-weight: 600;
    color: #666;
    text-align: center;
    margin: 0 0 1rem 0;
    width: 100%;
    word-wrap: break-word;
    min-height: 2rem;
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
