<script lang="ts">
  import { onDestroy } from "svelte";
  import type { Writable } from "svelte/store";
  import { Figure, drawScatterPlot, drawText, drawMathjax, drawArrowHead, createSourceTargetScales, Timeline, useCanvas2D, useVisibilityHandler } from "@diffusion-explorer/ui";
  import { settings } from "$lib/settings";

  // Data: allTimeSamples[timeStep][sampleIndex][x,y]
  export let allTimeSamples: Writable<number[][][]>;

  export let width = 1800;
  export let height = 800;
  export let numLines = 8;
  export let lineColor = '#f17720';
  export let lineOpacity = 1.0;
  export let lineWidth = 5;
  export let pointColor = '#4594e3';
  export let pointRadius = 5;
  export let pointOpacity = 0.5;
  export let labelFontSize = 50;
  export let animationDuration = 16000;
  export let sourceCenterX = 0.25;
  export let targetCenterX = 0.75;
  export let distributionScaleFactor = 0.85;
  export let staticForward = false;
  export let overlayText = "";
  export let showCurvedArrow = true;

  let canvas: HTMLCanvasElement | null = null;
  const canvas2d = useCanvas2D(width, height);

  let scales: ReturnType<typeof createSourceTargetScales> | null = null;
  let sourcePixelCoords: number[][] = [];
  let targetPixelCoords: number[][] = [];
  let lineSourceCoords: number[][] = [];
  let lineTargetCoords: number[][] = [];

  type AnimState = { forwardProgress: number; reverseProgress: number; phase: 'forward' | 'hold1' | 'reverse' | 'hold2' };
  let timeline: Timeline<AnimState> | null = null;
  let figureIsActive: Writable<boolean> | undefined;
  const { handleVisibilityChange } = useVisibilityHandler(() => timeline);
  let isInitialized = false;

  function runInitialComputation() {
    if (!canvas) return;
    const samples = $allTimeSamples;
    if (!samples || samples.length === 0) return;

    const sourceSamples = samples[0];
    const targetSamples = samples[samples.length - 1];
    if (!sourceSamples || !targetSamples) return;

    scales = createSourceTargetScales(sourceSamples, targetSamples, {
      width, height,
      marginWidth: 50, marginHeight: 20,
      sourceCenterX, targetCenterX,
      yShiftFactor: settings.stylingSettings.scatterPlot.yShiftFactor,
      distributionScaleFactor,
    });

    // All scatter points
    sourcePixelCoords = sourceSamples.map(p => [
      scales!.sourceCenterPixelX + (p[0] - scales!.sourceMeanX) * scales!.xScaleFactor,
      scales!.yScale(p[1]),
    ]);
    targetPixelCoords = targetSamples.map(p => [
      scales!.targetCenterPixelX + (p[0] - scales!.targetMeanX) * scales!.xScaleFactor,
      scales!.yScale(p[1]),
    ]);

    // Pick evenly-spaced trajectory indices for lines
    const total = Math.min(sourceSamples.length, targetSamples.length);
    const step = Math.max(1, Math.floor(total / numLines));
    lineSourceCoords = [];
    lineTargetCoords = [];
    for (let i = 0; i < numLines && i * step < total; i++) {
      const idx = i * step;
      lineSourceCoords.push(sourcePixelCoords[idx]);
      lineTargetCoords.push(targetPixelCoords[idx]);
    }
  }

  function setupTimeline() {
    timeline = new Timeline<AnimState>();
    timeline.initialState = { forwardProgress: 0, reverseProgress: 0, phase: 'forward' };

    // Phase layout: forward (0-0.15), hold (0.15-0.45), reverse (0.45-0.6), hold (0.6-1.0)
    timeline.add({
      name: "Animation",
      reduce(t: number) {
        if (t < 0.15) {
          return { forwardProgress: t / 0.15, reverseProgress: 0, phase: 'forward' as const };
        } else if (t < 0.45) {
          return { forwardProgress: 1, reverseProgress: 0, phase: 'hold1' as const };
        } else if (t < 0.6) {
          return { forwardProgress: 1, reverseProgress: (t - 0.45) / 0.15, phase: 'reverse' as const };
        } else {
          return { forwardProgress: 1, reverseProgress: 1, phase: 'hold2' as const };
        }
      }
    }, { start: 0, end: 1 });

    timeline.duration = animationDuration / 1000;
    timeline.looping = true;
    timeline.onTick((_t, state) => draw(state));
  }

  function draw(state: AnimState) {
    if (!ctx || !scales) return;
    ctx.clearRect(0, 0, width, height);

    const requestRedraw = () => { if (timeline) draw(timeline.state); };

    // Distribution labels
    drawMathjax(ctx, "p(z)", scales.sourceCenterPixelX, 20 + labelFontSize, labelFontSize, 0, labelFontSize, { color: '#333' }, requestRedraw);
    drawMathjax(ctx, "p(x)", scales.targetCenterPixelX, 20 + labelFontSize, labelFontSize, 0, labelFontSize, { color: '#333' }, requestRedraw);

    // Scatter plots
    drawScatterPlot(ctx, sourcePixelCoords, pointRadius, pointColor, pointOpacity);
    drawScatterPlot(ctx, targetPixelCoords, pointRadius, pointColor, pointOpacity);

    const isReverse = state.phase === 'reverse' || state.phase === 'hold2';
    const centerX = (scales.sourceCenterPixelX + scales.targetCenterPixelX) / 2;
    const centerY = height * 0.15;

    // Curved arrow below f(z) label — reverses direction during inverse phase
    if (showCurvedArrow) {
      const leftX = scales.sourceCenterPixelX + 120;
      const rightX = scales.targetCenterPixelX - 120;
      const arrowY = centerY + 50;
      const mx = (leftX + rightX) / 2;
      const my = arrowY - 60;

      // Swap start/end for reverse
      const arrowStart = isReverse ? rightX : leftX;
      const arrowEnd = isReverse ? leftX : rightX;

      ctx.save();
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = lineWidth;
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.moveTo(arrowStart, arrowY);
      ctx.quadraticCurveTo(mx, my, arrowEnd, arrowY);
      ctx.stroke();

      // Arrowhead at end
      ctx.fillStyle = lineColor;
      const prevX = arrowEnd - (arrowEnd - mx) * 0.05;
      const prevY = arrowY - (arrowY - my) * 0.05;
      drawArrowHead(ctx, prevX, prevY, arrowEnd, arrowY, 12);
      ctx.restore();
    }

    if (!isReverse) {
      // Forward phase: source → target
      drawScatterPlot(ctx, lineSourceCoords, pointRadius, lineColor, 0.8);

      if (state.forwardProgress > 0) {
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = lineWidth;
        ctx.globalAlpha = lineOpacity;

        for (let i = 0; i < lineSourceCoords.length; i++) {
          const [sx, sy] = lineSourceCoords[i];
          const [tx, ty] = lineTargetCoords[i];
          const endX = sx + (tx - sx) * state.forwardProgress;
          const endY = sy + (ty - sy) * state.forwardProgress;

          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(endX, endY);
          ctx.stroke();

          if (state.forwardProgress > 0.05) {
            ctx.fillStyle = lineColor;
            drawArrowHead(ctx, sx, sy, endX, endY, 10);
          }
        }
        ctx.globalAlpha = 1;

        if (state.forwardProgress >= 1) {
          drawScatterPlot(ctx, lineTargetCoords, pointRadius, lineColor, 0.8);
        }
      }

      // f(z) label
      drawMathjax(ctx, "f(z)", centerX, centerY, labelFontSize, 0, 0, { color: lineColor }, requestRedraw);
    } else {
      // Reverse phase: target → source
      drawScatterPlot(ctx, lineTargetCoords, pointRadius, lineColor, 0.8);

      if (state.reverseProgress > 0) {
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = lineWidth;
        ctx.globalAlpha = lineOpacity;

        for (let i = 0; i < lineSourceCoords.length; i++) {
          const [sx, sy] = lineSourceCoords[i];
          const [tx, ty] = lineTargetCoords[i];
          // Reverse: start from target, go toward source
          const endX = tx + (sx - tx) * state.reverseProgress;
          const endY = ty + (sy - ty) * state.reverseProgress;

          ctx.beginPath();
          ctx.moveTo(tx, ty);
          ctx.lineTo(endX, endY);
          ctx.stroke();

          if (state.reverseProgress > 0.05) {
            ctx.fillStyle = lineColor;
            drawArrowHead(ctx, tx, ty, endX, endY, 10);
          }
        }
        ctx.globalAlpha = 1;

        if (state.reverseProgress >= 1) {
          drawScatterPlot(ctx, lineSourceCoords, pointRadius, lineColor, 0.8);
        }
      }

      // f^{-1}(x) label
      drawMathjax(ctx, "f^{-1}(x)", centerX, centerY, labelFontSize, 0, 0, { color: lineColor }, requestRedraw);
    }

    // Overlay text
    if (overlayText) {
      drawText(ctx, overlayText, width / 2, height * 0.88, {
        font: `48px Libre Baskerville, Georgia, serif`,
        color: lineColor,
        opacity: 1,
        align: "center",
        baseline: "middle",
      });
    }
  }

  export function restart() {
    if (staticForward) return;
    if (timeline) {
      timeline.seek(0);
      timeline.play();
    }
  }

  export function pause() {
    if (timeline) timeline.pause();
  }

  onDestroy(() => { if (timeline) timeline.pause(); });

  $: ctx = canvas && canvas2d.ctx;

  $: if (
    !isInitialized &&
    $allTimeSamples && $allTimeSamples.length > 0 &&
    canvas
  ) {
    runInitialComputation();
    setupTimeline();
    isInitialized = true;
    if (staticForward) {
      const staticState: AnimState = { forwardProgress: 1, reverseProgress: 0, phase: 'hold1' };
      draw(staticState);
      // Redraw after MathJax caches render
      setTimeout(() => draw(staticState), 200);
      setTimeout(() => draw(staticState), 1000);
    } else {
      draw(timeline!.initialState);
      timeline!.play();
    }
  }

  $: if (figureIsActive !== undefined && isInitialized) {
    handleVisibilityChange($figureIsActive);
  }
</script>

<Figure backgroundVisible={false} bind:isActive={figureIsActive}>
  {#snippet children()}
    <div style="display: flex; flex-direction: column; align-items: center; width: 100%; margin-top: 70px;">
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
