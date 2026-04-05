<script lang="ts">
  import { onDestroy } from "svelte";
  import type { Writable } from "svelte/store";
  import { Figure, drawScatterPlot, drawMathjax, drawArrowHead, createSourceTargetScales, Timeline, useCanvas2D, useVisibilityHandler } from "@diffusion-explorer/ui";
  import { settings } from "$lib/settings";

  // Data: allTimeSamples[timeStep][sampleIndex][x,y]
  export let allTimeSamples: Writable<number[][][]>;

  export let width = 1800;
  export let height = 800;
  export let numFrames = 5;
  export let frameColor = '#2ecc71';
  export let frameOpacity = 0.7;
  export let frameScale = 0.5; // size of coordinate frames in data space
  export let pointColor = '#4594e3';
  export let pointRadius = 5;
  export let pointOpacity = 0.25;
  export let labelFontSize = 50;
  export let animationDuration = 10000;
  export let sourceCenterX = 0.25;
  export let targetCenterX = 0.75;
  export let distributionScaleFactor = 0.85;

  let canvas: HTMLCanvasElement | null = null;
  const canvas2d = useCanvas2D(width, height);

  let scales: ReturnType<typeof createSourceTargetScales> | null = null;
  let sourcePixelCoords: number[][] = [];
  let targetPixelCoords: number[][] = [];

  // For each coordinate frame: source center, target center, and Jacobian columns
  let frames: {
    srcPx: number[]; // source center in pixel coords
    tgtPx: number[]; // target center in pixel coords
    // Jacobian columns in pixel space (how unit vectors transform)
    srcEx: number[]; // source x-axis vector (unit)
    srcEy: number[]; // source y-axis vector (unit)
    tgtEx: number[]; // transformed x-axis vector
    tgtEy: number[]; // transformed y-axis vector
  }[] = [];

  type AnimState = { progress: number };
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

    // Pick evenly-spaced points for coordinate frames
    const total = Math.min(sourceSamples.length, targetSamples.length);
    const step = Math.max(1, Math.floor(total / numFrames));
    frames = [];

    // Size of unit vectors in pixel space
    const unitPx = frameScale * scales!.xScaleFactor;

    for (let i = 0; i < numFrames && i * step < total; i++) {
      const idx = i * step;
      const srcPx = sourcePixelCoords[idx];
      const tgtPx = targetPixelCoords[idx];

      // Compute numerical Jacobian by finding nearby points
      const srcPt = sourceSamples[idx];
      const tgtPt = targetSamples[idx];

      // Find closest neighbor to estimate partial derivatives
      let bestDist = Infinity;
      let neighborIdx = -1;
      for (let j = 0; j < total; j++) {
        if (j === idx) continue;
        const dx = sourceSamples[j][0] - srcPt[0];
        const dy = sourceSamples[j][1] - srcPt[1];
        const d = dx * dx + dy * dy;
        if (d < bestDist && d > 0.001) {
          bestDist = d;
          neighborIdx = j;
        }
      }

      // Find another neighbor not too collinear with the first
      let neighbor2Idx = -1;
      let bestDist2 = Infinity;
      if (neighborIdx >= 0) {
        const n1dx = sourceSamples[neighborIdx][0] - srcPt[0];
        const n1dy = sourceSamples[neighborIdx][1] - srcPt[1];
        const n1len = Math.sqrt(n1dx * n1dx + n1dy * n1dy);

        for (let j = 0; j < total; j++) {
          if (j === idx || j === neighborIdx) continue;
          const dx = sourceSamples[j][0] - srcPt[0];
          const dy = sourceSamples[j][1] - srcPt[1];
          const d = dx * dx + dy * dy;
          // Check not too collinear
          const cross = Math.abs(n1dx * dy - n1dy * dx) / (n1len * Math.sqrt(d) + 1e-10);
          if (d < bestDist2 && d > 0.001 && cross > 0.3) {
            bestDist2 = d;
            neighbor2Idx = j;
          }
        }
      }

      // Compute Jacobian from two neighbors
      let jxx = 1, jxy = 0, jyx = 0, jyy = 1; // default identity
      if (neighborIdx >= 0 && neighbor2Idx >= 0) {
        const ds1x = sourceSamples[neighborIdx][0] - srcPt[0];
        const ds1y = sourceSamples[neighborIdx][1] - srcPt[1];
        const dt1x = targetSamples[neighborIdx][0] - tgtPt[0];
        const dt1y = targetSamples[neighborIdx][1] - tgtPt[1];

        const ds2x = sourceSamples[neighbor2Idx][0] - srcPt[0];
        const ds2y = sourceSamples[neighbor2Idx][1] - srcPt[1];
        const dt2x = targetSamples[neighbor2Idx][0] - tgtPt[0];
        const dt2y = targetSamples[neighbor2Idx][1] - tgtPt[1];

        // Solve: J * [ds1; ds2] = [dt1; dt2]
        const det = ds1x * ds2y - ds1y * ds2x;
        if (Math.abs(det) > 1e-10) {
          jxx = (dt1x * ds2y - dt2x * ds1y) / det;
          jxy = (dt2x * ds1x - dt1x * ds2x) / det;
          jyx = (dt1y * ds2y - dt2y * ds1y) / det;
          jyy = (dt2y * ds1x - dt1y * ds2x) / det;
        }
      }

      // Source: unit x and y axes in pixel space
      const srcEx = [unitPx, 0];
      const srcEy = [0, -unitPx]; // negative because canvas y is flipped

      // Target: transformed axes via Jacobian (in pixel space)
      const tgtEx = [jxx * unitPx, -jyx * unitPx]; // negate y for canvas
      const tgtEy = [jxy * unitPx, -jyy * unitPx];

      frames.push({ srcPx, tgtPx, srcEx, srcEy, tgtEx, tgtEy });
    }
  }

  function setupTimeline() {
    timeline = new Timeline<AnimState>();
    timeline.initialState = { progress: 0 };

    // Animate: draw (0-0.2), hold (0.2-0.5), morph (0.5-0.8), hold (0.8-1.0)
    timeline.add({
      name: "Morph",
      reduce(t: number) {
        if (t < 0.15) return { progress: 0 };
        if (t < 0.45) return { progress: (t - 0.15) / 0.3 };
        return { progress: 1 };
      }
    }, { start: 0, end: 1 });

    timeline.duration = animationDuration / 1000;
    timeline.looping = true;
    timeline.onTick((_t, state) => draw(state));
  }

  function drawCoordFrame(
    cx: number, cy: number,
    ex: number[], ey: number[],
    color: string, opacity: number
  ) {
    if (!ctx) return;

    // Draw shaded parallelogram
    ctx.globalAlpha = opacity * 0.2;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + ex[0], cy + ex[1]);
    ctx.lineTo(cx + ex[0] + ey[0], cy + ex[1] + ey[1]);
    ctx.lineTo(cx + ey[0], cy + ey[1]);
    ctx.closePath();
    ctx.fill();

    // Draw x-axis arrow
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + ex[0], cy + ex[1]);
    ctx.stroke();
    ctx.fillStyle = color;
    drawArrowHead(ctx, cx, cy, cx + ex[0], cy + ex[1], 8);

    // Draw y-axis arrow
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + ey[0], cy + ey[1]);
    ctx.stroke();
    ctx.fillStyle = color;
    drawArrowHead(ctx, cx, cy, cx + ey[0], cy + ey[1], 8);

    ctx.globalAlpha = 1;
  }

  function drawCurvedArrow(
    x1: number, y1: number, x2: number, y2: number,
    color: string, lineWidth: number
  ) {
    if (!ctx) return;
    const mx = (x1 + x2) / 2;
    const my = Math.min(y1, y2) - 60; // curve upward

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(mx, my, x2, y2);
    ctx.stroke();

    // Arrowhead at the end
    // Compute tangent at endpoint
    const dt = 0.01;
    const tx = 2 * (1 - (1 - dt)) * (mx - x1) + 2 * (1 - dt) * (x2 - mx);
    const ty = 2 * (1 - (1 - dt)) * (my - y1) + 2 * (1 - dt) * (y2 - my);
    const prevX = x2 - tx * dt * 3;
    const prevY = y2 - ty * dt * 3;
    ctx.fillStyle = color;
    drawArrowHead(ctx, prevX, prevY, x2, y2, 12);
    ctx.restore();
  }

  function draw(state: AnimState) {
    if (!ctx || !scales) return;
    ctx.clearRect(0, 0, width, height);

    const requestRedraw = () => { if (timeline) draw(timeline.state); };

    // Labels
    drawMathjax(ctx, "p(z)", scales.sourceCenterPixelX, 20 + labelFontSize, labelFontSize, 0, labelFontSize, { color: '#333' }, requestRedraw);
    drawMathjax(ctx, "p(x)", scales.targetCenterPixelX, 20 + labelFontSize, labelFontSize, 0, labelFontSize, { color: '#333' }, requestRedraw);

    // Scatter plots
    drawScatterPlot(ctx, sourcePixelCoords, pointRadius, pointColor, pointOpacity);
    drawScatterPlot(ctx, targetPixelCoords, pointRadius, pointColor, pointOpacity);

    // Curved arrow between distributions with f(z) label above
    const arrowY = height * 0.45;
    const arrowX1 = scales.sourceCenterPixelX + 180;
    const arrowX2 = scales.targetCenterPixelX - 180;
    drawCurvedArrow(arrowX1, arrowY, arrowX2, arrowY, '#333', 4);

    const centerX = (arrowX1 + arrowX2) / 2;
    drawMathjax(ctx, "f(z)", centerX, arrowY - 80, labelFontSize, 0, 0, { color: '#333' }, requestRedraw);

    // Draw source coordinate frames (always unit squares)
    for (const frame of frames) {
      drawCoordFrame(frame.srcPx[0], frame.srcPx[1], frame.srcEx, frame.srcEy, frameColor, frameOpacity);
    }

    // Draw target coordinate frames (animate shearing from unit to Jacobian-transformed)
    const t = state.progress;
    for (const frame of frames) {
      const ex = [
        frame.srcEx[0] + (frame.tgtEx[0] - frame.srcEx[0]) * t,
        frame.srcEx[1] + (frame.tgtEx[1] - frame.srcEx[1]) * t,
      ];
      const ey = [
        frame.srcEy[0] + (frame.tgtEy[0] - frame.srcEy[0]) * t,
        frame.srcEy[1] + (frame.tgtEy[1] - frame.srcEy[1]) * t,
      ];
      drawCoordFrame(frame.tgtPx[0], frame.tgtPx[1], ex, ey, frameColor, frameOpacity);
    }
  }

  export function restart() {
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
    draw(timeline!.initialState);
    timeline!.play();
  }

  $: if (figureIsActive !== undefined && isInitialized) {
    handleVisibilityChange($figureIsActive);
  }
</script>

<Figure backgroundVisible={false} bind:isActive={figureIsActive}>
  {#snippet children()}
    <div style="display: flex; flex-direction: column; align-items: center; width: 100%; margin-top: 120px;">
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
