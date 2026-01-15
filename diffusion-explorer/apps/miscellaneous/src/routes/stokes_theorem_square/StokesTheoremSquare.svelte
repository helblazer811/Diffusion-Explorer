<!--
  Stokes' Theorem Square Grid Visualization

  Shows a grid of pulsing squares with a larger outer square,
  demonstrating how interior circulations cancel at shared edges.
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

  function setupTimeline() {
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
   * Draw arrows on the inside or outside of a square showing circulation direction.
   * @param inner - If true, arrows are drawn inside the square; if false, outside
   * @param clockwise - Direction of circulation
   * @param margin - Distance from edge to place arrows
   */
  function drawSquareArrows(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    inner: boolean,
    clockwise: boolean,
    margin: number,
    color: string,
    arrowSize: number,
    lineWidth: number,
    opacity: number
  ): void {
    const hw = size / 2;
    // If inner, arrows are inside (subtract margin); if outer, arrows are outside (add margin)
    const offset = inner ? -margin : margin;
    const arrowHw = hw + offset;

    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.globalAlpha = opacity;

    // Define midpoints of each edge, offset inward or outward
    // Top edge midpoint
    const topMid: [number, number] = [x, y - arrowHw];
    // Right edge midpoint
    const rightMid: [number, number] = [x + arrowHw, y];
    // Bottom edge midpoint
    const bottomMid: [number, number] = [x, y + arrowHw];
    // Left edge midpoint
    const leftMid: [number, number] = [x - arrowHw, y];

    // Arrow length spans from margin on one side to margin on the other
    const arrowLen = (hw - margin) * 0.8;

    // Define arrow directions based on clockwise/counterclockwise
    // Clockwise: top→right, right→down, bottom→left, left→up
    // Counter-clockwise: top→left, left→down, bottom→right, right→up
    if (clockwise) {
      // Top arrow points right
      drawArrow(ctx, topMid[0] - arrowLen, topMid[1], topMid[0] + arrowLen, topMid[1], arrowSize);
      // Right arrow points down
      drawArrow(ctx, rightMid[0], rightMid[1] - arrowLen, rightMid[0], rightMid[1] + arrowLen, arrowSize);
      // Bottom arrow points left
      drawArrow(ctx, bottomMid[0] + arrowLen, bottomMid[1], bottomMid[0] - arrowLen, bottomMid[1], arrowSize);
      // Left arrow points up
      drawArrow(ctx, leftMid[0], leftMid[1] + arrowLen, leftMid[0], leftMid[1] - arrowLen, arrowSize);
    } else {
      // Top arrow points left
      drawArrow(ctx, topMid[0] + arrowLen, topMid[1], topMid[0] - arrowLen, topMid[1], arrowSize);
      // Left arrow points down
      drawArrow(ctx, leftMid[0], leftMid[1] - arrowLen, leftMid[0], leftMid[1] + arrowLen, arrowSize);
      // Bottom arrow points right
      drawArrow(ctx, bottomMid[0] - arrowLen, bottomMid[1], bottomMid[0] + arrowLen, bottomMid[1], arrowSize);
      // Right arrow points up
      drawArrow(ctx, rightMid[0], rightMid[1] + arrowLen, rightMid[0], rightMid[1] - arrowLen, arrowSize);
    }

    ctx.restore();
  }

  /**
   * Draw arrows on the exterior of the outer square, with arrow length matching inner square width.
   * One arrow per side, centered on each edge.
   */
  function drawOuterSquareArrowsAligned(
    ctx: CanvasRenderingContext2D,
    centerX: number,
    centerY: number,
    outerSize: number,
    innerSquareWidth: number,
    margin: number,
    clockwise: boolean,
    color: string,
    arrowSize: number,
    lineWidth: number,
    opacity: number
  ): void {
    const outerHw = outerSize / 2;
    const arrowY_top = centerY - outerHw - margin;
    const arrowY_bottom = centerY + outerHw + margin;
    const arrowX_left = centerX - outerHw - margin;
    const arrowX_right = centerX + outerHw + margin;

    // Arrow length matches inner square width (half on each side of center)
    const arrowLen = (innerSquareWidth * 0.8) / 2;

    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.globalAlpha = opacity;

    if (clockwise) {
      // Top edge: arrow points right, centered
      drawArrow(ctx, centerX - arrowLen, arrowY_top, centerX + arrowLen, arrowY_top, arrowSize);
      // Bottom edge: arrow points left, centered
      drawArrow(ctx, centerX + arrowLen, arrowY_bottom, centerX - arrowLen, arrowY_bottom, arrowSize);
      // Right edge: arrow points down, centered
      drawArrow(ctx, arrowX_right, centerY - arrowLen, arrowX_right, centerY + arrowLen, arrowSize);
      // Left edge: arrow points up, centered
      drawArrow(ctx, arrowX_left, centerY + arrowLen, arrowX_left, centerY - arrowLen, arrowSize);
    } else {
      // Top edge: arrow points left
      drawArrow(ctx, centerX + arrowLen, arrowY_top, centerX - arrowLen, arrowY_top, arrowSize);
      // Bottom edge: arrow points right
      drawArrow(ctx, centerX - arrowLen, arrowY_bottom, centerX + arrowLen, arrowY_bottom, arrowSize);
      // Left edge: arrow points down
      drawArrow(ctx, arrowX_left, centerY - arrowLen, arrowX_left, centerY + arrowLen, arrowSize);
      // Right edge: arrow points up
      drawArrow(ctx, arrowX_right, centerY + arrowLen, arrowX_right, centerY - arrowLen, arrowSize);
    }

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
      // Draw arrows inside the squares
      if (showArrows) {
        drawSquareArrows(ctx, pos.x, pos.y, squareWidth, true, clockwise, 8, pulseColor, 3, strokeWidth, 1.0);
      }
    }

    // Draw static background outline for outer square
    const outerWidth = gridTotalWidth + outerPadding * 2;
    drawSquareOutline(ctx, width / 2, height / 2, outerWidth, outerColor, outerStrokeWidth, 0.15);
    // Draw arrows on the exterior of the outer square, with length matching inner square width
    if (showArrows) {
      drawOuterSquareArrowsAligned(ctx, width / 2, height / 2, outerWidth, squareWidth, 12, clockwise, outerColor, 6, outerStrokeWidth, 1.0);
    }

    // Draw all inner grid squares (pulsing)
    for (const anim of innerSquareAnimations) {
      anim.draw(ctx, state);
    }

    // Draw outer square (pulsing, larger, thicker)
    if (outerSquareAnimation) {
      outerSquareAnimation.draw(ctx, state);
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
      runInitialComputation();
      setupTimeline();
      isInitialized = true;

      if (playingByDefault && timeline) {
        draw(timeline.initialState);
        timeline.play();
      }
    }
  });

  $effect(() => {
    if (figureIsActive !== undefined && isInitialized) {
      handleVisibilityChange($figureIsActive);
    }
  });
</script>

<div class="stokes-square-wrapper">
  <div class="stokes-square-equation">
    <Katex
      math={"\\oint_C \\mathbf{F} \\cdot d\\mathbf{r} = \\iint_S (\\nabla \\times \\mathbf{F}) \\cdot dS"}
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
  .stokes-square-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .stokes-square-equation {
    text-align: center;
    margin-bottom: 1rem;
    color: #4b5563;
    font-size: 1.3rem;
  }
</style>
