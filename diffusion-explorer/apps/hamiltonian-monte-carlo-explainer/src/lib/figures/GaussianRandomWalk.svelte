<script lang="ts">
  import { onDestroy } from "svelte";
  import type { Writable } from "svelte/store";
  import {
    Figure,
    Player,
    Timeline,
    useCanvas2D,
    useVisibilityHandler,
  } from "@diffusion-explorer/ui";
  import { mulberry32, boxMuller } from "$lib/hmc/random";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  interface Props {
    canvasWidth?: number;
    canvasHeight?: number;
    numSteps?: number;
    stepsPerSecond?: number;
    proposalSigma?: number;
    circleRadius?: number;
    pointRadius?: number;
    trailDotRadius?: number;
    trailAlpha?: number;
    connectorAlpha?: number;
    pointColor?: string;
    circleColor?: string;
    trailColor?: string;
    fadeOutDuration?: number;
    seed?: number;
  }

  let {
    canvasWidth = 1440,
    canvasHeight = 360,
    numSteps = 400,
    stepsPerSecond = 18,
    proposalSigma = 14,
    circleRadius = 150,
    pointRadius = 6,
    trailDotRadius = 2.2,
    trailAlpha = 0.18,
    connectorAlpha = 0.12,
    pointColor = "#1e40af",
    circleColor = "#111111",
    trailColor = "#1e40af",
    fadeOutDuration = 0.6,
    seed = 11,
  }: Props = $props();

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  let canvas: HTMLCanvasElement | null = $state(null);
  const canvas2d = useCanvas2D(canvasWidth, canvasHeight);
  let ctx = $derived(canvas && canvas2d.ctx);

  const cx = canvasWidth / 2;
  const cy = canvasHeight / 2;

  // Walk positions in pixel space, fully precomputed.
  let chain: { x: number; y: number }[] = [];

  type AnimationState = { stepIndex: number; loopAlpha: number };

  let player: Player<AnimationState> | null = null;
  let isInitialized = $state(false);

  let figureIsActive: Writable<boolean> | undefined = $state(undefined);
  const { handleVisibilityChange } = useVisibilityHandler(() => player);

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function runInitialComputation(): void {
    const rng = mulberry32(seed);
    chain = new Array(numSteps);
    chain[0] = { x: cx, y: cy };

    for (let i = 1; i < numSteps; i++) {
      const prev = chain[i - 1];

      // Reject-and-resample Gaussian proposal until it lands inside the circle.
      // Capped so a pathological seed can't loop forever; falls back to clamp.
      let nx = prev.x;
      let ny = prev.y;
      let attempts = 0;
      while (attempts < 32) {
        const [z1, z2] = boxMuller(rng);
        nx = prev.x + proposalSigma * z1;
        ny = prev.y + proposalSigma * z2;
        const dx = nx - cx;
        const dy = ny - cy;
        if (dx * dx + dy * dy <= circleRadius * circleRadius) break;
        attempts++;
      }
      if (attempts === 32) {
        const dx = nx - cx;
        const dy = ny - cy;
        const len = Math.hypot(dx, dy) || 1;
        const r = circleRadius * 0.95;
        nx = cx + (dx / len) * r;
        ny = cy + (dy / len) * r;
      }

      chain[i] = { x: nx, y: ny };
    }
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  function setupTimeline(): void {
    const walkDuration = numSteps / stepsPerSecond;
    const duration = walkDuration + fadeOutDuration;

    const walkClip = {
      name: "GaussianRandomWalk",
      reduce(t: number): AnimationState {
        const tt = t * duration;
        if (tt <= walkDuration) {
          const stepIndex = Math.min(
            numSteps - 1,
            Math.floor(tt * stepsPerSecond),
          );
          return { stepIndex, loopAlpha: 1 };
        }
        const fadeT = (tt - walkDuration) / fadeOutDuration;
        return {
          stepIndex: numSteps - 1,
          loopAlpha: Math.max(0, 1 - fadeT),
        };
      },
    };

    const tl = Timeline.from<AnimationState>({
      duration,
      initialState: { stepIndex: 0, loopAlpha: 1 },
      clips: [{ clip: walkClip, start: 0, end: 1 }],
    });

    player = new Player(tl, { looping: true });
    player.onTick((_t, state) => draw(state));
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function draw(state: AnimationState): void {
    if (!ctx || chain.length === 0) return;

    // --- Static background ---
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    drawCircleOutline(state.loopAlpha);

    // --- Dynamic foreground ---
    const { stepIndex, loopAlpha } = state;

    // Connectors (drawn first so dots sit on top).
    ctx.save();
    ctx.strokeStyle = trailColor;
    ctx.lineWidth = 1;
    ctx.lineCap = "round";
    ctx.globalAlpha = connectorAlpha * loopAlpha;
    ctx.beginPath();
    for (let i = 1; i <= stepIndex; i++) {
      const a = chain[i - 1];
      const b = chain[i];
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    ctx.restore();

    // Accumulated trail dots.
    ctx.save();
    ctx.fillStyle = trailColor;
    ctx.globalAlpha = trailAlpha * loopAlpha;
    for (let i = 0; i < stepIndex; i++) {
      const p = chain[i];
      ctx.beginPath();
      ctx.arc(p.x, p.y, trailDotRadius, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.restore();

    // Current walker.
    const cur = chain[stepIndex];
    ctx.save();
    ctx.globalAlpha = loopAlpha;
    ctx.fillStyle = pointColor;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cur.x, cur.y, pointRadius, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawCircleOutline(loopAlpha: number): void {
    if (!ctx) return;
    ctx.save();
    ctx.globalAlpha = 0.18 * loopAlpha;
    ctx.strokeStyle = circleColor;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.arc(cx, cy, circleRadius, 0, 2 * Math.PI);
    ctx.stroke();
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
      draw({ stepIndex: 0, loopAlpha: 1 });
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
      class="gaussian-random-walk-canvas"
    ></canvas>
  </div>
</Figure>

<style>
  .canvas-wrapper {
    width: 100%;
    margin: 0 auto;
    box-sizing: border-box;
  }

  .gaussian-random-walk-canvas {
    width: 100%;
    height: auto;
    display: block;
    background: transparent;
  }
</style>
