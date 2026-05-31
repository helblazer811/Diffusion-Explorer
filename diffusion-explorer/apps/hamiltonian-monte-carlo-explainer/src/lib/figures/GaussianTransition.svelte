<script lang="ts">
  import { onDestroy } from "svelte";
  import type { Writable } from "svelte/store";
  import * as d3 from "d3";
  import {
    Figure,
    Player,
    Timeline,
    useCanvas2D,
    useVisibilityHandler,
  } from "@diffusion-explorer/ui";

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
    stepDuration?: number;
    seed?: number;
  }

  let {
    canvasWidth = 1440,
    canvasHeight = 360,
    numSteps = 9,
    proposalSigma = 36,
    pointRadius = 8,
    pointColor = "#1e40af",
    proposalColor = "#1e40af",
    lineColor = "#1e40af",
    labelColor = "#111111",
    stepDuration = 2.4,
    seed = 7,
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
    phase: "point" | "contour" | "blink" | "line" | "fade";
    phaseAlpha: number;
    blinkOn: boolean;
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
    const padX = canvasWidth * 0.06;
    const usableW = canvasWidth - 2 * padX;
    const midY = canvasHeight * 0.55;
    const jitterAmp = canvasHeight * 0.18;

    points = [];
    for (let i = 0; i < numSteps; i++) {
      const t = numSteps === 1 ? 0.5 : i / (numSteps - 1);
      const x = padX + t * usableW;
      const y = midY + gaussian(rng) * jitterAmp * 0.6;
      points.push({ x, y });
    }
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  // Phase fractions within a single step. They sum to 1.
  const PHASE_FRACTIONS = {
    point: 0.12,
    contour: 0.22,
    blink: 0.18,
    line: 0.20,
    fade: 0.28,
  } as const;

  function setupTimeline(): void {
    const totalSteps = Math.max(1, points.length - 1);
    const duration = stepDuration * totalSteps;

    const stepClip = {
      name: "GaussianRandomWalk",
      reduce(t: number): AnimationState {
        const float = t * totalSteps;
        const stepIndex = Math.min(Math.floor(float), totalSteps - 1);
        const local = float - stepIndex;

        // Walk phases left-to-right within [0,1).
        let acc = 0;
        let phase: AnimationState["phase"] = "point";
        let phaseAlpha = 0;
        const order: AnimationState["phase"][] = [
          "point",
          "contour",
          "blink",
          "line",
          "fade",
        ];
        for (const p of order) {
          const f = PHASE_FRACTIONS[p];
          if (local < acc + f) {
            phase = p;
            phaseAlpha = f > 0 ? (local - acc) / f : 0;
            break;
          }
          acc += f;
        }

        // Blink the proposed point during the "blink" phase: visible, hidden, visible.
        const blinkOn = phase === "blink"
          ? phaseAlpha < 1 / 3 || phaseAlpha > 2 / 3
          : phase === "line" || phase === "fade";

        return { stepIndex, phase, phaseAlpha, blinkOn };
      },
    };

    const tl = Timeline.from<AnimationState>({
      duration,
      initialState: {
        stepIndex: 0,
        phase: "point",
        phaseAlpha: 0,
        blinkOn: false,
      },
      clips: [{ clip: stepClip, start: 0, end: 1 }],
    });

    player = new Player(tl, { looping: true });
    player.onTick((_t, state) => draw(state));
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function draw(state: AnimationState): void {
    if (!ctx || points.length === 0) return;

    // --- Static background ---
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // --- Dynamic foreground ---
    const { stepIndex, phase, phaseAlpha, blinkOn } = state;
    const cur = points[stepIndex];
    const next = points[Math.min(stepIndex + 1, points.length - 1)];

    // Contour opacity envelope: ramps in during "contour", full during "blink"+"line",
    // fades out during "fade".
    let contourAlpha = 0;
    if (phase === "contour") contourAlpha = phaseAlpha;
    else if (phase === "blink" || phase === "line") contourAlpha = 1;
    else if (phase === "fade") contourAlpha = 1 - phaseAlpha;

    // Proposed point opacity: matches blink-on flag, then steady through line+fade.
    let proposalAlpha = 0;
    if (phase === "blink") proposalAlpha = blinkOn ? 1 : 0;
    else if (phase === "line") proposalAlpha = 1;
    else if (phase === "fade") proposalAlpha = 1 - phaseAlpha;

    // Connecting line opacity: grows during "line", fades during "fade".
    let lineAlpha = 0;
    if (phase === "line") lineAlpha = phaseAlpha;
    else if (phase === "fade") lineAlpha = 1 - phaseAlpha;

    if (contourAlpha > 0) {
      drawProposalContours(cur.x, cur.y, contourAlpha);
      drawLabel("p(x' | x)", cur.x, cur.y - proposalSigma * 3 - 14, contourAlpha);
    }

    if (lineAlpha > 0) {
      drawConnector(cur, next, lineAlpha);
    }

    // Current point — always visible.
    drawDot(cur.x, cur.y, pointColor, 1);
    drawLabel("x", cur.x, cur.y - pointRadius - 10, 1);

    // Proposed point.
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
    ctx.lineWidth = 1.5;
    const rgb = d3.color(proposalColor)?.rgb();
    const r = rgb?.r ?? 30;
    const g = rgb?.g ?? 64;
    const b = rgb?.b ?? 175;

    // Three concentric rings at 1σ, 2σ, 3σ with decreasing opacity.
    const sigmas = [1, 2, 3];
    const ringOpacities = [0.85, 0.55, 0.30];
    for (let i = 0; i < sigmas.length; i++) {
      ctx.globalAlpha = alpha * ringOpacities[i];
      ctx.strokeStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.beginPath();
      ctx.arc(x, y, proposalSigma * sigmas[i], 0, 2 * Math.PI);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawConnector(
    a: { x: number; y: number },
    b: { x: number; y: number },
    alpha: number,
  ): void {
    if (!ctx) return;
    // Trim the line so it starts and ends at the dot edges, not the centers.
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    const ux = dx / len;
    const uy = dy / len;
    const start = { x: a.x + ux * pointRadius, y: a.y + uy * pointRadius };
    const end = {
      x: a.x + ux * (pointRadius + (len - 2 * pointRadius) * alpha),
      y: a.y + uy * (pointRadius + (len - 2 * pointRadius) * alpha),
    };

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
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
    ctx.font = "italic 16px 'Computer Modern Serif', 'Times New Roman', serif";
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
        phase: "point",
        phaseAlpha: 0,
        blinkOn: false,
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

<Figure bind:isActive={figureIsActive} backgroundVisible={false}>
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
