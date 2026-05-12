<!--
  ContinuityEquationFigure

  Pointwise visualization of ∂p/∂t + ∇·(p v) = 0 at a single fixed point x.

  Both panes share a convergent vector field v = -k(x - p), so the density
  evolution and the local flow picture are internally consistent.

  LEFT pane (∂p/∂t at x):
    - A multi-modal Gaussian density contracts onto the fixed point. An SVG
      overlay shows a thin callout from the dot to a vertical bar on the
      right side of the canvas; the bar grows as p(x) grows.

  RIGHT pane (-∇·(p v) at x):
    - Same density (muted by a translucent white overlay) with GPU
      streamlines of the same convergent field flowing into the fixed point,
      clipped to a circular region around it.
-->

<script lang="ts">
  import { tick, onDestroy } from "svelte";
  import type { Writable } from "svelte/store";
  import {
    DoubleFigure,
    TimeSlider,
    useCanvas2D,
    useVisibilityHandler,
    Timeline,
    StreamlineAnimation,
    PulsingPathlineAnimation,
    computeContours,
    plotContours,
    drawMathjax,
    Katex,
    type VectorFieldFn,
    type StreamlineAnimationState,
    type PulsingPathlineAnimationState,
    type ComputedContours,
  } from "@diffusion-explorer/ui";
  import * as d3 from "d3";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  export let children: import("svelte").Snippet | undefined = undefined;

  // Layout
  export let width = 800;
  export let height = 340;
  export let gap = 20;
  export let backgroundVisible = false;

  // Fixed point + convergent field. The same field drives both the density
  // evolution (samples contract onto the point) and the streamline animation
  // on the right pane — so the visualization is internally consistent. A
  // small wavy component is added so pathlines curve and vary with position
  // (a pure linear sink is translation-invariant — pathlines would look
  // identical at every cursor location).
  export let fixedPoint: [number, number] = [0, 0];
  export let fieldStrength = 1.0;
  export let fieldWavyAmplitude = 0.7;
  export let fieldWavyFrequency = 3.0;
  export let domainHalfWidth = 1.1;

  // Density samples — Gaussian mixture positioned so the fixed point sits
  // inside the initial support (non-zero p(x) at t=0). Density then
  // contracts onto x under the convergent field.
  export let densityModes: Array<{
    mean: [number, number];
    cov: [[number, number], [number, number]];
    weight: number;
  }> = [
    { mean: [-0.1, 0.4], cov: [[0.08, 0.02], [0.02, 0.05]], weight: 0.4 },
    { mean: [0.1, -0.4], cov: [[0.07, 0], [0, 0.06]], weight: 0.35 },
    { mean: [0.4, 0.05], cov: [[0.05, -0.01], [-0.01, 0.06]], weight: 0.25 },
  ];
  export let numSamples = 3000;
  export let contourBandwidth = 10;
  export let contourGridSize = 400;
  export let contourThresholds = 5;
  export let contourOpacity = 0.4;
  export let contourColor = "#3b82f6"; // blue

  // Animation discretization — many frames over a short integration window,
  // so the contraction is gentle and the visual is smooth.
  export let contourAnimationSteps = 180;
  export let contourStepSize = 0.004;
  export let animationDuration = 6;

  // Right-pane visualization mode. Pathlines: integrate forward/backward
  // from seed points around x to show the local convergent flow. Streamlines:
  // GPU-rendered field streamlines clipped to a circle around x.
  export let rhsMode: "pathlines" | "streamlines" = "pathlines";

  // Streamlines (right pane) — fewer pulses per second with longer pulses.
  export let streamlineColor = "#f97316"; // orange
  export let streamlineDensity: number | [number, number] = 0.6;
  export let streamlineMinPathLength = 1.0;
  export let streamlineWidth = 3;
  export let pulseWidthPixels = 48;
  export let pulsePauseWidthPixels = 16;
  export let streamlinePulseFrequency = 0.25;
  // Show converging streamlines only within this circular radius (px) around
  // the fixed point, so the visual emphasizes the local convergence.
  export let streamlineClipRadius = 90;

  // Pulsing pathlines (right pane) — seed points sampled within a small
  // radius around the fixed point; each seed is propagated forward and
  // backward through the convergent field to build a pathline.
  export let pathlineColor = "#f97316"; // orange
  export let pathlineThickness = 3;
  export let pathSeedCount = 12;
  // Multiplier on the dot's pixel radius — seeds sit on a circle slightly
  // larger than the dot itself by default, so pathlines visibly emerge from
  // just outside x. Set to 1.0 to exactly match the dot.
  export let pathSeedRadiusInDotRadii = 1.0;
  // With seeds sitting on a tight circle around x, the forward leg is short
  // (a few steps get you to x), but the backward leg needs many steps to
  // reach far enough out that paths read as a real starburst.
  export let pathForwardSteps = 12;
  export let pathBackwardSteps = 90;
  export let pathStepSize = 0.04;
  export let pathPulseWidth = 60;
  export let pathPulseGap = 140;
  export let pathPulseFrequency = 0.25;

  // Translucent white mute between the density and the foreground layers.
  // The right pane uses a stronger mute so the orange streamlines/pathlines
  // really pop against the muted density.
  export let densityMuteColor = "#ffffff";
  export let densityMuteOpacity = 0.4;
  export let rightDensityMuteOpacity = 0.7;

  // Fixed point styling
  export let pointColor = "#374151";
  export let pointRadius = 6;
  export let pointLabel = "x";
  export let pointLabelFontSize = 28;
  export let pointLabelOffset: [number, number] = [0, -28];

  // Bar chart styling (overlaid vertical bar on the right side of the left canvas)
  // Blue to match the p_t(x) density color scheme on the LHS pane.
  export let barColor = "#3b82f6";
  export let barThickness = 18; // bar width in px
  export let barMaxHeight = 200; // bar height in px at p(x) = max
  export let barRightMargin = 36; // distance from canvas right edge to bar in px
  export let barCalloutColor = "#9ca3af";
  export let barCalloutGap = 4; // gap between dot edge and start of callout in px
  export let barLabelGap = 6; // gap between baseline and label in px
  export let barArrowLength = 36; // length of the ∂p/∂t axis arrow in px
  // EMA smoothing for the bar value — each tick blends toward the new
  // measurement by this fraction. Lower = smoother but laggier.
  export let barEmaAlpha = 0.18;
  export let barGridColor = "#d1d5db";
  export let barGridWidth = 1;
  export let barBaselineColor = "#9ca3af";
  export let barBaselineWidth = 1.5;
  // Callout matches the baseline thickness so the two read as one connected
  // elbow shape.
  export let barCalloutWidth = barBaselineWidth;

  export let playingByDefault = true;

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  let figureIsActive: Writable<boolean>;

  let leftCanvas: HTMLCanvasElement | null = null;
  let densityCanvas: HTMLCanvasElement | null = null; // 2D, behind streamlines
  let gpuCanvas: HTMLCanvasElement | null = null; // WebGPU, orange streamlines
  let dotCanvas: HTMLCanvasElement | null = null; // 2D, in front of streamlines (orange dot)

  const leftCanvas2d = useCanvas2D(width, height);
  const densityCanvas2d = useCanvas2D(width, height);
  const dotCanvas2d = useCanvas2D(width, height);

  let isInitialized = false;

  type AnimationState = StreamlineAnimationState &
    PulsingPathlineAnimationState & {
      contourFrame: number;
    };

  let timeline: Timeline<AnimationState> | null = null;
  let streamlineAnim: StreamlineAnimation<AnimationState> | null = null;
  let pathlineAnim: PulsingPathlineAnimation<AnimationState> | null = null;
  let activeField: VectorFieldFn | null = null;
  let contourFrames: ComputedContours[] = [];
  let densitySeries: number[] = []; // per-frame, normalized to [0, 1]
  let currentBarValue = 0; // reactive, drives the SVG bar width

  // Per-frame samples (so we can query density at an arbitrary point on hover)
  // and a global max density used for normalization so the bar scale is
  // consistent regardless of cursor position.
  let frameSamples: [number, number][][] = [];
  let globalMaxDensity = 1;
  let currentContourFrame = 0;

  // Cursor interactivity. When non-null, both panes hide the fixed x/dot and
  // a cursor dot is shown instead; the bar tracks density at this point.
  let cursorDomain: [number, number] | null = null;

  const { handleVisibilityChange } = useVisibilityHandler(() => timeline);

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  function getDomain() {
    const xMin = fixedPoint[0] - domainHalfWidth;
    const xMax = fixedPoint[0] + domainHalfWidth;
    const yMin = fixedPoint[1] - domainHalfWidth;
    const yMax = fixedPoint[1] + domainHalfWidth;
    return { xMin, xMax, yMin, yMax };
  }

  function toPixel(p: [number, number], cW: number, cH: number): [number, number] {
    const { xMin, xMax, yMin, yMax } = getDomain();
    return [
      ((p[0] - xMin) / (xMax - xMin)) * cW,
      ((yMax - p[1]) / (yMax - yMin)) * cH,
    ];
  }

  function boxMullerTransform(): [number, number] {
    const u1 = Math.random();
    const u2 = Math.random();
    const r = Math.sqrt(-2 * Math.log(u1));
    const theta = 2 * Math.PI * u2;
    return [r * Math.cos(theta), r * Math.sin(theta)];
  }

  function sampleGaussianMixture(
    n: number,
    modes: typeof densityModes
  ): [number, number][] {
    const samples: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const r = Math.random();
      let cumWeight = 0;
      let selected = modes[0];
      for (const g of modes) {
        cumWeight += g.weight;
        if (r <= cumWeight) {
          selected = g;
          break;
        }
      }
      const { mean, cov } = selected;
      const [z1, z2] = boxMullerTransform();
      // Cholesky decomposition of 2x2 covariance.
      const a = Math.sqrt(cov[0][0]);
      const b = cov[1][0] / a;
      const c = Math.sqrt(Math.max(0, cov[1][1] - b * b));
      samples.push([mean[0] + a * z1, mean[1] + b * z1 + c * z2]);
    }
    return samples;
  }

  function eulerIntegrate(
    samples: [number, number][],
    vectorField: VectorFieldFn,
    dt: number
  ): [number, number][] {
    return samples.map(([x, y]) => {
      const [vx, vy] = vectorField(x, y);
      return [x + vx * dt, y + vy * dt];
    });
  }

  function createConvergentField(
    p: [number, number],
    k: number,
    wavyAmp: number = 0,
    wavyFreq: number = 0
  ): VectorFieldFn {
    return (x, y) => [
      -k * (x - p[0]) + wavyAmp * Math.sin(wavyFreq * y),
      -k * (y - p[1]) - wavyAmp * Math.sin(wavyFreq * x),
    ];
  }

  /**
   * Sample seeds in a disc around `center` and integrate the field both
   * forward and backward from each one. Returns the resulting paths in
   * PIXEL coords ready to feed to PulsingPathlineAnimation.
   */
  function buildPathlines(
    field: VectorFieldFn,
    center: [number, number],
    seedRadius: number,
    seedCount: number,
    fwdSteps: number,
    bkwSteps: number,
    dt: number,
    cW: number,
    cH: number
  ): number[][][] {
    const paths: number[][][] = [];
    for (let i = 0; i < seedCount; i++) {
      // Evenly spaced points on the circle of radius `seedRadius` around
      // `center` — gives a regular starburst pattern rather than random
      // clustering.
      const theta = (2 * Math.PI * i) / seedCount;
      const sx = center[0] + seedRadius * Math.cos(theta);
      const sy = center[1] + seedRadius * Math.sin(theta);

      const bkw: [number, number][] = [];
      let bx = sx;
      let by = sy;
      for (let s = 0; s < bkwSteps; s++) {
        const [vx, vy] = field(bx, by);
        bx -= vx * dt;
        by -= vy * dt;
        bkw.push([bx, by]);
      }

      const fwd: [number, number][] = [];
      let fx = sx;
      let fy = sy;
      for (let s = 0; s < fwdSteps; s++) {
        const [vx, vy] = field(fx, fy);
        fx += vx * dt;
        fy += vy * dt;
        fwd.push([fx, fy]);
      }

      const pathDomain: [number, number][] = [
        ...bkw.reverse(),
        [sx, sy],
        ...fwd,
      ];
      paths.push(pathDomain.map((p) => toPixel(p, cW, cH)) as number[][]);
    }
    return paths;
  }

  function densityAtPoint(
    samples: [number, number][],
    p: [number, number],
    radius: number
  ): number {
    const r2 = radius * radius;
    let count = 0;
    for (const [x, y] of samples) {
      const dx = x - p[0];
      const dy = y - p[1];
      if (dx * dx + dy * dy <= r2) count++;
    }
    return count / (samples.length * Math.PI * r2);
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function runInitialComputation(cW: number, cH: number) {
    const field = createConvergentField(
      fixedPoint,
      fieldStrength,
      fieldWavyAmplitude,
      fieldWavyFrequency
    );
    activeField = field;
    const toPixelBound = (p: [number, number]) => toPixel(p, cW, cH);
    const domain = getDomain();

    if (rhsMode === "streamlines") {
      streamlineAnim = StreamlineAnimation.create<AnimationState>({
        backend: "gpu",
        vectorFieldFn: field,
        domain,
        toPixel: toPixelBound,
        density: streamlineDensity,
        minPathLength: streamlineMinPathLength,
        color: streamlineColor,
        strokeWidth: streamlineWidth,
        pulseWidthPixels,
        pulsePauseWidthPixels,
        offsets: "synchronized",
        duration: animationDuration,
        pulseFrequency: streamlinePulseFrequency,
      });
    } else {
      // Pre-cache pathlines around the original fixed point; we translate
      // the GPU canvas at runtime so they follow the cursor.
      const paths = buildPathlines(
        field,
        fixedPoint,
        pathSeedRadius,
        pathSeedCount,
        pathForwardSteps,
        pathBackwardSteps,
        pathStepSize,
        cW,
        cH
      );
      pathlineAnim = PulsingPathlineAnimation.create<AnimationState>({
        paths,
        color: pathlineColor,
        thickness: pathlineThickness,
        pulseWidth: pathPulseWidth,
        pulseGap: pathPulseGap,
        offsets: "synchronized",
        duration: animationDuration,
        pulseFrequency: pathPulseFrequency,
        showPreview: true,
        previewOpacity: 0.3,
      });
    }

    // Density: same convergent field driving the contours.
    let samples = sampleGaussianMixture(numSamples, densityModes);
    const contourDomain: [number, number, number, number] = [
      domain.xMin,
      domain.xMax,
      domain.yMin,
      domain.yMax,
    ];
    const densityRadius = domainHalfWidth * 0.08;

    // Probe grid for the global density max (used to normalize the bar so
    // its scale stays consistent as the cursor moves around).
    const probePoints: [number, number][] = [];
    const probeSide = 16;
    for (let i = 0; i < probeSide; i++) {
      for (let j = 0; j < probeSide; j++) {
        probePoints.push([
          domain.xMin + ((i + 0.5) / probeSide) * (domain.xMax - domain.xMin),
          domain.yMin + ((j + 0.5) / probeSide) * (domain.yMax - domain.yMin),
        ]);
      }
    }

    contourFrames = [];
    frameSamples = [];
    const rawDensity: number[] = [];
    let runningMax = 0;
    for (let i = 0; i < contourAnimationSteps; i++) {
      contourFrames.push(
        computeContours(samples, {
          bandwidth: contourBandwidth,
          gridSize: contourGridSize,
          thresholds: contourThresholds,
          domain: contourDomain,
        })
      );
      // Stash a copy of samples so we can query density at the cursor later.
      frameSamples.push(samples.map(([x, y]) => [x, y]));
      rawDensity.push(densityAtPoint(samples, fixedPoint, densityRadius));
      for (const p of probePoints) {
        const d = densityAtPoint(samples, p, densityRadius);
        if (d > runningMax) runningMax = d;
      }
      samples = eulerIntegrate(samples, field, contourStepSize);
    }
    globalMaxDensity = Math.max(runningMax, 1e-12);
    densitySeries = rawDensity.map((d) => d / globalMaxDensity);
  }

  function setupTimeline(cW: number, cH: number) {
    const rhsAnim = streamlineAnim ?? pathlineAnim;
    if (!rhsAnim) return;

    timeline = new Timeline<AnimationState>();
    timeline.initialState = {
      streamlinePhase: 0,
      pulsingPathlinePhase: 0,
      contourFrame: 0,
    };
    timeline.duration = animationDuration;
    timeline.looping = true;

    timeline.add(rhsAnim.clip, { start: 0, end: 1 });

    timeline.add(
      {
        name: "ContourFrame",
        reduce(t: number) {
          const idx = Math.min(
            Math.floor(t * contourAnimationSteps),
            contourAnimationSteps - 1
          );
          return { contourFrame: idx };
        },
      },
      { start: 0, end: 1 }
    );

    timeline.onTick((_t, state) => {
      currentContourFrame = state.contourFrame;
      drawLeft(state, cW, cH);
      drawRight(state, cW, cH);
      let target: number;
      if (cursorDomain) {
        const d = densityAtPoint(
          frameSamples[state.contourFrame] ?? [],
          cursorDomain,
          domainHalfWidth * 0.08
        );
        target = Math.min(1.5, d / globalMaxDensity);
      } else {
        target = densitySeries[state.contourFrame] ?? 0;
      }
      // Exponential moving average: each tick blends current value toward the
      // new sample by `barEmaAlpha`. Lower alpha → smoother but laggier.
      currentBarValue = currentBarValue + barEmaAlpha * (target - currentBarValue);
    });
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function drawDensityAndDot(
    ctx: CanvasRenderingContext2D,
    cf: ComputedContours,
    cW: number,
    cH: number,
    mute: boolean,
    muteOpacity: number = densityMuteOpacity
  ) {
    const toPixelBound = (p: [number, number]) => toPixel(p, cW, cH);

    plotContours(ctx, cf, {
      xScale: (x) => toPixelBound([x, 0])[0],
      yScale: (y) => toPixelBound([0, y])[1],
      fillColor: contourColor,
      opacity: contourOpacity,
      fill: true,
      stroke: false,
    });

    if (mute) {
      ctx.save();
      ctx.globalAlpha = muteOpacity;
      ctx.fillStyle = densityMuteColor;
      ctx.fillRect(0, 0, cW, cH);
      ctx.restore();
    }
  }

  function drawDot(
    ctx: CanvasRenderingContext2D,
    cW: number,
    cH: number,
    pos: [number, number] = fixedPoint
  ) {
    const [px, py] = toPixel(pos, cW, cH);
    // White halo
    ctx.fillStyle = "white";
    ctx.beginPath();
    ctx.arc(px, py, pointRadius + 2.5, 0, 2 * Math.PI);
    ctx.fill();
    // Dot
    ctx.fillStyle = pointColor;
    ctx.beginPath();
    ctx.arc(px, py, pointRadius, 0, 2 * Math.PI);
    ctx.fill();
    drawMathjax(
      ctx,
      pointLabel,
      px + pointLabelOffset[0],
      py + pointLabelOffset[1] + pointLabelFontSize / 2,
      pointLabelFontSize,
      0,
      0,
      // strokeWidth is in MathJax internal SVG units (≈ 1000 / em), so the
      // value needs to be large to read as a visible halo at fontSize.
      { color: pointColor, stroke: "white", strokeWidth: 110, strokeOpacity: 1 }
    );
  }

  function drawLeft(state: AnimationState, cW: number, cH: number) {
    const ctx = leftCanvas2d.ctx;
    const cf = contourFrames[state.contourFrame];
    if (!ctx || !cf) return;
    ctx.clearRect(0, 0, cW, cH);
    drawDensityAndDot(ctx, cf, cW, cH, /* mute */ true);
    const pos = cursorDomain ?? fixedPoint;
    drawDot(ctx, cW, cH, pos);
  }

  function drawRight(state: AnimationState, cW: number, cH: number) {
    // GPU streamlines / pathlines (middle z-layer)
    if (streamlineAnim?.initialized) {
      streamlineAnim.draw(state, [0, 0, 0, 0]);
    }
    if (pathlineAnim?.initialized) {
      pathlineAnim.draw(state, [0, 0, 0, 0]);
    }

    // Density + (stronger) mute on the back canvas so the orange streamlines
    // / pathlines on the GPU canvas above stand out against the density.
    const dctx = densityCanvas2d.ctx;
    const cf = contourFrames[state.contourFrame];
    if (dctx && cf) {
      dctx.clearRect(0, 0, cW, cH);
      drawDensityAndDot(dctx, cf, cW, cH, /* mute */ true, rightDensityMuteOpacity);
    }

    // Orange dot on the topmost canvas so it sits above the streamlines
    const tctx = dotCanvas2d.ctx;
    if (tctx) {
      tctx.clearRect(0, 0, cW, cH);
      const pos = cursorDomain ?? fixedPoint;
      drawDot(tctx, cW, cH, pos);
    }
  }

  // ----------------------------------------------------------------
  // Bar chart (d3 scale, Svelte template)
  // ----------------------------------------------------------------

  // Bar geometry — vertical bar overlaid on the right side of the left canvas.
  // Bar's bottom sits at the bottom of the canvas. A thin L-shaped callout
  // connects the orange dot to the top of the bar.
  $: dotPixel = canvasWidth && canvasHeight
    ? toPixel(cursorDomain ?? fixedPoint, canvasWidth, canvasHeight)
    : [0, 0];
  $: barHeightScale = d3.scaleLinear().domain([0, 1]).range([0, barMaxHeight]);
  $: barCurrentHeight = Math.max(0, barHeightScale(currentBarValue));
  $: barX = canvasWidth ? canvasWidth - barRightMargin - barThickness : 0;
  // Vertical bar chart on the LEFT side of the canvas, centered vertically.
  $: barX = barRightMargin;
  $: barCenterX = barX + barThickness / 2;
  $: barBottomY = canvasHeight && barMaxHeight
    ? (canvasHeight + barMaxHeight) / 2
    : canvasHeight;
  $: barTopY = barBottomY - barCurrentHeight;
  $: gridFractions = [0.25, 0.5, 0.75, 1.0];

  // Angled (diagonal) callout from the dot to the RIGHT side of the
  // vertical bar's BASE — the rightmost end of the baseline tick.
  $: barCalloutTargetX = barX + barThickness + 12;
  $: barCalloutTargetY = barBottomY;
  $: barCalloutStart = canvasWidth && canvasHeight
    ? (() => {
        const [dx, dy] = dotPixel;
        const vx = barCalloutTargetX - dx;
        const vy = barCalloutTargetY - dy;
        const len = Math.hypot(vx, vy) || 1;
        const off = pointRadius + barCalloutGap;
        return [dx + (vx / len) * off, dy + (vy / len) * off];
      })()
    : [0, 0];

  // Center of the streamline clip circle, in percentages of the GPU canvas.
  $: streamlineClipCenterPct = canvasWidth && canvasHeight
    ? (() => {
        const [px, py] = toPixel(fixedPoint, canvasWidth, canvasHeight);
        return [(px / canvasWidth) * 100, (py / canvasHeight) * 100];
      })()
    : [50, 50];

  // Translate the GPU canvas so the convergent pattern follows the cursor.
  // Only used in streamline mode — pathline mode recomputes paths at the
  // cursor position instead, so no translation is needed.
  $: gpuTranslate = cursorDomain && canvasWidth && canvasHeight && rhsMode === "streamlines"
    ? (() => {
        const [cx, cy] = toPixel(cursorDomain, canvasWidth, canvasHeight);
        const [fx, fy] = toPixel(fixedPoint, canvasWidth, canvasHeight);
        return [cx - fx, cy - fy];
      })()
    : [0, 0];

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  onDestroy(() => {
    if (timeline) timeline.pause();
    if (streamlineAnim) streamlineAnim.destroy();
    if (pathlineAnim) pathlineAnim.destroy();
  });

  // ----------------------------------------------------------------
  // Cursor interactivity
  // ----------------------------------------------------------------

  function eventToDomain(e: PointerEvent): [number, number] {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // Clamp the event coords to the canvas bounds so the cursor dot never
    // ends up outside the visible area (e.g., when the pointer is moving
    // between panes and the event fires with edge-of-rect coordinates).
    const xPx = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const yPx = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    const xCanvas = (xPx / rect.width) * canvasWidth;
    const yCanvas = (yPx / rect.height) * canvasHeight;
    const { xMin, xMax, yMin, yMax } = getDomain();
    return [
      xMin + (xCanvas / canvasWidth) * (xMax - xMin),
      yMax - (yCanvas / canvasHeight) * (yMax - yMin),
    ];
  }

  function handlePointerMove(e: PointerEvent) {
    if (!isInitialized) return;
    cursorDomain = eventToDomain(e);
  }

  function handlePointerLeave() {
    cursorDomain = null;
  }

  // Recompute pathlines whenever the active center (cursor or fixedPoint)
  // moves, so the wavy-field paths actually vary with location instead of
  // just being CSS-translated. Cheap (~1000 ODE steps + a GPU upload).
  $: if (
    rhsMode === "pathlines" &&
    pathlineAnim?.initialized &&
    activeField &&
    canvasWidth &&
    canvasHeight
  ) {
    const center = cursorDomain ?? fixedPoint;
    const newPaths = buildPathlines(
      activeField,
      center,
      pathSeedRadius,
      pathSeedCount,
      pathForwardSteps,
      pathBackwardSteps,
      pathStepSize,
      canvasWidth,
      canvasHeight
    );
    pathlineAnim.updatePaths(newPaths);
  }

  // Recompute the bar value whenever the cursor moves between ticks, so the
  // bar updates smoothly even when the cursor is held still and only the
  // contour frame is advancing. Same EMA smoothing as the tick path.
  $: if (cursorDomain && frameSamples.length > 0) {
    const d = densityAtPoint(
      frameSamples[currentContourFrame] ?? [],
      cursorDomain,
      domainHalfWidth * 0.08
    );
    const target = Math.min(1.5, d / globalMaxDensity);
    currentBarValue = currentBarValue + barEmaAlpha * (target - currentBarValue);
  }

  // ----------------------------------------------------------------
  // Reactive blocks
  // ----------------------------------------------------------------

  $: canvasWidth = Math.floor((width - gap) / 2);
  $: canvasHeight = height;
  // Pathline seed radius in DOMAIN units, derived from the dot's pixel radius
  // so the seed circle matches the visible dot.
  $: pathSeedRadius = canvasWidth
    ? (pointRadius * pathSeedRadiusInDotRadii * 2 * domainHalfWidth) / canvasWidth
    : 0.04;

  $: if (
    !isInitialized &&
    leftCanvas &&
    densityCanvas &&
    dotCanvas &&
    gpuCanvas
  ) {
    runInitialComputation(canvasWidth, canvasHeight);
    setupTimeline(canvasWidth, canvasHeight);
    isInitialized = true;
    tick().then(async () => {
      leftCanvas2d.resize(canvasWidth, canvasHeight);
      densityCanvas2d.resize(canvasWidth, canvasHeight);
      dotCanvas2d.resize(canvasWidth, canvasHeight);

      if (gpuCanvas) {
        const dpr = window.devicePixelRatio || 1;
        gpuCanvas.width = canvasWidth * dpr;
        gpuCanvas.height = canvasHeight * dpr;
        if (streamlineAnim) await streamlineAnim.init(gpuCanvas);
        else if (pathlineAnim) await pathlineAnim.init(gpuCanvas);
      }

      if (timeline) {
        drawLeft(timeline.initialState, canvasWidth, canvasHeight);
        drawRight(timeline.initialState, canvasWidth, canvasHeight);
        currentBarValue = densitySeries[0] ?? 0;
        if (playingByDefault) timeline.play();
      }
    });
  }

  $: if (figureIsActive !== undefined && isInitialized) {
    handleVisibilityChange($figureIsActive);
  }
</script>

<div class="continuity-equation-equation">
  <div class="equation-grid">
    <div class="grid-label grid-label-left">
      Rate of change of <span style="color: #3b82f6;">density</span>
    </div>
    <div class="grid-label-spacer"></div>
    <div class="grid-label grid-label-right">
      Divergence of <span style="color: #f97316;">probability flux</span>
    </div>
    <div class="grid-label-spacer"></div>

    <div class="grid-math">
      <Katex math={"\\frac{\\partial \\textcolor{#3b82f6}{p_t(x)}}{\\partial t}"} displayMode={true} />
    </div>
    <div class="grid-equals">
      <Katex math={"+"} displayMode={true} />
    </div>
    <div class="grid-math">
      <Katex math={"\\nabla \\cdot \\textcolor{#f97316}{p_t v_t}"} displayMode={true} />
    </div>
    <div class="grid-equals">
      <Katex math={"= \\; 0"} displayMode={true} />
    </div>
  </div>
</div>

<DoubleFigure {gap} {backgroundVisible} bind:isActive={figureIsActive}>
  {#snippet left()}
    <div
      class="left-canvas-container"
      style="width: 100%; aspect-ratio: {canvasWidth}/{canvasHeight};"
      onpointermove={handlePointerMove}
      onpointerleave={handlePointerLeave}
    >
      <canvas
        bind:this={leftCanvas}
        use:leftCanvas2d.bindCanvas
        class="density-canvas"
      ></canvas>
      <!-- Horizontal bar-chart overlay at the bottom of the canvas:
           gridlines, baseline tick, callout from the dot, the bar itself,
           and a ∂p_t(x)/∂t axis arrow extending to the right. -->
      <svg
        class="bar-overlay"
        viewBox="0 0 {canvasWidth} {canvasHeight}"
        preserveAspectRatio="none"
      >
        <defs>
          <marker
            id="ce-axis-arrowhead"
            markerWidth="5"
            markerHeight="5"
            refX="2.5"
            refY="2.5"
            orient="auto"
          >
            <polygon points="0 0, 5 2.5, 0 5" fill={barColor} />
          </marker>
        </defs>
        {#each gridFractions as frac}
          <line
            x1={barX - 8}
            y1={barBottomY - frac * barMaxHeight}
            x2={barX + barThickness + 8}
            y2={barBottomY - frac * barMaxHeight}
            stroke={barGridColor}
            stroke-width={barGridWidth}
          />
        {/each}
        <line
          x1={barX - 12}
          y1={barBottomY}
          x2={barX + barThickness + 12}
          y2={barBottomY}
          stroke={barBaselineColor}
          stroke-width={barBaselineWidth}
        />
        <!-- Angled (diagonal) callout from the dot to the LEFT side of the
             bar's baseline tick. -->
        <line
          x1={barCalloutStart[0]}
          y1={barCalloutStart[1]}
          x2={barCalloutTargetX}
          y2={barCalloutTargetY}
          stroke={barCalloutColor}
          stroke-width={barCalloutWidth}
        />
        <rect
          x={barX}
          y={barTopY}
          width={barThickness}
          height={barCurrentHeight}
          fill={barColor}
          rx="2"
        />
        <!-- Axis arrow centered on the bar, always pointing up. Length is
             fixed so the arrow stays a recognizable size at every value. -->
        <line
          x1={barCenterX}
          y1={barTopY}
          x2={barCenterX}
          y2={barTopY - barArrowLength}
          stroke={barColor}
          stroke-width="2.5"
          marker-end="url(#ce-axis-arrowhead)"
        />
      </svg>
      <!-- ∂p_t(x)/∂t label, to the LEFT of the bar's axis arrow,
           vertically centered on the arrow midpoint. -->
      <div
        class="dpdt-label"
        style="
          left: {((barCenterX - 20) / canvasWidth) * 100}%;
          top: {((barTopY - barArrowLength / 2) / canvasHeight) * 100}%;
        "
      >
        <Katex math={`\\textcolor{${barColor}}{\\frac{\\partial p_t(x)}{\\partial t}}`} />
      </div>
      <div
        class="bar-label"
        style="
          left: {(barCenterX / canvasWidth) * 100}%;
          top: {((barBottomY + barLabelGap) / canvasHeight) * 100}%;
        "
      >
        <Katex math={`\\color{${barColor}} p_t(x)`} />
      </div>
    </div>
  {/snippet}

  {#snippet right()}
    <div
      class="right-canvas-container"
      style="width: 100%; aspect-ratio: {canvasWidth}/{canvasHeight};"
      onpointermove={handlePointerMove}
      onpointerleave={handlePointerLeave}
    >
      <!-- Back: density + mute -->
      <canvas
        bind:this={densityCanvas}
        use:densityCanvas2d.bindCanvas
        class="back-canvas"
      ></canvas>
      <!-- Middle: GPU streamlines, clipped to a circular region around the
           fixed point so the visual emphasizes the local convergence. -->
      <canvas
        bind:this={gpuCanvas}
        class="gpu-canvas"
        style="
          {rhsMode === 'streamlines'
            ? `clip-path: circle(${streamlineClipRadius}px at ${streamlineClipCenterPct[0]}% ${streamlineClipCenterPct[1]}%);`
            : ''}
          transform: translate({gpuTranslate[0]}px, {gpuTranslate[1]}px);
          transition: transform 0.05s linear;
        "
      ></canvas>
      <!-- Front: orange dot label -->
      <canvas
        bind:this={dotCanvas}
        use:dotCanvas2d.bindCanvas
        class="front-canvas"
      ></canvas>
    </div>
  {/snippet}

  {#snippet footer()}
    <TimeSlider
      timeline={timeline as import("@diffusion-explorer/ui").Timeline<unknown> | null}
      color="#9ca3af"
    />
  {/snippet}

  {#snippet caption()}
    {@render children?.()}
  {/snippet}
</DoubleFigure>

<style>
  .continuity-equation-equation {
    text-align: center;
    margin-bottom: 0;
    color: #374151;
  }

  .equation-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto;
    grid-template-rows: auto auto;
    column-gap: 0.15rem;
    row-gap: 1.1rem;
    justify-items: center;
  }

  .grid-label {
    font-size: 1.5rem;
    color: #666;
    text-align: center;
    line-height: 1.4;
    max-width: 350px;
    align-self: end;
  }

  .grid-label-spacer {
    /* placeholder over the equals sign */
  }

  .grid-math,
  .grid-equals {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.4rem;
    align-self: center;
  }

  .continuity-equation-equation + :global(.double-figure) {
    margin-top: 0;
  }

  .left-canvas-container,
  .right-canvas-container {
    position: relative;
    cursor: crosshair;
  }

  .left-canvas-container {
    /* Breathing room to the LEFT of the canvas so the bar chart's labels
       don't crowd the figure-content's left edge. */
    margin-left: 24px;
  }

  .density-canvas {
    width: 100%;
    height: 100%;
    display: block;
  }

  .bar-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    overflow: visible;
  }

  .bar-label {
    position: absolute;
    /* Horizontally centered at `left`, top edge at `top` — sits BELOW the
       reference y. */
    transform: translate(-50%, 0);
    color: #374151;
    font-size: 1.5rem;
    line-height: 1;
    pointer-events: none;
    white-space: nowrap;
  }

  .dpdt-label {
    position: absolute;
    /* Anchor right edge at `left` and vertical center at `top` — sits to
       the LEFT of the reference x, vertically centered on it. */
    transform: translate(-100%, -50%);
    font-size: 1.5rem;
    line-height: 1;
    pointer-events: none;
    white-space: nowrap;
  }

  /* Rotate labels 90° counter-clockwise so they read bottom-to-top —
     standard "y-axis label" orientation. The label's center stays at
     (left, top). */
  .rotated-label {
    transform: translate(-50%, -50%) rotate(-90deg);
    transform-origin: center;
  }

  .back-canvas,
  .gpu-canvas,
  .front-canvas {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
  }

  .back-canvas {
    z-index: 0;
  }

  .gpu-canvas {
    z-index: 1;
  }

  .front-canvas {
    z-index: 2;
  }
</style>
