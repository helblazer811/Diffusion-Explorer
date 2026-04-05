<!-- Animated visualization of a coupling that draws pairs one at a time with labels.
     Each pair shows x_0, x_1 labels temporarily and (x_0, x_1) above the connecting line. -->

<script lang="ts">
  import { onDestroy, type Snippet } from "svelte";
  import type { Writable } from "svelte/store";
  import { Figure, drawScatterPlot, drawMathjax, createSourceTargetScales, Timeline, useCanvas2D, useVisibilityHandler, shuffleArray } from "@diffusion-explorer/ui";
  import { settings } from "$lib/settings";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  export let children: Snippet | undefined = undefined;

  // Data props
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
  export let sourceLabel = "\\pi(X_0)";
  export let targetLabel = "\\pi(X_1)";
  export let latexFontSize = 40;

  // Coupling line styling
  export let couplingLineColor = '#888';
  export let couplingLineOpacity = 0.5;
  export let couplingLineWidth = 4;
  export let numScatterSamples = 100;

  // Pair animation settings
  export let numPairs = 10;
  export let pairDuration = 2000;     // ms per pair
  export let pairLabelColor = '#333';
  export let highlightSourceColor = '#3b82f6';
  export let highlightTargetColor = '#f17720';
  export let highlightRadius = 10;

  // Background visibility
  export let backgroundVisible = true;

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  let canvas: HTMLCanvasElement | null = null;
  const canvas2d = useCanvas2D(width, height);

  let scales: ReturnType<typeof createSourceTargetScales> | null = null;
  let sourcePixelCoords: number[][] = [];
  let targetPixelCoords: number[][] = [];

  // Pairs: each is { sourceIdx, targetIdx }
  let pairs: { sourceIdx: number; targetIdx: number }[] = [];

  type AnimationState = {
    t: number; // 0→1 over the entire animation
  };

  let timeline: Timeline<AnimationState> | null = null;
  let figureIsActive: Writable<boolean> | undefined;
  const { handleVisibilityChange } = useVisibilityHandler(() => timeline);
  let isInitialized = false;

  // Track loop for reshuffling
  let prevTime = 0;

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function selectRandomPairs() {
    const numSrc = sourcePixelCoords.length;
    const numTgt = targetPixelCoords.length;
    if (numSrc === 0 || numTgt === 0) return;

    pairs = [];
    for (let i = 0; i < numPairs; i++) {
      pairs.push({
        sourceIdx: Math.floor(Math.random() * numSrc),
        targetIdx: Math.floor(Math.random() * numTgt),
      });
    }
  }

  function runInitialComputation() {
    if (!canvas) return;
    if (sourceDistributionSamples.length === 0 || targetDistributionSamples.length === 0) return;

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

    const numSrc = Math.min(numScatterSamples, sourceDistributionSamples.length);
    sourcePixelCoords = [];
    for (let i = 0; i < numSrc; i++) {
      const p = sourceDistributionSamples[i];
      sourcePixelCoords.push([
        scales.sourceCenterPixelX + (p[0] - scales.sourceMeanX) * scales.xScaleFactor,
        scales.yScale(p[1]),
      ]);
    }

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

    selectRandomPairs();
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  function setupTimeline() {
    timeline = new Timeline<AnimationState>();
    timeline.initialState = { t: 0 };

    timeline.add(
      {
        name: "PairAnimation",
        reduce(t: number) {
          return { t };
        }
      },
      { start: 0, end: 1 }
    );

    timeline.duration = (pairDuration * numPairs) / 1000;
    timeline.looping = true;

    timeline.onTick((time, state) => {
      // Detect loop
      if (prevTime > 0.9 && time < 0.1) {
        selectRandomPairs();
      }
      prevTime = time;
      draw(state);
    });
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function draw(state: AnimationState) {
    if (!ctx || !scales || !isInitialized) return;
    ctx.clearRect(0, 0, width, height);

    const requestRedraw = () => { if (timeline) draw(timeline.state); };

    // Draw distribution labels
    const labelY = marginHeight / 2;
    const labelColor = settings.stylingSettings.label.color;
    drawMathjax(ctx, sourceLabel, scales.sourceCenterPixelX, labelY + labelFontSize, labelFontSize, 0, labelFontSize * 1.0, { color: labelColor }, requestRedraw);
    drawMathjax(ctx, targetLabel, scales.targetCenterPixelX, labelY + labelFontSize, labelFontSize, 0, labelFontSize * 1.0, { color: labelColor }, requestRedraw);

    // Draw scatter plots
    drawScatterPlot(ctx, sourcePixelCoords, pointRadius, sourcePointColor, pointOpacity);
    drawScatterPlot(ctx, targetPixelCoords, pointRadius, targetPointColor, pointOpacity);

    // Determine which pair we're on and progress within it
    const totalProgress = state.t * numPairs;
    const currentPairIndex = Math.min(Math.floor(totalProgress), numPairs - 1);
    const pairProgress = totalProgress - currentPairIndex;

    // Draw completed pairs (lines + endpoints)
    for (let i = 0; i < currentPairIndex; i++) {
      const pair = pairs[i];
      if (!pair) continue;
      const [sx, sy] = sourcePixelCoords[pair.sourceIdx];
      const [tx, ty] = targetPixelCoords[pair.targetIdx];

      ctx.save();
      ctx.strokeStyle = couplingLineColor;
      ctx.lineWidth = couplingLineWidth;
      ctx.globalAlpha = couplingLineOpacity * 0.6;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.restore();

      // Source endpoint
      ctx.save();
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = highlightSourceColor;
      ctx.beginPath();
      ctx.arc(sx, sy, highlightRadius * 0.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Target endpoint
      ctx.save();
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = highlightTargetColor;
      ctx.beginPath();
      ctx.arc(tx, ty, highlightRadius * 0.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Draw current pair with animation
    const currentPair = pairs[currentPairIndex];
    if (currentPair) {
      const [sx, sy] = sourcePixelCoords[currentPair.sourceIdx];
      const [tx, ty] = targetPixelCoords[currentPair.targetIdx];

      // Phase 1 (0-0.3): show highlighted points with x_0, x_1 labels
      // Phase 2 (0.3-0.7): draw line, show (x_0, x_1) label
      // Phase 3 (0.7-1.0): fade labels, keep line

      const lineProgress = Math.max(0, Math.min(1, (pairProgress - 0.2) / 0.3));
      const labelOpacity = pairProgress < 0.8 ? 1.0 : Math.max(0, 1 - (pairProgress - 0.8) / 0.2);
      const pointLabelOpacity = pairProgress < 0.6 ? 1.0 : Math.max(0, 1 - (pairProgress - 0.6) / 0.2);

      // Draw line (animated from source to target)
      if (lineProgress > 0) {
        const endX = sx + (tx - sx) * lineProgress;
        const endY = sy + (ty - sy) * lineProgress;

        ctx.save();
        ctx.strokeStyle = couplingLineColor;
        ctx.lineWidth = couplingLineWidth;
        ctx.globalAlpha = couplingLineOpacity;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(endX, endY);
        ctx.stroke();
        ctx.restore();
      }

      // Highlight source point (always visible)
      ctx.save();
      ctx.fillStyle = highlightSourceColor;
      ctx.beginPath();
      ctx.arc(sx, sy, highlightRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Highlight target point (always visible)
      ctx.save();
      ctx.fillStyle = highlightTargetColor;
      ctx.beginPath();
      ctx.arc(tx, ty, highlightRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // x_0 label above source point
      if (pointLabelOpacity > 0.01) {
        ctx.save();
        ctx.globalAlpha = pointLabelOpacity;
        drawMathjax(ctx, "x_0", sx, sy, latexFontSize, 0, -25, { color: highlightSourceColor, stroke: 'white', strokeWidth: 4, strokeOpacity: 0.5 }, requestRedraw);
        ctx.restore();
      }

      // x_1 label above target point
      if (pointLabelOpacity > 0.01) {
        ctx.save();
        ctx.globalAlpha = pointLabelOpacity;
        drawMathjax(ctx, "x_1", tx, ty, latexFontSize, 0, -25, { color: highlightTargetColor, stroke: 'white', strokeWidth: 4, strokeOpacity: 0.5 }, requestRedraw);
        ctx.restore();
      }

      // (x_0, x_1) label at same Y as distribution labels, centered between distributions
      if (labelOpacity > 0.01 && lineProgress > 0.5) {
        const cx = (scales.sourceCenterPixelX + scales.targetCenterPixelX) / 2;
        const pairLabelY = marginHeight / 2 + labelFontSize;
        ctx.save();
        ctx.globalAlpha = labelOpacity;
        drawMathjax(ctx, "({\\color{" + highlightSourceColor + "}{x_0}},\\, {\\color{" + highlightTargetColor + "}{x_1}})", cx, pairLabelY, latexFontSize * 0.9, 0, labelFontSize * 1.0, { color: pairLabelColor }, requestRedraw);
        ctx.restore();
      }
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
    timeline!.play();
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
