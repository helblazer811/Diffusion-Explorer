<!-- Volume integral visualization with animated grid subdivision inside the closed curve. -->

<script lang="ts">
  import { onDestroy } from "svelte";
  import {
    useCanvas2D,
    Timeline,
    StreamlineAnimation,
    drawMathjax,
    type VectorFieldFn,
    type StreamlineAnimationState,
  } from "@diffusion-explorer/ui";
  import { drawClosedCurve, type CurveFn } from "./divergence_theorem";
  import {
    CreateGridAnimation,
    SubdivideGridAnimation,
    type CreateGridAnimationState,
    type SubdivideGridAnimationState,
    sampleSurfacePoints,
    computeBoundingBox,
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

  // Streamline styling
  export let streamlineColor = "#3b82f6";
  export let streamlineWidth = 2.5;
  export let streamlineOpacity = 0.8;
  export let showStreamlines = true;
  export let gradientSubdivisions = 12;
  export let minPathLength = 1.5;
  export let segmentLength = 0.01;

  // Animation pulse settings
  export let pulseWidth = 0.20;
  export let pulsePauseWidth = 0.05;

  // Animation timing
  export let animationDuration = 12;
  export let playingByDefault = true;

  // Visibility
  export let isActive;

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  let canvas: HTMLCanvasElement | null = null;
  const canvas2d = useCanvas2D(width, height);
  $: ctx = canvas && canvas2d.ctx;

  let isInitialized = false;
  let wasPlayingBeforeHidden = false;

  // Combined animation state
  type AnimationState = StreamlineAnimationState & CreateGridAnimationState & SubdivideGridAnimationState & DivergenceArrowAnimationState;

  let timeline: Timeline<AnimationState> | null = null;
  let streamlineAnim: StreamlineAnimation<AnimationState> | null = null;
  let createGridAnim: CreateGridAnimation<AnimationState> | null = null;
  let subdivideGridAnim: SubdivideGridAnimation<AnimationState> | null = null;
  let arrowAnim: DivergenceArrowAnimation<AnimationState> | null = null;

  // Pre-computed data (only boundingBox needed for label positioning)
  let boundingBox: { xMin: number; xMax: number; yMin: number; yMax: number } | null = null;

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  const domainMargin = 0.3;  // Zoomed in view

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

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function draw(state: AnimationState): void {
    if (!ctx || !isInitialized) return;

    ctx.clearRect(0, 0, width, height);

    // 1. Draw streamlines (behind everything) with pulse animation
    if (showStreamlines && streamlineAnim) {
      streamlineAnim.draw(ctx, state);
    }

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
      subdivideGridAnim.draw(ctx, state);
    } else if (createGridAnim) {
      // Before subdivision, draw the initial grid creation
      createGridAnim.draw(ctx, state);
    }

    // 4. Draw animated arrows (above surface fill)
    if (arrowAnim) {
      arrowAnim.draw(ctx, state);
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
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function runInitialComputation() {
    if (!canvas) return;

    // Compute bounding box (needed for label positioning and streamlines)
    const surfaceSamples = sampleSurfacePoints(curveFn);
    boundingBox = computeBoundingBox(surfaceSamples.points);

    // Create streamline animation
    streamlineAnim = StreamlineAnimation.create<AnimationState>({
      vectorFieldFn: vectorFieldFn as VectorFieldFn,
      domain: {
        xMin: boundingBox.xMin - domainMargin,
        xMax: boundingBox.xMax + domainMargin,
        yMin: boundingBox.yMin - domainMargin,
        yMax: boundingBox.yMax + domainMargin,
      },
      toPixel,
      density: 0.4, // Lower density since view is more zoomed in
      minPathLength,
      segmentLength,
      color: streamlineColor,
      strokeWidth: streamlineWidth,
      gradientSubdivisions,
      pulseWidth,
      pulsePauseWidth,
      baseOpacity: streamlineOpacity,
      offsets: "synchronized",
    });

    // Create initial grid animation (resolution N)
    createGridAnim = CreateGridAnimation.create<AnimationState>({
      curveFn,
      gridResolution,
      toPixel,
      color: gridColor,
      strokeWidth: gridWidth,
      clipDuration: 0.25, // First quarter of animation
    });

    // Create subdivision animation (N → 2N)
    subdivideGridAnim = SubdivideGridAnimation.create<AnimationState>({
      curveFn,
      baseResolution: gridResolution,
      toPixel,
      color: gridColor,
      strokeWidth: gridWidth,
      clipDuration: 0.25, // Second quarter of animation
    });

    // Create arrow animation (at final resolution 2N)
    arrowAnim = DivergenceArrowAnimation.create<AnimationState>({
      curveFn,
      gridResolution: gridResolution * 2, // Final resolution after subdivision
      toPixel,
      scaleLength,
      color: arrowColor,
      padding: arrowPadding,
      initialLengthFraction: 0.3, // Start arrows at 30% of max length
      clipDuration: 0.5, // Second half of animation
    });
  }

  function setupTimeline() {
    if (!streamlineAnim || !createGridAnim || !subdivideGridAnim || !arrowAnim) return;

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

    // Streamlines: full duration [0, 1]
    timeline.add(streamlineAnim.clip, 0);

    // CreateGrid: first quarter [0, 0.25]
    timeline.add(createGridAnim.clip, 0);

    // Subdivide: second quarter [0.25, 0.5]
    timeline.add(subdivideGridAnim.clip, 0.25);

    // Arrows: second half [0.5, 1.0]
    timeline.add(arrowAnim.clip, 0.5);

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

  onDestroy(() => {
    if (timeline) timeline.pause();
  });

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  // Initialize when canvas is ready
  $: if (!isInitialized && canvas && curveFn && vectorFieldFn) {
    runInitialComputation();
    setupTimeline();
    isInitialized = true;
    draw(timeline!.initialState);
    if (playingByDefault) startAnimation();
  }

  // Handle visibility changes
  $: if (isActive !== undefined && isInitialized) {
    handleVisibilityChange($isActive);
  }
</script>

<div class="volume-integral-wrapper">
  <div class="volume-integral-container">
    <canvas
      bind:this={canvas}
      use:canvas2d.bindCanvas
      style="width: 100%; height: auto; aspect-ratio: {width}/{height};"
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
    width: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
    position: relative;
  }
</style>
