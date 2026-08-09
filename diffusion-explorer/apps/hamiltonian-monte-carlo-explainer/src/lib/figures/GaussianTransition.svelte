<script lang="ts">
  import { onDestroy, type Snippet } from "svelte";
  import type { Writable } from "svelte/store";
  import * as d3 from "d3";
  import {
    Figure,
    Player,
    TimelineBuilder,
    createPauseClip,
    useCanvas2D,
    useVisibilityHandler,
    type Clip,
  } from "@diffusion-explorer/ui";
  import { settings } from "$lib/settings";

  const { colors, point } = settings.stylingSettings;

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  interface Props {
    canvasWidth?: number;
    canvasHeight?: number;
    numSteps?: number;
    proposalSigma?: number;
    pointRadius?: number;
    pointColor?: string;
    proposalColor?: string;
    lineColor?: string;
    labelColor?: string;
    labelFontSize?: number;
    pastAlpha?: number;
    stepDuration?: number;
    seed?: number;
    caption?: Snippet;
  }

  let {
    canvasWidth = 1440,
    canvasHeight = 280,
    numSteps = 9,
    proposalSigma = 48,
    pointRadius = point.radius,
    pointColor = colors.point,
    proposalColor = colors.point,
    lineColor = colors.point,
    labelColor = "#111111",
    labelFontSize = 22,
    pastAlpha = 0.35,
    stepDuration = 2.4,
    seed = 7,
    caption,
  }: Props = $props();

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  let canvas: HTMLCanvasElement | null = $state(null);
  const canvas2d = useCanvas2D(canvasWidth, canvasHeight);
  let ctx = $derived(canvas && canvas2d.ctx);

  // Predefined chain of points in pixel space — left to right with vertical jitter.
  let points: { x: number; y: number }[] = [];

  type AnimationState = {
    stepIndex: number;
    contourAlpha: number;
    proposalAlpha: number;
    lineAlpha: number;
    lineGrowT: number;
    fadeToPast: number;
    showArrow: boolean;
  };

  let player: Player<AnimationState> | null = null;
  let isInitialized = $state(false);

  let figureIsActive: Writable<boolean> | undefined = $state(undefined);
  const { handleVisibilityChange } = useVisibilityHandler(() => player);

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  function mulberry32(a: number): () => number {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function gaussian(rng: () => number): number {
    const u = Math.max(rng(), 1e-9);
    const v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function runInitialComputation(): void {
    const rng = mulberry32(seed);
    // Outer proposal disk radius — pad horizontally so it never clips the
    // canvas edges. Vertically, leave room above for the q(x'|x) label and
    // below for the outer disk.
    const outerRadius = proposalSigma * 2.0;
    const padX = outerRadius + 12;
    const labelHeadroom = outerRadius + labelFontSize + 14;
    const padTop = labelHeadroom + 6;
    const padBottom = outerRadius + 12;

    const usableW = Math.max(1, canvasWidth - 2 * padX);
    const midY = (padTop + (canvasHeight - padBottom)) / 2;
    const yHalfBand = Math.max(
      0,
      (canvasHeight - padTop - padBottom) / 2,
    );
    const jitterAmp = yHalfBand * 0.6;

    points = [];
    for (let i = 0; i < numSteps; i++) {
      const t = numSteps === 1 ? 0.5 : i / (numSteps - 1);
      const x = padX + t * usableW;
      // Clamp the Gaussian-jittered y into the safe vertical band so the
      // outer disk + label always stay inside the canvas.
      const yJ = Math.max(-yHalfBand, Math.min(yHalfBand, gaussian(rng) * jitterAmp));
      const y = midY + yJ;
      points.push({ x, y });
    }
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  // Per-step phase weights. Scaled by stepDuration to get clip durations
  // in milliseconds; total per step = stepDuration seconds.
  const PHASE_WEIGHTS = {
    point: 0.12,
    contour: 0.22,
    hold: 0.10,
    blink: 0.16,
    line: 0.16,
    fade: 0.24,
  } as const;

  function setupTimeline(): void {
    const totalSteps = Math.max(1, points.length - 1);
    const stepMs = stepDuration * 1000;
    const ms = (w: number) => Math.max(1, Math.round(stepMs * w));

    const initialState: AnimationState = {
      stepIndex: 0,
      contourAlpha: 0,
      proposalAlpha: 0,
      lineAlpha: 0,
      lineGrowT: 0,
      fadeToPast: 1,
      showArrow: false,
    };

    const builder = new TimelineBuilder<AnimationState>().setInitialState({
      ...initialState,
    });

    for (let i = 0; i < totalSteps; i++) {
      // Set the active step index and reset per-step envelopes. Instant clip
      // (1ms) so it lands at the start of every step without consuming
      // visible time.
      const setStep: Clip<AnimationState> = {
        name: `Step${i}/SetIndex`,
        reduce: () => ({
          stepIndex: i,
          contourAlpha: 0,
          proposalAlpha: 0,
          lineAlpha: 0,
          lineGrowT: 0,
          fadeToPast: 1,
          showArrow: false,
        }),
      };
      builder.add(setStep, { durationMs: 1 });

      // Anchor: the current point is already on screen — nothing animates
      // here, but we keep a beat so the eye settles before the contour
      // appears.
      builder.add(createPauseClip<AnimationState>(), {
        durationMs: ms(PHASE_WEIGHTS.point),
      });

      // Contour grows in around the current point.
      const contourGrow: Clip<AnimationState> = {
        name: `Step${i}/ContourGrow`,
        reduce: (t) => ({ contourAlpha: t }),
      };
      builder.add(contourGrow, { durationMs: ms(PHASE_WEIGHTS.contour) });

      // Hold the fully-drawn proposal distribution before x' appears.
      builder.add(createPauseClip<AnimationState>(), {
        durationMs: ms(PHASE_WEIGHTS.hold),
      });

      // Proposed point blinks on/off (on, off, on, off, on) to grab the eye.
      const proposalBlink: Clip<AnimationState> = {
        name: `Step${i}/ProposalBlink`,
        reduce: (t) => ({
          contourAlpha: 1,
          proposalAlpha: Math.floor(t * 5) % 2 === 0 ? 1 : 0,
        }),
      };
      builder.add(proposalBlink, { durationMs: ms(PHASE_WEIGHTS.blink) });

      // Connector grows from current to proposed point with arrowhead.
      const connectorGrow: Clip<AnimationState> = {
        name: `Step${i}/ConnectorGrow`,
        reduce: (t) => ({
          contourAlpha: 1,
          proposalAlpha: 1,
          lineAlpha: 1,
          lineGrowT: t,
          showArrow: true,
        }),
      };
      builder.add(connectorGrow, { durationMs: ms(PHASE_WEIGHTS.line) });

      // Fade to past: contour fades away; current dot, proposed dot, and
      // connector all lerp 1 → pastAlpha together. Strip the arrowhead so
      // the connector lands as a plain line matching past-step appearance.
      const fadeToPastClip: Clip<AnimationState> = {
        name: `Step${i}/FadeToPast`,
        reduce: (t) => {
          const f = 1 - (1 - pastAlpha) * t;
          return {
            contourAlpha: 1 - t,
            proposalAlpha: f,
            lineAlpha: f,
            lineGrowT: 1,
            fadeToPast: f,
            showArrow: false,
          };
        },
      };
      builder.add(fadeToPastClip, { durationMs: ms(PHASE_WEIGHTS.fade) });
    }

    const timeline = builder.build();
    player = new Player(timeline, { looping: true });
    player.onTick((_t, state) => draw(state));
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function draw(state: AnimationState): void {
    if (!ctx || points.length === 0) return;

    // --- Static background ---
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // --- Past chain: persistent low-opacity orange dots and connectors ---
    for (let i = 0; i < state.stepIndex; i++) {
      const a = points[i];
      const b = points[i + 1];
      drawConnector(a, b, pastAlpha, 1);
      drawDot(a.x, a.y, pointColor, pastAlpha);
    }

    // --- Dynamic foreground ---
    const {
      stepIndex,
      contourAlpha,
      proposalAlpha,
      lineAlpha,
      lineGrowT,
      fadeToPast,
      showArrow,
    } = state;
    const cur = points[stepIndex];
    const next = points[Math.min(stepIndex + 1, points.length - 1)];

    if (contourAlpha > 0) {
      drawProposalContours(cur.x, cur.y, contourAlpha);
      drawLabel(
        "q(x' | x)",
        cur.x,
        cur.y - proposalSigma * 2.0 - 14,
        contourAlpha,
      );
    }

    if (lineAlpha > 0) {
      drawConnector(cur, next, lineAlpha, lineGrowT, showArrow);
    }

    drawDot(cur.x, cur.y, pointColor, fadeToPast);
    drawLabel("x", cur.x, cur.y - pointRadius - 10, fadeToPast);

    if (proposalAlpha > 0) {
      drawDot(next.x, next.y, proposalColor, proposalAlpha);
      drawLabel("x'", next.x, next.y - pointRadius - 10, proposalAlpha);
    }
  }

  function drawDot(
    x: number,
    y: number,
    color: string,
    alpha: number,
  ): void {
    if (!ctx) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, pointRadius, 0, 2 * Math.PI);
    ctx.fill();
    ctx.restore();
  }

  function drawProposalContours(
    x: number,
    y: number,
    alpha: number,
  ): void {
    if (!ctx) return;
    ctx.save();
    const rgb = d3.color(proposalColor)?.rgb();
    const r = rgb?.r ?? 249;
    const g = rgb?.g ?? 115;
    const b = rgb?.b ?? 22;
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;

    // Filled concentric disks, drawn outer→inner so they stack and the
    // center accumulates the darkest color (uniform per-ring alpha).
    const radii = [2.0, 1.4, 0.8].map((s) => proposalSigma * s);
    const ringAlpha = 0.18;
    for (const radius of radii) {
      ctx.globalAlpha = alpha * ringAlpha;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawConnector(
    a: { x: number; y: number },
    b: { x: number; y: number },
    alpha: number,
    growT: number,
    showArrow: boolean = false,
  ): void {
    if (!ctx) return;
    // Trim the line so it starts and ends at the dot edges, not the centers.
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    const ux = dx / len;
    const uy = dy / len;
    // When the arrowhead is showing, stop the line short of the destination
    // dot so the head sits in a gap rather than tucked under the dot's edge.
    // Without an arrow we keep the original edge-to-edge geometry so
    // past-step connectors look unchanged.
    const arrowGap = showArrow ? pointRadius + 6 : pointRadius;
    const start = { x: a.x + ux * pointRadius, y: a.y + uy * pointRadius };
    const travel = Math.max(0, len - pointRadius - arrowGap);
    const end = {
      x: a.x + ux * (pointRadius + travel * growT),
      y: a.y + uy * (pointRadius + travel * growT),
    };

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = lineColor;
    ctx.fillStyle = lineColor;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();

    if (showArrow) {
      const headLength = 10;
      const headWidth = 8;
      // Perpendicular unit vector for the arrowhead's flare.
      const px = -uy;
      const py = ux;
      // Tip extends past the line end so the head is fully visible in the
      // gap between the line and the proposed dot.
      const tipX = end.x + ux * headLength;
      const tipY = end.y + uy * headLength;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(end.x + px * (headWidth / 2), end.y + py * (headWidth / 2));
      ctx.lineTo(end.x - px * (headWidth / 2), end.y - py * (headWidth / 2));
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }

  function drawLabel(
    text: string,
    x: number,
    y: number,
    alpha: number,
  ): void {
    if (!ctx) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = labelColor;
    ctx.font = `italic ${labelFontSize}px 'Computer Modern Serif', 'Times New Roman', serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  onDestroy(() => {
    player?.dispose();
  });

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  $effect(() => {
    if (canvas && ctx && !isInitialized) {
      isInitialized = true;
      runInitialComputation();
      setupTimeline();
      draw({
        stepIndex: 0,
        contourAlpha: 0,
        proposalAlpha: 0,
        lineAlpha: 0,
        lineGrowT: 0,
        fadeToPast: 1,
        showArrow: false,
      });
      player?.play();
    }
  });

  $effect(() => {
    if (figureIsActive && isInitialized) {
      const unsubscribe = figureIsActive.subscribe((active: boolean) => {
        handleVisibilityChange(active);
      });
      return unsubscribe;
    }
  });
</script>

<Figure bind:isActive={figureIsActive} backgroundVisible={false} {caption}>
  <div class="canvas-wrapper" style="max-width: {canvasWidth}px;">
    <canvas
      bind:this={canvas}
      use:canvas2d.bindCanvas
      class="gaussian-transition-canvas"
    ></canvas>
  </div>
</Figure>

<style>
  .canvas-wrapper {
    width: 100%;
    margin: 0 auto;
    box-sizing: border-box;
  }

  .gaussian-transition-canvas {
    width: 100%;
    height: auto;
    display: block;
    background: transparent;
  }
</style>
