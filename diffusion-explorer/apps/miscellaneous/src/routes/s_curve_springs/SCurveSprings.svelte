<!-- Sketch figure: dimensionality reduction as solving a spring system.
     The `dataset` prop selects what's rolled up:
       'crumpled-patch' — a 2D lattice deformed into a wrinkled blob; the
                          springs un-crumple toward an intrinsic 2D layout.
       'spiral'         — a 1D Archimedean curve rolled up in 2D; the
                          springs unroll it into a straight line.
     In both cases the cloud highlights a point, shows springs to its
     neighbors, and plots the spring-system stress as it relaxes. -->

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
  import { solveSpringSystem1D, solveSpringSystem2D } from "./spring_solver";

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

  // Which dataset is rolled up underneath the spring system.
  //   'crumpled-patch' — 2D lattice → un-crumpled 2D layout
  //   'spiral'         — 1D Archimedean curve → unrolled 1D line
  export let dataset: 'crumpled-patch' | 'spiral' = 'crumpled-patch';

  export let numPoints = 400;
  // Noise magnitude in normalized data units. For 'crumpled-patch' this is
  // 2D Gaussian perturbation; for 'spiral' it's perpendicular-to-curve only.
  export let noiseSigma = 0.045;

  // Spiral-only knobs.
  export let spiralTurns = 2.5;          // number of turns of the Archimedean spiral
  export let spiralInnerRadius = 0.08;   // r at s=0
  export let spiralOuterRadius = 1.15;   // r at s=1

  export let springCount = 3;            // springs from the highlighted point
  export let springNotches = 16;         // default zigzag count per spring
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

  // Computed once in runInitialComputation. The intrinsic-coord field set
  // depends on `dataset`:
  //   'crumpled-patch' → (u, v) ∈ [-1, 1]² (2D intrinsic). Pairwise (u, v)
  //                      Euclidean distances are the spring rest lengths.
  //   'spiral'         → s ∈ [0, 1] (1D arclength fraction). Pairwise |s_i − s_j|
  //                      are the spring rest lengths — springs unroll the curve.
  // x, y is always the displayed 2D position (with noise), and t ∈ [0, 1]
  // is the per-point parameterization used for viridis color.
  type Sample = {
    x: number;
    y: number;
    t: number;
    u?: number;
    v?: number;
    s?: number;
  };
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
  // Per-spring notch counts. Derived from each spring's rest length so that
  // notch spacing (rest length / notch count) is constant across springs;
  // at rest every spring then has the same spatial frequency.
  let springNotchCounts: number[] = [];
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

  // 2D-patch dataset: each point has intrinsic (u, v) ∈ [-1, 1]² on a
  // flat patch. The patch is crumpled by a smooth radius-dependent
  // rotation so that pairwise (u, v) distances no longer match the
  // displayed (x, y) distances. With `crumpleStrength = 0` it's the
  // identity. The springs (rest length = (u, v) distance) then pull the
  // crumpled cloud back toward an un-crumpled lattice.
  const crumpleStrength = 0.9;
  const crumpleFreq = 1.6;
  function crumple(u: number, v: number): [number, number] {
    const r = Math.hypot(u, v);
    const theta = crumpleStrength * Math.sin(crumpleFreq * Math.PI * r);
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    return [c * u - s * v, s * u + c * v];
  }

  // 1D-curve dataset: every point has an intrinsic 1D coordinate
  // s ∈ [0, 1] (fractional arclength along the spiral). The spiral is an
  // Archimedean curve r(θ) = a + b·θ rolled up in 2D. Spring rest lengths
  // are |s_i − s_j| · pxSpan, so the springs are trying to UNROLL the
  // spiral into a straight 1D line — a task that's actually achievable
  // (the intrinsic geometry is genuinely 1D), so the final stress
  // approaches zero rather than plateauing.
  //
  // Sampling is uniform in arclength (not in θ), so points are evenly
  // spaced along the curve regardless of how tight the inner turns are.
  // For an Archimedean spiral, arclength as a function of θ is
  //   L(θ) = (1/2) · b · [θ·√(1+θ²) + asinh(θ)]   (with a=0)
  // We use a numerical inversion (precomputed lookup) so we don't need
  // to solve transcendentals at sample time.
  function buildSpiralArcInverter(
    a: number,
    b: number,
    thetaMax: number,
    samples: number,
  ): (sFrac: number) => number {
    // Tabulate (θ, arclength) pairs by trapezoidal integration of
    // ds/dθ = √(r² + (dr/dθ)²) = √((a + b·θ)² + b²).
    const thetas = new Float64Array(samples + 1);
    const arcs = new Float64Array(samples + 1);
    let acc = 0;
    thetas[0] = 0;
    arcs[0] = 0;
    let prevDs = Math.hypot(a, b);
    for (let i = 1; i <= samples; i++) {
      const th = (i / samples) * thetaMax;
      const r = a + b * th;
      const ds = Math.hypot(r, b);
      acc += 0.5 * (prevDs + ds) * (thetaMax / samples);
      thetas[i] = th;
      arcs[i] = acc;
      prevDs = ds;
    }
    const total = arcs[samples] || 1;
    // Returns the θ corresponding to the given fractional arclength.
    return (sFrac: number) => {
      const target = sFrac * total;
      // Binary search arcs[] for `target`.
      let lo = 0;
      let hi = samples;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (arcs[mid] < target) lo = mid + 1;
        else hi = mid;
      }
      if (lo === 0) return thetas[0];
      const a0 = arcs[lo - 1];
      const a1 = arcs[lo];
      const t = a1 > a0 ? (target - a0) / (a1 - a0) : 0;
      return thetas[lo - 1] + t * (thetas[lo] - thetas[lo - 1]);
    };
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

    // ---- 1. Sample generation (dataset-specific) -----------------------
    samples = [];
    let dataDomain: [number, number];
    if (dataset === 'spiral') {
      // Sample uniformly in arclength along an Archimedean spiral
      //   r(θ) = innerR + b·θ
      // and add Gaussian noise PERPENDICULAR to the curve (so the noise
      // reads as thickness rather than radial wobble). Each sample stores
      // its intrinsic 1D coord s ∈ [0, 1] and the displayed (x, y).
      const thetaMax = spiralTurns * 2 * Math.PI;
      const a = spiralInnerRadius;
      const b = (spiralOuterRadius - spiralInnerRadius) / thetaMax;
      const arcInv = buildSpiralArcInverter(a, b, thetaMax, 4096);
      // Spiral-perpendicular noise reads as line thickness; reuse a
      // smaller default if the caller hasn't overridden it.
      const sigma = noiseSigma;
      for (let i = 0; i < numPoints; i++) {
        const sFrac = (i + 0.5) / numPoints;
        const theta = arcInv(sFrac);
        const r = a + b * theta;
        const cx = r * Math.cos(theta);
        const cy = r * Math.sin(theta);
        const dxdth = b * Math.cos(theta) - r * Math.sin(theta);
        const dydth = b * Math.sin(theta) + r * Math.cos(theta);
        const tlen = Math.hypot(dxdth, dydth) || 1;
        const nx = -dydth / tlen;
        const ny = dxdth / tlen;
        const noise = sigma * randNormal(rng);
        samples.push({
          x: cx + nx * noise,
          y: cy + ny * noise,
          s: sFrac,
          t: sFrac,
        });
      }
      const dom = spiralOuterRadius * 1.15;
      dataDomain = [-dom, dom];
    } else {
      // 2D-patch dataset: regular g × g lattice on (u, v) ∈ [-1, 1]²,
      // crumpled into displayed (x, y), with isotropic 2D Gaussian noise.
      // numPoints is a soft target — we use g² where g = round(√n).
      const grid = Math.max(2, Math.round(Math.sqrt(numPoints)));
      const total = grid * grid;
      for (let gi = 0; gi < grid; gi++) {
        for (let gj = 0; gj < grid; gj++) {
          const u = grid === 1 ? 0 : (2 * gi) / (grid - 1) - 1;
          const v = grid === 1 ? 0 : (2 * gj) / (grid - 1) - 1;
          const [cx, cy] = crumple(u, v);
          samples.push({
            x: cx + noiseSigma * randNormal(rng),
            y: cy + noiseSigma * randNormal(rng),
            u,
            v,
            t: (u + 1) / 2, // color is a 1-D gradient along intrinsic u
          });
        }
      }
      numPoints = total;
      dataDomain = [-1.3, 1.3];
    }

    // ---- 2. Pixel scaling onto the scatter region ----------------------
    const xScale = (x: number) =>
      marginWidth +
      ((x - dataDomain[0]) / (dataDomain[1] - dataDomain[0])) *
        (width - 2 * marginWidth);
    const yScale = (y: number) =>
      scatterBottom -
      ((y - dataDomain[0]) / (dataDomain[1] - dataDomain[0])) *
        (scatterBottom - marginHeight);
    pointPixels = samples.map((p) => [xScale(p.x), yScale(p.y)]);

    // ---- 3. Color (viridis along the per-sample t) ---------------------
    colors = samples.map((p) => interpolateViridis(p.t));

    // ---- 4. Highlight selection (dataset-specific) ---------------------
    if (dataset === 'spiral') {
      // Middle of arclength. Index ordering already follows s since we
      // sampled uniformly in s.
      highlightIdx = Math.floor(samples.length / 2);
    } else {
      // Sample closest to the patch's intrinsic center (u = v = 0).
      let bestUV = Infinity;
      for (let i = 0; i < samples.length; i++) {
        const d = Math.hypot(samples[i].u ?? 0, samples[i].v ?? 0);
        if (d < bestUV) {
          bestUV = d;
          highlightIdx = i;
        }
      }
    }

    // ---- 5. Spring targets -------------------------------------------
    // Pick "far" candidates by INTRINSIC distance (so the dramatic, long-
    // rest-length springs get drawn) then fan by display-space angle
    // so the springs don't visually bunch.
    const [hx, hy] = pointPixels[highlightIdx];
    const intrinsicDist = (i: number, j: number): number => {
      if (dataset === 'spiral') {
        return Math.abs((samples[i].s ?? 0) - (samples[j].s ?? 0));
      }
      const du = (samples[i].u ?? 0) - (samples[j].u ?? 0);
      const dv = (samples[i].v ?? 0) - (samples[j].v ?? 0);
      return Math.hypot(du, dv);
    };
    const candidates: { idx: number; dIntrinsic: number; angle: number }[] = [];
    for (let i = 0; i < pointPixels.length; i++) {
      if (i === highlightIdx) continue;
      const [px, py] = pointPixels[i];
      candidates.push({
        idx: i,
        dIntrinsic: intrinsicDist(highlightIdx, i),
        angle: Math.atan2(py - hy, px - hx),
      });
    }
    candidates.sort((a, b) => b.dIntrinsic - a.dIntrinsic);
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

    // ---- 6. Pairwise rest lengths (dataset-specific) ------------------
    // Rest lengths are pairwise distances on the INTRINSIC manifold
    // (1D arclength for the spiral, 2D (u,v) for the patch), rescaled
    // to pixel units so spring magnitudes are commensurate with the
    // canvas. Two points that are near in display space but far on the
    // intrinsic manifold get a long spring — that's what drives the
    // un-crumpling / unrolling.
    const xPx = pointPixels.map((p) => p[0]);
    const yPx = pointPixels.map((p) => p[1]);
    const pxSpanX = Math.max(...xPx) - Math.min(...xPx);
    const pxSpan = Math.hypot(
      pxSpanX,
      Math.max(...yPx) - Math.min(...yPx),
    );
    const intrinsicScale =
      dataset === 'spiral'
        ? pxSpanX             // s ∈ [0, 1] → fill the scatter width when unrolled
        : pxSpan / (2 * Math.SQRT2); // (u, v) ∈ [-1, 1]² → pxSpan on the diagonal
    const targetD = new Float64Array(numPoints * numPoints);
    for (let i = 0; i < numPoints; i++) {
      for (let j = i + 1; j < numPoints; j++) {
        const d = intrinsicDist(i, j) * intrinsicScale;
        targetD[i * numPoints + j] = d;
        targetD[j * numPoints + i] = d;
      }
    }

    // ---- 6b. Per-spring notch counts ---------------------------------
    // Pick spacing so the median spring lands on `springNotches` notches;
    // longer springs get proportionally more notches at rest. This keeps
    // notch spacing visually constant across the drawn springs.
    const springRest = springTargets.map(
      (idx) => targetD[highlightIdx * numPoints + idx],
    );
    const sortedRest = [...springRest].sort((a, b) => a - b);
    const medianRest =
      sortedRest.length === 0
        ? 1
        : sortedRest[Math.floor(sortedRest.length / 2)] || 1;
    const notchSpacing = medianRest / Math.max(springNotches, 1);
    springNotchCounts = springRest.map((d) =>
      Math.max(1, Math.round(d / Math.max(notchSpacing, 1e-9))),
    );

    // ---- 7. Solve the spring system (dataset-specific) ----------------
    if (dataset === 'spiral') {
      // 1D gradient descent: the springs unroll the spiral to a straight
      // line. The intrinsic geometry is genuinely 1D, so the final stress
      // approaches zero rather than plateauing.
      const result = solveSpringSystem1D(
        pointPixels.map((p) => [p[0], p[1]] as [number, number]),
        {
          rng,
          method: 'gradient',
          maxIter: 400,
          stepSize: 4e-5,
          weights: 'uniform',
          targetDistances: targetD,
        },
      );
      stressTrace = result.stressTrace;

      // Lift the 1D trajectory to 2D pixel frames: each frame blends
      // between the spiral (frame 0) and the unrolled line (final frame,
      // y = collapseY). The 1D solver's converged coordinate sets x;
      // y eases from spiral-y down to collapseY.
      const T = result.trajectory.length;
      const final1D = result.trajectory[T - 1];
      let minX1 = Infinity;
      let maxX1 = -Infinity;
      for (const v of final1D) {
        if (v < minX1) minX1 = v;
        if (v > maxX1) maxX1 = v;
      }
      const span1D = Math.max(maxX1 - minX1, 1e-6);
      const targetLeft = scatterLeft + 20;
      const targetRight = scatterRight - 20;
      const cxDst = (targetLeft + targetRight) / 2;
      const cxSrc = (minX1 + maxX1) / 2;
      const widthScale = (targetRight - targetLeft) / span1D;
      const lineXOf = (v: number) => cxDst + (v - cxSrc) * widthScale;

      trajectoryPixels = result.trajectory.map((iter, k) => {
        const progress = T <= 1 ? 0 : k / (T - 1);
        const ease = smoothstep(progress);
        return iter.map<[number, number]>((v, i) => {
          const lineX = lineXOf(v);
          const sx = pointPixels[i][0];
          const sy = pointPixels[i][1];
          return [
            sx + (lineX - sx) * ease,
            sy + (collapseY - sy) * ease,
          ];
        });
      });
    } else {
      // 2D heavy-ball (momentum) gradient descent — physically faithful
      // springs that ring out as they relax. No y-attractor: the
      // intrinsic (u, v) distances ARE 2D, so the cloud should land in a
      // 2D un-crumpled lattice rather than collapse to a line. Tuned
      // (γ=0.99, η=4e-6) for visible overshoot + ringing rather than
      // a smooth monotonic relaxation.
      const result = solveSpringSystem2D(
        pointPixels.map((p) => [p[0], p[1]] as [number, number]),
        {
          rng,
          maxIter: 800,
          stepSize: 4e-6,
          momentum: 0.99,
          collapseStrength: 0,
          collapseY,
          weights: 'uniform',
          targetDistances: targetD,
        },
      );
      stressTrace = result.stressTrace;

      // Uniform affine remap so the FINAL frame's bounding box fits in
      // the scatter region with aspect ratio preserved (otherwise an
      // un-crumpled square patch reads stretched).
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      const lastIter = result.trajectory[result.trajectory.length - 1];
      for (const [x, y] of lastIter) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      const xSpan = Math.max(maxX - minX, 1e-6);
      const ySpan = Math.max(maxY - minY, 1e-6);
      const targetLeft = scatterLeft + 20;
      const targetRight = scatterRight - 20;
      const targetTop = marginHeight + 20;
      const targetBottom = scatterBottom - 20;
      const scale = Math.min(
        (targetRight - targetLeft) / xSpan,
        (targetBottom - targetTop) / ySpan,
      );
      const cxSrc = (minX + maxX) / 2;
      const cySrc = (minY + maxY) / 2;
      const cxDst = (targetLeft + targetRight) / 2;
      const cyDst = (targetTop + targetBottom) / 2;
      const remap = (x: number, y: number): [number, number] => [
        cxDst + (x - cxSrc) * scale,
        cyDst + (y - cySrc) * scale,
      ];

      trajectoryPixels = result.trajectory.map((iter, k) => {
        if (k === 0) {
          return iter.map<[number, number]>(
            (_p, i) => [pointPixels[i][0], pointPixels[i][1]],
          );
        }
        return iter.map<[number, number]>(([x, y]) => remap(x, y));
      });
    }
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
            // Match `compress`'s smoothstep so the leading edge of the
            // stress curve and the marker dot stay in lockstep with the
            // points easing into 1D.
            return { energyProgress: smoothstep(t) };
          },
        },
      ],
      { durationMs: 5200 },
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

  // Spring endpoints (the highlight + the targets we draw springs to) stay
  // at full opacity even when the rest of the cloud dims, so the visible
  // springs read clearly.
  $: springEndpointSet = new Set<number>([highlightIdx, ...springTargets]);

  function drawScatter(state: AnimationState) {
    if (!ctx) return;
    const appear = state.pointsAppear;
    if (appear <= 0) return;
    for (let i = 0; i < pointPixels.length; i++) {
      const [px, py] = pointAt(i, state.compress);
      const isHighlight = i === highlightIdx;
      const isSpringEndpoint = springEndpointSet.has(i);
      const alpha = appear * (isSpringEndpoint ? 1 : state.dimAlpha);
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
      // Prop override > rest-length-derived count > flat default.
      const notches =
        (springNotchesPerSpring && springNotchesPerSpring[k]) ||
        springNotchCounts[k] ||
        springNotches;
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
