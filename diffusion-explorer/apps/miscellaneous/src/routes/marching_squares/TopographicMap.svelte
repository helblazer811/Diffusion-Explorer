<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Figure, useCanvas2D, Timeline, type Clip } from '@diffusion-explorer/ui';
  import * as d3 from 'd3';
  import { loadVolcanoData } from './topography-data';
  import {
    computeContourCells,
    traceContourLines,
    drawContourLines,
    chainSegments,
    type Point,
  } from './contour-outlining';
  import { getAllCasePolygons, getCaseIndex } from './marching-squares';
  import { IncrementalComponentTracker, type CellInfo } from './union-find-components';

  // ================================================================
  // Props
  // ================================================================
  export let canvasWidth = 400;
  export let canvasHeight = 400;
  export let numLevels = 3;
  export let blurSigma = 0;
  export let gridSize = 100;

  // Minimum threshold as fraction of height range (0 = minHeight, 1 = maxHeight)
  const minThresholdFraction = 0.25;

  // ================================================================
  // State
  // ================================================================
  const marginWidth = 20;
  const marginHeight = 20;

  const canvas2d = useCanvas2D(canvasWidth, canvasHeight);
  let canvas: HTMLCanvasElement | null = null;

  // Visibility binding
  let figureIsActive: ReturnType<typeof import('svelte/store').writable<boolean>> | undefined;

  // Initialize flag
  let isInitialized = false;

  // Scales (set after data loads)
  let xScale: d3.ScaleLinear<number, number>;
  let yScale: d3.ScaleLinear<number, number>;

  // Volcano heightmap data
  let heightmap: Float32Array;
  let heightmapWidth: number;
  let heightmapHeight: number;
  let minHeight: number;
  let maxHeight: number;

  // Pre-rendered heatmap
  let heatmapImageData: ImageData | null = null;

  // Contour data for all levels
  let contourLevels: Array<{
    threshold: number;
    polylines: Point[][];
  }> = [];

  // Component trackers (one per level) for incremental connected component visualization
  let componentTrackers: IncrementalComponentTracker[] = [];

  // Timeline
  let timeline: Timeline<AnimationState>;

  // Animation state type
  type AnimationState = {
    currentLevel: number;
    currentRowIndex: number; // Changed to row-based animation
    completedLevels: number[];
  };

  // ================================================================
  // Helpers
  // ================================================================

  function evalHeightAt(col: number, row: number): number {
    const hx = (col / gridSize) * (heightmapWidth - 1);
    const hy = (row / gridSize) * (heightmapHeight - 1);
    // Bilinear interpolation
    const x0 = Math.floor(hx);
    const y0 = Math.floor(hy);
    const x1 = Math.min(x0 + 1, heightmapWidth - 1);
    const y1 = Math.min(y0 + 1, heightmapHeight - 1);
    const fx = hx - x0;
    const fy = hy - y0;

    const v00 = heightmap[y0 * heightmapWidth + x0];
    const v10 = heightmap[y0 * heightmapWidth + x1];
    const v01 = heightmap[y1 * heightmapWidth + x0];
    const v11 = heightmap[y1 * heightmapWidth + x1];

    return (1 - fx) * (1 - fy) * v00 + fx * (1 - fy) * v10 + (1 - fx) * fy * v01 + fx * fy * v11;
  }

  function plasmaColorScale(t: number): [number, number, number] {
    const color = d3.color(d3.interpolatePlasma(t));
    if (color) {
      const rgb = color.rgb();
      return [Math.round(rgb.r), Math.round(rgb.g), Math.round(rgb.b)];
    }
    return [0, 0, 0];
  }

  function createHeatmapImageData(): ImageData {
    const imageData = new ImageData(heightmapWidth, heightmapHeight);
    const data = imageData.data;

    for (let row = 0; row < heightmapHeight; row++) {
      for (let col = 0; col < heightmapWidth; col++) {
        const height = heightmap[row * heightmapWidth + col];
        const t = (height - minHeight) / (maxHeight - minHeight) * 0.7;
        const [r, g, b] = plasmaColorScale(t);

        const idx = (row * heightmapWidth + col) * 4;
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = 255;
      }
    }

    return imageData;
  }

  /**
   * Get threshold value for a given level (0 to numLevels-1)
   */
  function getThresholdForLevel(level: number): number {
    const t = minThresholdFraction + ((level + 1) / (numLevels + 1)) * (1 - minThresholdFraction);
    return minHeight + t * (maxHeight - minHeight);
  }

  // ================================================================
  // Setup
  // ================================================================

  function runInitialComputation() {
    xScale = d3
      .scaleLinear()
      .domain([0, gridSize])
      .range([marginWidth, canvasWidth - marginWidth]);

    yScale = d3
      .scaleLinear()
      .domain([0, gridSize])
      .range([marginHeight, canvasHeight - marginHeight]);

    heatmapImageData = createHeatmapImageData();

    // Compute contour lines at multiple levels (starting from higher minimum)
    contourLevels = [];
    for (let i = 0; i < numLevels; i++) {
      const t = minThresholdFraction + ((i + 1) / (numLevels + 1)) * (1 - minThresholdFraction);
      const threshold = minHeight + t * (maxHeight - minHeight);

      const cells = computeContourCells(evalHeightAt, gridSize, gridSize, threshold);
      const polylines = traceContourLines(cells, gridSize, gridSize);

      contourLevels.push({ threshold, polylines });
    }

    // Initialize component trackers for each level
    componentTrackers = [];
    for (let i = 0; i < numLevels; i++) {
      componentTrackers.push(new IncrementalComponentTracker());
    }
  }

  // ================================================================
  // Animations
  // ================================================================

  function setupTimeline() {
    timeline = new Timeline<AnimationState>();

    const totalRows = gridSize;
    const totalIterations = totalRows * numLevels;

    timeline.initialState = {
      currentLevel: 0,
      currentRowIndex: -1,
      completedLevels: [],
    };

    timeline.duration = totalIterations * 0.15; // Slower since fewer iterations
    timeline.looping = true;
    timeline.setEndPause(2);

    const rowIterationClip: Clip<AnimationState> = {
      name: 'RowIteration',
      reduce(t: number) {
        const globalIndex = Math.min(Math.floor(t * totalIterations), totalIterations - 1);

        const currentLevel = Math.floor(globalIndex / totalRows);
        const rowIndex = globalIndex % totalRows;

        // Build list of completed levels
        const completedLevels: number[] = [];
        for (let i = 0; i < currentLevel; i++) {
          completedLevels.push(i);
        }

        return {
          currentLevel,
          currentRowIndex: rowIndex,
          completedLevels,
        };
      },
    };

    timeline.add(rowIterationClip, { start: 0.05, end: 1 }); // Add initial pause

    timeline.onTick((_, state) => {
      draw(state);
    });
  }

  // ================================================================
  // Drawing
  // ================================================================

  function drawHeatmapLayer(ctx: CanvasRenderingContext2D) {
    if (!heatmapImageData) return;

    ctx.save();

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = heatmapImageData.width;
    tempCanvas.height = heatmapImageData.height;
    const tempCtx = tempCanvas.getContext('2d');
    if (tempCtx) {
      tempCtx.putImageData(heatmapImageData, 0, 0);
      const plotWidth = canvasWidth - 2 * marginWidth;
      const plotHeight = canvasHeight - 2 * marginHeight;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(tempCanvas, marginWidth, marginHeight, plotWidth, plotHeight);
    }

    ctx.restore();
  }

  /**
   * Draw a thin gray grid over the heatmap
   */
  function drawGrid(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 0.5;

    for (let col = 0; col <= gridSize; col++) {
      const px = xScale(col);
      ctx.beginPath();
      ctx.moveTo(px, yScale(0));
      ctx.lineTo(px, yScale(gridSize));
      ctx.stroke();
    }

    for (let row = 0; row <= gridSize; row++) {
      const py = yScale(row);
      ctx.beginPath();
      ctx.moveTo(xScale(0), py);
      ctx.lineTo(xScale(gridSize), py);
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Highlight the current row being processed
   */
  function drawRowHighlight(ctx: CanvasRenderingContext2D, rowIndex: number) {
    if (rowIndex < 0) return;

    const px = xScale(0);
    const py = yScale(rowIndex);
    const pw = xScale(gridSize) - px;
    const ph = yScale(rowIndex + 1) - py;

    ctx.save();
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    ctx.strokeRect(px, py, pw, ph);
    ctx.restore();
  }

  /**
   * Extract the outer boundary edges of a connected component.
   */
  function extractComponentBoundary(cells: CellInfo[]): Array<{ start: Point; end: Point }> {
    const filledSet = new Set(cells.map((c) => `${c.row},${c.col}`));
    const segments: Array<{ start: Point; end: Point }> = [];

    for (const cell of cells) {
      const { row, col, polygon } = cell;

      for (let i = 0; i < polygon.length; i++) {
        const p1 = polygon[i];
        const p2 = polygon[(i + 1) % polygon.length];

        const start: Point = [col + p1[0], row + p1[1]];
        const end: Point = [col + p2[0], row + p2[1]];

        const p1IsMidpoint = p1[0] === 0.5 || p1[1] === 0.5;
        const p2IsMidpoint = p2[0] === 0.5 || p2[1] === 0.5;

        // Case 1: Contour edge (midpoint to midpoint)
        if (p1IsMidpoint && p2IsMidpoint) {
          segments.push({ start, end });
          continue;
        }

        // Case 2: Edge along cell boundary - include if neighbor not filled
        const isOnTop = p1[1] === 0 && p2[1] === 0;
        const isOnBottom = p1[1] === 1 && p2[1] === 1;
        const isOnLeft = p1[0] === 0 && p2[0] === 0;
        const isOnRight = p1[0] === 1 && p2[0] === 1;

        let neighborKey: string | null = null;
        if (isOnTop) neighborKey = `${row - 1},${col}`;
        else if (isOnBottom) neighborKey = `${row + 1},${col}`;
        else if (isOnLeft) neighborKey = `${row},${col - 1}`;
        else if (isOnRight) neighborKey = `${row},${col + 1}`;

        if (neighborKey !== null && !filledSet.has(neighborKey)) {
          segments.push({ start, end });
        }
      }
    }

    return segments;
  }

  /**
   * Draw outlines for all connected components in a tracker
   */
  function drawComponentOutlines(ctx: CanvasRenderingContext2D, tracker: IncrementalComponentTracker) {
    const components = tracker.getAllComponents();

    for (const [_, cells] of components) {
      const boundarySegments = extractComponentBoundary(cells);
      const polylines = chainSegments(boundarySegments);

      drawContourLines(ctx, polylines, {
        xScale: (x) => xScale(x),
        yScale: (y) => yScale(y),
        strokeColor: 'white',
        lineWidth: 2,
      });
    }
  }

  /**
   * Draw a single cell filled (for the current cell being processed)
   */
  function drawFilledCell(ctx: CanvasRenderingContext2D, row: number, col: number, polygon: Point[]) {
    const px = xScale(col);
    const py = yScale(row);
    const pw = xScale(col + 1) - px;
    const ph = yScale(row + 1) - py;

    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.beginPath();
    for (let i = 0; i < polygon.length; i++) {
      const [nx, ny] = polygon[i];
      const canvasX = px + nx * pw;
      const canvasY = py + ny * ph;
      if (i === 0) ctx.moveTo(canvasX, canvasY);
      else ctx.lineTo(canvasX, canvasY);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /**
   * Draw cells for a specific threshold level using incremental component tracking (row-based)
   */
  function drawLevelRows(
    ctx: CanvasRenderingContext2D,
    level: number,
    upToRowIndex: number,
    highlightCurrentRow: boolean
  ) {
    const threshold = getThresholdForLevel(level);
    const casePolygons = getAllCasePolygons();
    const maxRow = upToRowIndex < 0 ? -1 : Math.min(upToRowIndex, gridSize - 1);

    if (maxRow < 0) return;

    const tracker = componentTrackers[level];
    tracker.clear();

    // Process all cells up to and including the current row
    for (let row = 0; row <= maxRow; row++) {
      for (let col = 0; col < gridSize; col++) {
        const tl = evalHeightAt(col, row);
        const tr = evalHeightAt(col + 1, row);
        const br = evalHeightAt(col + 1, row + 1);
        const bl = evalHeightAt(col, row + 1);

        const caseIndex = getCaseIndex(tl, tr, br, bl, threshold);
        const polygon = casePolygons[caseIndex];

        if (polygon.length > 0) {
          const cellInfo: CellInfo = {
            row,
            col,
            caseIndex,
            polygon: polygon as [number, number][],
          };
          tracker.addCell(cellInfo);
        }
      }
    }

    drawComponentOutlines(ctx, tracker);

    // Highlight the current row's cells
    if (highlightCurrentRow) {
      for (let col = 0; col < gridSize; col++) {
        const tl = evalHeightAt(col, maxRow);
        const tr = evalHeightAt(col + 1, maxRow);
        const br = evalHeightAt(col + 1, maxRow + 1);
        const bl = evalHeightAt(col, maxRow + 1);

        const caseIndex = getCaseIndex(tl, tr, br, bl, threshold);
        const polygon = casePolygons[caseIndex];

        if (polygon.length > 0) {
          drawFilledCell(ctx, maxRow, col, polygon);
        }
      }
    }
  }

  /**
   * Draw all processed rows with their polygons across all levels
   */
  function drawProcessedRows(ctx: CanvasRenderingContext2D, state: AnimationState) {
    // Draw completed levels (all rows) - no highlight
    for (const level of state.completedLevels) {
      drawLevelRows(ctx, level, gridSize - 1, false);
    }

    // Draw current level (up to current row)
    if (state.currentRowIndex >= 0) {
      drawLevelRows(ctx, state.currentLevel, state.currentRowIndex, false);
    }
  }

  /**
   * Main draw function
   */
  function draw(state: AnimationState) {
    const ctx = canvas && canvas2d.ctx;
    if (!ctx) return;

    // Dark gray background (matches page)
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // Heatmap
    drawHeatmapLayer(ctx);

    // Contour outlines
    drawProcessedRows(ctx, state);
  }

  // ================================================================
  // Event Handlers
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
  // Lifecycle
  // ================================================================

  onMount(async () => {
    if (canvas) {
      canvas2d.init(canvas);
    }

    const volcanoData = await loadVolcanoData('/volcano.csv', blurSigma);
    heightmap = volcanoData.data;
    heightmapWidth = volcanoData.width;
    heightmapHeight = volcanoData.height;
    minHeight = volcanoData.minHeight;
    maxHeight = volcanoData.maxHeight;

    runInitialComputation();
    setupTimeline();
    isInitialized = true;

    draw(timeline.state);
  });

  onDestroy(() => {
    if (timeline) {
      timeline.dispose();
    }
  });

  // ================================================================
  // Reactive Blocks
  // ================================================================

  $: if (figureIsActive !== undefined && isInitialized) {
    handleVisibilityChange($figureIsActive);
  }
</script>

<Figure backgroundVisible={false} bind:isActive={figureIsActive}>
  {#snippet children()}
    <canvas
      bind:this={canvas}
      width={canvasWidth}
      height={canvasHeight}
      style="width: {canvasWidth}px; height: {canvasHeight}px;"
    />
  {/snippet}

  {#snippet caption()}
    <strong>Contour Plot Animation.</strong> White contour lines at {numLevels} elevation thresholds
    being traced incrementally using the marching squares algorithm.
  {/snippet}
</Figure>
