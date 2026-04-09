<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { Writable } from 'svelte/store';
  import {
    Figure,
    Timeline,
    createPauseClip,
    useCanvas2D,
    drawScatterPlot,
    drawArrowHead,
    drawMathjax,
  } from '@diffusion-explorer/ui';
  import type { FlowModelClient } from '@diffusion-explorer/diffusion';
  import { Katex } from '@diffusion-explorer/ui';

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  export let flowMatchingClient: FlowModelClient | null = null;
  export let cachedGridTrajectories: number[][][] | null = null;
  export let cachedDenseTrajectories: number[][][] | null = null;
  export let allTimeSamples: Writable<number[][][]>;
  export let sourceDistributionSamples: number[][] = [];
  export let targetDistributionSamples: number[][] = [];

  export let width: number = 1600;
  export let height: number = 500;
  export let gridResolution: number = 12;
  export let numSteps: number = 50;
  export let highlightCell: { i: number; j: number } = { i: 6, j: 6 };
  export let animationDuration: number = 8000;
  export let pauseDuration: number = 5000;
  export let scatterPointColor: string = '#3b82f6';
  export let scatterPointRadius: number = 4;
  export let scatterPointOpacity: number = 0.5;
  export let backgroundVisible: boolean = false;
  export let labelFontSize: string = '1em';
  export let showDetLabel: boolean = true;
  export let children: unknown = undefined;

  $: caption = children;

  // Layout: left region takes leftFrac of width, right region takes rightFrac
  const leftFrac = 0.45;
  const gapFrac = 0.08;
  const rightFrac = 1 - leftFrac - gapFrac;

  $: leftEnd = width * leftFrac;
  $: rightStart = width * (leftFrac + gapFrac);
  $: rightEnd = width;

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  let canvas: HTMLCanvasElement | null = null;
  const canvas2d = useCanvas2D(width, height);
  $: ctx = canvas && canvas2d.ctx;

  // Grid data: [timesteps][gridRes][gridRes][2]
  let allGridStates: number[][][][] = [];
  let sourceGrid: number[][][] = []; // grid at t=0 for Jacobian reference

  // Extra sample trajectories: [timesteps][samples][2]
  let sampleTrajectories: number[][][] = [];

  let isInitialized = false;
  let isLoading = true;

  type AnimState = { time: number };
  let timeline: Timeline<AnimState> | null = null;

  // Left region scales (scatter plot mapped into left portion)
  let leftMargin = 30;
  let leftXScale: (v: number) => number = (v) => v;
  let leftYScale: (v: number) => number = (v) => v;

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  function reshapeToGrid(trajectories: number[][][], resolution: number): number[][][][] {
    return trajectories.map(timestep => {
      const grid: number[][][] = [];
      for (let i = 0; i < resolution; i++) {
        grid[i] = [];
        for (let j = 0; j < resolution; j++) {
          const sampleIdx = i * resolution + j;
          grid[i][j] = timestep[sampleIdx];
        }
      }
      return grid;
    });
  }

  function computeLocalJacobian(
    srcGrid: number[][][],
    curGrid: number[][][],
    i: number,
    j: number
  ): { J: number[][]; det: number } {
    const res = srcGrid.length;

    const iLo = Math.max(0, i - 1);
    const iHi = Math.min(res - 1, i + 1);
    const jLo = Math.max(0, j - 1);
    const jHi = Math.min(res - 1, j + 1);

    const dsx = srcGrid[iHi][j][0] - srcGrid[iLo][j][0];
    const dsy = srcGrid[i][jHi][1] - srcGrid[i][jLo][1];

    const dfx_dx = (curGrid[iHi][j][0] - curGrid[iLo][j][0]) / (dsx || 1e-10);
    const dfy_dx = (curGrid[iHi][j][1] - curGrid[iLo][j][1]) / (dsx || 1e-10);
    const dfx_dy = (curGrid[i][jHi][0] - curGrid[i][jLo][0]) / (dsy || 1e-10);
    const dfy_dy = (curGrid[i][jHi][1] - curGrid[i][jLo][1]) / (dsy || 1e-10);

    const J = [[dfx_dx, dfx_dy], [dfy_dx, dfy_dy]];
    const det = dfx_dx * dfy_dy - dfx_dy * dfy_dx;

    return { J, det };
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function computeScales() {
    if (allGridStates.length === 0) return;

    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    for (const grid of allGridStates) {
      for (const row of grid) {
        for (const [x, y] of row) {
          xMin = Math.min(xMin, x);
          xMax = Math.max(xMax, x);
          yMin = Math.min(yMin, y);
          yMax = Math.max(yMax, y);
        }
      }
    }

    const padding = Math.max(xMax - xMin, yMax - yMin) * 0.08;
    xMin -= padding; xMax += padding; yMin -= padding; yMax += padding;

    const dataW = xMax - xMin;
    const dataH = yMax - yMin;
    const canvasW = leftEnd - 2 * leftMargin;
    const canvasH = height - 2 * leftMargin;
    const scale = Math.min(canvasW / dataW, canvasH / dataH);

    const offsetX = leftMargin + (canvasW - dataW * scale) / 2;
    const offsetY = leftMargin + (canvasH - dataH * scale) / 2;

    leftXScale = (v: number) => offsetX + (v - xMin) * scale;
    leftYScale = (v: number) => offsetY + (v - yMin) * scale;
  }

  async function initializeFromCache() {
    if (!cachedGridTrajectories || cachedGridTrajectories.length === 0) return false;

    const numSamples = cachedGridTrajectories[0].length;
    const resolution = Math.round(Math.sqrt(numSamples));
    if (resolution * resolution !== numSamples) {
      console.warn('Grid trajectories sample count is not a perfect square:', numSamples);
      return false;
    }

    gridResolution = resolution;
    allGridStates = reshapeToGrid(cachedGridTrajectories, resolution);
    sourceGrid = allGridStates[0];
    isLoading = false;
    return true;
  }

  async function initializeFromClient() {
    if (!flowMatchingClient) return false;

    const xs = sourceDistributionSamples.map(p => p[0]);
    const ys = sourceDistributionSamples.map(p => p[1]);
    const pad = 0.3;
    const domainRange = {
      xMin: Math.min(...xs) - pad,
      xMax: Math.max(...xs) + pad,
      yMin: Math.min(...ys) - pad,
      yMax: Math.max(...ys) + pad,
    };

    try {
      const result = flowMatchingClient.sampleGrid(gridResolution, domainRange, numSteps);
      const trajectories = await result.promise;
      allGridStates = reshapeToGrid(trajectories, gridResolution);
      sourceGrid = allGridStates[0];
      isLoading = false;
      return true;
    } catch (e) {
      console.error('Failed to sample grid:', e);
      return false;
    }
  }

  // ----------------------------------------------------------------
  // Animations
  // ----------------------------------------------------------------

  function setupTimeline() {
    timeline = new Timeline<AnimState>();
    timeline.initialState = { time: 0 };

    const totalDuration = animationDuration + pauseDuration;
    const forwardEnd = animationDuration / totalDuration;

    timeline.add({
      name: 'Forward',
      reduce(t: number) { return { time: t }; },
    }, { start: 0, end: forwardEnd });

    timeline.add(createPauseClip(), { start: forwardEnd, end: 1 });

    timeline.duration = totalDuration / 1000;
    timeline.looping = true;
    timeline.onTick((_t: number, state: Readonly<AnimState>) => {
      draw(state);
    });
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  const vecColor = '#2ecc71';

  function draw(state: AnimState) {
    if (!ctx || allGridStates.length === 0) return;
    ctx.clearRect(0, 0, width, height);

    const numTimesteps = allGridStates.length;
    const timestepIndex = Math.min(
      Math.floor(state.time * (numTimesteps - 1)),
      numTimesteps - 1
    );
    const currentGrid = allGridStates[timestepIndex];

    // ====== LEFT REGION: scatter plot + mini parallelogram ======

    // Scatter plot
    const samples = $allTimeSamples;
    if (samples && samples.length > 0) {
      const sampleTimesteps = samples.length;
      const sampleIdx = Math.min(
        Math.floor(state.time * (sampleTimesteps - 1)),
        sampleTimesteps - 1
      );
      const currentSamples = samples[sampleIdx];
      const pixelSamples = currentSamples.map(p => [
        leftXScale(p[0]),
        leftYScale(p[1]),
      ]);
      drawScatterPlot(ctx, pixelSamples, scatterPointRadius, scatterPointColor, scatterPointOpacity * 0.5);
    }

    // Extra sampled trajectories
    if (sampleTrajectories.length > 0) {
      const extraTimesteps = sampleTrajectories.length;
      const extraIdx = Math.min(
        Math.floor(state.time * (extraTimesteps - 1)),
        extraTimesteps - 1
      );
      const extraSamples = sampleTrajectories[extraIdx];
      const pixelExtra = extraSamples.map(p => [
        leftXScale(p[0]),
        leftYScale(p[1]),
      ]);
      drawScatterPlot(ctx, pixelExtra, scatterPointRadius, scatterPointColor, scatterPointOpacity * 0.5);
    }

    // Mini parallelogram at highlighted cell
    const ci = highlightCell.i;
    const cj = highlightCell.j;
    if (ci < 1 || ci >= gridResolution - 1 || cj < 1 || cj >= gridResolution - 1 || sourceGrid.length === 0) return;

    const { J } = computeLocalJacobian(sourceGrid, currentGrid, ci, cj);

    // Origin in left-region pixel space
    const origin = currentGrid[ci][cj];
    const pox = leftXScale(origin[0]);
    const poy = leftYScale(origin[1]);

    // Fit mini parallelogram into small bounding box
    const maxSize = 30;
    const rawCornersL = [
      [0, 0], [J[0][0], J[1][0]],
      [J[0][0] + J[0][1], J[1][0] + J[1][1]],
      [J[0][1], J[1][1]],
    ];
    let rMinX = Infinity, rMaxX = -Infinity, rMinY = Infinity, rMaxY = -Infinity;
    for (const [cx, cy] of rawCornersL) {
      rMinX = Math.min(rMinX, cx); rMaxX = Math.max(rMaxX, cx);
      rMinY = Math.min(rMinY, cy); rMaxY = Math.max(rMaxY, cy);
    }
    const rawSpan = Math.max(rMaxX - rMinX, rMaxY - rMinY) || 1e-6;
    const miniScale = maxSize / rawSpan;
    const me1x = J[0][0] * miniScale;
    const me1y = J[1][0] * miniScale;
    const me2x = J[0][1] * miniScale;
    const me2y = J[1][1] * miniScale;

    // Draw mini parallelogram fill
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = vecColor;
    ctx.beginPath();
    ctx.moveTo(pox, poy);
    ctx.lineTo(pox + me1x, poy + me1y);
    ctx.lineTo(pox + me1x + me2x, poy + me1y + me2y);
    ctx.lineTo(pox + me2x, poy + me2y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Draw mini parallelogram outline
    ctx.save();
    ctx.strokeStyle = vecColor;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.moveTo(pox, poy);
    ctx.lineTo(pox + me1x, poy + me1y);
    ctx.lineTo(pox + me1x + me2x, poy + me1y + me2y);
    ctx.lineTo(pox + me2x, poy + me2y);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();

    // Compute mini parallelogram bounding box for connector
    const miniCornerYs = [poy, poy + me1y, poy + me1y + me2y, poy + me2y];
    const miniCornerXs = [pox, pox + me1x, pox + me1x + me2x, pox + me2x];
    const miniTop = Math.min(...miniCornerYs);
    const miniBot = Math.max(...miniCornerYs);
    const miniRight = Math.max(...miniCornerXs);

    // ====== CONNECTOR: trapezoid from mini parallelogram to right region ======

    // Right region box (will be computed as square below)
    const rPad = 20;
    const rFullW_ = rightEnd - rightStart;
    const rFullH_ = height - 2 * rPad;
    const rSide_ = Math.min(rFullW_, rFullH_);
    const rBoxLeft = rightStart + (rFullW_ - rSide_) / 2;
    const rBoxTop = rPad + (rFullH_ - rSide_) / 2;
    const rBoxBot = rBoxTop + rSide_;

    ctx.save();
    ctx.globalAlpha = 0.07;
    ctx.fillStyle = '#888888';
    ctx.beginPath();
    ctx.moveTo(miniRight, miniTop);
    ctx.lineTo(rBoxLeft, rBoxTop);
    ctx.lineTo(rBoxLeft, rBoxBot);
    ctx.lineTo(miniRight, miniBot);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = '#888888';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.25;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(miniRight, miniTop);
    ctx.lineTo(rBoxLeft, rBoxTop);
    ctx.moveTo(miniRight, miniBot);
    ctx.lineTo(rBoxLeft, rBoxBot);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // ====== RIGHT REGION: zoomed parallelogram with vectors ======

    // Right region background with drop shadow (square)
    const rFullW = rightEnd - rightStart;
    const rFullH = height - 2 * rPad;
    const rSide = Math.min(rFullW, rFullH);
    const rX = rightStart + (rFullW - rSide) / 2;
    const rY = rPad + (rFullH - rSide) / 2;
    const rW = rSide;
    const cornerRadius = 8;

    // Drop shadow
    ctx.save();
    ctx.shadowColor = 'rgba(100, 100, 100, 0.35)';
    ctx.shadowBlur = 20;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(rX, rY, rSide, rSide, cornerRadius);
    ctx.fill();
    ctx.restore();

    // Clip right region for scatter + parallelogram drawing
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(rX, rY, rSide, rSide, cornerRadius);
    ctx.clip();

    // Gather scatter points for the zoomed right region
    const originData = currentGrid[ci][cj];
    var nearbySamples: number[][] = [];

    const samples2 = $allTimeSamples;
    if (samples2 && samples2.length > 0) {
      const sampleTimesteps2 = samples2.length;
      const sampleIdx2 = Math.min(
        Math.floor(state.time * (sampleTimesteps2 - 1)),
        sampleTimesteps2 - 1
      );
      nearbySamples = samples2[sampleIdx2];
    }

    // Compute zoomed parallelogram
    const rawCorners = [
      [0, 0], [J[0][0], J[1][0]],
      [J[0][0] + J[0][1], J[1][0] + J[1][1]],
      [J[0][1], J[1][1]],
    ];
    let rawMinX2 = Infinity, rawMaxX2 = -Infinity, rawMinY2 = Infinity, rawMaxY2 = -Infinity;
    for (const [cx, cy] of rawCorners) {
      rawMinX2 = Math.min(rawMinX2, cx); rawMaxX2 = Math.max(rawMaxX2, cx);
      rawMinY2 = Math.min(rawMinY2, cy); rawMaxY2 = Math.max(rawMaxY2, cy);
    }
    const rawW2 = rawMaxX2 - rawMinX2 || 1e-6;
    const rawH2 = rawMaxY2 - rawMinY2 || 1e-6;

    const rMargin = 60;
    const availW = rSide - 2 * rMargin;
    const availH = rSide - 2 * rMargin;
    const vecScale = Math.min(availW / rawW2, availH / rawH2) * 0.85;

    const ox = rX + rMargin + (availW - rawW2 * vecScale) / 2 - rawMinX2 * vecScale;
    const oy = rY + rMargin + (availH - rawH2 * vecScale) / 2 - rawMinY2 * vecScale;

    const e1x = J[0][0] * vecScale;
    const e1y = J[1][0] * vecScale;
    const e2x = J[0][1] * vecScale;
    const e2y = J[1][1] * vecScale;

    // Draw scatter points in zoomed right region (clipped to the square)
    // Scale: map the visible data-space region (rSide worth) around the origin
    // Use a data radius that shows a meaningful neighborhood
    const zoomDataScale = rSide / 1.2; // data units to pixels — ~1.2 data units fills the square

    if (nearbySamples.length > 0) {
      const zoomedPixels = nearbySamples.map(p => [
        ox + (p[0] - originData[0]) * zoomDataScale,
        oy + (p[1] - originData[1]) * zoomDataScale,
      ]);
      drawScatterPlot(ctx, zoomedPixels, scatterPointRadius * 2, scatterPointColor, 0.15);
    }

    // Filled parallelogram
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = vecColor;
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox + e1x, oy + e1y);
    ctx.lineTo(ox + e1x + e2x, oy + e1y + e2y);
    ctx.lineTo(ox + e2x, oy + e2y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Parallelogram outline
    ctx.save();
    ctx.strokeStyle = vecColor;
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox + e1x, oy + e1y);
    ctx.lineTo(ox + e1x + e2x, oy + e1y + e2y);
    ctx.lineTo(ox + e2x, oy + e2y);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();

    // Column vector 1 arrow
    ctx.save();
    ctx.strokeStyle = vecColor;
    ctx.fillStyle = vecColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox + e1x, oy + e1y);
    ctx.stroke();
    drawArrowHead(ctx, ox, oy, ox + e1x, oy + e1y, 10);
    ctx.restore();

    // Column vector 2 arrow
    ctx.save();
    ctx.strokeStyle = vecColor;
    ctx.fillStyle = vecColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox + e2x, oy + e2y);
    ctx.stroke();
    drawArrowHead(ctx, ox, oy, ox + e2x, oy + e2y, 10);
    ctx.restore();

    // Restore clip
    ctx.restore();
  }

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  export function restart() {
    if (timeline) {
      timeline.seek(0);
      timeline.play();
    }
  }

  export function pause() {
    if (timeline) timeline.pause();
  }

  onDestroy(() => {
    if (timeline) timeline.pause();
  });

  // ----------------------------------------------------------------
  // Reactive Blocks
  // ----------------------------------------------------------------

  $: if (
    !isInitialized &&
    canvas &&
    (cachedGridTrajectories || (flowMatchingClient && sourceDistributionSamples.length > 0))
  ) {
    (async () => {
      let success = await initializeFromCache();
      if (!success) {
        success = await initializeFromClient();
      }
      if (success && allGridStates.length > 0) {
        highlightCell = {
          i: Math.min(Math.max(1, highlightCell.i), gridResolution - 2),
          j: Math.min(Math.max(1, highlightCell.j), gridResolution - 2),
        };
        if (cachedDenseTrajectories && cachedDenseTrajectories.length > 0) {
          sampleTrajectories = cachedDenseTrajectories;
        }

        computeScales();
        setupTimeline();
        isInitialized = true;
        draw(timeline!.initialState);
        timeline!.play();
      }
    })();
  }

  $: if (isInitialized && sampleTrajectories.length > 0 && timeline) {
    draw(timeline.state);
  }
</script>

<Figure backgroundVisible={false} {caption}>
  {#snippet children()}
    <div class="jacobian-wrapper" style="width: 100%; max-width: {width}px;">
      {#if showDetLabel}
        <div class="det-label" style="left: {(leftFrac + gapFrac + (1 - leftFrac - gapFrac) / 2) * 100}%; font-size: {labelFontSize};">
          <Katex math={"\\color{#2ecc71}{\\left|\\det \\dfrac{\\partial f}{\\partial z}\\right|}"} />
        </div>
      {/if}
      <canvas
        bind:this={canvas}
        use:canvas2d.bindCanvas
        style="width: 100%; height: auto; aspect-ratio: {width}/{height};"
      ></canvas>
    </div>
  {/snippet}
</Figure>

<style>
  .jacobian-wrapper {
    position: relative;
  }
  .det-label {
    position: absolute;
    top: -3.5em;
    transform: translateX(-50%);
    pointer-events: none;
  }
</style>
