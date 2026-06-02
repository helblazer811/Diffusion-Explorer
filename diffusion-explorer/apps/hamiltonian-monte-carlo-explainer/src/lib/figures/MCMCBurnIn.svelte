<script lang="ts">
  import { onDestroy, type Snippet } from "svelte";
  import type { Writable } from "svelte/store";
  import {
    Figure,
    Player,
    Timeline,
    useCanvas2D,
    useVisibilityHandler,
  } from "@diffusion-explorer/ui";
  import * as d3 from "d3";
  import { mulberry32 } from "$lib/hmc/random";
  import type { Vec2 } from "$lib/hmc/random";
  import { computeRectKDE } from "$lib/hmc/kde";
  import { sampleGMMBatch, GMM_STD } from "$lib/hmc/gmm";
  import { gmmLogProb, runMetropolisHastings, type MHStep } from "$lib/hmc/mcmc";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  interface Props {
    canvasWidth?: number;
    canvasHeight?: number;
    domainRange?: { xMin: number; xMax: number; yMin: number; yMax: number };
    heatmapResolution?: number;
    heatmapBandwidth?: number;
    heatmapDimAlpha?: number;
    numSteps?: number;
    stepsPerSecond?: number;
    proposalStd?: number;
    /**
     * Burn-in is the first iteration at which the chain enters the
     * `burnInRadiusSigmas`-σ ball around the target's mode (in data units).
     * Defaults to 3σ.
     */
    burnInRadiusSigmas?: number;
    /** Where the chain starts, in data coords — far from the mode. */
    startPos?: Vec2;
    pointRadius?: number;
    trailDotRadius?: number;
    connectorLineWidth?: number;
    trailAlpha?: number;
    connectorAlpha?: number;
    pointColor?: string;
    fadeOutDuration?: number;
    seed?: number;
    caption?: Snippet;
  }

  let {
    canvasWidth = 720,
    canvasHeight = 260,
    domainRange = { xMin: -2.5, xMax: 2.5, yMin: -0.9, yMax: 0.9 },
    heatmapResolution = 480,
    heatmapBandwidth = 10,
    heatmapDimAlpha = 0.5,
    numSteps = 300,
    stepsPerSecond = 22,
    proposalStd = 0.08,
    burnInRadiusSigmas = 3,
    startPos = [-2.1, 0.0],
    pointRadius = 5,
    trailDotRadius = 4,
    connectorLineWidth = 2,
    trailAlpha = 0.55,
    connectorAlpha = 0.4,
    pointColor = "#f97316",
    fadeOutDuration = 0.6,
    seed = 7,
    caption,
  }: Props = $props();

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  let canvas: HTMLCanvasElement | null = $state(null);
  const canvas2d = useCanvas2D(canvasWidth, canvasHeight);
  let ctx = $derived(canvas && canvas2d.ctx);

  // Single Gaussian centered at the origin — the stationary distribution.
  const TARGET_MEANS: Vec2[] = [[0.0, 0.0]];
  const TARGET_WEIGHTS: number[] = [1.0];

  type Chain = { x: number; y: number }[];
  let chain: Chain = [];

  let heatmapCanvas: HTMLCanvasElement | null = null;

  type AnimationState = {
    stepIndex: number;
    loopAlpha: number;
    progress: number;
    /** 0 = bracket not yet drawn, 1 = full |---| bracket. */
    bracketProgress: number;
  };

  /** Seconds it takes to sweep the bracket from left tick to right tick. */
  const BRACKET_REVEAL_SECONDS = 0.6;

  let player: Player<AnimationState> | null = null;
  let isInitialized = $state(false);

  // Reactive copies of the latest animation state — drive the timeline
  // marker and burn-in bracket below the canvas.
  let progress: number = $state(0);
  let bracketProgress: number = $state(0);

  // First iteration at which the chain entered the 3σ ball around the mode.
  // Computed once from the precomputed chain. Drives the bracket position.
  let burnInEndIndex: number = $state(0);

  let figureIsActive: Writable<boolean> | undefined = $state(undefined);
  const { handleVisibilityChange } = useVisibilityHandler(() => player);

  // Timeline / annotation layout (in pixels, beneath the canvas).
  const TIMELINE_HEIGHT = 96;
  const TIMELINE_PAD_X = 12;
  const TIMELINE_BAR_Y = 50;
  const TIMELINE_BAR_HEIGHT = 8;
  const BRACKET_Y = 28;
  const BRACKET_TICK_HEIGHT = 8;
  const AXIS_LABEL_Y = 82;

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  function dataToPixelX(x: number): number {
    const { xMin, xMax } = domainRange;
    return ((x - xMin) / (xMax - xMin)) * canvasWidth;
  }

  function dataToPixelY(y: number): number {
    const { yMin, yMax } = domainRange;
    return canvasHeight - ((y - yMin) / (yMax - yMin)) * canvasHeight;
  }

  function chainFromMHSteps(steps: MHStep[]): Chain {
    const out: Chain = new Array(steps.length + 1);
    out[0] = {
      x: dataToPixelX(steps[0].from[0]),
      y: dataToPixelY(steps[0].from[1]),
    };
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const next: Vec2 = s.accepted ? s.proposal : s.from;
      out[i + 1] = { x: dataToPixelX(next[0]), y: dataToPixelY(next[1]) };
    }
    return out;
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function runInitialComputation(): void {
    const rng = mulberry32(seed);
    heatmapCanvas = buildHeatmapCanvas(rng);

    const logProb = (x: Vec2) =>
      gmmLogProb(x, TARGET_MEANS, TARGET_WEIGHTS, GMM_STD);

    const steps = runMetropolisHastings({
      start: [startPos[0], startPos[1]],
      numSteps,
      proposalStd,
      logProb,
      rng: mulberry32(seed + 1),
      bounds: domainRange,
    });
    chain = chainFromMHSteps(steps);

    // Find first iteration where the chain has entered the 3σ ball around
    // the (single) target mode. The chain index after step s is s+1; the
    // pre-step starting point sits at index 0.
    const [mx, my] = TARGET_MEANS[0];
    const radius = burnInRadiusSigmas * GMM_STD;
    const radiusSq = radius * radius;
    const startDx = startPos[0] - mx;
    const startDy = startPos[1] - my;
    let endIdx = numSteps; // fall back to "never converged" — bracket spans full track
    if (startDx * startDx + startDy * startDy <= radiusSq) {
      endIdx = 0;
    } else {
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        const pos: Vec2 = s.accepted ? s.proposal : s.from;
        const dx = pos[0] - mx;
        const dy = pos[1] - my;
        if (dx * dx + dy * dy <= radiusSq) {
          endIdx = i + 1;
          break;
        }
      }
    }
    burnInEndIndex = endIdx;
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  function setupTimeline(): void {
    const walkDuration = numSteps / stepsPerSecond;
    const duration = walkDuration + fadeOutDuration;

    const walkClip = {
      name: "MCMCBurnIn",
      reduce(t: number): Partial<AnimationState> {
        const tt = t * duration;
        if (tt <= walkDuration) {
          const stepIndex = Math.min(
            numSteps - 1,
            Math.floor(tt * stepsPerSecond),
          );
          return {
            stepIndex,
            loopAlpha: 1,
            progress: tt / walkDuration,
          };
        }
        const fadeT = (tt - walkDuration) / fadeOutDuration;
        return {
          stepIndex: numSteps - 1,
          loopAlpha: Math.max(0, 1 - fadeT),
          progress: 1,
        };
      },
    };

    // Bracket reveal: a separate clip that runs for BRACKET_REVEAL_SECONDS
    // starting at the moment the chain crosses the 3σ threshold. Drives
    // `bracketProgress` from 0 → 1 so the bracket sweeps in left-to-right.
    const burnInTimeSeconds = burnInEndIndex / stepsPerSecond;
    const revealStartSeconds = Math.min(burnInTimeSeconds, walkDuration);
    const revealEndSeconds = Math.min(
      revealStartSeconds + BRACKET_REVEAL_SECONDS,
      walkDuration,
    );
    const revealStartFrac = revealStartSeconds / duration;
    const revealEndFrac = revealEndSeconds / duration;
    const bracketRevealClip = {
      name: "BracketReveal",
      reduce(t: number): Partial<AnimationState> {
        return { bracketProgress: t };
      },
    };

    const clips = [{ clip: walkClip, start: 0, end: 1 }];
    if (revealEndFrac > revealStartFrac) {
      clips.push({
        clip: bracketRevealClip,
        start: revealStartFrac,
        end: revealEndFrac,
      });
    }

    const tl = Timeline.from<AnimationState>({
      duration,
      initialState: {
        stepIndex: 0,
        loopAlpha: 1,
        progress: 0,
        bracketProgress: 0,
      },
      clips,
    });

    player = new Player(tl, { looping: true });
    player.onTick((_t, state) => {
      progress = state.progress;
      bracketProgress = state.bracketProgress;
      draw(state);
    });
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function drawChain(
    chain: Chain,
    color: string,
    stepIndex: number,
    loopAlpha: number,
  ): void {
    if (!ctx || chain.length === 0) return;

    // Connectors.
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = connectorLineWidth;
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

    // Trail dots.
    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = trailAlpha * loopAlpha;
    for (let i = 0; i < stepIndex; i++) {
      const p = chain[i];
      ctx.beginPath();
      ctx.arc(p.x, p.y, trailDotRadius, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.restore();

    // Current walker.
    const cur = chain[Math.min(stepIndex, chain.length - 1)];
    ctx.save();
    ctx.globalAlpha = loopAlpha;
    ctx.fillStyle = color;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cur.x, cur.y, pointRadius, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function draw(state: AnimationState): void {
    if (!ctx) return;

    // --- Static background: target heatmap, dimmed ---
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    if (heatmapCanvas) {
      ctx.drawImage(heatmapCanvas, 0, 0, canvasWidth, canvasHeight);
    }
    ctx.save();
    ctx.fillStyle = `rgba(255, 255, 255, ${heatmapDimAlpha})`;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.restore();

    // --- Dynamic foreground ---
    drawChain(chain, pointColor, state.stepIndex, state.loopAlpha);
  }

  /**
   * Render a single isotropic Gaussian centered at the origin into an
   * offscreen canvas. Same pipeline as the GMM heatmaps elsewhere — KDE on
   * sampled points so the visual style matches the rest of the explainer.
   */
  function buildHeatmapCanvas(rng: () => number): HTMLCanvasElement {
    const { xMin, xMax, yMin, yMax } = domainRange;
    const gridW = heatmapResolution;
    const gridH = Math.round(gridW * (canvasHeight / canvasWidth));

    const samples = sampleGMMBatch(
      rng,
      60000,
      TARGET_MEANS,
      TARGET_WEIGHTS,
      GMM_STD,
    );
    const density = computeRectKDE(
      samples,
      [xMin, xMax, yMin, yMax],
      gridW,
      gridH,
      heatmapBandwidth,
    );
    const blurred = gaussianBlur2D(density, gridW, gridH, 3);

    let max = 0;
    for (let i = 0; i < blurred.length; i++) if (blurred[i] > max) max = blurred[i];
    const invMax = max > 0 ? 1 / max : 0;

    const offscreen = document.createElement("canvas");
    offscreen.width = gridW;
    offscreen.height = gridH;
    const offCtx = offscreen.getContext("2d")!;
    const img = offCtx.createImageData(gridW, gridH);

    const floor = 0.18;
    for (let gy = 0; gy < gridH; gy++) {
      for (let gx = 0; gx < gridW; gx++) {
        const v = blurred[gy * gridW + gx] * invMax;
        const vClipped = Math.max(0, (v - floor) / (1 - floor));
        const t = Math.pow(vClipped, 0.85);
        const c = d3.color(d3.interpolateBlues(0.15 + 0.85 * t))?.rgb() ?? d3.rgb(255, 255, 255);
        const idx = ((gridH - 1 - gy) * gridW + gx) * 4;
        img.data[idx] = c.r;
        img.data[idx + 1] = c.g;
        img.data[idx + 2] = c.b;
        img.data[idx + 3] = Math.round(255 * Math.min(1, t * 1.4));
      }
    }
    offCtx.putImageData(img, 0, 0);
    return offscreen;
  }

  // Separable Gaussian blur on a flat row-major grid.
  function gaussianBlur2D(
    src: Float32Array | number[],
    w: number,
    h: number,
    sigma: number,
  ): Float32Array {
    const r = Math.max(1, Math.ceil(3 * sigma));
    const kernel = new Float32Array(2 * r + 1);
    const inv2s2 = 1 / (2 * sigma * sigma);
    let ksum = 0;
    for (let i = -r; i <= r; i++) {
      const v = Math.exp(-i * i * inv2s2);
      kernel[i + r] = v;
      ksum += v;
    }
    for (let i = 0; i < kernel.length; i++) kernel[i] /= ksum;

    const tmp = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let k = -r; k <= r; k++) {
          const xx = Math.min(w - 1, Math.max(0, x + k));
          acc += src[row + xx] * kernel[k + r];
        }
        tmp[row + x] = acc;
      }
    }
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let k = -r; k <= r; k++) {
          const yy = Math.min(h - 1, Math.max(0, y + k));
          acc += tmp[yy * w + x] * kernel[k + r];
        }
        out[y * w + x] = acc;
      }
    }
    return out;
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
      draw({ stepIndex: 0, loopAlpha: 1, progress: 0, bracketProgress: 0 });
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

  // Derived geometry for the SVG timeline + bracket.
  let trackX0 = $derived(TIMELINE_PAD_X);
  let trackX1 = $derived(canvasWidth - TIMELINE_PAD_X);
  let trackWidth = $derived(trackX1 - trackX0);
  let burnInFraction = $derived(
    numSteps > 0 ? Math.min(1, burnInEndIndex / numSteps) : 0,
  );
  let burnInX1 = $derived(trackX0 + trackWidth * burnInFraction);
  let markerX = $derived(trackX0 + trackWidth * progress);
  let bracketCenterX = $derived((trackX0 + burnInX1) / 2);
  // Bracket reveal animation. Three sub-phases of bracketProgress p ∈ [0, 1]:
  //   p == 0   : nothing drawn
  //   p > 0    : left tick visible, horizontal line growing right
  //   p ≥ 0.85 : right tick + label fade in
  let bracketActive = $derived(bracketProgress > 0 && burnInFraction > 0);
  let bracketLineEndX = $derived(
    trackX0 + (burnInX1 - trackX0) * Math.min(1, bracketProgress),
  );
  let bracketRightAlpha = $derived(
    Math.max(0, Math.min(1, (bracketProgress - 0.85) / 0.15)),
  );
</script>

<Figure bind:isActive={figureIsActive} backgroundVisible={false} {caption}>
  <div class="figure-content" style="max-width: {canvasWidth}px;">
    <canvas
      bind:this={canvas}
      use:canvas2d.bindCanvas
      class="mcmc-burn-in-canvas"
    ></canvas>
    <svg
      class="mcmc-burn-in-timeline"
      viewBox="0 0 {canvasWidth} {TIMELINE_HEIGHT}"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <!-- Burn-in bracket: |-----| spanning [trackX0, burnInX1].
           Sweeps in left → right once the chain crosses the 3σ threshold. -->
      {#if bracketActive}
        <g>
          <!-- Left tick: appears immediately at the start of the reveal -->
          <line
            x1={trackX0}
            y1={BRACKET_Y - BRACKET_TICK_HEIGHT / 2}
            x2={trackX0}
            y2={BRACKET_Y + BRACKET_TICK_HEIGHT / 2}
            stroke="#374151"
            stroke-width="1.5"
          />
          <!-- Horizontal line: grows from the left tick toward burnInX1 -->
          <line
            x1={trackX0}
            y1={BRACKET_Y}
            x2={bracketLineEndX}
            y2={BRACKET_Y}
            stroke="#374151"
            stroke-width="1.5"
          />
          <!-- Right tick + label: fade in once the line reaches the right edge -->
          <line
            x1={burnInX1}
            y1={BRACKET_Y - BRACKET_TICK_HEIGHT / 2}
            x2={burnInX1}
            y2={BRACKET_Y + BRACKET_TICK_HEIGHT / 2}
            stroke="#374151"
            stroke-width="1.5"
            opacity={bracketRightAlpha}
          />
          <text
            x={bracketCenterX}
            y={BRACKET_Y - 8}
            text-anchor="middle"
            font-size="17"
            font-family="ui-sans-serif, system-ui, sans-serif"
            fill="#374151"
            opacity={bracketRightAlpha}
          >
            Burn In
          </text>
        </g>
      {/if}

      <!-- Timeline track -->
      <rect
        x={trackX0}
        y={TIMELINE_BAR_Y}
        width={trackWidth}
        height={TIMELINE_BAR_HEIGHT}
        rx={TIMELINE_BAR_HEIGHT / 2}
        ry={TIMELINE_BAR_HEIGHT / 2}
        fill="#e5e7eb"
      />
      <!-- Filled portion up to current progress -->
      <rect
        x={trackX0}
        y={TIMELINE_BAR_Y}
        width={Math.max(0, markerX - trackX0)}
        height={TIMELINE_BAR_HEIGHT}
        rx={TIMELINE_BAR_HEIGHT / 2}
        ry={TIMELINE_BAR_HEIGHT / 2}
        fill={pointColor}
        opacity="0.85"
      />
      <!-- Playhead -->
      <circle
        cx={markerX}
        cy={TIMELINE_BAR_Y + TIMELINE_BAR_HEIGHT / 2}
        r={7}
        fill={pointColor}
        stroke="#ffffff"
        stroke-width="1.5"
      />

      <!-- Axis label -->
      <text
        x={(trackX0 + trackX1) / 2}
        y={AXIS_LABEL_Y}
        text-anchor="middle"
        font-size="17"
        font-family="ui-sans-serif, system-ui, sans-serif"
        fill="#374151"
      >
        Iterations
      </text>
    </svg>
  </div>
</Figure>

<style>
  .figure-content {
    width: 100%;
    margin: 0 auto;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .mcmc-burn-in-canvas {
    width: 100%;
    height: auto;
    display: block;
    background: transparent;
  }

  .mcmc-burn-in-timeline {
    width: 100%;
    height: auto;
    display: block;
    margin-top: 4px;
    pointer-events: none;
  }
</style>
