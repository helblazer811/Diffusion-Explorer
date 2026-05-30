<!-- Sketch figure: viridis-colored S-curve scatter, then highlight one point and
     draw springs to its neighbors while energy decays on a side panel. -->

<script lang="ts">
  import { onDestroy } from "svelte";
  import type { Writable } from "svelte/store";
  import { interpolateViridis } from "d3-scale-chromatic";
  import {
    Figure,
    TimelineBuilder,
    Player,
    createPauseClip,
    drawText,
    useCanvas2D,
    useVisibilityHandler,
  } from "@diffusion-explorer/ui";
  import { solveSpringSystem1D } from "./spring_solver";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  export let width = 900;
  export let height = 600;            // top: scatter, bottom: flat energy strip + label space
  export let marginWidth = 60;
  export let marginHeight = 40;
  export let energyPanelHeight = 100; // height of the energy strip below the scatter
  export let energyPanelGap = 22;     // gap between scatter region and energy strip
  export let energyBottomLabelSpace = 50; // extra space under the strip for the x-axis label

  export let numPoints = 200;
  export let noiseSigma = 0.045;         // gaussian perturbation in normalized data units

  export let springCount = 3;            // springs from the highlighted point
  export let springNotches = 8;          // default zigzag count per spring
  export let springNotchesPerSpring: number[] | null = null;

  export let seed = 7;
  export let playingByDefault = true;
  export let backgroundVisible = false;

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  let canvas: HTMLCanvasElement | null = null;
  const canvas2d = useCanvas2D(width, height);
  $: ctx = canvas && canvas2d.ctx;

  let isInitialized = false;

  // Computed once in runInitialComputation
  type Sample = { x: number; y: number; t: number };
  let samples: Sample[] = [];
  let pointPixels: [number, number][] = [];        // original 2D pixel positions
  // SMACOF trajectory in pixel space. trajectoryPixels[k][i] = [x, y] of point i
  // at iteration k (k=0 is the initial state, last entry is the converged 1D
  // embedding). All entries share y = collapseY (the points lie on a line);
  // the scatter is drawn by interpolating between trajectoryPixels[0] and
  // trajectoryPixels[k] based on `state.compress`.
  let trajectoryPixels: [number, number][][] = [];
  let colors: string[] = [];
  let highlightIdx = 0;
  let springTargets: number[] = [];
  let stressTrace: number[] = [];                  // real SMACOF stress per iteration

  type AnimationState = {
    pointsAppear: number;
    dimAlpha: number;
    highlightRingAlpha: number;
    springsAppear: number;
    compress: number;                              // 0 = full 2D, 1 = collapsed 1D
    energyProgress: number;                        // 0 → 1 across the compression phase
  };

  const initialState: AnimationState = {
    pointsAppear: 0,
    dimAlpha: 1,
    highlightRingAlpha: 0,
    springsAppear: 0,
    compress: 0,
    energyProgress: 0,
  };

  let player: Player<AnimationState> | null = null;
  let figureIsActive: Writable<boolean> | undefined;
  const { handleVisibilityChange } = useVisibilityHandler(() => player);

  // Layout: scatter spans the full top region, energy strip below it,
  // axis-label space at the very bottom.
  $: scatterBottom = height - energyBottomLabelSpace - energyPanelHeight - energyPanelGap;
  $: energyTop = scatterBottom + energyPanelGap;
  $: energyBottom = energyTop + energyPanelHeight;
  $: scatterLeft = marginWidth;
  $: scatterRight = width - marginWidth;
  $: energyLeft = marginWidth + 50;       // inset for the (rotated, larger) y-axis label
  $: energyRight = width - marginWidth;
  // Y position the points collapse onto when fully compressed (1D line).
  $: collapseY = (marginHeight + scatterBottom) / 2;

  // Visual constants
  const pointRadius = 5.5;
  const dimTarget = 0.18;
  const highlightRingRadius = 12;
  const springColor = "#444";
  const springLineWidth = 1.6;
  const springAmplitude = 6.5;
  const springStraightLen = 8;
  const energyAxisColor = "#bbb";
  const energyLineColor = "#444";

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  // Seeded RNG (mulberry32). Deterministic across reloads.
  function mulberry32(s: number): () => number {
    let state = s | 0;
    return function () {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Box-Muller standard normal
  function randNormal(rng: () => number): number {
    const u1 = Math.max(rng(), 1e-9);
    const u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }

  function smoothstep(t: number): number {
    const x = Math.max(0, Math.min(1, t));
    return x * x * (3 - 2 * x);
  }

  // Analytic S-curve, t ∈ [0, 1] → (x, y) in approximately [-1, 1]^2.
  function sCurve(t: number): [number, number] {
    const x = lerp(-1, 1, t);
    const y = Math.sin(Math.PI * (2 * t - 1));
    return [x, y];
  }

  // Spring renderer: straight notch → zigzag → straight notch → connect.
  // `stretch ∈ [0, 1]` modulates the perpendicular amplitude (0 = straight line,
  // 1 = full zigzag). `notches` is the per-spring frequency and is constant
  // through the animation (changing it mid-animation would visibly snap).
  function drawSpring(
    ctx: CanvasRenderingContext2D,
    ax: number,
    ay: number,
    bx: number,
    by: number,
    notches: number,
    ampPx: number,
    straightLen: number,
    color: string,
    lineWidth = 1.6,
    alpha = 1,
  ) {
    if (alpha <= 0) return;
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(ax, ay);

    if (len <= 2 * straightLen + 4 || notches <= 0) {
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.restore();
      return;
    }

    const tx = dx / len;
    const ty = dy / len;
    // Right-handed normal (rotate tangent 90° CCW in screen-space).
    const nx = -ty;
    const ny = tx;

    const psx = ax + straightLen * tx;
    const psy = ay + straightLen * ty;
    const pex = bx - straightLen * tx;
    const pey = by - straightLen * ty;
    const midLen = len - 2 * straightLen;

    ctx.lineTo(psx, psy);

    // Notches are evenly spaced along the middle section. Stretch/compression
    // is implicit: as the endpoints move, midLen changes, so the notches
    // automatically spread apart or pack together. Amplitude is constant.
    const total = 2 * notches;
    for (let k = 0; k < total; k++) {
      const s = (k + 0.5) / total;
      const cx = psx + s * midLen * tx;
      const cy = psy + s * midLen * ty;
      const sign = k % 2 === 0 ? 1 : -1;
      ctx.lineTo(cx + sign * ampPx * nx, cy + sign * ampPx * ny);
    }

    ctx.lineTo(pex, pey);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.restore();
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function runInitialComputation() {
    const rng = mulberry32(seed);

    // 1. Sample points along the S with Gaussian perturbation.
    samples = [];
    for (let i = 0; i < numPoints; i++) {
      const t = rng();
      const [cx, cy] = sCurve(t);
      samples.push({
        x: cx + noiseSigma * randNormal(rng),
        y: cy + noiseSigma * randNormal(rng),
        t,
      });
    }

    // 2. Pixel scaling onto the scatter region (top of the canvas).
    const xDomain: [number, number] = [-1.3, 1.3];
    const yDomain: [number, number] = [-1.3, 1.3];
    const xScale = (x: number) =>
      marginWidth +
      ((x - xDomain[0]) / (xDomain[1] - xDomain[0])) * (width - 2 * marginWidth);
    const yScale = (y: number) =>
      scatterBottom -
      ((y - yDomain[0]) / (yDomain[1] - yDomain[0])) * (scatterBottom - marginHeight);

    pointPixels = samples.map((p) => [xScale(p.x), yScale(p.y)]);

    // 3. Per-point viridis color from arclength fraction.
    colors = samples.map((p) => interpolateViridis(p.t));

    // 4. Highlight: pick the sample closest to the middle of the S.
    let bestT = Infinity;
    for (let i = 0; i < samples.length; i++) {
      const d = Math.abs(samples[i].t - 0.5);
      if (d < bestT) {
        bestT = d;
        highlightIdx = i;
      }
    }

    // 5. Spring targets: pick FAR points (top 40% by distance from the
    //    highlight), then fan them out by angle so the springs don't bunch.
    const [hx, hy] = pointPixels[highlightIdx];
    const candidates: { idx: number; dist: number; angle: number }[] = [];
    for (let i = 0; i < pointPixels.length; i++) {
      if (i === highlightIdx) continue;
      const [px, py] = pointPixels[i];
      const dx = px - hx;
      const dy = py - hy;
      const dist = Math.hypot(dx, dy);
      candidates.push({ idx: i, dist, angle: Math.atan2(dy, dx) });
    }
    candidates.sort((a, b) => b.dist - a.dist); // farthest first
    const farPool = candidates.slice(
      0,
      Math.max(springCount, Math.floor(candidates.length * 0.4)),
    );
    farPool.sort((a, b) => a.angle - b.angle);
    springTargets = [];
    if (farPool.length > 0) {
      for (let i = 0; i < springCount; i++) {
        const idx = Math.floor((i * farPool.length) / springCount);
        springTargets.push(farPool[idx].idx);
      }
    }

    // 6. Run SMACOF on the original 2D pixel cloud to project to 1D.
    //    Capture the full per-iteration trajectory + stress trace so the
    //    animation can replay the optimization.
    const result = solveSpringSystem1D(
      pointPixels.map((p) => [p[0], p[1]] as [number, number]),
      {
        method: 'gradient',
        rng,
        maxIter: 600,
        tol: 1e-7,
        stepSize: 2.5,
      },
    );
    stressTrace = result.stressTrace;

    // Convert each iteration's 1D coordinates into pixel-space (x, y) pairs.
    // The 1D embedding x's come straight out of SMACOF (already in pixel
    // units since we fed it pixel-space points). Center and rescale to the
    // scatter region's full width so the line is visible end-to-end. y is
    // pinned to `collapseY` for every iteration EXCEPT iteration 0, which
    // we override to the original 2D positions so the animation has somewhere
    // to start (otherwise frame 0 would already look like a horizontal line).
    let minX = Infinity;
    let maxX = -Infinity;
    const lastIter = result.trajectory[result.trajectory.length - 1];
    for (const v of lastIter) {
      if (v < minX) minX = v;
      if (v > maxX) maxX = v;
    }
    const targetLeft = scatterLeft + 20;
    const targetRight = scatterRight - 20;
    const span = Math.max(maxX - minX, 1e-6);
    const remap = (v: number) =>
      targetLeft + ((v - minX) / span) * (targetRight - targetLeft);

    trajectoryPixels = result.trajectory.map((iter, k) =>
      iter.map<[number, number]>((v, i) => {
        if (k === 0) return [pointPixels[i][0], pointPixels[i][1]];
        return [remap(v), collapseY];
      }),
    );
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  function setupTimeline() {
    if (player) player.dispose?.();

    const builder = new TimelineBuilder<AnimationState>().setInitialState({
      ...initialState,
    });

    // Phase A: scatter fades in along the S.
    builder.add(
      {
        name: "PointsAppear",
        reduce(t) {
          return { pointsAppear: smoothstep(t) };
        },
      },
      { durationMs: 500 },
    );
    builder.add(createPauseClip(), { durationMs: 400 });

    // Phase B: dim everything except the highlighted point and reveal the ring.
    builder.add(
      [
        {
          name: "DimNonHighlight",
          reduce(t) {
            return { dimAlpha: lerp(1, dimTarget, smoothstep(t)) };
          },
        },
        {
          name: "RevealHighlightRing",
          reduce(t) {
            return { highlightRingAlpha: smoothstep(t) };
          },
        },
      ],
      { durationMs: 600 },
    );
    builder.add(createPauseClip(), { durationMs: 300 });

    // Phase C: springs fade in around the highlighted point.
    builder.add(
      {
        name: "SpringsAppear",
        reduce(t) {
          return { springsAppear: smoothstep(t) };
        },
      },
      { durationMs: 500 },
    );
    builder.add(createPauseClip(), { durationMs: 600 });

    // Phase D: compress all points to 1D via the spring-system solver.
    // The springs visibly stretch as endpoints move (notch count is fixed,
    // amplitude is fixed; their notch spacing changes with segment length).
    // The energy strip plots the real stress curve in lockstep.
    builder.add(
      [
        {
          name: "CompressTo1D",
          reduce(t) {
            return { compress: smoothstep(t) };
          },
        },
        {
          name: "DrawEnergy",
          reduce(t) {
            return { energyProgress: t };
          },
        },
      ],
      { durationMs: 2600 },
    );
    builder.add(createPauseClip(), { durationMs: 1500 });

    const timeline = builder.build();
    player = new Player(timeline, { looping: true });
    player.onTick((_t, state) => draw(state));
  }

  // ----------------------------------------------------------------
  // Compression helpers (used in drawing)
  // ----------------------------------------------------------------

  // Map state.compress ∈ [0, 1] to a fractional iteration index across
  // trajectoryPixels. compress=0 → iteration 0 (original 2D), compress=1 →
  // last iteration (converged 1D).
  function trajectoryFrame(compress: number): {
    lo: number;
    hi: number;
    frac: number;
  } {
    const T = trajectoryPixels.length;
    if (T <= 1) return { lo: 0, hi: 0, frac: 0 };
    const idx = compress * (T - 1);
    const lo = Math.floor(idx);
    const hi = Math.min(lo + 1, T - 1);
    const frac = idx - lo;
    return { lo, hi, frac };
  }

  // Current pixel position of point `i` given the compression state.
  function pointAt(i: number, compress: number): [number, number] {
    if (compress <= 0 || trajectoryPixels.length === 0) {
      return pointPixels[i];
    }
    const { lo, hi, frac } = trajectoryFrame(compress);
    const a = trajectoryPixels[lo][i];
    const b = trajectoryPixels[hi][i];
    return [a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac];
  }

  // Current stress value given the compression state (for the energy strip).
  function stressAt(compress: number): number {
    if (stressTrace.length === 0) return 0;
    const { lo, hi, frac } = trajectoryFrame(compress);
    return stressTrace[lo] + (stressTrace[hi] - stressTrace[lo]) * frac;
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function drawScatter(state: AnimationState) {
    if (!ctx) return;
    const appear = state.pointsAppear;
    if (appear <= 0) return;
    for (let i = 0; i < pointPixels.length; i++) {
      const [px, py] = pointAt(i, state.compress);
      const isHighlight = i === highlightIdx;
      const alpha = appear * (isHighlight ? 1 : state.dimAlpha);
      if (alpha <= 0.001) continue;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = colors[i];
      ctx.beginPath();
      ctx.arc(px, py, isHighlight ? pointRadius + 1.5 : pointRadius, 0, 2 * Math.PI);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawHighlightRing(state: AnimationState) {
    if (!ctx) return;
    if (state.highlightRingAlpha <= 0) return;
    const [hx, hy] = pointAt(highlightIdx, state.compress);
    ctx.save();
    ctx.globalAlpha = state.highlightRingAlpha;
    ctx.strokeStyle = colors[highlightIdx];
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(hx, hy, highlightRingRadius, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.restore();
  }

  function drawSprings(state: AnimationState) {
    if (!ctx) return;
    if (state.springsAppear <= 0 || springTargets.length === 0) return;
    const [hx, hy] = pointAt(highlightIdx, state.compress);
    for (let k = 0; k < springTargets.length; k++) {
      const tgt = springTargets[k];
      const [tx, ty] = pointAt(tgt, state.compress);
      const notches =
        (springNotchesPerSpring && springNotchesPerSpring[k]) || springNotches;
      drawSpring(
        ctx,
        hx,
        hy,
        tx,
        ty,
        notches,
        springAmplitude,
        springStraightLen,
        springColor,
        springLineWidth,
        state.springsAppear,
      );
    }
  }

  function drawEnergyPanel(state: AnimationState) {
    if (!ctx) return;
    if (state.springsAppear <= 0) return;
    if (stressTrace.length === 0) return;

    // Wide flat strip below the scatter region.
    const x0 = energyLeft;
    const x1 = energyRight;
    const y0 = energyTop;
    const y1 = energyBottom;
    const panelAlpha = state.springsAppear;

    // Faint axes (L-shape).
    ctx.save();
    ctx.globalAlpha = panelAlpha;
    ctx.strokeStyle = energyAxisColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0, y1);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.restore();

    // Axis labels.
    drawText(ctx, "Iteration", (x0 + x1) / 2, y1 + 22, {
      font: "500 24px Helvetica, Arial, sans-serif",
      color: "#888",
      opacity: panelAlpha,
      align: "center",
      baseline: "top",
    });

    ctx.save();
    ctx.globalAlpha = panelAlpha;
    ctx.translate(x0 - 28, (y0 + y1) / 2);
    ctx.rotate(-Math.PI / 2);
    drawText(ctx, "Stress", 0, 0, {
      font: "500 24px Helvetica, Arial, sans-serif",
      color: "#888",
      opacity: 1,
      align: "center",
      baseline: "middle",
    });
    ctx.restore();

    // Plot the SMACOF stress curve. The full trace is fixed (same length as
    // the SMACOF trajectory); we draw only up to the iteration corresponding
    // to the current compression progress.
    const N = stressTrace.length;
    const eMax = Math.max(...stressTrace);
    const eMin = 0;
    const denom = Math.max(eMax - eMin, 1e-9);
    const xAt = (i: number) => x0 + (i / Math.max(N - 1, 1)) * (x1 - x0);
    const yAt = (v: number) => y1 - ((v - eMin) / denom) * (y1 - y0);

    // During Phase C (springs breathing, energyProgress=0), draw nothing yet.
    // During Phase D, draw up to the current iteration.
    const upTo = Math.max(
      2,
      Math.min(N, Math.floor(state.energyProgress * (N - 1)) + 1),
    );

    ctx.save();
    ctx.globalAlpha = panelAlpha;
    ctx.strokeStyle = energyLineColor;
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(xAt(0), yAt(stressTrace[0]));
    for (let i = 1; i < upTo; i++) {
      ctx.lineTo(xAt(i), yAt(stressTrace[i]));
    }
    ctx.stroke();

    // Marker dot at the current iteration (visible only after compression
    // starts).
    if (state.energyProgress > 0) {
      const cur = stressAt(state.compress);
      const idx = state.compress * (N - 1);
      ctx.fillStyle = energyLineColor;
      ctx.globalAlpha = panelAlpha;
      ctx.beginPath();
      ctx.arc(xAt(idx), yAt(cur), 6, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.restore();
  }

  function draw(state: AnimationState) {
    if (!ctx || !isInitialized) return;
    ctx.clearRect(0, 0, width, height);

    drawScatter(state);
    drawHighlightRing(state);
    drawSprings(state);
    drawEnergyPanel(state);
  }

  // ----------------------------------------------------------------
  // Event Handlers
  // ----------------------------------------------------------------
  // (no canvas interaction)

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  onDestroy(() => {
    if (player) player.pause();
  });

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  $: if (canvas && ctx && !isInitialized) {
    runInitialComputation();
    isInitialized = true;
    setupTimeline();
    draw(player?.state ?? initialState);
    if (playingByDefault) player?.play();
  }

  $: if (figureIsActive !== undefined && isInitialized) {
    handleVisibilityChange($figureIsActive === true);
  }
</script>

<div class="scs-wrap" style="max-width:{width}px;">
  <h2 class="scs-title">Dimensionality Reduction as Solving a Spring System</h2>
  <Figure bind:isActive={figureIsActive} {backgroundVisible} {player} devMode={true}>
    {#snippet children()}
      <div style="width:100%;max-width:{width}px;">
        <canvas
          bind:this={canvas}
          use:canvas2d.bindCanvas
          style="width:100%;height:auto;aspect-ratio:{width}/{height};"
        ></canvas>
      </div>
    {/snippet}
  </Figure>
</div>

<style>
  .scs-wrap {
    margin: 2rem auto 0;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .scs-title {
    text-align: center;
    font-size: 1.6rem;
    font-weight: 500;
    color: #777;
    margin: 0 0 0.4rem 0;
    line-height: 1.25;
  }
</style>
