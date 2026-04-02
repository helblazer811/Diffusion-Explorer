<!-- Animated visualization of an independent coupling between source and target distributions.
     Lines animate from left to right connecting randomly paired source and target points. -->

<script lang="ts">
  import { onDestroy, type Snippet } from "svelte";
  import type { Writable } from "svelte/store";
  import { Figure, drawScatterPlot, drawText, drawMathjax, createSourceTargetScales, Timeline, useCanvas2D, useVisibilityHandler, shuffleArray } from "@diffusion-explorer/ui";
  import { settings } from "$lib/settings";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  // Caption slot (passed as default children)
  export let children: Snippet | undefined = undefined;

  // Data props (from parent +page.svelte)
  export let sourceDistributionSamples: number[][] = [];
  export let targetDistributionSamples: number[][] = [];

  // Layout
  export let width = 800;
  export let height = 450;
  export let marginWidth = 50;
  export let marginHeight = 20;

  // Styling
  export let sourcePointColor = settings.stylingSettings.scatterPlot.color;
  export let targetPointColor = '#f17720';
  export let pointRadius = settings.stylingSettings.scatterPlot.radius;
  export let pointOpacity = settings.stylingSettings.scatterPlot.opacity;
  export let sourceCenterX = settings.stylingSettings.layout.sourceCenterX;
  export let targetCenterX = settings.stylingSettings.layout.targetCenterX;
  export let yShiftFactor = settings.stylingSettings.scatterPlot.yShiftFactor;
  export let distributionScaleFactor = settings.stylingSettings.scatterPlot.scaleFactor;

  // Label styling
  export let labelFontSize = settings.stylingSettings.label.fontSize;
  export let sourceLabel = "Source Distribution";
  export let targetLabel = "Target Distribution";
  export let useLatexLabels = false;

  // Coupling line styling
  export let couplingLineColor = '#888';
  export let couplingLineOpacity = 0.4;
  export let couplingLineWidth = 2;
  export let numLinesToDraw = 80;
  export let numScatterSamples = 100;

  // Animation settings
  export let animationDuration = 6000;
  export let lineAnimationEnd = 0.5;   // Lines finish animating at this fraction
  export let holdEnd = 1.0;            // Hold fully drawn lines until end

  // Background visibility
  export let backgroundVisible = true;

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  // Canvas
  let canvas: HTMLCanvasElement | null = null;
  const canvas2d = useCanvas2D(width, height);

  // Scales and pre-computed coordinates
  let scales: ReturnType<typeof createSourceTargetScales> | null = null;
  let sourcePixelCoords: number[][] = [];
  let targetPixelCoords: number[][] = [];
  let shuffledTargetIndices: number[] = [];

  // Animation state type
  type AnimationState = {
    couplingProgress: number;  // 0 → 1 for line animation (left to right)
  };

  // Animation state
  let timeline: Timeline<AnimationState> | null = null;

  // Visibility-based animation control
  let figureIsActive: Writable<boolean> | undefined;
  const { handleVisibilityChange } = useVisibilityHandler(() => timeline);
  let isInitialized = false;

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function runInitialComputation() {
    if (!canvas) return;
    if (sourceDistributionSamples.length === 0 || targetDistributionSamples.length === 0) return;

    // Create scales
    scales = createSourceTargetScales(
      sourceDistributionSamples,
      targetDistributionSamples,
      {
        width,
        height,
        marginWidth,
        marginHeight,
        sourceCenterX,
        targetCenterX,
        yShiftFactor,
        distributionScaleFactor,
      }
    );

    // Pre-compute source pixel coordinates
    const numSrc = Math.min(numScatterSamples, sourceDistributionSamples.length);
    sourcePixelCoords = [];
    for (let i = 0; i < numSrc; i++) {
      const p = sourceDistributionSamples[i];
      sourcePixelCoords.push([
        scales.sourceCenterPixelX + (p[0] - scales.sourceMeanX) * scales.xScaleFactor,
        scales.yScale(p[1]),
      ]);
    }

    // Pre-compute target pixel coordinates (randomly sampled)
    const targetIndices = Array.from({ length: targetDistributionSamples.length }, (_, i) => i);
    shuffleArray(targetIndices);
    const numTgt = Math.min(numScatterSamples, targetDistributionSamples.length);
    targetPixelCoords = [];
    for (let i = 0; i < numTgt; i++) {
      const p = targetDistributionSamples[targetIndices[i]];
      targetPixelCoords.push([
        scales.targetCenterPixelX + (p[0] - scales.targetMeanX) * scales.xScaleFactor,
        scales.yScale(p[1]),
      ]);
    }

    // Create shuffled pairings for coupling lines
    const numPairs = Math.min(numLinesToDraw, sourcePixelCoords.length, targetPixelCoords.length);
    shuffledTargetIndices = Array.from({ length: targetPixelCoords.length }, (_, i) => i);
    shuffleArray(shuffledTargetIndices);
    shuffledTargetIndices = shuffledTargetIndices.slice(0, numPairs);
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  function setupTimeline() {
    timeline = new Timeline<AnimationState>();
    timeline.initialState = { couplingProgress: 0 };

    // Clip: animate coupling lines from left to right
    timeline.add(
      {
        name: "CouplingLines",
        reduce(t: number) {
          const normalizedEnd = lineAnimationEnd / holdEnd;
          if (t < normalizedEnd) {
            return { couplingProgress: t / normalizedEnd };
          }
          return { couplingProgress: 1 };
        }
      },
      { start: 0, end: 1 }
    );

    timeline.duration = animationDuration / 1000;
    timeline.looping = true;

    timeline.onTick((_t, state) => {
      draw(state);
    });
  }

  function startAnimation() {
    if (!timeline) return;
    timeline.play();
  }

  function stopAnimation() {
    if (timeline) timeline.pause();
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function drawLabels() {
    if (!ctx || !scales) return;
    const labelColor = settings.stylingSettings.label.color;
    const labelFontWeight = settings.stylingSettings.label.fontWeight;
    const labelOpacity = settings.stylingSettings.label.opacity;
    const labelY = marginHeight / 2;

    if (useLatexLabels) {
      const requestRedraw = () => { if (timeline) draw(timeline.state); };
      drawMathjax(ctx, sourceLabel, scales.sourceCenterPixelX, labelY + labelFontSize, labelFontSize, 0, labelFontSize * 1.0, { color: labelColor }, requestRedraw);
      drawMathjax(ctx, targetLabel, scales.targetCenterPixelX, labelY + labelFontSize, labelFontSize, 0, labelFontSize * 1.0, { color: labelColor }, requestRedraw);
    } else {
      const labelFont = `${labelFontWeight} ${labelFontSize}px Libre Baskerville, Georgia, serif`;
      drawText(ctx, sourceLabel, scales.sourceCenterPixelX, labelY, {
        font: labelFont, color: labelColor, opacity: labelOpacity, align: "center", baseline: "top",
      });
      drawText(ctx, targetLabel, scales.targetCenterPixelX, labelY, {
        font: labelFont, color: labelColor, opacity: labelOpacity, align: "center", baseline: "top",
      });
    }
  }

  function drawCouplingLines(progress: number) {
    if (!ctx || !sourcePixelCoords.length || !targetPixelCoords.length) return;

    ctx.strokeStyle = couplingLineColor;
    ctx.lineWidth = couplingLineWidth;
    ctx.globalAlpha = couplingLineOpacity;

    const linesToDraw = Math.min(numLinesToDraw, sourcePixelCoords.length, shuffledTargetIndices.length);
    for (let i = 0; i < linesToDraw; i++) {
      const [sx, sy] = sourcePixelCoords[i];
      const targetIdx = shuffledTargetIndices[i];
      const [tx, ty] = targetPixelCoords[targetIdx];

      // Animate from source to target
      const endX = sx + (tx - sx) * progress;
      const endY = sy + (ty - sy) * progress;

      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(endX, endY);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
  }

  function draw(state: AnimationState) {
    if (!ctx || !isInitialized) return;
    ctx.clearRect(0, 0, width, height);

    // --- Static Background ---
    drawLabels();
    drawScatterPlot(ctx, sourcePixelCoords, pointRadius, sourcePointColor, pointOpacity);
    drawScatterPlot(ctx, targetPixelCoords, pointRadius, targetPointColor, pointOpacity);

    // --- Dynamic Foreground ---
    if (state.couplingProgress > 0) {
      drawCouplingLines(state.couplingProgress);
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

  $: caption = children;
  $: ctx = canvas && canvas2d.ctx;

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
    startAnimation();
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
