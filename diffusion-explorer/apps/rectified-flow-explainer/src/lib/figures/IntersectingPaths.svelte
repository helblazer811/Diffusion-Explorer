<!-- Visualizes intersecting linear paths between source and target distributions with velocity vectors at intersection. -->

<script lang="ts">
  import { Figure, drawScatterPlot, drawText, drawArrow, drawMathjax, createSourceTargetScales, dataToPixelX, useCanvas2D, mathjaxInitialized, Timeline, TimelineBuilder, useVisibilityHandler } from "@diffusion-explorer/ui";
  import type { Snippet } from "svelte";
  import type { Writable } from "svelte/store";
  import { onDestroy } from "svelte";
  import type { FlowModelClient } from "@diffusion-explorer/diffusion";
  import { settings } from "$lib/settings";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  export let children: Snippet | undefined = undefined;

  // Data
  export let sourceDistributionSamples: [number, number][] = [];
  export let targetDistributionSamples: [number, number][] = [];

  // Arrow styling
  export let arrowColor = "#f17720";
  export let arrowLength = 0.3;
  export let meanVectorColor = "#22c55e";

  // Layout/Styling
  export let width = 800;
  export let height = 350;
  export let marginWidth = 50;
  export let marginHeight = 20;
  export let sourceCenterX = 0.2;
  export let targetCenterX = 0.8;
  export let pointRadius = settings.stylingSettings.scatterPlot.radius;
  export let pointOpacity = settings.stylingSettings.scatterPlot.opacity;
  export let lineColor = "#888";
  export let lineOpacity = 0.25;
  export let lineWidth = 4;
  export let sourcePointColor = settings.stylingSettings.scatterPlot.color;
  export let targetPointColor = settings.stylingSettings.scatterPlot.color;
  export let arrowWidth = 4;
  export let arrowHeadSize = 6;
  export let yShiftFactor = settings.stylingSettings.scatterPlot.yShiftFactor;

  export let labelFontSize = settings.stylingSettings.label.fontSize;
  export let labelFontWeight = settings.stylingSettings.label.fontWeight;
  export let labelFontFamily = "Helvetica, Arial, sans-serif";
  export let labelColor = settings.stylingSettings.label.color;
  export let labelOpacity = settings.stylingSettings.label.opacity;
  export let sourceLabelText = "Source Distribution";
  export let targetLabelText = "Target Distribution";

  export let topArrowLabelOffset: { x: number; y: number } = { x: -55, y: -45 };
  export let bottomArrowLabelOffset: { x: number; y: number } = { x: -55, y: 8 };
  export let meanArrowLabelOffset: { x: number; y: number } = { x: 30, y: -18 };

  // Hardcoded line endpoint coordinates
  export let sourcePointA: [number, number] = [-0.2, -0.8];
  export let sourcePointB: [number, number] = [-0.2, 0.5];
  export let targetPointA: [number, number] = [0.2, 1.6];
  export let targetPointB: [number, number] = [-1.1, -1.0];

  export let backgroundVisible = true;
  export let latexLabelOffsetY = settings.stylingSettings.figureLatex.latexLabelOffsetY;
  export let latexFontSize = settings.stylingSettings.figureLatex.fontSize;

  // Coupling animation mode
  export let showCouplingAnimation = false;
  export let playingByDefault = true;
  export let looping = true;
  export let numCouplingPaths = 60;

  // Called when all animation stages are complete and user clicks again
  export let onNextSlide: (() => void) | null = null;

  // Flow trajectory (final phase)
  export let flowMatchingClient: FlowModelClient | null = null;
  export let trajectoryColor = '#22c55e'; // green
  export let trajectoryLineWidth = 3;
  export let trajectoryStartTime = 0.5;
  export let samplingSteps = 100;
  export let trajectoryDuration = 5000; // ms for trajectory animation phase

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  $: caption = children;

  let canvas: HTMLCanvasElement | null = null;
  const canvas2d = useCanvas2D(width, height);
  $: ctx = canvas && canvas2d.ctx;

  let scales: ReturnType<typeof createSourceTargetScales> | null = null;
  let isInitialized = false;

  let sourcePixelCoords: number[][] = [];
  let targetPixelCoords: number[][] = [];
  let line1Coords: { x1: number; y1: number; x2: number; y2: number } | null = null;
  let line2Coords: { x1: number; y1: number; x2: number; y2: number } | null = null;
  let intersection: { x: number; y: number; t: number } | null = null;

  // Coupling animation state
  type AnimationState = {
    bgPathsProgress: number;      // 0→1: lines grow from source to target
    bgPathsOpacity: number;       // 1→0: background paths (all except two) fade out
    intersectionOpacity: number;  // 0→1: intersection dot + x
    orangeArrowOpacity: number;   // 0→1→0: orange arrows + labels
    greenArrowOpacity: number;    // 0→1→0: green mean arrow + label
    trajectoryProgress: number;   // 0→1: learned flow path through x
  };

  const initialState: AnimationState = {
    bgPathsProgress: 0,
    bgPathsOpacity: 1,
    intersectionOpacity: 0,
    orangeArrowOpacity: 0,
    greenArrowOpacity: 0,
    trajectoryProgress: 0,
  };

  let timeline: Timeline<AnimationState> | null = null;
  let bgCouplingPaths: [number, number, number, number][] = []; // [sx,sy,tx,ty]
  let combinedTrajectoryPixels: number[][] = [];
  let combinedMeanX = 0;
  let animationComplete = false; // true once the last stage finishes


  // Precomputed arrow geometry
  type ArrowData = {
    dir1: { x: number; y: number }; dir2: { x: number; y: number };
    meanDir: { x: number; y: number }; arrowScale: number;
    arrow1End: { x: number; y: number }; arrow2End: { x: number; y: number };
    meanEnd: { x: number; y: number };
    arrow1Mid: { x: number; y: number }; arrow2Mid: { x: number; y: number };
  };
  let arrowData: ArrowData | null = null;

  let figureIsActive: Writable<boolean>;
  const { handleVisibilityChange } = useVisibilityHandler(() => timeline);

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  function normalize(v: { x: number; y: number }): { x: number; y: number } {
    const len = Math.hypot(v.x, v.y);
    if (len < 1e-10) return { x: 0, y: 0 };
    return { x: v.x / len, y: v.y / len };
  }

  function findIntersection(l1: { x1: number; y1: number; x2: number; y2: number }, l2: { x1: number; y1: number; x2: number; y2: number }): { x: number; y: number; t: number } | null {
    const { x1, y1, x2, y2 } = l1;
    const { x1: x3, y1: y3, x2: x4, y2: y4 } = l2;
    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(denom) < 1e-10) return null;
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1), t };
  }

  function getPixelX(dataX: number, t: number): number {
    const centerPixelX = scales.sourceCenterPixelX + t * (scales.targetCenterPixelX - scales.sourceCenterPixelX);
    return centerPixelX + (dataX - combinedMeanX) * scales.xScaleFactor;
  }

  function pixelToDataXY(pixelX: number, pixelY: number, t: number): [number, number] {
    const centerPixelX = scales.sourceCenterPixelX + t * (scales.targetCenterPixelX - scales.sourceCenterPixelX);
    return [(pixelX - centerPixelX) / scales.xScaleFactor + combinedMeanX, scales.yScale.invert(pixelY)];
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function runInitialComputation() {
    scales = createSourceTargetScales(sourceDistributionSamples, targetDistributionSamples, {
      width, height, marginWidth, marginHeight, sourceCenterX, targetCenterX, yShiftFactor,
    });

    sourcePixelCoords = sourceDistributionSamples.map((p: [number, number]) => [
      scales.sourceCenterPixelX + (p[0] - scales.sourceMeanX) * scales.xScaleFactor,
      scales.yScale(p[1]),
    ]);
    targetPixelCoords = targetDistributionSamples.map((p: [number, number]) => [
      scales.targetCenterPixelX + (p[0] - scales.targetMeanX) * scales.xScaleFactor,
      scales.yScale(p[1]),
    ]);

    line1Coords = {
      x1: dataToPixelX(sourcePointB[0], true, scales), y1: scales.yScale(sourcePointB[1]),
      x2: dataToPixelX(targetPointB[0], false, scales), y2: scales.yScale(targetPointB[1]),
    };
    line2Coords = {
      x1: dataToPixelX(sourcePointA[0], true, scales), y1: scales.yScale(sourcePointA[1]),
      x2: dataToPixelX(targetPointA[0], false, scales), y2: scales.yScale(targetPointA[1]),
    };
    intersection = findIntersection(line1Coords, line2Coords);
    precomputeArrowData();

    if (showCouplingAnimation) {
      computeBgCouplingPaths();
    }
  }

  function computeBgCouplingPaths() {
    // Pair every point: use the same count from both distributions
    const count = Math.min(sourcePixelCoords.length, targetPixelCoords.length);
    bgCouplingPaths = Array.from({ length: count }, (_, i) => [
      sourcePixelCoords[i][0], sourcePixelCoords[i][1],
      targetPixelCoords[i][0], targetPixelCoords[i][1],
    ] as [number, number, number, number]);
  }

  function precomputeArrowData() {
    if (!intersection || !line1Coords || !line2Coords) return;
    const dir1 = normalize({ x: line1Coords.x2 - line1Coords.x1, y: line1Coords.y2 - line1Coords.y1 });
    const dir2 = normalize({ x: line2Coords.x2 - line2Coords.x1, y: line2Coords.y2 - line2Coords.y1 });
    const meanDir = normalize({ x: (dir1.x + dir2.x) / 2, y: (dir1.y + dir2.y) / 2 });
    const arrowScale = arrowLength * Math.min(
      Math.hypot(line1Coords.x2 - line1Coords.x1, line1Coords.y2 - line1Coords.y1),
      Math.hypot(line2Coords.x2 - line2Coords.x1, line2Coords.y2 - line2Coords.y1)
    );
    const arrow1End = { x: intersection.x + dir1.x * arrowScale, y: intersection.y + dir1.y * arrowScale };
    const arrow2End = { x: intersection.x + dir2.x * arrowScale, y: intersection.y + dir2.y * arrowScale };
    const meanEnd = { x: intersection.x + meanDir.x * arrowScale, y: intersection.y + meanDir.y * arrowScale };
    arrowData = {
      dir1, dir2, meanDir, arrowScale, arrow1End, arrow2End, meanEnd,
      arrow1Mid: { x: (intersection.x + arrow1End.x) / 2, y: (intersection.y + arrow1End.y) / 2 },
      arrow2Mid: { x: (intersection.x + arrow2End.x) / 2, y: (intersection.y + arrow2End.y) / 2 },
    };
  }

  async function computeFlowTrajectories() {
    if (!flowMatchingClient || !intersection || !scales) return;
    const allX = [...sourceDistributionSamples.map(p => p[0]), ...targetDistributionSamples.map(p => p[0])];
    combinedMeanX = allX.reduce((a, b) => a + b, 0) / allX.length;

    const [dataX, dataY] = pixelToDataXY(intersection.x, intersection.y, trajectoryStartTime);
    const startPoint: [number, number] = [dataX, dataY];

    const reversePixels: number[][] = [[intersection.x, intersection.y]];
    const forwardPixels: number[][] = [[intersection.x, intersection.y]];

    const revResult = flowMatchingClient.sampleFromInitialPoints([startPoint], samplingSteps,
      { reverse: true, t_start: trajectoryStartTime, t_end: 0 },
      (step: number, x_t: number[][]) => {
        const t = trajectoryStartTime - ((step + 1) / samplingSteps) * trajectoryStartTime;
        reversePixels.push([getPixelX(x_t[0][0], t), scales.yScale(x_t[0][1])]);
      }
    );
    const fwdResult = flowMatchingClient.sampleFromInitialPoints([startPoint], samplingSteps,
      { t_start: trajectoryStartTime, t_end: 1.0 },
      (step: number, x_t: number[][]) => {
        const t = trajectoryStartTime + ((step + 1) / samplingSteps) * (1 - trajectoryStartTime);
        forwardPixels.push([getPixelX(x_t[0][0], t), scales.yScale(x_t[0][1])]);
      }
    );
    await Promise.all([revResult.promise, fwdResult.promise]);
    combinedTrajectoryPixels = [...reversePixels.slice().reverse(), ...forwardPixels.slice(1)];
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  function setupCouplingTimeline() {
    if (timeline) timeline.pause();

    timeline = new TimelineBuilder<AnimationState>()
      .setInitialState({ ...initialState })
      .setLooping(false)
      // Stage 0 (auto): coupling lines grow
      .add({ name: 'DrawPaths', reduce(t) { return { bgPathsProgress: t }; } }, { durationMs: 1000 })
      .waitForInput()
      // Stage 1 (click): fade other paths, then show intersection x
      .add({ name: 'FadeBg', reduce(t) { return { bgPathsOpacity: 1 - t }; } }, { durationMs: 800 })
      .add({ name: 'Intersection', reduce(t) { return { intersectionOpacity: t }; } }, { durationMs: 600 })
      .waitForInput()
      // Stage 2 (click): orange arrows
      .add({ name: 'OrangeArrows', reduce(t) { return { orangeArrowOpacity: t }; } }, { durationMs: 700 })
      .waitForInput()
      // Stage 3 (click): green mean arrow
      .add({ name: 'GreenArrow', reduce(t) { return { greenArrowOpacity: t }; } }, { durationMs: 700 })
      .waitForInput()
      // Stage 4 (click): fade arrows + draw trajectory
      .add({ name: 'FadeArrows', reduce(t) { return { orangeArrowOpacity: 1 - t, greenArrowOpacity: 1 - t }; } }, { durationMs: 500 })
      .add({ name: 'Trajectory', reduce(t) { return { trajectoryProgress: t }; } }, { durationMs: trajectoryDuration })
      .build();

    timeline.onTick((_t, state) => {
      draw(state);
      if (_t >= 1.0) animationComplete = true;
    });
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  function draw(state: AnimationState = initialState) {
    if (!ctx || !scales) return;
    ctx.clearRect(0, 0, width, height);

    const latexColor = settings.stylingSettings.figureLatex.color;
    const requestRedraw = () => draw(timeline?.state ?? initialState);

    if (showCouplingAnimation) {
      drawCouplingAnimated(state, latexColor, requestRedraw);
    } else {
      drawStatic(latexColor, requestRedraw);
    }
  }

  function drawStatic(latexColor: string, requestRedraw: () => void) {
    if (!ctx || !scales || !line1Coords || !line2Coords) return;

    drawScatterPlot(ctx, sourcePixelCoords, pointRadius, sourcePointColor, pointOpacity);
    drawScatterPlot(ctx, targetPixelCoords, pointRadius, targetPointColor, pointOpacity);
    drawText(ctx, sourceLabelText, scales.sourceCenterPixelX, marginHeight / 2, {
      font: `${labelFontWeight} ${labelFontSize}px ${labelFontFamily}`, color: labelColor, opacity: labelOpacity, align: "center", baseline: "top",
    });
    drawText(ctx, targetLabelText, scales.targetCenterPixelX, marginHeight / 2, {
      font: `${labelFontWeight} ${labelFontSize}px ${labelFontFamily}`, color: labelColor, opacity: labelOpacity, align: "center", baseline: "top",
    });

    ctx.save();
    ctx.strokeStyle = lineColor; ctx.lineWidth = lineWidth; ctx.globalAlpha = lineOpacity;
    ctx.beginPath(); ctx.moveTo(line1Coords.x1, line1Coords.y1); ctx.lineTo(line1Coords.x2, line1Coords.y2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(line2Coords.x1, line2Coords.y1); ctx.lineTo(line2Coords.x2, line2Coords.y2); ctx.stroke();
    ctx.globalAlpha = 1; ctx.restore();

    ctx.fillStyle = lineColor;
    for (const [x, y] of [[line1Coords.x1, line1Coords.y1],[line1Coords.x2, line1Coords.y2],[line2Coords.x1, line2Coords.y1],[line2Coords.x2, line2Coords.y2]]) {
      ctx.beginPath(); ctx.arc(x, y, pointRadius, 0, 2 * Math.PI); ctx.fill();
    }

    if (intersection && arrowData) {
      const { arrow1End, arrow2End, meanEnd, arrow1Mid, arrow2Mid } = arrowData;
      ctx.save(); ctx.strokeStyle = arrowColor; ctx.fillStyle = arrowColor; ctx.lineWidth = arrowWidth;
      drawArrow(ctx, intersection.x, intersection.y, arrow1End.x, arrow1End.y, arrowHeadSize);
      drawArrow(ctx, intersection.x, intersection.y, arrow2End.x, arrow2End.y, arrowHeadSize);
      ctx.restore();
      ctx.save(); ctx.strokeStyle = meanVectorColor; ctx.fillStyle = meanVectorColor; ctx.lineWidth = arrowWidth;
      drawArrow(ctx, intersection.x, intersection.y, meanEnd.x, meanEnd.y, arrowHeadSize);
      ctx.restore();
      ctx.beginPath(); ctx.arc(intersection.x, intersection.y, pointRadius, 0, 2*Math.PI); ctx.fillStyle = lineColor; ctx.fill();
      drawMathjax(ctx, "v_t(x|x_0^a, x_1^a)", arrow2Mid.x + topArrowLabelOffset.x, arrow2Mid.y + topArrowLabelOffset.y, latexFontSize, 60, 100, { color: arrowColor }, requestRedraw);
      drawMathjax(ctx, "v_t(x|x_0^b, x_1^b)", arrow1Mid.x + bottomArrowLabelOffset.x, arrow1Mid.y + bottomArrowLabelOffset.y, latexFontSize, 60, -35, { color: arrowColor }, requestRedraw);
      drawMathjax(ctx, "v_t^\\theta(x) = \\mathbb{E}[X_1 - X_0 | x_t = x]", meanEnd.x + meanArrowLabelOffset.x, meanEnd.y + meanArrowLabelOffset.y, latexFontSize, 150, 30, { color: meanVectorColor }, requestRedraw);
      drawMathjax(ctx, "x", intersection.x, intersection.y, latexFontSize, 0, latexLabelOffsetY, { color: latexColor }, requestRedraw);
    }

    drawMathjax(ctx, "x_0^a", line2Coords.x1, line2Coords.y1, latexFontSize, 0, latexLabelOffsetY, { color: latexColor }, requestRedraw);
    drawMathjax(ctx, "x_0^b", line1Coords.x1, line1Coords.y1, latexFontSize, 0, latexLabelOffsetY, { color: latexColor }, requestRedraw);
    drawMathjax(ctx, "x_1^a", line2Coords.x2, line2Coords.y2, latexFontSize, 0, latexLabelOffsetY, { color: latexColor }, requestRedraw);
    drawMathjax(ctx, "x_1^b", line1Coords.x2, line1Coords.y2, latexFontSize, 0, latexLabelOffsetY, { color: latexColor }, requestRedraw);
  }

  function drawCouplingAnimated(state: AnimationState, latexColor: string, requestRedraw: () => void) {
    if (!ctx || !scales || !line1Coords || !line2Coords) return;

    // Always: scatter plots + labels (clip both to same count so every point is paired)
    const pairedCount = Math.min(sourcePixelCoords.length, targetPixelCoords.length);
    drawScatterPlot(ctx, sourcePixelCoords.slice(0, pairedCount), pointRadius, sourcePointColor, pointOpacity);
    drawScatterPlot(ctx, targetPixelCoords.slice(0, pairedCount), pointRadius, targetPointColor, pointOpacity);
    drawText(ctx, sourceLabelText, scales.sourceCenterPixelX, marginHeight / 2, {
      font: `${labelFontWeight} ${labelFontSize}px ${labelFontFamily}`, color: labelColor, opacity: labelOpacity, align: "center", baseline: "top",
    });
    drawText(ctx, targetLabelText, scales.targetCenterPixelX, marginHeight / 2, {
      font: `${labelFontWeight} ${labelFontSize}px ${labelFontFamily}`, color: labelColor, opacity: labelOpacity, align: "center", baseline: "top",
    });

    // Background coupling paths — grow from source to target
    const bgLineW = 2;
    const bgLineOp = 0.4;
    if (state.bgPathsProgress > 0 && state.bgPathsOpacity > 0) {
      ctx.save();
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = bgLineW;
      ctx.globalAlpha = state.bgPathsOpacity * bgLineOp;
      const prog = state.bgPathsProgress;
      for (const [sx, sy, tx, ty] of bgCouplingPaths) {
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + prog * (tx - sx), sy + prog * (ty - sy));
        ctx.stroke();
      }
      ctx.restore();
    }

    // Highlighted paths — same thickness as background, but always fully opaque (stay visible as bg fades)
    if (state.bgPathsProgress > 0) {
      const prog = state.bgPathsProgress;
      const hlOpacity = Math.max(state.bgPathsOpacity * bgLineOp, bgLineOp);
      ctx.save();
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = bgLineW;
      ctx.globalAlpha = hlOpacity;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(line1Coords.x1, line1Coords.y1);
      ctx.lineTo(line1Coords.x1 + prog * (line1Coords.x2 - line1Coords.x1), line1Coords.y1 + prog * (line1Coords.y2 - line1Coords.y1));
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(line2Coords.x1, line2Coords.y1);
      ctx.lineTo(line2Coords.x1 + prog * (line2Coords.x2 - line2Coords.x1), line2Coords.y1 + prog * (line2Coords.y2 - line2Coords.y1));
      ctx.stroke();
      ctx.restore();
    }

    // Endpoint circles + labels (appear once paths are fully drawn and bg has faded)
    if (state.bgPathsOpacity < 0.5 && state.bgPathsProgress >= 1) {
      ctx.save();
      ctx.globalAlpha = state.highlightThickness;
      ctx.fillStyle = lineColor;
      for (const [x, y] of [[line1Coords.x1, line1Coords.y1],[line1Coords.x2, line1Coords.y2],[line2Coords.x1, line2Coords.y1],[line2Coords.x2, line2Coords.y2]]) {
        ctx.beginPath(); ctx.arc(x, y, pointRadius, 0, 2*Math.PI); ctx.fill();
      }
      ctx.restore();
      drawMathjax(ctx, "x_0^a", line2Coords.x1, line2Coords.y1, latexFontSize, 0, latexLabelOffsetY, { color: latexColor }, requestRedraw);
      drawMathjax(ctx, "x_0^b", line1Coords.x1, line1Coords.y1, latexFontSize, 0, latexLabelOffsetY, { color: latexColor }, requestRedraw);
      drawMathjax(ctx, "x_1^a", line2Coords.x2, line2Coords.y2, latexFontSize, 0, latexLabelOffsetY, { color: latexColor }, requestRedraw);
      drawMathjax(ctx, "x_1^b", line1Coords.x2, line1Coords.y2, latexFontSize, 0, latexLabelOffsetY, { color: latexColor }, requestRedraw);
    }

    // Intersection dot + x label (phase 3)
    if (state.intersectionOpacity > 0 && intersection) {
      ctx.save();
      ctx.globalAlpha = state.intersectionOpacity;
      ctx.fillStyle = lineColor;
      ctx.beginPath(); ctx.arc(intersection.x, intersection.y, pointRadius * 1.4, 0, 2*Math.PI); ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = state.intersectionOpacity;
      drawMathjax(ctx, "x", intersection.x, intersection.y, latexFontSize, 0, latexLabelOffsetY, { color: latexColor }, requestRedraw);
      ctx.restore();
    }

    // Orange arrows + labels (phase 4)
    if (state.orangeArrowOpacity > 0 && intersection && arrowData) {
      const { arrow1End, arrow2End, arrow1Mid, arrow2Mid } = arrowData;
      ctx.save();
      ctx.globalAlpha = state.orangeArrowOpacity;
      ctx.strokeStyle = arrowColor; ctx.fillStyle = arrowColor; ctx.lineWidth = arrowWidth;
      drawArrow(ctx, intersection.x, intersection.y, arrow1End.x, arrow1End.y, arrowHeadSize);
      drawArrow(ctx, intersection.x, intersection.y, arrow2End.x, arrow2End.y, arrowHeadSize);
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = state.orangeArrowOpacity;
      drawMathjax(ctx, "v_t(x|x_0^a, x_1^a)", arrow2Mid.x + topArrowLabelOffset.x, arrow2Mid.y + topArrowLabelOffset.y, latexFontSize, 60, 100, { color: arrowColor }, requestRedraw);
      drawMathjax(ctx, "v_t(x|x_0^b, x_1^b)", arrow1Mid.x + bottomArrowLabelOffset.x, arrow1Mid.y + bottomArrowLabelOffset.y, latexFontSize, 60, -35, { color: arrowColor }, requestRedraw);
      ctx.restore();
    }

    // Green mean arrow + label (phase 5)
    if (state.greenArrowOpacity > 0 && intersection && arrowData) {
      const { meanEnd } = arrowData;
      ctx.save();
      ctx.globalAlpha = state.greenArrowOpacity;
      ctx.strokeStyle = meanVectorColor; ctx.fillStyle = meanVectorColor; ctx.lineWidth = arrowWidth;
      drawArrow(ctx, intersection.x, intersection.y, meanEnd.x, meanEnd.y, arrowHeadSize);
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = state.greenArrowOpacity;
      drawMathjax(ctx, "v_t^\\theta(x) = \\mathbb{E}[X_1 - X_0 | x_t = x]", meanEnd.x + meanArrowLabelOffset.x, meanEnd.y + meanArrowLabelOffset.y, latexFontSize, 150, 30, { color: meanVectorColor }, requestRedraw);
      ctx.restore();
    }

    // Keep intersection visible during trajectory phase too
    if (state.trajectoryProgress > 0 && intersection && state.intersectionOpacity >= 1) {
      ctx.save();
      ctx.fillStyle = lineColor;
      ctx.beginPath(); ctx.arc(intersection.x, intersection.y, pointRadius * 1.4, 0, 2*Math.PI); ctx.fill();
      ctx.restore();
    }

    // Green trajectory (phase 7)
    if (state.trajectoryProgress > 0 && combinedTrajectoryPixels.length >= 2) {
      const end = Math.floor(state.trajectoryProgress * (combinedTrajectoryPixels.length - 1)) + 1;
      if (end >= 2) {
        ctx.save();
        ctx.strokeStyle = trajectoryColor;
        ctx.fillStyle = trajectoryColor;
        ctx.lineWidth = trajectoryLineWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const dotR = trajectoryLineWidth * 1.2;
        ctx.beginPath(); ctx.arc(combinedTrajectoryPixels[0][0], combinedTrajectoryPixels[0][1], dotR, 0, 2*Math.PI); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(combinedTrajectoryPixels[0][0], combinedTrajectoryPixels[0][1]);
        for (let i = 1; i < end; i++) ctx.lineTo(combinedTrajectoryPixels[i][0], combinedTrajectoryPixels[i][1]);
        ctx.stroke();
        const cur = combinedTrajectoryPixels[end - 1];
        ctx.beginPath(); ctx.arc(cur[0], cur[1], dotR, 0, 2*Math.PI); ctx.fill();
        ctx.restore();
      }
    }
  }

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  // Advance animation stage. Returns true if animation is in progress, false if all done.
  export function advance(): boolean {
    if (!showCouplingAnimation) return false;
    if (animationComplete) {
      onNextSlide?.();
      return false;
    }
    timeline?.advance(); // no-op if not at a waitForInput point
    return true;
  }

  export function restart() {
    animationComplete = false;
    timeline?.resetState();
    timeline?.play();
  }
  export function pause() {
    if (timeline) timeline.pause();
  }

  function handleCanvasClick() {
    if (!showCouplingAnimation) return;
    timeline?.advance(); // no-op if not waiting for input
    // Slide advancement is handled naturally: data-no-advance is present until
    // animationComplete, so the deckEl click listener only fires after all stages finish.
  }

  onDestroy(() => { if (timeline) timeline.pause(); });

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  $: if (
    canvas &&
    sourceDistributionSamples.length > 0 &&
    targetDistributionSamples.length > 0 &&
    !isInitialized
  ) {
    runInitialComputation();
    isInitialized = true;
    if (showCouplingAnimation) {
      draw(initialState);
      setupCouplingTimeline();
      if (playingByDefault) timeline!.play();
      // Start trajectory computation in background
      if (flowMatchingClient) {
        computeFlowTrajectories().catch(err => console.error('[IntersectingPaths] Trajectory error:', err));
      }
    } else {
      draw(initialState);
      mathjaxInitialized.then(() => draw(initialState));
    }
  }

  $: if (isInitialized && showCouplingAnimation) {
    mathjaxInitialized.then(() => draw(timeline?.state ?? initialState));
  }

  $: if (figureIsActive !== undefined && isInitialized) {
    if (showCouplingAnimation) {
      if (!$figureIsActive) {
        // On slide exit: reset so next visit starts from stage 0
        animationComplete = false;
        timeline?.pause();
        timeline?.resetState();
      } else if (playingByDefault) {
        timeline?.play();
      }
    } else {
      handleVisibilityChange($figureIsActive);
    }
  }
</script>

<Figure {caption} bind:isActive={figureIsActive} {backgroundVisible}>
  {#snippet children()}
    <div
      style="width:100%;max-width:{width}px;"
      data-no-advance={showCouplingAnimation && !animationComplete ? '' : null}
    >
      <canvas
        bind:this={canvas}
        use:canvas2d.bindCanvas
        onclick={handleCanvasClick}
        style="width:100%;height:auto;aspect-ratio:{width}/{height};{showCouplingAnimation ? 'cursor:pointer;' : ''}"
      ></canvas>
    </div>
  {/snippet}
</Figure>
