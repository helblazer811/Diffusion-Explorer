<!--
  Divergence Theorem Square Grid Visualization

  Shows a grid of pulsing squares with a larger outer square,
  demonstrating how interior flux contributions cancel at shared edges,
  leaving only the flux through the outer boundary.
-->

<script lang="ts">
  import { onDestroy } from "svelte";
  import type { Writable } from "svelte/store";
  import {
    Figure,
    Katex,
    Timeline,
    useCanvas2D,
    useVisibilityHandler,
    drawArrow,
  } from "@diffusion-explorer/ui";
  import {
    PulsingSquareAnimation,
    type PulsingSquareState,
  } from "./pulsing-square-animation";

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
    loopPulseFrequency?: number;

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
    showArrows?: boolean;

    playingByDefault?: boolean;
  }

  let {
    // Layout
    width = 400,
    height = 400,

    // Grid configuration
    gridResolution = 5,
    squareWidth = 45,
    gap = 20,

    // Animation
    clockwise = true,
    animationDuration = 4000,
    loopPulseFrequency = 4,

    // Pulse styling - inner squares
    pulseWidth = 20,
    pulsePauseWidth = 10,
    pulseColor = "#3b82f6",
    strokeWidth = 4,
    baseOpacity = 0.8,

    // Outer square styling
    outerPadding = 10,
    outerStrokeWidth = 4,
    outerColor = "#f97316",

    // Display options
    showArrows = false,

    playingByDefault = true,
  }: Props = $props();

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  type AnimationState = PulsingSquareState;

  let canvas: HTMLCanvasElement | null = $state(null);
  const canvas2d = useCanvas2D(width, height);
  let ctx = $derived(canvas ? canvas2d.ctx : null);

  let isInitialized = $state(false);
  let figureIsActive: Writable<boolean> | undefined = $state(undefined);

  let timeline: Timeline<AnimationState> | null = $state(null);
  let innerSquareAnimations: PulsingSquareAnimation<AnimationState>[] = $state(
    []
  );
  let outerSquareAnimation: PulsingSquareAnimation<AnimationState> | null =
    $state(null);

  // Grid layout computed values
  let gridPositions: { x: number; y: number }[] = $state([]);
  let gridTotalWidth: number = $state(0);
  let gridTotalHeight: number = $state(0);

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

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

  function runInitialComputation() {
    if (!canvas) return;

    // Compute grid positions
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

    // Create pulsing square animations for each grid position
    innerSquareAnimations = gridPositions.map((pos) =>
      PulsingSquareAnimation.create<AnimationState>({
        x: pos.x,
        y: pos.y,
        width: squareWidth,
        pulseWidth,
        pulsePauseWidth,
        clockwise,
        color: pulseColor,
        strokeWidth,
        baseOpacity,
        loopPulseFrequency: 3,
        subdivisions: 150,
      })
    );

    // Create outer square animation
    const outerWidth = gridTotalWidth + outerPadding * 2;
    outerSquareAnimation = PulsingSquareAnimation.create<AnimationState>({
      x: width / 2,
      y: height / 2,
      width: outerWidth,
      pulseWidth: pulseWidth * 1.5,
      pulsePauseWidth: pulsePauseWidth * 1.5,
      clockwise,
      color: outerColor,
      strokeWidth: outerStrokeWidth,
      baseOpacity,
      loopPulseFrequency,
      subdivisions: 300,
    });
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  async function setupTimeline() {
    if (!canvas) return;

    // Initialize all animations with the canvas
    await Promise.all([
      ...innerSquareAnimations.map(anim => anim.init(canvas!)),
      outerSquareAnimation!.init(canvas),
    ]);

    const initialState: AnimationState = { phase: 0 };

    timeline = new Timeline<AnimationState>();
    timeline.initialState = initialState;
    timeline.duration = animationDuration / 1000;
    timeline.looping = true;

    // Single clip for phase - all squares share the same phase
    timeline.add(
      {
        name: "PulsePhase",
        reduce(t: number) {
          return { phase: t };
        },
      },
      { start: 0, end: 1 }
    );

    timeline.onTick((_t, state) => {
      draw(state);
    });
  }

  const { handleVisibilityChange } = useVisibilityHandler(() => timeline);

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  /**
   * Draw a static square outline.
   */
  function drawSquareOutline(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    color: string,
    lineWidth: number,
    opacity: number
  ): void {
    const hw = size / 2;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.globalAlpha = opacity;
    ctx.beginPath();
    ctx.rect(x - hw, y - hw, size, size);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Draw outward normal arrows on a square showing flux direction.
   * Arrows point outward from each edge (perpendicular to edges).
   */
  function drawOutwardNormalArrows(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    margin: number,
    color: string,
    arrowSize: number,
    lineWidth: number,
    opacity: number
  ): void {
    const hw = size / 2;
    const arrowLen = size * 0.25;

    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.globalAlpha = opacity;

    // Top edge: arrow points up (outward)
    const topY = y - hw - margin;
    drawArrow(ctx, x, topY, x, topY - arrowLen, arrowSize);

    // Bottom edge: arrow points down (outward)
    const bottomY = y + hw + margin;
    drawArrow(ctx, x, bottomY, x, bottomY + arrowLen, arrowSize);

    // Left edge: arrow points left (outward)
    const leftX = x - hw - margin;
    drawArrow(ctx, leftX, y, leftX - arrowLen, y, arrowSize);

    // Right edge: arrow points right (outward)
    const rightX = x + hw + margin;
    drawArrow(ctx, rightX, y, rightX + arrowLen, y, arrowSize);

    ctx.restore();
  }

  /**
   * Draw outward normal arrows on the exterior of the outer square.
   */
  function drawOuterSquareNormalArrows(
    ctx: CanvasRenderingContext2D,
    centerX: number,
    centerY: number,
    outerSize: number,
    margin: number,
    color: string,
    arrowSize: number,
    lineWidth: number,
    opacity: number
  ): void {
    const outerHw = outerSize / 2;
    const arrowLen = outerSize * 0.08;

    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.globalAlpha = opacity;

    // Top edge: arrow points up (outward)
    const topY = centerY - outerHw - margin;
    drawArrow(ctx, centerX, topY, centerX, topY - arrowLen, arrowSize);

    // Bottom edge: arrow points down (outward)
    const bottomY = centerY + outerHw + margin;
    drawArrow(ctx, centerX, bottomY, centerX, bottomY + arrowLen, arrowSize);

    // Left edge: arrow points left (outward)
    const leftX = centerX - outerHw - margin;
    drawArrow(ctx, leftX, centerY, leftX - arrowLen, centerY, arrowSize);

    // Right edge: arrow points right (outward)
    const rightX = centerX + outerHw + margin;
    drawArrow(ctx, rightX, centerY, rightX + arrowLen, centerY, arrowSize);

    ctx.restore();
  }

  /**
   * Main draw function - depends on animation state, not time.
   */
  function draw(state: AnimationState): void {
    if (!ctx || !isInitialized) return;

    ctx.clearRect(0, 0, width, height);

    // Draw static background outlines for inner squares
    for (const pos of gridPositions) {
      drawSquareOutline(ctx, pos.x, pos.y, squareWidth, pulseColor, strokeWidth, 0.15);
      // Draw outward normal arrows on each inner square
      if (showArrows) {
        drawOutwardNormalArrows(ctx, pos.x, pos.y, squareWidth, 5, pulseColor, 3, strokeWidth * 0.7, 0.8);
      }
    }

    // Draw static background outline for outer square
    const outerWidth = gridTotalWidth + outerPadding * 2;
    drawSquareOutline(ctx, width / 2, height / 2, outerWidth, outerColor, outerStrokeWidth, 0.15);
    // Draw outward normal arrows on the exterior of the outer square
    if (showArrows) {
      drawOuterSquareNormalArrows(ctx, width / 2, height / 2, outerWidth, 12, outerColor, 6, outerStrokeWidth, 1.0);
    }

    // Draw all inner grid squares (pulsing)
    for (const anim of innerSquareAnimations) {
      anim.draw(state);
    }

    // Draw outer square (pulsing, larger, thicker)
    if (outerSquareAnimation) {
      outerSquareAnimation.draw(state);
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
    if (!isInitialized && ctx) {
      isInitialized = true;
      runInitialComputation();
      setupTimeline().then(() => {
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

<div class="divergence-square-wrapper">
  <div class="divergence-square-equation">
    <Katex
      math={"\\oint_{\\partial V} \\mathbf{F} \\cdot \\mathbf{n} \\, dS = \\int_V (\\nabla \\cdot \\mathbf{F}) \\, dV"}
      displayMode={true}
    />
  </div>

  <Figure bind:isActive={figureIsActive} backgroundVisible={false}>
    <canvas
      bind:this={canvas}
      use:canvas2d.bindCanvas
      style="width: 100%; height: auto; aspect-ratio: {width}/{height};"
    ></canvas>
  </Figure>
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
</style>
