<!--
  Divergence Theorem Square Grid Visualization

  Shows a grid of pulsing squares with a larger outer square,
  demonstrating how interior flux contributions cancel at shared edges,
  leaving only the flux through the outer boundary.

  Uses GPU-accelerated WebGPU rendering with arrowheads on pulses.
-->

<script lang="ts">
  import { onDestroy } from "svelte";
  import type { Writable } from "svelte/store";
  import {
    Figure,
    Katex,
    PulsingPathsRenderer,
  } from "@diffusion-explorer/ui";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  interface Props {
    // Layout
    width?: number;
    height?: number;

    // Grid configuration
    gridResolution?: number;
    squareWidth?: number;
    gap?: number;

    // Animation
    clockwise?: boolean;
    animationDuration?: number;
    pulseFrequency?: number;

    // Pulse styling - inner squares
    pulseWidth?: number;
    pulsePauseWidth?: number;
    pulseColor?: string;
    strokeWidth?: number;
    baseOpacity?: number;

    // Outer square styling
    outerPadding?: number;
    outerStrokeWidth?: number;
    outerColor?: string;

    // Display options
    showArrowhead?: boolean;
    arrowheadSize?: number;

    playingByDefault?: boolean;
  }

  let {
    // Layout
    width = 400,
    height = 400,

    // Grid configuration
    gridResolution = 4,
    squareWidth = 55,
    gap = 20,

    // Animation
    clockwise = true,
    animationDuration = 4000,
    pulseFrequency = 0.5,

    // Pulse styling - inner squares
    pulseWidth = 35,
    pulsePauseWidth = 15,
    pulseColor = "#3b82f6",
    strokeWidth = 4,
    baseOpacity = 0.8,

    // Outer square styling
    outerPadding = 10,
    outerStrokeWidth = 4,
    outerColor = "#f97316",

    // Display options
    showArrowhead = true,
    arrowheadSize = 2.0,

    playingByDefault = true,
  }: Props = $props();

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  let canvas: HTMLCanvasElement | null = $state(null);
  let isInitialized = $state(false);
  let figureIsActive: Writable<boolean> | undefined = $state(undefined);

  // WebGPU renderers
  let innerRenderer: PulsingPathsRenderer | null = $state(null);
  let outerRenderer: PulsingPathsRenderer | null = $state(null);
  let sharedDevice: GPUDevice | null = $state(null);

  // Animation state
  let isPlaying = $state(false);
  let wasPlayingBeforeHidden = $state(false);
  let animationFrameId: number | null = $state(null);
  let startTime: number | null = $state(null);

  // WebGPU availability
  let webgpuAvailable = $state(false);
  let initError: string | null = $state(null);

  // Grid layout computed values
  let gridPositions: { x: number; y: number }[] = $state([]);
  let gridTotalWidth: number = $state(0);
  let gridTotalHeight: number = $state(0);

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  /**
   * Generate a square perimeter path as an array of [x, y] points.
   * Points are ordered for traversal in the specified direction.
   */
  function generateSquarePath(
    centerX: number,
    centerY: number,
    size: number,
    cw: boolean
  ): number[][] {
    const hw = size / 2;
    if (cw) {
      return [
        [centerX - hw, centerY - hw], // TL
        [centerX + hw, centerY - hw], // TR
        [centerX + hw, centerY + hw], // BR
        [centerX - hw, centerY + hw], // BL
        [centerX - hw, centerY - hw], // Close
      ];
    } else {
      return [
        [centerX - hw, centerY - hw], // TL
        [centerX - hw, centerY + hw], // BL
        [centerX + hw, centerY + hw], // BR
        [centerX + hw, centerY - hw], // TR
        [centerX - hw, centerY - hw], // Close
      ];
    }
  }

  /**
   * Calculate center positions for all squares in the grid.
   * Grid is centered in the canvas.
   */
  function computeGridPositions(
    resolution: number,
    squareW: number,
    gapSize: number,
    canvasWidth: number,
    canvasHeight: number
  ): {
    positions: { x: number; y: number }[];
    totalWidth: number;
    totalHeight: number;
  } {
    const totalWidth = resolution * squareW + (resolution - 1) * gapSize;
    const totalHeight = resolution * squareW + (resolution - 1) * gapSize;

    const startX = (canvasWidth - totalWidth) / 2 + squareW / 2;
    const startY = (canvasHeight - totalHeight) / 2 + squareW / 2;

    const positions: { x: number; y: number }[] = [];
    for (let row = 0; row < resolution; row++) {
      for (let col = 0; col < resolution; col++) {
        positions.push({
          x: startX + col * (squareW + gapSize),
          y: startY + row * (squareW + gapSize),
        });
      }
    }

    return { positions, totalWidth, totalHeight };
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  async function initializeRenderers() {
    if (!canvas) return;

    // Check WebGPU availability
    if (!navigator.gpu) {
      initError = "WebGPU is not supported in this browser";
      return;
    }

    try {
      const dpr = window.devicePixelRatio || 1;

      // Set canvas size (physical pixels)
      canvas.width = width * dpr;
      canvas.height = height * dpr;

      // Create shared WebGPU device
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        throw new Error("Failed to get WebGPU adapter");
      }
      sharedDevice = await adapter.requestDevice();

      const gpuContext = {
        adapter,
        device: sharedDevice,
        destroy: () => sharedDevice?.destroy(),
      };

      // Compute grid positions (in CSS pixels)
      const result = computeGridPositions(
        gridResolution,
        squareWidth,
        gap,
        width,
        height
      );
      gridPositions = result.positions;
      gridTotalWidth = result.totalWidth;
      gridTotalHeight = result.totalHeight;

      // Generate inner square paths (in CSS pixels)
      const innerPaths: number[][][] = gridPositions.map((pos) =>
        generateSquarePath(pos.x, pos.y, squareWidth, clockwise)
      );

      // Generate outer square path
      const outerWidth = gridTotalWidth + outerPadding * 2;
      const outerPath = generateSquarePath(
        width / 2,
        height / 2,
        outerWidth,
        clockwise
      );

      // Create inner squares renderer
      innerRenderer = await PulsingPathsRenderer.create(
        canvas,
        {
          dpr,
          thickness: strokeWidth,
          pulseWidth,
          pulseGap: pulsePauseWidth,
          color: pulseColor,
          baseOpacity,
          showArrowhead,
          arrowheadSize,
          showPreview: true,
          previewOpacity: 0.15,
        },
        gpuContext
      );
      innerRenderer.setPaths(innerPaths, "synchronized");

      // Create outer square renderer (shares same device and canvas)
      outerRenderer = await PulsingPathsRenderer.create(
        canvas,
        {
          dpr,
          thickness: outerStrokeWidth,
          pulseWidth: pulseWidth * 1.5,
          pulseGap: pulsePauseWidth * 1.5,
          color: outerColor,
          baseOpacity,
          showArrowhead,
          arrowheadSize: arrowheadSize * 1.2,
          showPreview: true,
          previewOpacity: 0.15,
        },
        gpuContext
      );
      outerRenderer.setPaths([outerPath], "synchronized");

      webgpuAvailable = true;
      isInitialized = true;

      // Initial draw
      draw(0);

      if (playingByDefault) {
        startAnimation();
      }
    } catch (e) {
      initError = e instanceof Error ? e.message : "Failed to initialize WebGPU";
      console.error("WebGPU initialization error:", e);
    }
  }

  // ----------------------------------------------------------------
  // Animation
  // ----------------------------------------------------------------

  /**
   * Main draw function - depends on animation phase.
   */
  function draw(phase: number): void {
    if (!innerRenderer || !outerRenderer) return;

    // Clear with transparent background and render inner squares
    innerRenderer.render({ phase }, [0, 0, 0, 0]);

    // Render outer square on top (no clear)
    outerRenderer.render({ phase });
  }

  function animate(timestamp: number) {
    if (!isPlaying) return;

    if (startTime === null) {
      startTime = timestamp;
    }

    const elapsed = (timestamp - startTime) / 1000; // seconds
    const durationSec = animationDuration / 1000;
    const phase = ((elapsed * pulseFrequency) / durationSec) % 1;

    draw(phase);

    animationFrameId = requestAnimationFrame(animate);
  }

  function startAnimation() {
    if (isPlaying || !isInitialized) return;
    isPlaying = true;
    startTime = null;
    animationFrameId = requestAnimationFrame(animate);
  }

  function stopAnimation() {
    if (!isPlaying) return;
    isPlaying = false;
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  }

  // ----------------------------------------------------------------
  // Event Handlers
  // ----------------------------------------------------------------

  function handleVisibilityChange(active: boolean) {
    if (!isInitialized) return;
    if (!active && isPlaying) {
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
    stopAnimation();
    if (innerRenderer) innerRenderer.destroy();
    if (outerRenderer) outerRenderer.destroy();
  });

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  $effect(() => {
    if (!isInitialized && canvas) {
      initializeRenderers();
    }
  });

  $effect(() => {
    if (figureIsActive !== undefined && isInitialized) {
      handleVisibilityChange($figureIsActive);
    }
  });
</script>

<div class="divergence-square-wrapper">
  <div class="divergence-square-equation">
    <Katex
      math={"\\oint_{\\partial V} \\mathbf{F} \\cdot \\mathbf{n} \\, dS = \\int_V (\\nabla \\cdot \\mathbf{F}) \\, dV"}
      displayMode={true}
    />
  </div>

  {#if initError}
    <div class="error-message">
      <p>WebGPU Error: {initError}</p>
      <p class="error-hint">
        WebGPU requires a modern browser with GPU support enabled.
      </p>
    </div>
  {:else}
    <Figure bind:isActive={figureIsActive} backgroundVisible={false}>
      <canvas
        bind:this={canvas}
        style="width: {width}px; height: {height}px;"
      ></canvas>
    </Figure>
  {/if}
</div>

<style>
  .divergence-square-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .divergence-square-equation {
    text-align: center;
    margin-bottom: 1rem;
    color: #4b5563;
    font-size: 1.3rem;
  }

  .error-message {
    padding: 20px;
    text-align: center;
    color: #e63946;
  }

  .error-hint {
    font-size: 0.9em;
    color: #666;
  }
</style>
