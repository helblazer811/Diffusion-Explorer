<!-- Visualizes stochastic interpolation: a deterministic linear path (blue) contrasted with a noisy stochastic interpolant path (orange). -->

<script lang="ts">
  import { onDestroy } from "svelte";
  import type { Snippet } from "svelte";
  import type { Writable } from "svelte/store";
  import { Figure, TimeSlider, drawScatterPlot, drawText, drawMathjax, createSourceTargetScales, Timeline, createPauseClip, useCanvas2D, useVisibilityHandler } from "@diffusion-explorer/ui";
  import { settings } from "$lib/settings";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  export let children: Snippet | undefined = undefined;

  // Data props
  export let sourceDistributionSamples: [number, number][] = [];
  export let targetDistributionSamples: [number, number][] = [];

  // Point selection for the line
  export let sourcePointIndex = 0;
  export let targetPointIndex = 0;

  // Stochastic interpolant params
  export let sigma = 40.0;
  export let numPathSteps = 200;
  export let numPaths = 5;

  // Colors
  export let sourcePointColor = settings.stylingSettings.scatterPlot.color;
  export let targetPointColor = settings.stylingSettings.scatterPlot.color;
  export let linearLineColor = '#3b82f6';
  export let stochasticLineColor = '#f17720';
  export let linearDotColor = '#3b82f6';
  export let stochasticDotColor = '#f17720';

  // Animation
  export let animationDuration = 4000;
  export let pauseDuration = 500;
  export let playingByDefault = true;

  // Layout/Styling
  export let width = 800;
  export let height = 450;
  export let marginWidth = 50;
  export let marginHeight = 20;
  export let sourceCenterX = settings.stylingSettings.layout.sourceCenterX;
  export let targetCenterX = settings.stylingSettings.layout.targetCenterX;
  export let pointRadius = settings.stylingSettings.scatterPlot.radius;
  export let pointOpacity = settings.stylingSettings.scatterPlot.opacity;
  export let yShiftFactor = settings.stylingSettings.scatterPlot.yShiftFactor;
  export let lineWidth = 5;
  export let animatedDotRadius = 6;
  export let labelFontSize = settings.stylingSettings.label.fontSize;
  export let labelFontWeight = settings.stylingSettings.label.fontWeight;
  export let labelColor = settings.stylingSettings.label.color;
  export let labelOpacity = settings.stylingSettings.label.opacity;
  export let sourceLabelText = "Source Distribution";
  export let targetLabelText = "Target Distribution";

  // Background visibility
  export let backgroundVisible = true;

  // Show/hide equation at bottom
  export let showEquation = true;

  // LaTeX label styling
  export let latexLabelOffsetY = settings.stylingSettings.figureLatex.latexLabelOffsetY;
  export let latexFontSize = settings.stylingSettings.figureLatex.fontSize;

  // Show linear dot
  export let showLinearDot = true;

  // Max norm for epsilon (clamp epsilon vector if norm exceeds this)
  export let maxEpsilonNorm: number | null = null;

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  $: caption = children;

  let canvas: HTMLCanvasElement | null = null;
  const canvas2d = useCanvas2D(width, height);
  $: ctx = canvas && canvas2d.ctx;

  type AnimationState = {
    time: number;           // progress within current path (0→1)
    activePathIndex: number; // which path is currently animating
  };

  let scales: ReturnType<typeof createSourceTargetScales> | null = null;
  let sourcePixelCoords: number[][] = [];
  let targetPixelCoords: number[][] = [];
  let sourcePointPixel: number[] = [0, 0];
  let targetPointPixel: number[] = [0, 0];

  // Pre-computed noisy paths in pixel coordinates (one per epsilon)
  let noisyPaths: [number, number][][] = [];

  let isInitialized = false;
  let timeline: Timeline<AnimationState> | null = null;
  let displayTime: number = 0;

  let figureIsActive: Writable<boolean>;
  const { handleVisibilityChange } = useVisibilityHandler(() => timeline);

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  function randn(): number {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  function precomputeScatterCoords() {
    if (!scales) return;

    sourcePixelCoords = sourceDistributionSamples.map((p: [number, number]) => [
      scales.sourceCenterPixelX + (p[0] - scales.sourceMeanX) * scales.xScaleFactor,
      scales.yScale(p[1]),
    ]);

    targetPixelCoords = targetDistributionSamples.map((p: [number, number]) => [
      scales.targetCenterPixelX + (p[0] - scales.targetMeanX) * scales.xScaleFactor,
      scales.yScale(p[1]),
    ]);

    const sp = sourceDistributionSamples[sourcePointIndex];
    const tp = targetDistributionSamples[targetPointIndex];
    if (sp && tp) {
      sourcePointPixel = [
        scales.sourceCenterPixelX + (sp[0] - scales.sourceMeanX) * scales.xScaleFactor,
        scales.yScale(sp[1]),
      ];
      targetPointPixel = [
        scales.targetCenterPixelX + (tp[0] - scales.targetMeanX) * scales.xScaleFactor,
        scales.yScale(tp[1]),
      ];
    }
  }

  function precomputeNoisyPath(): [number, number][] {
    // Sample a single epsilon per dimension for the entire trajectory
    let epsilonX = randn();
    let epsilonY = randn();

    // Clamp epsilon vector norm if it exceeds maxEpsilonNorm
    if (maxEpsilonNorm !== null) {
      const norm = Math.sqrt(epsilonX * epsilonX + epsilonY * epsilonY);
      if (norm > maxEpsilonNorm) {
        const scale = maxEpsilonNorm / norm;
        epsilonX *= scale;
        epsilonY *= scale;
      }
    }

    const path: [number, number][] = [];
    for (let i = 0; i <= numPathSteps; i++) {
      const t = i / numPathSteps;
      const noiseScale = sigma * (1 - t) * t;
      const x = sourcePointPixel[0] + t * (targetPointPixel[0] - sourcePointPixel[0]) + noiseScale * epsilonX;
      const y = sourcePointPixel[1] + t * (targetPointPixel[1] - sourcePointPixel[1]) + noiseScale * epsilonY;
      path.push([x, y]);
    }
    return path;
  }

  function getPointOnPath(path: [number, number][], t: number): [number, number] {
    const idx = t * numPathSteps;
    const lo = Math.floor(idx);
    const hi = Math.min(lo + 1, numPathSteps);
    const frac = idx - lo;
    return [
      path[lo][0] + frac * (path[hi][0] - path[lo][0]),
      path[lo][1] + frac * (path[hi][1] - path[lo][1]),
    ];
  }

  function drawLine(x1: number, y1: number, x2: number, y2: number, color: string, lineW: number, opacity: number = 1) {
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineW;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  function drawPolyline(points: [number, number][], color: string, lineW: number, opacity: number = 1) {
    if (points.length < 2) return;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineW;
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i][0], points[i][1]);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawCircle(x: number, y: number, radius: number, color: string, opacity: number = 1) {
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function runInitialComputation() {
    if (!canvas) return;
    if (sourceDistributionSamples.length === 0 || targetDistributionSamples.length === 0) return;

    scales = createSourceTargetScales(sourceDistributionSamples, targetDistributionSamples, {
      width,
      height,
      marginWidth,
      marginHeight,
      sourceCenterX,
      targetCenterX,
      yShiftFactor,
    });

    precomputeScatterCoords();
    noisyPaths = [];
    for (let i = 0; i < numPaths; i++) {
      noisyPaths.push(precomputeNoisyPath());
    }
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  function setupTimeline() {
    timeline = new Timeline<AnimationState>();
    timeline.initialState = { time: 0, activePathIndex: 0 };

    // Each path gets: forward animation + pause
    // Total segments = numPaths * (forward + pause)
    const segmentDuration = animationDuration + pauseDuration;
    const totalDuration = numPaths * segmentDuration;

    for (let i = 0; i < numPaths; i++) {
      const segStart = (i * segmentDuration) / totalDuration;
      const forwardEnd = (i * segmentDuration + animationDuration) / totalDuration;
      const segEnd = ((i + 1) * segmentDuration) / totalDuration;

      const pathIndex = i;
      timeline.add({
        name: `Forward-${i}`,
        reduce(t: number) {
          return { time: t, activePathIndex: pathIndex };
        }
      }, { start: segStart, end: forwardEnd });

      timeline.add(createPauseClip(), { start: forwardEnd, end: segEnd });
    }

    timeline.duration = totalDuration / 1000;
    timeline.looping = true;

    timeline.onTick((_t, state) => {
      displayTime = state.time;
      draw(state);
    });
  }

  function startAnimation() {
    if (!timeline) return;
    timeline.play();
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function draw(state: AnimationState) {
    if (!ctx || !isInitialized) return;
    ctx.clearRect(0, 0, width, height);

    // --- Static Background ---
    const textY = marginHeight / 2;
    if (sourceLabelText) {
      drawText(ctx, sourceLabelText, scales.sourceCenterPixelX, textY, {
        font: `${labelFontWeight} ${labelFontSize}px Libre Baskerville, Georgia, serif`,
        color: labelColor,
        opacity: labelOpacity,
        align: "center",
        baseline: "top",
      });
    }
    if (targetLabelText) {
      drawText(ctx, targetLabelText, scales.targetCenterPixelX, textY, {
        font: `${labelFontWeight} ${labelFontSize}px Libre Baskerville, Georgia, serif`,
        color: labelColor,
        opacity: labelOpacity,
        align: "center",
        baseline: "top",
      });
    }

    // Draw scatter plots
    drawScatterPlot(ctx, sourcePixelCoords, pointRadius, sourcePointColor, pointOpacity);
    drawScatterPlot(ctx, targetPixelCoords, pointRadius, targetPointColor, pointOpacity);

    // Draw deterministic linear path (blue)
    drawLine(
      sourcePointPixel[0], sourcePointPixel[1],
      targetPointPixel[0], targetPointPixel[1],
      linearLineColor, lineWidth, 0.8
    );

    // Draw endpoints
    drawCircle(sourcePointPixel[0], sourcePointPixel[1], pointRadius, linearLineColor);
    drawCircle(targetPointPixel[0], targetPointPixel[1], pointRadius, linearLineColor);

    // --- Dynamic Foreground ---
    const t = state.time;
    const activeIdx = state.activePathIndex;

    // Draw completed paths fully
    for (let i = 0; i < activeIdx; i++) {
      drawPolyline(noisyPaths[i], stochasticLineColor, lineWidth - 1, 0.6);
    }

    // Draw active path up to current time
    if (activeIdx < noisyPaths.length) {
      const endStep = Math.ceil(t * numPathSteps);
      drawPolyline(noisyPaths[activeIdx].slice(0, endStep + 1), stochasticLineColor, lineWidth - 1, 0.8);
    }

    // Linear dot (blue)
    if (showLinearDot) {
      const linX = sourcePointPixel[0] + t * (targetPointPixel[0] - sourcePointPixel[0]);
      const linY = sourcePointPixel[1] + t * (targetPointPixel[1] - sourcePointPixel[1]);
      drawCircle(linX, linY, animatedDotRadius, linearDotColor);
    }

    // Stochastic dot on active path (orange)
    if (activeIdx < noisyPaths.length) {
      const [stochX, stochY] = getPointOnPath(noisyPaths[activeIdx], t);
      drawCircle(stochX, stochY, animatedDotRadius + 1, stochasticDotColor);
    }

    // LaTeX labels
    const latexColor = settings.stylingSettings.figureLatex.color;

    drawMathjax(
      ctx, "x_0", sourcePointPixel[0], sourcePointPixel[1],
      latexFontSize, 0, latexLabelOffsetY, { color: latexColor }
    );

    drawMathjax(
      ctx, "x_1", targetPointPixel[0], targetPointPixel[1],
      latexFontSize, 0, latexLabelOffsetY, { color: latexColor }
    );

    // Formula at bottom center
    if (showEquation) {
      drawMathjax(
        ctx, "x_t \\sim X_t = (1-t)X_0 + tX_1 + \\sigma(1-t)t\\varepsilon", width / 2, height - marginHeight,
        latexFontSize, 0, 15, { color: latexColor }
      );
    }
  }

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  onDestroy(() => {
    if (timeline) timeline.pause();
  });

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  $: if (
    !isInitialized &&
    sourceDistributionSamples.length > 0 &&
    targetDistributionSamples.length > 0 &&
    canvas
  ) {
    runInitialComputation();
    setupTimeline();
    isInitialized = true;
    draw(timeline!.initialState);
    if (playingByDefault) startAnimation();
  }

  $: if (figureIsActive !== undefined && isInitialized) {
    handleVisibilityChange($figureIsActive);
  }
</script>

<Figure {caption} {backgroundVisible} bind:isActive={figureIsActive}>
  {#snippet children()}
    <div style="display: flex; flex-direction: column; align-items: center; width: 100%;">
      <div style="width: 100%; max-width: {width}px;">
        <canvas
          bind:this={canvas}
          use:canvas2d.bindCanvas
          style="width: 100%; height: auto; aspect-ratio: {width}/{height};"
        ></canvas>
      </div>
    </div>
  {/snippet}
</Figure>
