<!--
  DivergenceTheoremSquare

  Visualizes why the divergence theorem holds: a region tiled by smaller squares.
  Each inner square has pulses traveling around its perimeter (blue), and a larger
  outer square also has pulses (orange). Adjacent inner-square pulses move in
  opposite directions on the shared edge, "cancelling" — only the outer-boundary
  pulse contribution survives.

  Implementation: pure Canvas2D (no WebGPU). Simple and reliable across browsers.
-->

<script lang="ts">
  import { onDestroy } from "svelte";
  import type { Writable } from "svelte/store";
  import { Figure, Katex } from "@diffusion-explorer/ui";

  interface Props {
    width?: number;
    height?: number;

    gridResolution?: number;
    squareWidth?: number;
    gap?: number;

    clockwise?: boolean;
    animationDuration?: number;
    pulseFrequency?: number;

    // Inner pulses
    pulseWidth?: number;
    pulsePauseWidth?: number;
    pulseColor?: string;
    strokeWidth?: number;
    baseOpacity?: number;

    // Outer square
    outerPadding?: number;
    outerStrokeWidth?: number;
    outerColor?: string;

    // Arrowheads
    showArrowhead?: boolean;
    arrowheadSize?: number;

    playingByDefault?: boolean;
  }

  let {
    width = 400,
    height = 400,

    gridResolution = 4,
    squareWidth = 55,
    gap = 20,

    clockwise = true,
    animationDuration = 4000,
    pulseFrequency = 0.5,

    pulseWidth = 35,
    pulsePauseWidth = 15,
    pulseColor = "#3b82f6",
    strokeWidth = 4,
    baseOpacity = 0.25,

    outerPadding = 10,
    outerStrokeWidth = 4,
    outerColor = "#f97316",

    showArrowhead = true,
    arrowheadSize = 7,

    playingByDefault = true,
  }: Props = $props();

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  let canvas: HTMLCanvasElement | null = $state(null);
  let figureIsActive: Writable<boolean> | undefined = $state(undefined);

  let rafId: number | null = null;
  let startTime: number | null = null;
  let isPlaying = false;
  let wasPlayingBeforeHidden = false;
  let dpr = 1;

  // Grid layout (CSS pixels)
  type Square = { cx: number; cy: number; size: number; cw: boolean };
  let innerSquares: Square[] = [];
  let outerSquare: Square | null = null;

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  /**
   * Map a 0..1 fraction of the perimeter to an (x, y) on the square's edge.
   * Direction is determined by `cw` (clockwise vs counter-clockwise).
   * Also returns the local tangent (unit direction along the path) so callers
   * can orient an arrowhead.
   */
  function pointAtFraction(
    sq: Square,
    f: number
  ): { x: number; y: number; tx: number; ty: number } {
    const hw = sq.size / 2;
    // Normalize fraction to [0, 1)
    let t = f - Math.floor(f);
    // Each side is 1/4 of the perimeter
    // Order (clockwise from TL): TL→TR (top), TR→BR (right), BR→BL (bottom), BL→TL (left)
    // For counter-clockwise, reverse the path direction.
    if (!sq.cw) {
      t = 1 - t;
      if (t === 1) t = 0;
    }
    const seg = Math.min(3, Math.floor(t * 4));
    const local = t * 4 - seg;
    let x = 0,
      y = 0,
      tx = 0,
      ty = 0;
    switch (seg) {
      case 0: // top edge L→R
        x = sq.cx - hw + local * sq.size;
        y = sq.cy - hw;
        tx = 1;
        ty = 0;
        break;
      case 1: // right edge T→B
        x = sq.cx + hw;
        y = sq.cy - hw + local * sq.size;
        tx = 0;
        ty = 1;
        break;
      case 2: // bottom edge R→L
        x = sq.cx + hw - local * sq.size;
        y = sq.cy + hw;
        tx = -1;
        ty = 0;
        break;
      case 3: // left edge B→T
        x = sq.cx - hw;
        y = sq.cy + hw - local * sq.size;
        tx = 0;
        ty = -1;
        break;
    }
    if (!sq.cw) {
      tx = -tx;
      ty = -ty;
    }
    return { x, y, tx, ty };
  }

  /** Polyline along the perimeter from fraction `start` to `end` (mod 1). */
  function arcPoints(sq: Square, start: number, end: number, samples = 12): { x: number; y: number }[] {
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= samples; i++) {
      const f = start + ((end - start) * i) / samples;
      const p = pointAtFraction(sq, f);
      pts.push({ x: p.x, y: p.y });
    }
    return pts;
  }

  function computeGridLayout() {
    const totalGridWidth = gridResolution * squareWidth + (gridResolution - 1) * gap;
    const totalGridHeight = totalGridWidth;
    const startX = (width - totalGridWidth) / 2 + squareWidth / 2;
    const startY = (height - totalGridHeight) / 2 + squareWidth / 2;

    innerSquares = [];
    for (let row = 0; row < gridResolution; row++) {
      for (let col = 0; col < gridResolution; col++) {
        innerSquares.push({
          cx: startX + col * (squareWidth + gap),
          cy: startY + row * (squareWidth + gap),
          size: squareWidth,
          cw: clockwise,
        });
      }
    }

    outerSquare = {
      cx: width / 2,
      cy: height / 2,
      size: totalGridWidth + outerPadding * 2,
      cw: clockwise,
    };
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function drawSquareOutline(
    ctx: CanvasRenderingContext2D,
    sq: Square,
    color: string,
    lineWidth: number,
    opacity: number
  ) {
    const hw = sq.size / 2;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.globalAlpha = opacity;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeRect(sq.cx - hw, sq.cy - hw, sq.size, sq.size);
    ctx.restore();
  }

  function drawPulses(
    ctx: CanvasRenderingContext2D,
    sq: Square,
    phase: number,
    pulseLengthPx: number,
    gapPx: number,
    color: string,
    lineWidth: number,
    arrowhead: boolean,
    arrowheadRadius: number
  ) {
    const perimeter = sq.size * 4;
    const cycle = pulseLengthPx + gapPx;
    if (perimeter <= 0 || cycle <= 0) return;

    const numPulses = Math.max(1, Math.round(perimeter / cycle));
    const pulseLengthFrac = pulseLengthPx / perimeter;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    for (let k = 0; k < numPulses; k++) {
      const baseFrac = (k / numPulses + phase) % 1;
      const tailFrac = baseFrac;
      const headFrac = baseFrac + pulseLengthFrac;

      const pts = arcPoints(sq, tailFrac, headFrac, 12);
      if (pts.length < 2) continue;

      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();

      if (arrowhead) {
        const tip = pointAtFraction(sq, headFrac);
        const angle = Math.atan2(tip.ty, tip.tx);
        const r = arrowheadRadius;
        ctx.beginPath();
        ctx.moveTo(tip.x + r * Math.cos(angle), tip.y + r * Math.sin(angle));
        ctx.lineTo(
          tip.x + r * Math.cos(angle + (2 * Math.PI) / 3),
          tip.y + r * Math.sin(angle + (2 * Math.PI) / 3)
        );
        ctx.lineTo(
          tip.x + r * Math.cos(angle + (4 * Math.PI) / 3),
          tip.y + r * Math.sin(angle + (4 * Math.PI) / 3)
        );
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function draw(phase: number) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // DPR transform — set once per frame so all coordinates are in CSS pixels.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // Inner squares: faint base outlines, then bright pulses
    for (const sq of innerSquares) {
      drawSquareOutline(ctx, sq, pulseColor, strokeWidth, baseOpacity);
    }
    for (const sq of innerSquares) {
      drawPulses(
        ctx,
        sq,
        phase,
        pulseWidth,
        pulsePauseWidth,
        pulseColor,
        strokeWidth,
        showArrowhead,
        arrowheadSize
      );
    }

    // Outer square: faint base + bright pulses (slightly fatter / spaced wider)
    if (outerSquare) {
      drawSquareOutline(ctx, outerSquare, outerColor, outerStrokeWidth, baseOpacity);
      drawPulses(
        ctx,
        outerSquare,
        phase,
        pulseWidth * 1.5,
        pulsePauseWidth * 1.5,
        outerColor,
        outerStrokeWidth,
        showArrowhead,
        arrowheadSize * 1.2
      );
    }
  }

  // ----------------------------------------------------------------
  // Animation
  // ----------------------------------------------------------------

  function animate(timestamp: number) {
    if (!isPlaying) return;
    if (startTime === null) startTime = timestamp;
    const elapsedSec = (timestamp - startTime) / 1000;
    const durationSec = animationDuration / 1000;
    const phase = ((elapsedSec * pulseFrequency) / durationSec) % 1;
    draw(phase);
    rafId = requestAnimationFrame(animate);
  }

  function startAnimation() {
    if (isPlaying) return;
    isPlaying = true;
    startTime = null;
    rafId = requestAnimationFrame(animate);
  }

  function stopAnimation() {
    isPlaying = false;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  // ----------------------------------------------------------------
  // Init / lifecycle
  // ----------------------------------------------------------------

  function initCanvas() {
    if (!canvas) return;
    dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    computeGridLayout();
    draw(0);
    if (playingByDefault) startAnimation();
  }

  function handleVisibilityChange(active: boolean) {
    if (!active && isPlaying) {
      wasPlayingBeforeHidden = true;
      stopAnimation();
    } else if (active && wasPlayingBeforeHidden) {
      wasPlayingBeforeHidden = false;
      startAnimation();
    }
  }

  $effect(() => {
    if (canvas) initCanvas();
  });

  $effect(() => {
    if (figureIsActive !== undefined) {
      handleVisibilityChange($figureIsActive);
    }
  });

  onDestroy(() => {
    stopAnimation();
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
    <canvas bind:this={canvas}></canvas>
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
