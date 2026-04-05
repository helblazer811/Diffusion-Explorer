<!-- Volume integral visualization with animated grid subdivision inside the closed curve. -->

<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import {
    useCanvas2D,
    Timeline,
    drawMathjax,
    StreamlineRenderer,
    generateStreamlines,
    type VectorFieldFn,
  } from "@diffusion-explorer/ui";
  import { drawClosedCurve, type CurveFn } from "./divergence_theorem";
  import {
    CreateGridAnimation,
    SubdivideGridAnimation,
    type CreateGridAnimationState,
    type SubdivideGridAnimationState,
    sampleSurfacePoints,
    computeBoundingBox,
    isPointInside,
    type SurfaceSamples,
  } from "./grid-animation";
  import {
    DivergenceArrowAnimation,
    type DivergenceArrowAnimationState,
  } from "./divergence-arrow-animation";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  // Curve and field functions from parent
  export let curveFn: CurveFn;
  export let vectorFieldFn: (x: number, y: number) => [number, number];

  // Layout
  export let width = 400;
  export let height = 350;

  // Grid parameters
  export let gridResolution = 1;

  // Surface styling
  export let surfaceOpacity = 0.97;
  export let surfaceFillColor = "#e0e0e0";
  export let surfaceStrokeColor = "#999";
  export let surfaceStrokeWidth = 2;

  // Label (drawn on canvas with rounded rectangle background)
  export let showLabel = true;
  export let labelText = "V";
  export let volumeLabelFontSize = 28;
  export let volumeLabelColor = "#f97316";
  export let volumeLabelStrokeColor = "white";
  export let volumeLabelStrokeWidth = 5;
  export let volumeLabelYOffset = -0.6; // Fraction of bounding box height from center (negative = above)

  // Grid styling
  export let gridColor = "#f97316";  // Orange
  export let gridWidth = 2;

  // Arrow styling
  export let arrowColor = "#f97316";  // Orange
  export let arrowPadding = 0.3;  // Fraction of cell to leave as padding

  // Divergence label annotation
  export let showDivergenceLabel = true;
  export let divergenceLabelText = "\\nabla \\cdot \\mathbf{F}";
  export let divergenceLabelFontSize = 18;
  export let divergenceLabelColor = "#f97316";
  export let annotationLineWidth = 1.5;

  // Streamline styling
  export let streamlineColor = "#3b82f6";
  export let streamlineWidth = 2.5;
  export let streamlineOpacity = 0.8;
  export let showStreamlines = true;
  export let gradientSubdivisions = 12;
  export let minPathLength = 1.5;
  export let segmentLength = 0.01;

  // Animation pulse settings (in pixels)
  export let pulseWidthPixels = 40;
  export let pulsePauseWidthPixels = 15;

  // Arrowhead settings
  export let showArrowhead = true;
  export let arrowheadSize = 2.0;

  // Animation timing
  export let animationDuration = 16;
  export let playingByDefault = true;

  // Visibility
  export let isActive;

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  // GPU canvas for streamlines (behind)
  let gpuCanvas: HTMLCanvasElement | null = null;
  let streamlineRenderer: StreamlineRenderer | null = null;

  // 2D canvas for overlays (on top)
  let canvas: HTMLCanvasElement | null = null;
  const canvas2d = useCanvas2D(width, height);
  $: ctx = canvas && canvas2d.ctx;

  let isInitialized = false;
  let wasPlayingBeforeHidden = false;

  // Combined animation state - streamlinePhase drives the GPU renderer
  type AnimationState = { streamlinePhase: number } & CreateGridAnimationState & SubdivideGridAnimationState & DivergenceArrowAnimationState;

  let timeline: Timeline<AnimationState> | null = null;
  let createGridAnim: CreateGridAnimation<AnimationState> | null = null;
  let subdivideGridAnim: SubdivideGridAnimation<AnimationState> | null = null;
  let arrowAnim: DivergenceArrowAnimation<AnimationState> | null = null;

  // Pre-computed data (only boundingBox needed for label positioning)
  let boundingBox: { xMin: number; xMax: number; yMin: number; yMax: number } | null = null;

  // Target cell for divergence annotation (top-left cell with arrows)
  let annotationTargetCell: { center: [number, number]; cellWidth: number; cellHeight: number } | null = null;

  // Domain margin (matches SurfaceIntegral)
  export let domainMargin = 0.3;

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  function toPixel(p: [number, number]): [number, number] {
    if (!boundingBox) return [0, 0];
    const xMin = boundingBox.xMin - domainMargin;
    const xMax = boundingBox.xMax + domainMargin;
    const yMin = boundingBox.yMin - domainMargin;
    const yMax = boundingBox.yMax + domainMargin;

    return [
      ((p[0] - xMin) / (xMax - xMin)) * width,
      ((yMax - p[1]) / (yMax - yMin)) * height
    ];
  }

  function scaleLength(domainLen: number): number {
    if (!boundingBox) return 0;
    const domainWidth = (boundingBox.xMax - boundingBox.xMin) + 2 * domainMargin;
    return (domainLen / domainWidth) * width;
  }

  /**
   * Find a valid (non-boundary) cell in the top-left region for annotation.
   * Returns cell center and dimensions, or null if none found.
   */
  function findTopLeftValidCell(
    surfaceSamples: SurfaceSamples,
    bb: { xMin: number; xMax: number; yMin: number; yMax: number },
    resolution: number
  ): { center: [number, number]; cellWidth: number; cellHeight: number } | null {
    const maxDim = Math.max(bb.xMax - bb.xMin, bb.yMax - bb.yMin);
    const step = maxDim / resolution;

    // Iterate from top-left (high y, low x) to find first valid cell
    for (let row = resolution - 1; row >= 0; row--) {
      for (let col = 0; col < resolution; col++) {
        const cellXMin = bb.xMin + col * step;
        const cellXMax = bb.xMin + (col + 1) * step;
        const cellYMin = bb.yMin + row * step;
        const cellYMax = bb.yMin + (row + 1) * step;
        const center: [number, number] = [
          (cellXMin + cellXMax) / 2,
          (cellYMin + cellYMax) / 2,
        ];

        // Check if center is inside
        if (!isPointInside(center, surfaceSamples)) continue;

        // Check if all corners are inside (non-boundary cell)
        const corners: [number, number][] = [
          [cellXMin, cellYMin],
          [cellXMax, cellYMin],
          [cellXMin, cellYMax],
          [cellXMax, cellYMax],
        ];
        const allCornersInside = corners.every((corner) =>
          isPointInside(corner, surfaceSamples)
        );

        if (allCornersInside) {
          return { center, cellWidth: step, cellHeight: step };
        }
      }
    }
    return null;
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function draw(state: AnimationState): void {
    if (!ctx || !isInitialized) return;

    // 1. Draw GPU streamlines (on separate canvas)
    if (showStreamlines && streamlineRenderer) {
      streamlineRenderer.render({ phase: state.streamlinePhase }, [0, 0, 0, 0]);
    }

    // Clear 2D overlay canvas
    ctx.clearRect(0, 0, width, height);

    // 2. Draw surface fill (behind grid and arrows)
    drawClosedCurve(ctx, curveFn, toPixel, {
      fillColor: surfaceFillColor,
      fillOpacity: surfaceOpacity,
      strokeColor: surfaceStrokeColor,
      strokeWidth: surfaceStrokeWidth
    });

    // 3. Draw animated grid lines (above surface fill)
    // CreateGridAnimation draws initial grid, SubdivideGridAnimation draws base + subdivision
    if (state.subdivideProgress > 0 && subdivideGridAnim) {
      // Once subdivision starts, it handles drawing both base and new lines
      subdivideGridAnim.draw(state);
    } else if (createGridAnim) {
      // Before subdivision, draw the initial grid creation
      createGridAnim.draw(state);
    }

    // 4. Draw animated arrows (above surface fill)
    if (arrowAnim) {
      arrowAnim.draw(state);
    }

    // 5. Draw volume label (V)
    if (showLabel && boundingBox) {
      const centerX = (boundingBox.xMin + boundingBox.xMax) / 2;
      const centerY = (boundingBox.yMin + boundingBox.yMax) / 2;
      const bbHeight = boundingBox.yMax - boundingBox.yMin;
      const labelY = centerY - volumeLabelYOffset * bbHeight;
      const [cx, cy] = toPixel([centerX, labelY]);
      const labelHeight = volumeLabelFontSize;

      drawMathjax(ctx, labelText, cx, cy + labelHeight / 2, volumeLabelFontSize, 0, 0, { color: volumeLabelColor, stroke: volumeLabelStrokeColor, strokeWidth: volumeLabelStrokeWidth });
    }

    // 6. Draw divergence label annotation (line from top-right to a cell)
    if (showDivergenceLabel && annotationTargetCell && state.arrowProgress > 0) {
      const [cellPx, cellPy] = toPixel(annotationTargetCell.center);

      // Label position (top-right area, but lower and more to the left)
      const labelX = width - 70;
      const labelY = 45;

      // Line starts from center-bottom of the label
      const lineStartX = labelX;
      const lineStartY = labelY + 8;

      // Draw the annotation line
      ctx.strokeStyle = divergenceLabelColor;
      ctx.lineWidth = annotationLineWidth;
      ctx.beginPath();
      ctx.moveTo(lineStartX, lineStartY);
      ctx.lineTo(cellPx, cellPy);
      ctx.stroke();

      // Draw the label centered at labelX, labelY
      drawMathjax(
        ctx,
        divergenceLabelText,
        labelX,
        labelY,
        divergenceLabelFontSize,
        0,
        0,
        { color: divergenceLabelColor }
      );
    }
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  async function initializeGPURenderer() {
    if (!gpuCanvas || !boundingBox) return;

    // Check WebGPU availability
    if (!(navigator as any).gpu) {
      console.warn("WebGPU not supported, streamlines will not render");
      return;
    }

    try {
      const dpr = window.devicePixelRatio || 1;

      // Set canvas size (physical pixels)
      gpuCanvas.width = width * dpr;
      gpuCanvas.height = height * dpr;

      // Create renderer
      streamlineRenderer = await StreamlineRenderer.create(gpuCanvas, {
        dpr,
        thickness: streamlineWidth,
        pulseWidth: pulseWidthPixels,
        pulseGap: pulsePauseWidthPixels,
        baseOpacity: streamlineOpacity,
        color: streamlineColor,
        showArrowhead,
        arrowheadSize,
      });

      // Generate streamlines in domain coordinates
      const domainMin: [number, number] = [boundingBox.xMin - domainMargin, boundingBox.yMin - domainMargin];
      const domainMax: [number, number] = [boundingBox.xMax + domainMargin, boundingBox.yMax + domainMargin];

      const rawStreamlines = generateStreamlines(vectorFieldFn as VectorFieldFn, {
        domainMin,
        domainMax,
        density: 0.5,
        integrationDirection: 'both',
        minlength: 1.0, // Filter out short streamlines
        maxlength: 100,
      });

      // Convert to pixel coordinates
      const pixelStreamlines = rawStreamlines.map((streamline) =>
        streamline.map((point) => toPixel(point as [number, number]))
      );

      // Upload to GPU with synchronized offsets
      streamlineRenderer.setStreamlines(pixelStreamlines, 'synchronized');
    } catch (e) {
      console.error("Failed to initialize StreamlineRenderer:", e);
    }
  }

  function runInitialComputation() {
    if (!canvas) return;

    // Compute bounding box (needed for label positioning and streamlines)
    const surfaceSamples = sampleSurfacePoints(curveFn);
    boundingBox = computeBoundingBox(surfaceSamples.points);

    // Find a top-left cell for the divergence annotation (at final resolution 2N)
    annotationTargetCell = findTopLeftValidCell(surfaceSamples, boundingBox, gridResolution * 2);

    // Create initial grid animation (resolution N)
    createGridAnim = CreateGridAnimation.create<AnimationState>({
      curveFn,
      gridResolution,
      toPixel,
      color: gridColor,
      strokeWidth: gridWidth,
    });

    // Create subdivision animation (N → 2N)
    subdivideGridAnim = SubdivideGridAnimation.create<AnimationState>({
      curveFn,
      baseResolution: gridResolution,
      toPixel,
      color: gridColor,
      strokeWidth: gridWidth,
    });

    // Create arrow animation (at final resolution 2N)
    arrowAnim = DivergenceArrowAnimation.create<AnimationState>({
      curveFn,
      gridResolution: gridResolution * 2, // Final resolution after subdivision
      toPixel,
      scaleLength,
      color: arrowColor,
      padding: arrowPadding,
      initialLengthFraction: 0.5, // Start arrows at 50% of max length
      repetitions: 3, // Repeat expansion animation 3 times
    });
  }

  async function setupTimeline() {
    if (!createGridAnim || !subdivideGridAnim || !arrowAnim || !canvas) return;

    // Initialize all animations with the canvas
    await Promise.all([
      createGridAnim.init(canvas),
      subdivideGridAnim.init(canvas),
      arrowAnim.init(canvas),
    ]);

    timeline = new Timeline<AnimationState>();
    timeline.initialState = {
      streamlinePhase: 0,
      createGridProgress: 0,
      subdivideProgress: 0,
      arrowProgress: 0
    };
    timeline.duration = animationDuration;
    timeline.looping = true;
    timeline.endPauseDuration = 2; // 2 second pause at end before looping

    // Streamlines: full duration [0, 1] - drives GPU renderer phase
    timeline.add(
      {
        name: "StreamlinePhase",
        reduce(t: number) {
          return { streamlinePhase: t };
        },
      },
      { start: 0, end: 1 }
    );

    // CreateGrid: [0, 0.12] (~2 seconds)
    timeline.add(createGridAnim.clip, { start: 0, end: 0.12 });

    // Subdivide: [0.12, 0.22] (~1.5 seconds)
    timeline.add(subdivideGridAnim.clip, { start: 0.12, end: 0.22 });

    // Arrows: [0.22, 1.0] (~12.5 seconds, ~4 seconds per repetition)
    timeline.add(arrowAnim.clip, { start: 0.22, end: 1 });

    timeline.onTick((_t, state) => {
      draw(state);
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
    // GPU renderer needs to be initialized after canvas is available
    if (gpuCanvas && boundingBox) {
      initializeGPURenderer();
    }
  });

  onDestroy(() => {
    if (timeline) timeline.pause();
    if (streamlineRenderer) streamlineRenderer.destroy();
  });

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  // Initialize when canvases are ready
  $: if (!isInitialized && canvas && gpuCanvas && curveFn && vectorFieldFn) {
    runInitialComputation();
    Promise.all([setupTimeline(), initializeGPURenderer()]).then(() => {
      isInitialized = true;
      draw(timeline!.initialState);
      if (playingByDefault) startAnimation();
    });
  }

  // Handle visibility changes
  $: if (isActive !== undefined && isInitialized) {
    handleVisibilityChange($isActive);
  }
</script>

<div class="volume-integral-wrapper">
  <div class="volume-integral-container" style="width: {width}px; height: {height}px;">
    <!-- GPU canvas for streamlines (behind) -->
    <canvas
      bind:this={gpuCanvas}
      class="gpu-canvas"
      style="width: {width}px; height: {height}px;"
    ></canvas>
    <!-- 2D canvas for overlays (on top) -->
    <canvas
      bind:this={canvas}
      use:canvas2d.bindCanvas
      class="overlay-canvas"
      style="width: {width}px; height: {height}px;"
    ></canvas>
  </div>
</div>

<style>
  .volume-integral-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
  }

  .volume-integral-container {
    position: relative;
  }

  .gpu-canvas {
    position: absolute;
    top: 0;
    left: 0;
  }

  .overlay-canvas {
    position: relative;
    z-index: 1;
  }
</style>
