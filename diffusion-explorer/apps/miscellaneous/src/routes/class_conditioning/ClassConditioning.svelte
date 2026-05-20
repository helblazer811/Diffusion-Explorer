<!-- Class conditioning disambiguates intersecting source→target couplings. -->

<script lang="ts">
  import { onDestroy } from "svelte";
  import type { Writable } from "svelte/store";
  import {
    Figure,
    TimelineBuilder,
    Player,
    createPauseClip,
    createSourceTargetScales,
    drawScatterPlot,
    drawText,
    drawLine,
    drawArrow,
    drawMathjax,
    mathjaxInitialized,
    useCanvas2D,
    useVisibilityHandler,
    ContourRenderer,
    createLinearColorScale,
    parseContourColor,
    TimelineInspector,
  } from "@diffusion-explorer/ui";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  export let width = 900;
  export let height = 440;
  export let marginWidth = 60;
  export let marginHeight = 40;

  // Two-class target Gaussian stdev (in data units)
  export let targetSigma = 0.4;

  export let numSourceSamples = 60;     // total source points
  export let numPerClass = 30;          // target points per class (total = 2 * numPerClass)

  // Probabilistic uncertainty visualization (uses the same z as the
  // discrete phase — see runProbeComputation).
  export let numProbeSamples = 10000;   // random pairs to probe through z
  export let probeRadiusPx = 16;        // pixel radius around z for filtering segments
  export let pointsPerProbePath = 24;   // density samples per qualifying segment
  export let contourGridSize = 220;     // KDE grid resolution for contour rendering
  export let contourBandwidth = 14;     // KDE bandwidth (pixel units)
  export let contourThresholds: number | number[] = 6;

  export let seed = 17;                 // deterministic RNG seed
  export let playingByDefault = true;
  export let backgroundVisible = false;

  // Styling
  const sourcePointColor = "#666";
  const classAColor = "#3b82f6";        // blue (matches rectified-flow blog)
  const classBColor = "#f17720";        // orange (matches rectified-flow blog)
  const couplingColor = "#888";
  const couplingDimAlpha = 0.18;
  const couplingFullAlpha = 0.55;
  const highlightLineWidth = 4.5;
  const couplingLineWidth = 2;
  const pointRadius = 7.5;
  const pointOpacity = 0.6;
  const zMarkerRadius = 6;
  const labelColor = "#888";

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  let canvas: HTMLCanvasElement | null = null;
  const canvas2d = useCanvas2D(width, height);
  $: ctx = canvas && canvas2d.ctx;

  let isInitialized = false;

  type ClassLabel = 0 | 1;

  // Distributions (data space)
  let sourceSamples: [number, number][] = [];
  let targetSamples: [number, number][] = [];
  let targetClasses: ClassLabel[] = [];

  // Coupling: source[i] paired with target[pairing[i]]
  let pairing: number[] = [];

  // Pixel coordinates (derived)
  let scales: ReturnType<typeof createSourceTargetScales> | null = null;
  let sourcePixels: [number, number][] = [];
  let targetPixels: [number, number][] = [];

  // The picked z pair: two coupling indices whose lines cross and go to
  // opposite classes. zPair = [i, j], indices into sourcePixels/pairing.
  let zPair: [number, number] | null = null;
  let zPixel: { x: number; y: number } | null = null;

  // Probabilistic probe state (uncertainty view) — probe is centered on
  // the same `zPixel` used by the discrete phase.
  let canonicalPathA: [number, number, number, number] | null = null;
  let canonicalPathB: [number, number, number, number] | null = null;
  let contourCanvasAll: HTMLCanvasElement | null = null;
  let contourCanvasA: HTMLCanvasElement | null = null;
  let contourCanvasB: HTMLCanvasElement | null = null;

  // Timeline + animation state
  type AnimationState = {
    fadeIn: number;             // 0→1: distributions appear
    couplingProgress: number;   // 0→1: naive lines grow from source to target
    nonZAlpha: number;          // 1→0 then stays: dim non-z couplings
    zPairHighlightAlpha: number; // 0→1: emphasize the two z-pair couplings
    zMarkerAlpha: number;       // 0→1: z dot at the intersection
    zLabelAlpha: number;        // 0→1: LaTeX "z" label above the dot
    ambiguityAlpha: number;     // 0→1 then 1→0: "class A or B?" labels
    conditionedClass: -1 | 0 | 1;  // -1 = no conditioning yet, else the picked class
    conditioningAlpha: number;  // 0→1: "conditioned on class A" label opacity
    branchKeptAlpha: number;    // 0→1: opacity of the kept branch (the other fades to grey)
    // Uncertainty view
    couplingsFade: number;      // 1 = couplings drawn, 0 = couplings hidden (during probe phase)
    densityAllAlpha: number;    // 0→1: all-class density cloud (X-shape)
    densityCondAlpha: number;   // 0→1: class A density (tube)
    densityCondBAlpha: number;  // 0→1: class B density (tube)
    canonicalAAlpha: number;    // 0→1: class A canonical path
    canonicalBAlpha: number;    // 0→1: class B canonical path
    canonicalColorMix: number;  // 0 = grey, 1 = full class color (blue / orange)
    condVelocityAAlpha: number; // 0→1: v_t(z|c=A) arrow + label
    condVelocityBAlpha: number; // 0→1: v_t(z|c=B) arrow + label
    probeLabelAlpha: number;    // 0→1: "uncertainty view" caption
  };

  const initialState: AnimationState = {
    fadeIn: 0,
    couplingProgress: 0,
    nonZAlpha: 1,
    zPairHighlightAlpha: 0,
    zMarkerAlpha: 0,
    zLabelAlpha: 0,
    ambiguityAlpha: 0,
    conditionedClass: -1,
    conditioningAlpha: 0,
    branchKeptAlpha: 0,
    couplingsFade: 1,
    densityAllAlpha: 0,
    densityCondAlpha: 0,
    densityCondBAlpha: 0,
    canonicalAAlpha: 0,
    canonicalBAlpha: 0,
    canonicalColorMix: 0,
    condVelocityAAlpha: 0,
    condVelocityBAlpha: 0,
    probeLabelAlpha: 0,
  };

  let player: Player<AnimationState> | null = null;
  let figureIsActive: Writable<boolean> | undefined;
  const { handleVisibilityChange } = useVisibilityHandler(() => player);

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

  function sampleGaussian2D(
    rng: () => number,
    mean: [number, number],
    sigma: number,
    n: number,
  ): [number, number][] {
    const out: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      out.push([
        mean[0] + sigma * randNormal(rng),
        mean[1] + sigma * randNormal(rng),
      ]);
    }
    return out;
  }

  function shuffle<T>(arr: T[], rng: () => number): T[] {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Segment-segment intersection. Returns the intersection point in the
  // interior of both segments, or null if they do not cross.
  function segmentIntersection(
    p1: [number, number],
    p2: [number, number],
    p3: [number, number],
    p4: [number, number],
  ): { x: number; y: number; t: number; s: number } | null {
    const [x1, y1] = p1;
    const [x2, y2] = p2;
    const [x3, y3] = p3;
    const [x4, y4] = p4;
    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(denom) < 1e-9) return null;
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    const s = ((x1 - x3) * (y1 - y2) - (y1 - y3) * (x1 - x2)) / denom;
    if (t <= 0.05 || t >= 0.95 || s <= 0.05 || s >= 0.95) return null;
    return {
      x: x1 + t * (x2 - x1),
      y: y1 + t * (y2 - y1),
      t,
      s,
    };
  }

  function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }

  function smoothstep(t: number): number {
    const x = Math.max(0, Math.min(1, t));
    return x * x * (3 - 2 * x);
  }

  // Used by drawMathjax to redraw the current state once a formula's SVG
  // finishes loading (MathJax renders asynchronously the first time).
  function requestRedraw() {
    if (!player) return;
    draw(player.state);
  }

  // Squared distance from point (px,py) to the segment (ax,ay)-(bx,by).
  function distToSegmentSq(
    px: number, py: number,
    ax: number, ay: number,
    bx: number, by: number,
  ): number {
    const abx = bx - ax;
    const aby = by - ay;
    const lenSq = abx * abx + aby * aby;
    let t = lenSq > 0 ? ((px - ax) * abx + (py - ay) * aby) / lenSq : 0;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const dx = px - (ax + t * abx);
    const dy = py - (ay + t * aby);
    return dx * dx + dy * dy;
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function runInitialComputation() {
    const rng = mulberry32(seed);

    // Source: N(0, 0.5² I), centered at the origin so x is essentially
    // anchored at the left center after rescaling.
    sourceSamples = sampleGaussian2D(rng, [0, 0], 0.5, numSourceSamples);

    // Target: two Gaussians stacked vertically. Class A on top, Class B
    // on bottom. (Lower data-y maps to lower pixel-y, i.e. the top of
    // the canvas, under the default d3 linear scale.)
    const targetA = sampleGaussian2D(rng, [0, -1.2], targetSigma, numPerClass);
    const targetB = sampleGaussian2D(rng, [0, 1.2], targetSigma, numPerClass);
    targetSamples = [...targetA, ...targetB];
    targetClasses = [
      ...Array(numPerClass).fill(0 as ClassLabel),
      ...Array(numPerClass).fill(1 as ClassLabel),
    ];

    // Independent coupling = a random permutation of target indices,
    // truncated to the source count.
    const perm = shuffle(
      Array.from({ length: targetSamples.length }, (_, i) => i),
      rng,
    );
    pairing = perm.slice(0, sourceSamples.length);

    // Compute pixel scales.
    scales = createSourceTargetScales(sourceSamples, targetSamples, {
      width,
      height,
      marginWidth,
      marginHeight,
      sourceCenterX: 0.18,
      targetCenterX: 0.82,
      yShiftFactor: 0,
      distributionScaleFactor: 0.75,
    });

    sourcePixels = sourceSamples.map((p) => [
      scales!.sourceCenterPixelX + (p[0] - scales!.sourceMeanX) * scales!.xScaleFactor,
      scales!.yScale(p[1]),
    ]);
    targetPixels = targetSamples.map((p) => [
      scales!.targetCenterPixelX + (p[0] - scales!.targetMeanX) * scales!.xScaleFactor,
      scales!.yScale(p[1]),
    ]);

    // Pick the z pair: two coupling lines that cross AND go to opposite
    // classes, with the crossing closest to horizontal center.
    zPair = null;
    zPixel = null;
    let bestDistFromCenter = Infinity;
    const centerX = (scales.sourceCenterPixelX + scales.targetCenterPixelX) / 2;
    for (let i = 0; i < sourcePixels.length; i++) {
      for (let j = i + 1; j < sourcePixels.length; j++) {
        if (targetClasses[pairing[i]] === targetClasses[pairing[j]]) continue;
        const isect = segmentIntersection(
          sourcePixels[i],
          targetPixels[pairing[i]],
          sourcePixels[j],
          targetPixels[pairing[j]],
        );
        if (!isect) continue;
        const d = Math.abs(isect.x - centerX);
        if (d < bestDistFromCenter) {
          bestDistFromCenter = d;
          zPair = [i, j];
          zPixel = { x: isect.x, y: isect.y };
        }
      }
    }

    runProbeComputation();
  }

  // Probabilistic probe: generate many random coupling pairs, keep those
  // that pass within `probeRadiusPx` of z, sample points uniformly along
  // each kept segment, and pre-render per-class density contour offscreens.
  // The two canonical paths shown in the uncertainty view reuse the same
  // discrete z-pair couplings that were highlighted earlier in the loop —
  // we don't pick a new "closest" pair.
  async function runProbeComputation() {
    if (!scales || !zPixel) return;

    const probeX = zPixel.x;
    const probeY = zPixel.y;

    const rng = mulberry32(seed + 101);
    const allPts: number[][] = [];
    const aPts: number[][] = [];
    const bPts: number[][] = [];

    const r2 = probeRadiusPx * probeRadiusPx;

    for (let i = 0; i < numProbeSamples; i++) {
      // Source ~ N(0, 0.5² I) in data space
      const srcDx = 0.5 * randNormal(rng);
      const srcDy = 0.5 * randNormal(rng);
      const sx =
        scales.sourceCenterPixelX + (srcDx - scales.sourceMeanX) * scales.xScaleFactor;
      const sy = scales.yScale(srcDy);

      // Pick a class 50/50, then sample target from that class's Gaussian
      // (mirrors the data-y assignment used in runInitialComputation).
      const cls: ClassLabel = rng() < 0.5 ? 0 : 1;
      const meanY = cls === 0 ? -1.2 : 1.2;
      const tgtDx = targetSigma * randNormal(rng);
      const tgtDy = meanY + targetSigma * randNormal(rng);
      const tx =
        scales.targetCenterPixelX + (tgtDx - scales.targetMeanX) * scales.xScaleFactor;
      const ty = scales.yScale(tgtDy);

      const distSq = distToSegmentSq(probeX, probeY, sx, sy, tx, ty);
      if (distSq > r2) continue;

      // Uniform samples along segment (skip endpoints)
      for (let j = 0; j < pointsPerProbePath; j++) {
        const u = (j + 0.5) / pointsPerProbePath;
        const px = sx + u * (tx - sx);
        const py = sy + u * (ty - sy);
        allPts.push([px, py]);
        (cls === 0 ? aPts : bPts).push([px, py]);
      }
    }

    // Reuse the discrete z-pair couplings as the canonical class A / class B
    // paths so the uncertainty view shows the SAME two lines the viewer
    // just saw highlighted around z.
    canonicalPathA = null;
    canonicalPathB = null;
    if (zPair) {
      const [i, j] = zPair;
      const [sxi, syi] = sourcePixels[i];
      const [txi, tyi] = targetPixels[pairing[i]];
      const [sxj, syj] = sourcePixels[j];
      const [txj, tyj] = targetPixels[pairing[j]];
      if (targetClasses[pairing[i]] === 0) {
        canonicalPathA = [sxi, syi, txi, tyi];
        canonicalPathB = [sxj, syj, txj, tyj];
      } else {
        canonicalPathA = [sxj, syj, txj, tyj];
        canonicalPathB = [sxi, syi, txi, tyi];
      }
    }

    // Render per-class filled contours via the unified ContourRenderer
    // (auto-selects GPU / CPU backend).
    const [allCanvas, aCanvas, bCanvas] = await Promise.all([
      renderContourOffscreen(allPts, "#777"),
      renderContourOffscreen(aPts, classAColor),
      renderContourOffscreen(bPts, classBColor),
    ]);
    contourCanvasAll = allCanvas;
    contourCanvasA = aCanvas;
    contourCanvasB = bCanvas;
    requestRedraw();
  }

  async function renderContourOffscreen(
    points: number[][],
    color: string,
  ): Promise<HTMLCanvasElement | null> {
    if (!points.length) return null;
    const dpr =
      typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const off = document.createElement("canvas");
    off.width = Math.floor(width * dpr);
    off.height = Math.floor(height * dpr);

    const rgb = parseContourColor(color);
    const colorScale = createLinearColorScale(
      [rgb[0], rgb[1], rgb[2], 0.0],
      [rgb[0], rgb[1], rgb[2], 0.95],
    );

    const renderer = await ContourRenderer.create({
      canvas: off,
      gridSize: contourGridSize,
      bandwidth: contourBandwidth,
      thresholds: contourThresholds,
      opacity: 1.0,
      colorScale,
      dpr,
      preferGPU: true,
    });
    // The contour shader expects "data y" convention (yMin is the bottom
    // of the visual). We're passing pixel coords where y=0 is the top of
    // the canvas, so we swap yMin/yMax to keep the rendering oriented
    // the same way as the rest of the figure.
    renderer.setPoints(points, { xMin: 0, xMax: width, yMin: height, yMax: 0 });
    renderer.draw();
    return off;
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  function setupTimeline() {
    if (player) player.dispose?.();

    const builder = new TimelineBuilder<AnimationState>()
      .setInitialState({ ...initialState });

    // A. Fade in source noise + the two-class target mixture
    builder.add(
      { name: "FadeInDistributions", reduce(t) { return { fadeIn: smoothstep(t) }; } },
      { durationMs: 500 },
    );
    builder.add(createPauseClip(), { durationMs: 200 });

    // B. Draw the naive (random) source→target couplings
    builder.add(
      {
        name: "DrawNaiveCouplings",
        reduce(t) {
          return { couplingProgress: smoothstep(t) };
        },
      },
      { durationMs: 1400 },
    );
    builder.add(createPauseClip(), { durationMs: 1800 });

    // C1. Emphasize the two coupling lines that cross and go to opposite
    //     classes (the others stay full-strength for the moment).
    builder.add(
      {
        name: "EmphasizeCrossingPair",
        reduce(t) {
          return { zPairHighlightAlpha: smoothstep(t) };
        },
      },
      { durationMs: 500 },
    );
    builder.add(createPauseClip(), { durationMs: 250 });

    // C2. Place the dot at the intersection point.
    builder.add(
      {
        name: "PlaceZDot",
        reduce(t) {
          return { zMarkerAlpha: smoothstep(t) };
        },
      },
      { durationMs: 400 },
    );
    // C3. Immediately after the dot lands, fade the rest of the coupling
    //     lines out of the way so the dot + highlighted pair stand alone.
    builder.add(
      {
        name: "FadeOutNonZCouplings",
        reduce(t) {
          return { nonZAlpha: 1 - smoothstep(t) };
        },
      },
      { durationMs: 700 },
    );
    builder.add(createPauseClip(), { durationMs: 350 });

    // C4. Reveal the italic "z" label above the dot.
    builder.add(
      {
        name: "RevealZLabel",
        reduce(t) {
          return { zLabelAlpha: smoothstep(t) };
        },
      },
      { durationMs: 450 },
    );
    builder.add(createPauseClip(), { durationMs: 500 });

    // D. Transition into the contour / uncertainty view: fade out the
    //    discrete couplings (the highlighted z-pair fades too), fade in
    //    the two canonical paths (one per class). The z marker + label
    //    stay put. The averaged-velocity arrow has not appeared yet.
    builder.add(
      [
        {
          name: "FadeOutCouplings",
          reduce(t) {
            const u = smoothstep(t);
            return { couplingsFade: 1 - u, zPairHighlightAlpha: 1 - u };
          },
        },
        {
          name: "FadeInCanonicalPaths",
          reduce(t) {
            const u = smoothstep(t);
            return { canonicalAAlpha: u, canonicalBAlpha: u, probeLabelAlpha: u };
          },
        },
      ],
      { durationMs: 900 },
    );
    builder.add(createPauseClip(), { durationMs: 500 });

    // E. Reveal the all-class path density around z (forms an X) — this
    //    is the uncertainty around z.
    builder.add(
      {
        name: "RevealAllClassDensity",
        reduce(t) {
          return { densityAllAlpha: smoothstep(t) };
        },
      },
      { durationMs: 1200 },
    );
    builder.add(createPauseClip(), { durationMs: 1000 });

    // F. Drop the all-class density and bring up the grey arrow + equation
    //    E[x_1 - x_0 | x_t = z] (the averaged direction over that
    //    uncertainty) in two parallel clips.
    builder.add(
      [
        {
          name: "FadeOutAllClassDensity",
          reduce(t) {
            return { densityAllAlpha: 1 - smoothstep(t) };
          },
        },
        {
          name: "ShowExpectedVelocity",
          reduce(t) {
            return { ambiguityAlpha: smoothstep(t) };
          },
        },
      ],
      { durationMs: 900 },
    );
    builder.add(createPauseClip(), { durationMs: 1500 });

    // G. Reveal the class-A density tube: fade in the blue contour,
    //    drop the class-B canonical + averaged-velocity arrow, colorize
    //    the kept (class A) canonical.
    builder.add(
      [
        {
          name: "FadeOutNonAElements",
          reduce(t) {
            const u = smoothstep(t);
            return { canonicalBAlpha: 1 - u, ambiguityAlpha: 1 - u };
          },
        },
        {
          name: "RevealClassADensity",
          reduce(t) {
            const u = smoothstep(t);
            return {
              densityCondAlpha: u,
              canonicalColorMix: u,
              conditionedClass: 0 as 0,
            };
          },
        },
      ],
      { durationMs: 1000 },
    );
    builder.add(createPauseClip(), { durationMs: 1000 });

    // G2. Drop the class-A density and bring up the blue v_t(z|c=A)
    //     arrow + label as two parallel clips.
    builder.add(
      [
        {
          name: "FadeOutClassADensity",
          reduce(t) {
            return { densityCondAlpha: 1 - smoothstep(t) };
          },
        },
        {
          name: "ShowClassAVelocity",
          reduce(t) {
            return { condVelocityAAlpha: smoothstep(t) };
          },
        },
      ],
      { durationMs: 900 },
    );
    builder.add(createPauseClip(), { durationMs: 1500 });

    // H. Flip to class B: fade out the class-A canonical + arrow, fade
    //    in the class-B contour + canonical.
    builder.add(
      [
        {
          name: "FadeOutClassAElements",
          reduce(t) {
            const u = smoothstep(t);
            return { canonicalAAlpha: 1 - u, condVelocityAAlpha: 1 - u };
          },
        },
        {
          name: "RevealClassBElements",
          reduce(t) {
            const u = smoothstep(t);
            return {
              densityCondBAlpha: u,
              canonicalBAlpha: u,
              conditionedClass: 1 as 1,
            };
          },
        },
      ],
      { durationMs: 1000 },
    );
    builder.add(createPauseClip(), { durationMs: 1000 });

    // H2. Drop the class-B density and bring up the orange v_t(z|c=B)
    //     arrow + label as two parallel clips.
    builder.add(
      [
        {
          name: "FadeOutClassBDensity",
          reduce(t) {
            return { densityCondBAlpha: 1 - smoothstep(t) };
          },
        },
        {
          name: "ShowClassBVelocity",
          reduce(t) {
            return { condVelocityBAlpha: smoothstep(t) };
          },
        },
      ],
      { durationMs: 900 },
    );
    builder.add(createPauseClip(), { durationMs: 1800 });

    // Slow the whole loop by 2x. Clip starts/ends are normalized [0, 1] in
    // the built Timeline, so giving the Builder an explicit duration that's
    // 2× the auto-computed total stretches every phase + pause uniformly.
    const totalMs = builder.totalDurationMs;
    const timeline = builder.setDuration((totalMs * 2) / 1000).build();
    player = new Player(timeline, { looping: true });
    player.onTick((_t, state) => draw(state));
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function targetColor(idx: number): string {
    return targetClasses[idx] === 0 ? classAColor : classBColor;
  }

  function drawCouplingLines(state: AnimationState) {
    if (!ctx || !scales || !sourcePixels.length) return;
    const prog = state.couplingProgress;
    if (prog <= 0) return;
    if (state.couplingsFade <= 0) return;

    const zSet = new Set<number>();
    if (zPair) {
      zSet.add(zPair[0]);
      zSet.add(zPair[1]);
    }

    for (let i = 0; i < sourcePixels.length; i++) {
      const tgtIdx = pairing[i];
      const [sx, sy] = sourcePixels[i];
      const [tx, ty] = targetPixels[tgtIdx];
      const endX = sx + (tx - sx) * prog;
      const endY = sy + (ty - sy) * prog;

      let alpha: number;
      let color: string;
      let lw: number;
      if (zSet.has(i)) {
        const cls = targetClasses[tgtIdx];
        const hl = state.zPairHighlightAlpha; // 0=blends in with others, 1=emphasized
        if (state.conditionedClass === -1) {
          // Pre-conditioning: z-pair starts identical to non-z and ramps
          // up to bolder/darker as the highlight phase plays.
          color = couplingColor;
          alpha = lerp(couplingFullAlpha, 0.95, hl);
          lw = lerp(couplingLineWidth, highlightLineWidth, hl);
        } else if (state.conditionedClass === cls) {
          // Kept branch: fades to class color, holds the highlighted width
          color = targetColor(tgtIdx);
          alpha = 0.95;
          lw = highlightLineWidth;
        } else {
          // Unselected branch: fades down to fully invisible
          color = couplingColor;
          alpha = 0.95 * (1 - state.branchKeptAlpha);
          lw = lerp(highlightLineWidth, couplingLineWidth, state.branchKeptAlpha);
        }
      } else {
        // Non-z couplings: full at first, fade to nothing during the
        // FadeOutNonZCouplings phase via nonZAlpha (1 → 0).
        alpha = couplingFullAlpha * state.nonZAlpha;
        color = couplingColor;
        lw = couplingLineWidth;
      }

      drawLine(ctx, sx, sy, endX, endY, color, lw, alpha * state.couplingsFade);
    }
  }

  function drawZMarker(state: AnimationState) {
    if (!ctx || !zPixel) return;

    // Dot — controlled by zMarkerAlpha. No outline/halo.
    if (state.zMarkerAlpha > 0) {
      ctx.save();
      ctx.globalAlpha = state.zMarkerAlpha;

      // Decide marker color: if conditioned, take the kept class color
      const markerFill =
        state.conditionedClass === -1
          ? "#333"
          : state.conditionedClass === 0
            ? classAColor
            : classBColor;

      ctx.beginPath();
      ctx.arc(zPixel.x, zPixel.y, zMarkerRadius, 0, 2 * Math.PI);
      ctx.fillStyle = markerFill;
      ctx.fill();

      ctx.restore();
    }

    // LaTeX "z" label — controlled separately by zLabelAlpha so the dot
    // can appear before the label. Slightly grey fill with a chunky white
    // outline so it reads clearly over the contour cloud.
    if (state.zLabelAlpha > 0) {
      ctx.save();
      ctx.globalAlpha = state.zLabelAlpha;
      drawMathjax(
        ctx,
        "z",
        zPixel.x,
        zPixel.y - zMarkerRadius - 6,
        28,
        0,
        0,
        { color: "#555", stroke: "#fff", strokeWidth: 6, strokeOpacity: 1 },
        requestRedraw,
      );
      ctx.restore();
    }
  }

  function drawAmbiguityLabels(state: AnimationState) {
    if (!ctx || !zPixel) return;
    if (state.ambiguityAlpha <= 0) return;

    // A single grey horizontal arrow pointing right from z stands in for
    // the marginal velocity v_t(z) = E[x_1 - x_0 | x_t = z] — i.e. the
    // unconditioned model's predicted direction, which averages over both
    // branches.
    const arrowLength = 110;
    const arrowEndX = zPixel.x + arrowLength;
    const arrowEndY = zPixel.y;

    ctx.save();
    ctx.globalAlpha = state.ambiguityAlpha;
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = "#555";
    ctx.fillStyle = "#555";
    drawArrow(ctx, zPixel.x, zPixel.y, arrowEndX, arrowEndY, 9);
    ctx.restore();

    // LaTeX equation centered just to the right of the arrow tip.
    // drawMathjax anchors at the bottom-center, so we shift x by an
    // estimated half-width to push the text fully past the arrowhead.
    ctx.save();
    ctx.globalAlpha = state.ambiguityAlpha;
    const eqFontSize = 22;
    const eqHalfWidthEst = 135;
    drawMathjax(
      ctx,
      "\\mathbb{E}[x_1 - x_0 \\mid x_t = z]",
      arrowEndX + 30 + eqHalfWidthEst,
      arrowEndY + eqFontSize / 2,
      eqFontSize,
      0,
      0,
      { color: "#444", stroke: "#fff", strokeWidth: 5, strokeOpacity: 1 },
      requestRedraw,
    );
    ctx.restore();
  }

  function drawConditioningLabel(state: AnimationState) {
    if (!ctx) return;
    // Show "Conditioned on class A" footer either from the discrete phase
    // (state.conditioningAlpha) or from the uncertainty phase
    // (state.densityCondAlpha after ProbeCondA).
    const probeFooter = state.densityCondAlpha;
    const cls = state.conditionedClass;
    if (state.conditioningAlpha <= 0 && probeFooter <= 0) return;

    const color = cls === 0 ? classAColor : cls === 1 ? classBColor : "#333";
    const text = cls === 0
      ? "Conditioned on class A"
      : cls === 1
        ? "Conditioned on class B"
        : "";

    const op = Math.max(state.conditioningAlpha, probeFooter);

    drawText(ctx, text, width / 2, height - marginHeight / 2 + 6, {
      font: "600 18px Helvetica, Arial, sans-serif",
      color,
      opacity: op,
      align: "center",
      baseline: "middle",
    });
  }

  // ----------------------------------------------------------------
  // Uncertainty view drawing
  // ----------------------------------------------------------------

  function drawDensity(state: AnimationState) {
    if (!ctx) return;
    if (state.densityAllAlpha > 0 && contourCanvasAll) {
      ctx.save();
      ctx.globalAlpha = state.densityAllAlpha;
      ctx.drawImage(contourCanvasAll, 0, 0, width, height);
      ctx.restore();
    }
    if (state.densityCondAlpha > 0 && contourCanvasA) {
      ctx.save();
      ctx.globalAlpha = state.densityCondAlpha;
      ctx.drawImage(contourCanvasA, 0, 0, width, height);
      ctx.restore();
    }
    if (state.densityCondBAlpha > 0 && contourCanvasB) {
      ctx.save();
      ctx.globalAlpha = state.densityCondBAlpha;
      ctx.drawImage(contourCanvasB, 0, 0, width, height);
      ctx.restore();
    }
  }

  function drawConditionalVelocityArrow(
    state: AnimationState,
    path: [number, number, number, number],
    color: string,
    latex: string,
    labelAbove: boolean,
    alpha: number,
  ) {
    if (!ctx || !zPixel) return;
    const [, , tx, ty] = path;
    const dx = tx - zPixel.x;
    const dy = ty - zPixel.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    const arrowLength = 110;
    const ex = zPixel.x + (dx / len) * arrowLength;
    const ey = zPixel.y + (dy / len) * arrowLength;

    // Soft white outline behind the colored arrow.
    ctx.save();
    ctx.globalAlpha = alpha * 0.5;
    ctx.lineWidth = 3.5 + 4;
    ctx.strokeStyle = "#fff";
    ctx.fillStyle = "#fff";
    drawArrow(ctx, zPixel.x, zPixel.y, ex, ey, 11);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    drawArrow(ctx, zPixel.x, zPixel.y, ex, ey, 9);
    ctx.restore();

    // Label is centered horizontally on the arrow tip and sits clearly
    // above (class A) or below (class B) the tip, with a chunky white
    // outline so it reads over the contour cloud.
    const eqFontSize = 22;
    const gap = 32;
    const anchorX = ex;
    const anchorY = labelAbove ? ey - gap : ey + gap + eqFontSize;
    ctx.save();
    ctx.globalAlpha = alpha;
    drawMathjax(
      ctx,
      latex,
      anchorX,
      anchorY,
      eqFontSize,
      0,
      0,
      { color, stroke: "#fff", strokeWidth: 8, strokeOpacity: 1 },
      requestRedraw,
    );
    ctx.restore();
  }

  function drawConditionalVelocityArrows(state: AnimationState) {
    if (state.condVelocityAAlpha > 0 && canonicalPathA) {
      drawConditionalVelocityArrow(
        state,
        canonicalPathA,
        classAColor,
        "v_t(z \\mid c = A)",
        true,
        state.condVelocityAAlpha,
      );
    }
    if (state.condVelocityBAlpha > 0 && canonicalPathB) {
      drawConditionalVelocityArrow(
        state,
        canonicalPathB,
        classBColor,
        "v_t(z \\mid c = B)",
        false,
        state.condVelocityBAlpha,
      );
    }
  }

  function drawCanonicalPath(
    state: AnimationState,
    path: [number, number, number, number] | null,
    color: string,
    alpha: number,
  ) {
    if (!ctx || !path || alpha <= 0) return;
    const [sx, sy, tx, ty] = path;
    const op = alpha * 0.92;
    const endR = 6;

    // Soft white outline behind the line + endpoint dots so the colored
    // path reads clearly over the contour cloud.
    ctx.save();
    ctx.globalAlpha = alpha * 0.5;
    ctx.strokeStyle = "#fff";
    ctx.fillStyle = "#fff";
    ctx.lineWidth = 4.5 + 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(sx, sy, endR + 2, 0, 2 * Math.PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(tx, ty, endR + 2, 0, 2 * Math.PI);
    ctx.fill();
    ctx.restore();

    // Colored line + endpoint dots
    ctx.save();
    ctx.globalAlpha = op;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 4.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(sx, sy, endR, 0, 2 * Math.PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(tx, ty, endR, 0, 2 * Math.PI);
    ctx.fill();
    ctx.restore();
  }

  // Linear blend of two #rrggbb colors → rgb(...).
  function blendHex(a: string, b: string, mix: number): string {
    const ar = parseInt(a.slice(1, 3), 16);
    const ag = parseInt(a.slice(3, 5), 16);
    const ab = parseInt(a.slice(5, 7), 16);
    const br = parseInt(b.slice(1, 3), 16);
    const bg = parseInt(b.slice(3, 5), 16);
    const bb = parseInt(b.slice(5, 7), 16);
    const r = Math.round(ar + (br - ar) * mix);
    const g = Math.round(ag + (bg - ag) * mix);
    const bl = Math.round(ab + (bb - ab) * mix);
    return `rgb(${r},${g},${bl})`;
  }

  function drawCanonicalPaths(state: AnimationState) {
    // blendHex slices fixed 7-char positions, so the grey constant must
    // be the full 7-char form (not the #666 shorthand) or the mid-mix
    // colors come out as rgb(…, …, NaN) and CSS falls back to black.
    const grey = "#666666";
    const mix = state.canonicalColorMix;
    const colorA = mix <= 0 ? grey : mix >= 1 ? classAColor : blendHex(grey, classAColor, mix);
    const colorB = mix <= 0 ? grey : mix >= 1 ? classBColor : blendHex(grey, classBColor, mix);
    // When the conditional velocity arrow is up, dim the rest of the
    // canonical line so the arrow stands out. The arrow paints on top of
    // the line at full alpha, so only the non-arrow portion looks faded.
    const dimA = 1 - state.condVelocityAAlpha * 0.55;
    const dimB = 1 - state.condVelocityBAlpha * 0.55;
    drawCanonicalPath(state, canonicalPathA, colorA, state.canonicalAAlpha * dimA);
    drawCanonicalPath(state, canonicalPathB, colorB, state.canonicalBAlpha * dimB);
  }

  function drawProbeCaption(state: AnimationState) {
    if (!ctx) return;
    if (state.probeLabelAlpha <= 0) return;
    // Show only when the uncertainty footer ("Conditioned on...") is not
    // already taking the bottom line.
    const probeFooter = state.densityCondAlpha;
    if (probeFooter > 0.05) return;
    drawText(
      ctx,
      "Paths passing within radius of z",
      width / 2,
      height - marginHeight / 2 + 6,
      {
        font: "600 17px Helvetica, Arial, sans-serif",
        color: "#555",
        opacity: state.probeLabelAlpha,
        align: "center",
        baseline: "middle",
      },
    );
  }

  function drawSourceTargetPoints(state: AnimationState) {
    if (!ctx || !scales) return;
    const op = state.fadeIn;

    drawScatterPlot(ctx, sourcePixels, pointRadius, sourcePointColor, op * pointOpacity);

    // Target points are colored by class.
    const classA: [number, number][] = [];
    const classB: [number, number][] = [];
    for (let i = 0; i < targetPixels.length; i++) {
      (targetClasses[i] === 0 ? classA : classB).push(targetPixels[i]);
    }
    drawScatterPlot(ctx, classA, pointRadius, classAColor, op * pointOpacity);
    drawScatterPlot(ctx, classB, pointRadius, classBColor, op * pointOpacity);
  }

  function drawHeaderLabels(state: AnimationState) {
    if (!ctx || !scales || !targetPixels.length) return;
    const font = "500 28px Helvetica, Arial, sans-serif";
    const op = state.fadeIn;

    // Class A sits on top, Class B on bottom. Find the topmost pixel y of
    // the top cluster (Class A) and the bottommost pixel y of the bottom
    // cluster (Class B) so each label hugs the outside of its cluster.
    let topA = Infinity;
    let bottomB = -Infinity;
    for (let i = 0; i < targetPixels.length; i++) {
      const y = targetPixels[i][1];
      if (targetClasses[i] === 0) {
        if (y < topA) topA = y;
      } else {
        if (y > bottomB) bottomB = y;
      }
    }

    const labelX = scales.targetCenterPixelX;
    const gap = 14;

    drawText(ctx, "Class A", labelX, topA - gap, {
      font,
      color: classAColor,
      opacity: op,
      align: "center",
      baseline: "bottom",
    });
    drawText(ctx, "Class B", labelX, bottomB + gap, {
      font,
      color: classBColor,
      opacity: op,
      align: "center",
      baseline: "top",
    });
  }

  function draw(state: AnimationState) {
    if (!ctx || !isInitialized) return;
    ctx.clearRect(0, 0, width, height);

    // --- Header labels (top of canvas) ---
    drawHeaderLabels(state);

    // --- Density cloud (lowest visual layer in the plotting area) ---
    drawDensity(state);

    // --- Coupling lines + canonical lines sit underneath the points ---
    drawCouplingLines(state);
    drawCanonicalPaths(state);

    // --- Scatter points on top of the lines ---
    drawSourceTargetPoints(state);

    // --- Annotations sit above the points ---
    drawAmbiguityLabels(state);
    drawConditionalVelocityArrows(state);
    drawZMarker(state);
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
    // Redraw once MathJax glyphs (e.g. "z") finish loading
    mathjaxInitialized.then(() => requestRedraw());
  }

  $: if (figureIsActive !== undefined && isInitialized) {
    handleVisibilityChange($figureIsActive === true);
  }
</script>

<div class="cc-wrap" style="max-width:{width}px;">
  <h2 class="cc-title">Class Conditioning Makes Flow Matching Easier</h2>
  <Figure bind:isActive={figureIsActive} {backgroundVisible}>
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
  <div class="cc-inspector">
    <TimelineInspector {player} />
  </div>
</div>

<style>
  .cc-wrap {
    margin: 2rem auto 0;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .cc-title {
    text-align: center;
    font-size: 1.9rem;
    font-weight: 500;
    color: #777;
    margin: 0 0 0.4rem 0;
    line-height: 1.25;
  }
  .cc-inspector {
    width: 100%;
    max-width: 900px;
    margin-top: 12px;
  }
</style>
