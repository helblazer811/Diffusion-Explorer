<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { DoubleFigure, useCanvas2D, drawHeatmap, Timeline, type Clip } from '@diffusion-explorer/ui';
  import * as d3 from 'd3';
  import {
    getAllCasePolygons,
    getCaseCornerStates,
    getCaseIndex,
    type Point,
  } from '../marching-squares';

  // ================================================================
  // Props - Component interface
  // ================================================================
  export let canvasWidth = 400;
  export let canvasHeight = 400;
  export let gridSize = 12;
  export let numSamples = 800;
  export let bandwidth = 8;
  export let threshold = 0.3;

  // ================================================================
  // State - Canvas, ctx, scales, flags, animation state
  // ================================================================
  const marginWidth = 40;
  const marginHeight = 40;

  // Canvas managers
  const leftCanvas2d = useCanvas2D(canvasWidth, canvasHeight);
  const rightCanvas2d = useCanvas2D(canvasWidth, canvasHeight);

  // Canvas references
  let leftCanvas: HTMLCanvasElement | null = null;
  let rightCanvas: HTMLCanvasElement | null = null;

  // Visibility binding - receives store from DoubleFigure
  let figureIsActive: ReturnType<typeof import('svelte/store').writable<boolean>> | undefined;

  // Initialize flag
  let isInitialized = false;

  // Computed contexts
  $: leftCtx = leftCanvas && leftCanvas2d.ctx;
  $: rightCtx = rightCanvas && rightCanvas2d.ctx;

  // Scales
  let xScale: d3.ScaleLinear<number, number>;
  let yScale: d3.ScaleLinear<number, number>;
  const domain: [number, number, number, number] = [-3, 3, -3, 3];
  const [xMin, xMax, yMin, yMax] = domain;

  // Generated samples for the 3-mode Gaussian
  let samples: number[][] = [];

  // Density grid for marching squares evaluation
  let densityGrid: Float32Array | null = null;
  const densityResolution = 100;

  // Timeline
  let timeline: Timeline<AnimationState>;

  // Animation state type
  type AnimationState = {
    currentCellIndex: number;  // Which cell we're highlighting (0 to gridSize*gridSize - 1)
    highlightedCaseIndex: number;  // Which case (0-15) to highlight on the right
    showPolygon: boolean;  // Whether to show the polygon on the current cell
  };

  // ================================================================
  // Helpers - Pure utility functions
  // ================================================================

  /**
   * Sample from a single 2D Gaussian
   */
  function sampleGaussian2D(
    meanX: number,
    meanY: number,
    stdX: number,
    stdY: number
  ): [number, number] {
    // Box-Muller transform
    const u1 = Math.random();
    const u2 = Math.random();
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const z1 = Math.sqrt(-2 * Math.log(u1)) * Math.sin(2 * Math.PI * u2);
    return [meanX + z0 * stdX, meanY + z1 * stdY];
  }

  /**
   * Generate samples from a 3-mode Gaussian mixture
   */
  function generate3ModeGaussianSamples(n: number): number[][] {
    const modes = [
      { mean: [-1.5, 1.0], std: [0.5, 0.5], weight: 0.35 },
      { mean: [1.2, 0.8], std: [0.6, 0.4], weight: 0.35 },
      { mean: [0, -1.5], std: [0.4, 0.6], weight: 0.3 },
    ];

    const result: number[][] = [];
    for (let i = 0; i < n; i++) {
      // Choose which mode to sample from
      const r = Math.random();
      let cumWeight = 0;
      let selectedMode = modes[0];
      for (const mode of modes) {
        cumWeight += mode.weight;
        if (r < cumWeight) {
          selectedMode = mode;
          break;
        }
      }

      const [x, y] = sampleGaussian2D(
        selectedMode.mean[0],
        selectedMode.mean[1],
        selectedMode.std[0],
        selectedMode.std[1]
      );
      result.push([x, y]);
    }
    return result;
  }

  /**
   * Compute density grid using kernel density estimation
   */
  function computeDensityGrid(
    points: number[][],
    resolution: number,
    sigma: number
  ): Float32Array {
    const w = resolution;
    const h = resolution;
    const grid = new Float32Array(w * h);

    const toGridX = (x: number) => ((x - xMin) / (xMax - xMin)) * (w - 1);
    const toGridY = (y: number) => ((y - yMin) / (yMax - yMin)) * (h - 1);

    // Splat points
    for (const [x, y] of points) {
      const gx = Math.round(toGridX(x));
      const gy = Math.round(toGridY(y));
      if (gx >= 0 && gx < w && gy >= 0 && gy < h) {
        grid[gy * w + gx] += 1;
      }
    }

    // Gaussian blur
    const radius = Math.ceil(3 * sigma);
    const size = radius * 2 + 1;
    const kernel = new Float32Array(size);

    let sum = 0;
    for (let i = -radius; i <= radius; i++) {
      const v = Math.exp(-(i * i) / (2 * sigma * sigma));
      kernel[i + radius] = v;
      sum += v;
    }
    for (let i = 0; i < size; i++) kernel[i] /= sum;

    // Horizontal blur
    const temp = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let k = -radius; k <= radius; k++) {
          const xx = x + k;
          if (xx >= 0 && xx < w) {
            acc += grid[y * w + xx] * kernel[k + radius];
          }
        }
        temp[y * w + x] = acc;
      }
    }

    // Vertical blur
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let k = -radius; k <= radius; k++) {
          const yy = y + k;
          if (yy >= 0 && yy < h) {
            acc += temp[yy * w + x] * kernel[k + radius];
          }
        }
        out[y * w + x] = acc;
      }
    }

    return out;
  }

  /**
   * Evaluate the density at a given point using bilinear interpolation
   */
  function evaluateDensity(x: number, y: number): number {
    if (!densityGrid) return 0;

    const w = densityResolution;
    const h = densityResolution;

    // Convert to grid coordinates
    const gx = ((x - xMin) / (xMax - xMin)) * (w - 1);
    const gy = ((y - yMin) / (yMax - yMin)) * (h - 1);

    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const x1 = Math.min(x0 + 1, w - 1);
    const y1 = Math.min(y0 + 1, h - 1);

    if (x0 < 0 || x0 >= w || y0 < 0 || y0 >= h) return 0;

    const fx = gx - x0;
    const fy = gy - y0;

    const v00 = densityGrid[y0 * w + x0];
    const v10 = densityGrid[y0 * w + x1];
    const v01 = densityGrid[y1 * w + x0];
    const v11 = densityGrid[y1 * w + x1];

    return (
      v00 * (1 - fx) * (1 - fy) +
      v10 * fx * (1 - fy) +
      v01 * (1 - fx) * fy +
      v11 * fx * fy
    );
  }

  /**
   * Get max density value for normalization
   */
  function getMaxDensity(): number {
    if (!densityGrid) return 1;
    let max = 0;
    for (let i = 0; i < densityGrid.length; i++) {
      if (densityGrid[i] > max) max = densityGrid[i];
    }
    return max || 1;
  }

  // ================================================================
  // Setup - runInitialComputation()
  // ================================================================

  function runInitialComputation() {
    // Create scales
    xScale = d3
      .scaleLinear()
      .domain([xMin, xMax])
      .range([marginWidth, canvasWidth - marginWidth]);

    yScale = d3
      .scaleLinear()
      .domain([yMin, yMax])
      .range([canvasHeight - marginHeight, marginHeight]);

    // Generate samples
    samples = generate3ModeGaussianSamples(numSamples);

    // Compute density grid
    densityGrid = computeDensityGrid(samples, densityResolution, bandwidth);
  }

  // ================================================================
  // Animations - setupTimeline(), clips, onTick
  // ================================================================

  function setupTimeline() {
    timeline = new Timeline<AnimationState>();

    const totalCells = gridSize * gridSize;

    timeline.initialState = {
      currentCellIndex: -1,
      highlightedCaseIndex: -1,
      showPolygon: false,
    };

    // Animation duration: ~0.15 seconds per cell
    timeline.duration = totalCells * 0.15;
    timeline.looping = true;
    timeline.setEndPause(2);

    // Create the cell iteration clip
    const cellIterationClip: Clip<AnimationState> = {
      name: 'CellIteration',
      reduce(t: number) {
        // t goes from 0 to 1 over the duration
        const cellIndex = Math.min(
          Math.floor(t * totalCells),
          totalCells - 1
        );

        // Calculate which case this cell matches
        const row = Math.floor(cellIndex / gridSize);
        const col = cellIndex % gridSize;

        const cellWidth = (xMax - xMin) / gridSize;
        const cellHeight = (yMax - yMin) / gridSize;

        const cellXMin = xMin + col * cellWidth;
        const cellYMin = yMin + row * cellHeight;

        // Get corner values (normalized)
        const maxDensity = getMaxDensity();
        const tl = evaluateDensity(cellXMin, cellYMin) / maxDensity;
        const tr = evaluateDensity(cellXMin + cellWidth, cellYMin) / maxDensity;
        const bl = evaluateDensity(cellXMin, cellYMin + cellHeight) / maxDensity;
        const br = evaluateDensity(cellXMin + cellWidth, cellYMin + cellHeight) / maxDensity;

        const caseIndex = getCaseIndex(tl, tr, br, bl, threshold);

        return {
          currentCellIndex: cellIndex,
          highlightedCaseIndex: caseIndex,
          showPolygon: true,
        };
      },
    };

    timeline.add(cellIterationClip, { start: 0, end: 1 });

    timeline.onTick((_, state) => {
      draw(state);
    });
  }

  // ================================================================
  // Drawing - Draw helpers + main draw(state) function
  // ================================================================

  /**
   * White to blue color scale
   */
  function whiteToBlueScale(t: number): string {
    // Interpolate from white (low density) to blue (high density)
    const r = Math.round(255 * (1 - t));
    const g = Math.round(255 * (1 - t));
    const b = 255;
    return `rgb(${r}, ${g}, ${b})`;
  }

  /**
   * Draw a thin gray grid over the heatmap
   */
  function drawGrid(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.strokeStyle = 'rgba(128, 128, 128, 0.4)';
    ctx.lineWidth = 0.5;

    const cellWidthData = (xMax - xMin) / gridSize;
    const cellHeightData = (yMax - yMin) / gridSize;

    // Vertical lines
    for (let col = 0; col <= gridSize; col++) {
      const x = xMin + col * cellWidthData;
      const px = xScale(x);
      ctx.beginPath();
      ctx.moveTo(px, yScale(yMax));
      ctx.lineTo(px, yScale(yMin));
      ctx.stroke();
    }

    // Horizontal lines
    for (let row = 0; row <= gridSize; row++) {
      const y = yMin + row * cellHeightData;
      const py = yScale(y);
      ctx.beginPath();
      ctx.moveTo(xScale(xMin), py);
      ctx.lineTo(xScale(xMax), py);
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Highlight the current cell being processed
   */
  function drawCellHighlight(ctx: CanvasRenderingContext2D, cellIndex: number) {
    if (cellIndex < 0) return;

    const row = Math.floor(cellIndex / gridSize);
    const col = cellIndex % gridSize;

    const cellWidthData = (xMax - xMin) / gridSize;
    const cellHeightData = (yMax - yMin) / gridSize;

    const cellXMin = xMin + col * cellWidthData;
    const cellYMin = yMin + row * cellHeightData;

    const px = xScale(cellXMin);
    const py = yScale(cellYMin + cellHeightData);
    const pw = xScale(cellXMin + cellWidthData) - px;
    const ph = yScale(cellYMin) - py;

    ctx.save();
    ctx.strokeStyle = '#ff6b6b';
    ctx.lineWidth = 2;
    ctx.strokeRect(px, py, pw, ph);
    ctx.restore();
  }

  /**
   * Draw all processed cells (cells before current index) with their polygons
   */
  function drawProcessedCells(ctx: CanvasRenderingContext2D, upToCellIndex: number) {
    if (upToCellIndex < 0) return;

    const cellWidthData = (xMax - xMin) / gridSize;
    const cellHeightData = (yMax - yMin) / gridSize;
    const maxDensity = getMaxDensity();
    const casePolygons = getAllCasePolygons();

    ctx.save();
    ctx.fillStyle = 'rgba(59, 130, 246, 0.6)';  // Blue with transparency

    for (let cellIndex = 0; cellIndex <= upToCellIndex; cellIndex++) {
      const row = Math.floor(cellIndex / gridSize);
      const col = cellIndex % gridSize;

      const cellXMin = xMin + col * cellWidthData;
      const cellYMin = yMin + row * cellHeightData;

      // Get corner values
      const tl = evaluateDensity(cellXMin, cellYMin) / maxDensity;
      const tr = evaluateDensity(cellXMin + cellWidthData, cellYMin) / maxDensity;
      const bl = evaluateDensity(cellXMin, cellYMin + cellHeightData) / maxDensity;
      const br = evaluateDensity(cellXMin + cellWidthData, cellYMin + cellHeightData) / maxDensity;

      const caseIndex = getCaseIndex(tl, tr, br, bl, threshold);
      const polygon = casePolygons[caseIndex];

      if (polygon.length > 0) {
        const px = xScale(cellXMin);
        const py = yScale(cellYMin + cellHeightData);
        const pw = xScale(cellXMin + cellWidthData) - px;
        const ph = yScale(cellYMin) - py;

        ctx.beginPath();
        for (let i = 0; i < polygon.length; i++) {
          const [nx, ny] = polygon[i];
          const canvasX = px + nx * pw;
          const canvasY = py + ny * ph;
          if (i === 0) {
            ctx.moveTo(canvasX, canvasY);
          } else {
            ctx.lineTo(canvasX, canvasY);
          }
        }
        ctx.closePath();
        ctx.fill();
      }
    }

    ctx.restore();
  }

  /**
   * Draw the 4x4 grid of marching squares cases on the right canvas
   */
  function drawCasesGrid(ctx: CanvasRenderingContext2D, highlightedCase: number) {
    const casePolygons = getAllCasePolygons();
    const padding = 20;
    const gap = 10;
    const availableWidth = canvasWidth - 2 * padding;
    const availableHeight = canvasHeight - 2 * padding;
    const cellSize = Math.min(
      (availableWidth - 3 * gap) / 4,
      (availableHeight - 3 * gap) / 4
    );

    const startX = padding + (availableWidth - (4 * cellSize + 3 * gap)) / 2;
    const startY = padding + (availableHeight - (4 * cellSize + 3 * gap)) / 2;

    for (let caseIndex = 0; caseIndex < 16; caseIndex++) {
      const row = Math.floor(caseIndex / 4);
      const col = caseIndex % 4;

      const cellX = startX + col * (cellSize + gap);
      const cellY = startY + row * (cellSize + gap);

      // Draw cell background
      ctx.save();
      ctx.fillStyle = '#f5f5f5';
      ctx.fillRect(cellX, cellY, cellSize, cellSize);

      // Draw cell border
      const isHighlighted = caseIndex === highlightedCase;
      ctx.strokeStyle = isHighlighted ? '#ff6b6b' : '#ccc';
      ctx.lineWidth = isHighlighted ? 3 : 1;
      ctx.strokeRect(cellX, cellY, cellSize, cellSize);

      // Draw corner indicators
      const cornerStates = getCaseCornerStates(caseIndex);
      const cornerRadius = 4;
      const cornerOffset = 6;

      const corners = [
        { x: cellX + cornerOffset, y: cellY + cornerOffset, filled: cornerStates.tl },
        { x: cellX + cellSize - cornerOffset, y: cellY + cornerOffset, filled: cornerStates.tr },
        { x: cellX + cellSize - cornerOffset, y: cellY + cellSize - cornerOffset, filled: cornerStates.br },
        { x: cellX + cornerOffset, y: cellY + cellSize - cornerOffset, filled: cornerStates.bl },
      ];

      for (const corner of corners) {
        ctx.beginPath();
        ctx.arc(corner.x, corner.y, cornerRadius, 0, Math.PI * 2);
        ctx.fillStyle = corner.filled ? '#3b82f6' : '#ddd';
        ctx.fill();
        ctx.strokeStyle = '#999';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Draw polygon
      const polygon = casePolygons[caseIndex];
      if (polygon.length > 0) {
        ctx.beginPath();
        ctx.fillStyle = 'rgba(59, 130, 246, 0.6)';
        for (let i = 0; i < polygon.length; i++) {
          const [nx, ny] = polygon[i];
          const canvasX = cellX + nx * cellSize;
          const canvasY = cellY + ny * cellSize;
          if (i === 0) {
            ctx.moveTo(canvasX, canvasY);
          } else {
            ctx.lineTo(canvasX, canvasY);
          }
        }
        ctx.closePath();
        ctx.fill();
      }

      // Draw case number
      ctx.fillStyle = '#666';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${caseIndex}`, cellX + cellSize / 2, cellY + cellSize + 12);

      ctx.restore();
    }
  }

  /**
   * Main draw function
   */
  function draw(state: AnimationState) {
    if (!leftCtx || !rightCtx) return;

    // Clear both canvases
    leftCtx.clearRect(0, 0, canvasWidth, canvasHeight);
    rightCtx.clearRect(0, 0, canvasWidth, canvasHeight);

    // ---- Left canvas: Heatmap + Grid + Processed cells + Current cell highlight ----

    // Draw heatmap
    drawHeatmap(leftCtx, samples, {
      resolution: 100,
      bandwidth: bandwidth,
      domain: domain,
      colorScale: whiteToBlueScale,
      opacity: 1,
      xScale: xScale,
      yScale: yScale,
    });

    // Draw grid
    drawGrid(leftCtx);

    // Draw processed cells with polygons
    drawProcessedCells(leftCtx, state.currentCellIndex);

    // Highlight current cell
    drawCellHighlight(leftCtx, state.currentCellIndex);

    // ---- Right canvas: 4x4 grid of cases ----
    drawCasesGrid(rightCtx, state.highlightedCaseIndex);
  }

  // ================================================================
  // Event Handlers - Canvas clicks, sliders, visibility
  // ================================================================

  function handleVisibilityChange(isVisible: boolean) {
    if (!timeline) return;
    if (isVisible) {
      timeline.play();
    } else {
      timeline.pause();
    }
  }

  // ================================================================
  // Lifecycle - onMount, onDestroy
  // ================================================================

  onMount(() => {
    if (leftCanvas) {
      leftCanvas2d.init(leftCanvas);
    }
    if (rightCanvas) {
      rightCanvas2d.init(rightCanvas);
    }

    runInitialComputation();
    setupTimeline();
    isInitialized = true;

    // Initial draw
    draw(timeline.state);
  });

  onDestroy(() => {
    if (timeline) {
      timeline.dispose();
    }
  });

  // ================================================================
  // Reactive Blocks - $: statements
  // ================================================================

  $: if (figureIsActive !== undefined && isInitialized) {
    handleVisibilityChange($figureIsActive);
  }
</script>

<DoubleFigure gap={20} bind:isActive={figureIsActive}>
  {#snippet left()}
    <canvas
      bind:this={leftCanvas}
      width={canvasWidth}
      height={canvasHeight}
      style="width: {canvasWidth}px; height: {canvasHeight}px;"
    />
  {/snippet}

  {#snippet right()}
    <canvas
      bind:this={rightCanvas}
      width={canvasWidth}
      height={canvasHeight}
      style="width: {canvasWidth}px; height: {canvasHeight}px;"
    />
  {/snippet}

  {#snippet caption()}
    <strong>Marching Squares Algorithm.</strong> Left: A 3-mode Gaussian mixture rendered
    as a heatmap with a grid overlay. The algorithm processes each cell from top-left
    to bottom-right, determining which of the 16 cases matches based on corner density
    values above/below the threshold. Right: The 16 possible marching squares cases.
    Filled corners (blue dots) indicate values above the threshold. The currently
    matched case is highlighted in red.
  {/snippet}
</DoubleFigure>
