/**
 * Pulse animation for the boundary arrows on the right pane of the
 * Conservation-of-Mass figure.
 *
 * Each arrow has a single normalized position parameter s ∈ [0, totalDepth]
 * mapping start → tip across both the shaft and the arrowhead:
 *
 *     s = 0 ────── lineLen ───── totalDepth
 *     |─── shaft ────|── arrowhead ──|
 *
 * A pulse phase p ∈ [0, 1] sweeps the pulse front along s. The active
 * stripe is [p - pulseWidthFrac, p] in normalized coords. We draw the
 * arrow geometry twice per arrow:
 *
 *   1. dim base color (faint) — always visible so arrows don't "disappear"
 *   2. bright pulse color clipped to a parallelogram perpendicular to the
 *      arrow direction covering the active stripe — only the part of the
 *      arrow inside the stripe lights up.
 *
 * When the stripe straddles the shaft/arrowhead boundary the clip naturally
 * includes part of the filled arrowhead, so the head "lights up" as the
 * pulse arrives. When the stripe lies fully within the arrowhead it fills
 * the head from base toward the tip.
 *
 * Renders to a single Canvas2D context; ~3 draw operations per arrow per
 * frame — trivial for 16 arrows.
 */

import { drawArrow } from "@diffusion-explorer/ui";

export type ArrowGeom = {
  /** Shaft start (pixel). */
  sx: number;
  sy: number;
  /** Tip (pixel). drawArrow's `to` point; arrowhead extends past this. */
  ex: number;
  ey: number;
  /** Unit vector start→tip (canvas y already flipped). */
  ux: number;
  uy: number;
};

export type BoundaryArrowPulseOptions = {
  /** Phase in [0, 1] driving all pulses. Wraps every cycle. */
  phase: number;
  /** Stroke width of the colored shaft (px). */
  shaftWidth: number;
  /** Width of the white halo per side (px). 0 = no halo. */
  haloWidth: number;
  /** Color of the halo (typically the canvas background). */
  haloColor: string;
  /** Arrowhead circumradius (px) for the colored arrow. */
  arrowHeadSize: number;
  /** Dim base color (the "no-pulse" appearance). */
  baseColor: string;
  /** Bright pulse color (often the same as baseColor — alpha varies). */
  pulseColor: string;
  /** Pulse width in normalized [0, 1] units along the arrow. */
  pulseWidthFrac: number;
  /**
   * Fraction of the cycle to wait between pulses (with no pulse drawn).
   * A value of 0.3 means pulses occupy 70% of the cycle and 30% is idle.
   * Defaults to 0.
   */
  pulsePauseFrac?: number;
  /**
   * Per-arrow phase offsets in [0, 1]. If provided, arrow i uses
   * effectivePhase = (phase + phaseOffsets[i]) mod 1. Useful for visual
   * staggering (e.g. phaseOffsets[i] = i / arrows.length for a rotating
   * wave around the boundary).
   */
  phaseOffsets?: number[];
  /** Base arrow alpha when no pulse is present. Default 0.55. */
  baseAlpha?: number;
  /**
   * Fraction of the total arrow depth occupied by the arrowhead. Default
   * computed from arrowHeadSize / (lineLen + arrowHeadSize), but you can
   * pass a value to override per-arrow geometry differences.
   *
   * Not currently used — kept for future per-arrow tuning.
   */
  arrowheadDepthFrac?: number;
};

/**
 * Draw a halo behind each arrow. Run this BEFORE drawBoundaryArrowPulses
 * so the halo sits below the base + pulse.
 */
export function drawBoundaryArrowHalos(
  ctx: CanvasRenderingContext2D,
  arrows: ArrowGeom[],
  opts: {
    shaftWidth: number;
    haloWidth: number;
    haloColor: string;
    arrowHeadSize: number;
  },
): void {
  if (opts.haloWidth <= 0) return;
  ctx.save();
  ctx.strokeStyle = opts.haloColor;
  ctx.fillStyle = opts.haloColor;
  ctx.lineWidth = opts.shaftWidth + 2 * opts.haloWidth;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  // Edge perpendicular distance for an equilateral triangle = circumradius/2,
  // so growing the circumradius by 2*halo gives equal perpendicular halo
  // around the arrowhead as we get around the shaft.
  const haloHeadRadius = opts.arrowHeadSize + 2 * opts.haloWidth;
  for (const a of arrows) {
    drawArrow(ctx, a.sx, a.sy, a.ex, a.ey, haloHeadRadius);
  }
  ctx.restore();
}

/**
 * Draw the dim base arrows + the bright pulse stripe on top.
 *
 * Two passes per arrow:
 *   1. base color at baseAlpha (the "resting" look)
 *   2. pulse color, clipped to a perpendicular stripe covering the active
 *      pulse window.
 */
export function drawBoundaryArrowPulses(
  ctx: CanvasRenderingContext2D,
  arrows: ArrowGeom[],
  opts: BoundaryArrowPulseOptions,
): void {
  const baseAlpha = opts.baseAlpha ?? 0.55;
  const pauseFrac = opts.pulsePauseFrac ?? 0;

  // 1. Dim base arrows (always visible).
  ctx.save();
  ctx.strokeStyle = opts.baseColor;
  ctx.fillStyle = opts.baseColor;
  ctx.lineWidth = opts.shaftWidth;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.globalAlpha = baseAlpha;
  for (const a of arrows) {
    drawArrow(ctx, a.sx, a.sy, a.ex, a.ey, opts.arrowHeadSize);
  }
  ctx.restore();

  // 2. Bright pulse pass. The pulse "active" portion of the cycle is
  // [0, 1 - pauseFrac]; the remainder is idle.
  const activeFrac = 1 - pauseFrac;
  if (activeFrac <= 0) return;

  for (let i = 0; i < arrows.length; i++) {
    const arrow = arrows[i];
    const off = opts.phaseOffsets ? opts.phaseOffsets[i] ?? 0 : 0;
    let p = (opts.phase + off) % 1;
    if (p < 0) p += 1;

    // Skip the idle portion of the cycle.
    if (p >= activeFrac) continue;

    // Map p ∈ [0, activeFrac] → q ∈ [0, 1 + pulseWidthFrac] so the pulse
    // starts off-screen (q = -pulseWidthFrac visually) and exits past the
    // tip (q = 1). This makes the pulse smoothly "enter" and "exit".
    const span = 1 + opts.pulseWidthFrac;
    const q = (p / activeFrac) * span;
    const s1 = q;                          // pulse front
    const s0 = q - opts.pulseWidthFrac;    // pulse tail

    // Clip to the visible part of the arrow [0, 1].
    const clipS0 = Math.max(0, s0);
    const clipS1 = Math.min(1, s1);
    if (clipS1 <= clipS0) continue;

    drawClippedArrow(ctx, arrow, clipS0, clipS1, opts);
  }
}

/**
 * Draw a single arrow in the pulse color, clipped to the perpendicular
 * stripe between s0 and s1 (both in [0, 1] along the arrow's total depth).
 *
 * Uses a parallelogram clip wide enough to extend off-canvas so we never
 * accidentally clip in the perpendicular direction.
 */
function drawClippedArrow(
  ctx: CanvasRenderingContext2D,
  arrow: ArrowGeom,
  s0: number,
  s1: number,
  opts: BoundaryArrowPulseOptions,
): void {
  const { sx, sy, ex, ey, ux, uy } = arrow;
  // Total arrow depth = shaft length + the arrowhead's forward overhang.
  // drawArrow places the triangle apex at distance arrowHeadSize forward of
  // (ex, ey). So the visual tip sits at (ex + ux*arrowHeadSize, ey - ...).
  // In canvas coords, the perpendicular direction needs to use the canvas
  // y-flip the arrow's geometry already encodes.
  const lineLen = Math.hypot(ex - sx, ey - sy);
  const totalDepth = lineLen + opts.arrowHeadSize;

  // Canvas-space unit vectors. ux,uy are already in canvas coords (y flipped
  // earlier), so the perpendicular in canvas coords is (-uy, ux).
  const cx = ex - sx;
  const cy = ey - sy;
  const len = Math.hypot(cx, cy) || 1;
  const dx = cx / len;       // canvas-space unit along shaft
  const dy = cy / len;
  const nx = -dy;
  const ny = dx;

  // Stripe extents along the arrow direction (pixel coords).
  const a0 = s0 * totalDepth;
  const a1 = s1 * totalDepth;

  // Parallelogram corners — extend perpendicular by a large W so we never
  // clip the (potentially wide) arrowhead in the cross direction.
  const W = Math.max(opts.arrowHeadSize, opts.shaftWidth) * 6;
  const p0x = sx + dx * a0 - nx * W;
  const p0y = sy + dy * a0 - ny * W;
  const p1x = sx + dx * a1 - nx * W;
  const p1y = sy + dy * a1 - ny * W;
  const p2x = sx + dx * a1 + nx * W;
  const p2y = sy + dy * a1 + ny * W;
  const p3x = sx + dx * a0 + nx * W;
  const p3y = sy + dy * a0 + ny * W;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(p0x, p0y);
  ctx.lineTo(p1x, p1y);
  ctx.lineTo(p2x, p2y);
  ctx.lineTo(p3x, p3y);
  ctx.closePath();
  ctx.clip();

  ctx.strokeStyle = opts.pulseColor;
  ctx.fillStyle = opts.pulseColor;
  ctx.lineWidth = opts.shaftWidth;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  drawArrow(ctx, sx, sy, ex, ey, opts.arrowHeadSize);

  ctx.restore();
}
