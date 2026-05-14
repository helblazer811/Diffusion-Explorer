<!-- Class conditioning disambiguates intersecting source→target couplings. -->

<script lang="ts">
  import { onDestroy } from "svelte";
  import type { Writable } from "svelte/store";
  import {
    Figure,
    Timeline,
    TimelineBuilder,
    createPauseClip,
    createSourceTargetScales,
    drawScatterPlot,
    drawText,
    drawLine,
    useCanvas2D,
    useVisibilityHandler,
  } from "@diffusion-explorer/ui";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  export let width = 750;
  export let height = 420;
  export let marginWidth = 60;
  export let marginHeight = 40;

  export let numSourceSamples = 30;     // total source points
  export let numPerClass = 15;          // target points per class (total = 2 * numPerClass)

  export let seed = 17;                 // deterministic RNG seed
  export let playingByDefault = true;
  export let backgroundVisible = true;

  // Styling
  const sourcePointColor = "#666";
  const classAColor = "#0891b2";        // teal
  const classBColor = "#f97316";        // orange
  const couplingColor = "#888";
  const couplingDimAlpha = 0.18;
  const couplingFullAlpha = 0.55;
  const highlightLineWidth = 3;
  const couplingLineWidth = 2;
  const pointRadius = 5;
  const zMarkerRadius = 8;
  const labelColor = "#444";

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

  // Timeline + animation state
  type AnimationState = {
    fadeIn: number;             // 0→1: distributions appear
    couplingProgress: number;   // 0→1: naive lines grow from source to target
    nonZAlpha: number;          // 1→0 then stays: dim non-z couplings
    zMarkerAlpha: number;       // 0→1: appearance of the "z" annotation
    ambiguityAlpha: number;     // 0→1 then 1→0: "class A or B?" labels
    conditionedClass: -1 | 0 | 1;  // -1 = no conditioning yet, else the picked class
    conditioningAlpha: number;  // 0→1: "conditioned on class A" label opacity
    branchKeptAlpha: number;    // 0→1: opacity of the kept branch (the other fades to grey)
  };

  const initialState: AnimationState = {
    fadeIn: 0,
    couplingProgress: 0,
    nonZAlpha: 1,
    zMarkerAlpha: 0,
    ambiguityAlpha: 0,
    conditionedClass: -1,
    conditioningAlpha: 0,
    branchKeptAlpha: 0,
  };

  let timeline: Timeline<AnimationState> | null = null;
  let figureIsActive: Writable<boolean> | undefined;
  const { handleVisibilityChange } = useVisibilityHandler(() => timeline);

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

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function runInitialComputation() {
    const rng = mulberry32(seed);

    // Source: N(0, 0.5² I), centered at the origin so x is essentially
    // anchored at the left center after rescaling.
    sourceSamples = sampleGaussian2D(rng, [0, 0], 0.5, numSourceSamples);

    // Target: two Gaussians stacked vertically. Same x-mean for both classes.
    const targetA = sampleGaussian2D(rng, [0, 1.2], 0.28, numPerClass);
    const targetB = sampleGaussian2D(rng, [0, -1.2], 0.28, numPerClass);
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
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  function setupTimeline() {
    if (timeline) timeline.dispose?.();

    const builder = new TimelineBuilder<AnimationState>()
      .setInitialState({ ...initialState })
      .setLooping(true);

    // A. Fade in distributions
    builder.add(
      { name: "FadeIn", reduce(t) { return { fadeIn: smoothstep(t) }; } },
      { durationMs: 500 },
    );
    builder.add(createPauseClip(), { durationMs: 200 });

    // B. Draw naive coupling lines
    builder.add(
      {
        name: "DrawCouplings",
        reduce(t) {
          return { couplingProgress: smoothstep(t) };
        },
      },
      { durationMs: 1400 },
    );
    builder.add(createPauseClip(), { durationMs: 500 });

    // C. Annotate z: dim other couplings, reveal z marker
    builder.add(
      {
        name: "AnnotateZ",
        reduce(t) {
          const u = smoothstep(t);
          return {
            nonZAlpha: 1 - u,
            zMarkerAlpha: u,
          };
        },
      },
      { durationMs: 900 },
    );
    builder.add(createPauseClip(), { durationMs: 600 });

    // D. Ambiguity: show that z is consistent with both branches
    builder.add(
      {
        name: "Ambiguity",
        reduce(t) {
          return { ambiguityAlpha: smoothstep(t) };
        },
      },
      { durationMs: 700 },
    );
    builder.add(createPauseClip(), { durationMs: 900 });

    // E. Condition on class A
    builder.add(
      {
        name: "ConditionA",
        reduce(t) {
          const u = smoothstep(t);
          return {
            ambiguityAlpha: 1 - u,
            conditionedClass: 0 as 0,
            conditioningAlpha: u,
            branchKeptAlpha: u,
          };
        },
      },
      { durationMs: 900 },
    );
    builder.add(createPauseClip(), { durationMs: 1200 });

    // F. Flip to class B (symmetry)
    builder.add(
      {
        name: "FlipToB",
        reduce(t) {
          const u = smoothstep(t);
          return {
            conditionedClass: 1 as 1,
            // Fade the kept-branch alpha through 0 and back to 1 so the
            // viewer sees the swap clearly.
            branchKeptAlpha: u < 0.5 ? 1 - 2 * u : 2 * (u - 0.5),
          };
        },
      },
      { durationMs: 900 },
    );
    builder.add(createPauseClip(), { durationMs: 1500 });

    timeline = builder.build();
    timeline.onTick((_t, state) => draw(state));
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
        // z-pair couplings: stay visible. After conditioning, the
        // unselected branch fades to grey.
        const cls = targetClasses[tgtIdx];
        if (state.conditionedClass === -1) {
          // Pre-conditioning: both branches keep full strength.
          color = couplingColor;
          alpha = couplingFullAlpha;
          lw = highlightLineWidth;
        } else if (state.conditionedClass === cls) {
          // Kept branch: emphasize, fade to class color
          color = targetColor(tgtIdx);
          alpha = lerp(couplingFullAlpha, 0.95, state.branchKeptAlpha);
          lw = highlightLineWidth;
        } else {
          // Unselected branch: fade to dim grey
          color = couplingColor;
          alpha = lerp(couplingFullAlpha, couplingDimAlpha, state.branchKeptAlpha);
          lw = couplingLineWidth;
        }
      } else {
        // Non-z couplings: full at first, then dim during annotation.
        alpha = lerp(couplingFullAlpha, couplingDimAlpha, 1 - state.nonZAlpha);
        color = couplingColor;
        lw = couplingLineWidth;
      }

      drawLine(ctx, sx, sy, endX, endY, color, lw, alpha);
    }
  }

  function drawZMarker(state: AnimationState) {
    if (!ctx || !zPixel) return;
    if (state.zMarkerAlpha <= 0) return;

    ctx.save();
    ctx.globalAlpha = state.zMarkerAlpha;

    // Decide marker color: if conditioned, take the kept class color
    const markerFill =
      state.conditionedClass === -1
        ? "#333"
        : state.conditionedClass === 0
          ? classAColor
          : classBColor;
    const markerEdge =
      state.conditionedClass === -1 ? "#fff" : "#fff";

    // White halo for legibility
    ctx.beginPath();
    ctx.arc(zPixel.x, zPixel.y, zMarkerRadius + 3, 0, 2 * Math.PI);
    ctx.fillStyle = "#fff";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(zPixel.x, zPixel.y, zMarkerRadius, 0, 2 * Math.PI);
    ctx.fillStyle = markerFill;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = markerEdge;
    ctx.stroke();

    // "z" label slightly to the upper right
    drawText(ctx, "z", zPixel.x + 14, zPixel.y - 18, {
      font: "italic 600 26px 'Times New Roman', serif",
      color: "#222",
      align: "left",
      baseline: "middle",
      opacity: state.zMarkerAlpha,
    });

    ctx.restore();
  }

  function drawAmbiguityLabels(state: AnimationState) {
    if (!ctx || !zPixel || !zPair) return;
    if (state.ambiguityAlpha <= 0) return;

    // Two leader lines from z toward each kept-pair target, labeled with
    // the class.
    const [i, j] = zPair;
    const classOfI = targetClasses[pairing[i]];
    const targetA_i = classOfI === 0 ? pairing[i] : pairing[j];
    const targetB_i = classOfI === 0 ? pairing[j] : pairing[i];

    const [ax, ay] = targetPixels[targetA_i];
    const [bx, by] = targetPixels[targetB_i];

    // Faint dashed lines z → target centroid for each class
    ctx.save();
    ctx.globalAlpha = state.ambiguityAlpha * 0.7;
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 1.5;

    ctx.strokeStyle = classAColor;
    ctx.beginPath();
    ctx.moveTo(zPixel.x, zPixel.y);
    ctx.lineTo(ax, ay);
    ctx.stroke();

    ctx.strokeStyle = classBColor;
    ctx.beginPath();
    ctx.moveTo(zPixel.x, zPixel.y);
    ctx.lineTo(bx, by);
    ctx.stroke();

    ctx.restore();

    // "class A?" / "class B?" labels near midpoints
    const midA = [(zPixel.x + ax) / 2, (zPixel.y + ay) / 2];
    const midB = [(zPixel.x + bx) / 2, (zPixel.y + by) / 2];

    drawText(ctx, "class A?", midA[0], midA[1] - 12, {
      font: "600 16px Helvetica, Arial, sans-serif",
      color: classAColor,
      opacity: state.ambiguityAlpha,
      align: "center",
      baseline: "bottom",
    });
    drawText(ctx, "class B?", midB[0], midB[1] + 12, {
      font: "600 16px Helvetica, Arial, sans-serif",
      color: classBColor,
      opacity: state.ambiguityAlpha,
      align: "center",
      baseline: "top",
    });
  }

  function drawConditioningLabel(state: AnimationState) {
    if (!ctx) return;
    if (state.conditioningAlpha <= 0) return;

    const cls = state.conditionedClass;
    const color = cls === 0 ? classAColor : cls === 1 ? classBColor : "#333";
    const text = cls === 0
      ? "Conditioned on class A"
      : cls === 1
        ? "Conditioned on class B"
        : "";

    drawText(ctx, text, width / 2, height - marginHeight / 2 + 6, {
      font: "600 18px Helvetica, Arial, sans-serif",
      color,
      opacity: state.conditioningAlpha,
      align: "center",
      baseline: "middle",
    });
  }

  function drawSourceTargetPoints(state: AnimationState) {
    if (!ctx || !scales) return;
    const op = state.fadeIn;

    drawScatterPlot(ctx, sourcePixels, pointRadius, sourcePointColor, op * 0.85);

    // Target points are colored by class.
    const classA: [number, number][] = [];
    const classB: [number, number][] = [];
    for (let i = 0; i < targetPixels.length; i++) {
      (targetClasses[i] === 0 ? classA : classB).push(targetPixels[i]);
    }
    drawScatterPlot(ctx, classA, pointRadius, classAColor, op * 0.95);
    drawScatterPlot(ctx, classB, pointRadius, classBColor, op * 0.95);
  }

  function drawHeaderLabels(state: AnimationState) {
    if (!ctx || !scales) return;
    const font = "600 17px Helvetica, Arial, sans-serif";
    const op = state.fadeIn;
    drawText(ctx, "Source (noise)", scales.sourceCenterPixelX, marginHeight / 2, {
      font,
      color: labelColor,
      opacity: op,
      align: "center",
      baseline: "middle",
    });
    drawText(ctx, "Target (two-class mixture)", scales.targetCenterPixelX, marginHeight / 2, {
      font,
      color: labelColor,
      opacity: op,
      align: "center",
      baseline: "middle",
    });
  }

  function draw(state: AnimationState) {
    if (!ctx || !isInitialized) return;
    ctx.clearRect(0, 0, width, height);

    // --- Static-ish background ---
    drawHeaderLabels(state);
    drawSourceTargetPoints(state);

    // --- Dynamic foreground ---
    drawCouplingLines(state);
    drawAmbiguityLabels(state);
    drawZMarker(state);
    drawConditioningLabel(state);
  }

  // ----------------------------------------------------------------
  // Event Handlers
  // ----------------------------------------------------------------
  // (no canvas interaction)

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  onDestroy(() => {
    if (timeline) timeline.pause();
  });

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  $: if (canvas && ctx && !isInitialized) {
    runInitialComputation();
    isInitialized = true;
    setupTimeline();
    draw(timeline?.state ?? initialState);
    if (playingByDefault) timeline?.play();
  }

  $: if (figureIsActive !== undefined && isInitialized) {
    handleVisibilityChange($figureIsActive === true);
  }
</script>

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
