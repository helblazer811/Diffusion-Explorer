<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Player, DoubleFigure, useCanvas2D, Timeline, type Clip } from '@diffusion-explorer/ui';
  import * as d3 from 'd3';
  import {
    getAllCasePolygons,
    getCaseCornerStates,
    getCaseIndex,
    type Point,
  } from './marching-squares';
  import { loadVolcanoData, evaluateHeightmap } from './topography-data';
  import {
    computeContourCells,
    traceContourLines,
    drawContourLines,
    chainSegments,
    type EdgeSegment,
  } from './contour-outlining';
  import { IncrementalComponentTracker, type CellInfo } from './union-find-components';

  // ================================================================
  // Props - Component interface
  // ================================================================
  export let canvasWidth = 400;
  export let canvasHeight = 400;
  export let gridSize = 8;
  export let numContourLevels = 3;
  export let blurSigma = 0;

  // ================================================================
  // State - Canvas, ctx, scales, flags, animation state
  // ================================================================
  const marginWidth = 20;
  const marginHeight = 20;

  // Canvas managers
  const leftCanvas2d = useCanvas2D(canvasWidth, canvasHeight);
  const rightCanvas2d = useCanvas2D(canvasWidth, canvasHeight);

  // Canvas references
  let leftCanvas: HTMLCanvasElement | null = null;
  let rightCanvas: HTMLCanvasElement | null = null;

  // Visibility binding
  let figureIsActive: ReturnType<typeof import('svelte/store').writable<boolean>> | undefined;

  // Initialize flag
  let isInitialized = false;

  // Computed contexts
  $: leftCtx = leftCanvas && leftCanvas2d.ctx;
  $: rightCtx = rightCanvas && rightCanvas2d.ctx;

  // Scales
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

  // Number of threshold levels
  const numLevels = 1;

  // Minimum threshold as fraction of height range (0 = minHeight, 1 = maxHeight)
  const minThresholdFraction = 0.15;

  // Animation state type
  type AnimationState = {
    currentLevel: number;
    currentCellIndex: number;
    highlightedCaseIndex: number;
    completedLevels: number[];
  };

  // ================================================================
  // Helpers - Pure utility functions
  // ================================================================

  /**
   * Evaluate heightmap at grid coordinates
   */
  function evalHeightAt(col: number, row: number): number {
    const hx = (col / gridSize) * (heightmapWidth - 1);
    const hy = (row / gridSize) * (heightmapHeight - 1);
    return evaluateHeightmap(heightmap, heightmapWidth, heightmapHeight, hx, hy);
  }

  /**
   * Get normalized height at grid position
   */
  function getNormalizedHeight(col: number, row: number): number {
    const height = evalHeightAt(col, row);
    return (height - minHeight) / (maxHeight - minHeight);
  }

  /**
   * Convert plasma color to RGB tuple
   */
  function plasmaColorScale(t: number): [number, number, number] {
    const color = d3.color(d3.interpolatePlasma(t));
    if (color) {
      const rgb = color.rgb();
      return [Math.round(rgb.r), Math.round(rgb.g), Math.round(rgb.b)];
    }
    return [0, 0, 0];
  }

  /**
   * Pre-render the heatmap as ImageData at full volcano resolution
   */
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

  // ================================================================
  // Setup - runInitialComputation()
  // ================================================================

  function runInitialComputation() {
    // Create scales
    xScale = d3
      .scaleLinear()
      .domain([0, gridSize])
      .range([marginWidth, canvasWidth - marginWidth]);

    yScale = d3
      .scaleLinear()
      .domain([0, gridSize])
      .range([marginHeight, canvasHeight - marginHeight]);

    // Pre-render heatmap
    heatmapImageData = createHeatmapImageData();

    // Compute contour lines at multiple levels (starting from higher minimum)
    contourLevels = [];
    for (let i = 0; i < numContourLevels; i++) {
      const t = minThresholdFraction + ((i + 1) / (numContourLevels + 1)) * (1 - minThresholdFraction);
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
  // Animations - setupTimeline(), clips, onTick
  // ================================================================

  /**
   * Get threshold value for a given level (0 to numLevels-1)
   * Thresholds are evenly spaced from minThresholdFraction to maxHeight
   */
  function getThresholdForLevel(level: number): number {
    const t = minThresholdFraction + ((level + 1) / (numLevels + 1)) * (1 - minThresholdFraction);
    return minHeight + t * (maxHeight - minHeight);
  }

  function setupTimeline() {
    const tl = Timeline.from<AnimationState>({
      duration: totalIterations * 0.5,
      initialState: {},
      clips: [
        { clip: cellIterationClip, ...{ start: 0.05, end: 1 } },
      ],
    });
    player = new Player(tl, { looping: true, endPause: 2 });

    const totalCells = gridSize * gridSize;
    const totalIterations = totalCells * numLevels;

    const cellIterationClip: Clip<AnimationState> = {
      name: 'CellIteration',
      reduce(t: number) {
        const globalIndex = Math.min(
          Math.floor(t * totalIterations),
          totalIterations - 1
        );

        const currentLevel = Math.floor(globalIndex / totalCells);
        const cellIndex = globalIndex % totalCells;

        // Build list of completed levels
        const completedLevels: number[] = [];
        for (let i = 0; i < currentLevel; i++) {
          completedLevels.push(i);
        }

        // Get threshold for current level
        const threshold = getThresholdForLevel(currentLevel);

        const row = Math.floor(cellIndex / gridSize);
        const col = cellIndex % gridSize;

        const tl = evalHeightAt(col, row);
        const tr = evalHeightAt(col + 1, row);
        const br = evalHeightAt(col + 1, row + 1);
        const bl = evalHeightAt(col, row + 1);

        const caseIndex = getCaseIndex(tl, tr, br, bl, threshold);

        return {
          currentLevel,
          currentCellIndex: cellIndex,
          highlightedCaseIndex: caseIndex,
          completedLevels,
        };
      },
    };

    // Start at 0.05 to add a pause at the beginning before animation starts

    player.onTick((_, state) => {
      draw(state);
    });
  }

  // ================================================================
  // Drawing - Draw helpers + main draw(state) function
  // ================================================================

  /**
   * Draw the terrain heatmap at full resolution
   */
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
    ctx.lineWidth = 1.5;

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
   * Draw all contour lines (white)
   */
  function drawAllContourLines(ctx: CanvasRenderingContext2D) {
    for (const level of contourLevels) {
      drawContourLines(ctx, level.polylines, {
        xScale: (x) => xScale(x),
        yScale: (y) => yScale(y),
        strokeColor: 'white',
        lineWidth: 2,
      });
    }
  }

  /**
   * Highlight the current cell being processed
   */
  function drawCellHighlight(ctx: CanvasRenderingContext2D, cellIndex: number) {
    if (cellIndex < 0) return;

    const row = Math.floor(cellIndex / gridSize);
    const col = cellIndex % gridSize;

    const px = xScale(col);
    const py = yScale(row);
    const pw = xScale(col + 1) - px;
    const ph = yScale(row + 1) - py;

    ctx.save();
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 4;
    ctx.strokeRect(px, py, pw, ph);
    ctx.restore();
  }

  /**
   * Extract the outer boundary edges of a connected component.
   * This traces around the filled polygon region, including edges where
   * the component borders unfilled cells or the grid edge.
   */
  function extractComponentBoundary(cells: CellInfo[]): Array<{ start: Point; end: Point }> {
    const filledSet = new Set(cells.map((c) => `${c.row},${c.col}`));
    const segments: Array<{ start: Point; end: Point }> = [];

    for (const cell of cells) {
      const { row, col, polygon } = cell;

      // For each edge of the polygon, determine if it should be drawn
      for (let i = 0; i < polygon.length; i++) {
        const p1 = polygon[i];
        const p2 = polygon[(i + 1) % polygon.length];

        // Convert to grid coordinates
        const start: Point = [col + p1[0], row + p1[1]];
        const end: Point = [col + p2[0], row + p2[1]];

        // Determine if this edge is on the boundary of the filled region
        // An edge is on the boundary if:
        // 1. It's a contour edge (connects midpoints) - always include
        // 2. It's on a cell edge where the neighbor is not in the filled set

        const p1IsMidpoint = p1[0] === 0.5 || p1[1] === 0.5;
        const p2IsMidpoint = p2[0] === 0.5 || p2[1] === 0.5;

        // Case 1: Contour edge (midpoint to midpoint) - always part of boundary
        if (p1IsMidpoint && p2IsMidpoint) {
          segments.push({ start, end });
          continue;
        }

        // Case 2: Edge along cell boundary - include if neighbor not filled
        // Check which cell edge this polygon edge lies on
        const isOnTop = p1[1] === 0 && p2[1] === 0;
        const isOnBottom = p1[1] === 1 && p2[1] === 1;
        const isOnLeft = p1[0] === 0 && p2[0] === 0;
        const isOnRight = p1[0] === 1 && p2[0] === 1;

        let neighborKey: string | null = null;
        if (isOnTop) neighborKey = `${row - 1},${col}`;
        else if (isOnBottom) neighborKey = `${row + 1},${col}`;
        else if (isOnLeft) neighborKey = `${row},${col - 1}`;
        else if (isOnRight) neighborKey = `${row},${col + 1}`;

        // Include edge if it's on a cell boundary and neighbor is not filled
        if (neighborKey !== null && !filledSet.has(neighborKey)) {
          segments.push({ start, end });
        }
      }
    }

    return segments;
  }

  /**
   * Draw filled polygons and outlines for all connected components in a tracker
   */
  function drawComponentOutlines(ctx: CanvasRenderingContext2D, tracker: IncrementalComponentTracker) {
    const components = tracker.getAllComponents();

    // First, fill all cells with mostly opaque white
    for (const [_, cells] of components) {
      for (const cell of cells) {
        const { row, col, polygon } = cell;
        const px = xScale(col);
        const py = yScale(row);
        const pw = xScale(col + 1) - px;
        const ph = yScale(row + 1) - py;

        ctx.save();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
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
    }

  }

  /**
   * Draw a single cell filled (for the current cell being processed)
   */
  function drawFilledCell(
    ctx: CanvasRenderingContext2D,
    row: number,
    col: number,
    polygon: Point[]
  ) {
    const px = xScale(col);
    const py = yScale(row);
    const pw = xScale(col + 1) - px;
    const ph = yScale(row + 1) - py;

    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 1.0)';
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
   * Draw cells for a specific threshold level using incremental component tracking
   * Shows outlines for all processed cells, and fills the current cell
   */
  function drawLevelCells(
    ctx: CanvasRenderingContext2D,
    level: number,
    upToCellIndex: number,
    highlightCurrentCell: boolean
  ) {
    const threshold = getThresholdForLevel(level);
    const casePolygons = getAllCasePolygons();
    const totalCells = gridSize * gridSize;
    const maxIndex = upToCellIndex < 0 ? -1 : Math.min(upToCellIndex, totalCells - 1);

    if (maxIndex < 0) return;

    const tracker = componentTrackers[level];

    // Reset and rebuild tracker up to current cell
    tracker.clear();

    let currentCellInfo: CellInfo | null = null;

    for (let cellIndex = 0; cellIndex <= maxIndex; cellIndex++) {
      const row = Math.floor(cellIndex / gridSize);
      const col = cellIndex % gridSize;

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

        // Track if this is the current cell
        if (cellIndex === maxIndex) {
          currentCellInfo = cellInfo;
        }
      }
    }

    // Draw all component outlines
    drawComponentOutlines(ctx, tracker);

    // Highlight current cell with filled polygon (brief flash)
    if (highlightCurrentCell && currentCellInfo) {
      drawFilledCell(ctx, currentCellInfo.row, currentCellInfo.col, currentCellInfo.polygon);
    }
  }

  /**
   * Draw all processed cells with their polygons across all levels
   */
  function drawProcessedCells(ctx: CanvasRenderingContext2D, state: AnimationState) {
    const totalCells = gridSize * gridSize;

    // Draw completed levels (all cells) - no highlight
    for (const level of state.completedLevels) {
      drawLevelCells(ctx, level, totalCells - 1, false);
    }

    // Draw current level (up to current cell) - highlight current cell
    if (state.currentCellIndex >= 0) {
      drawLevelCells(ctx, state.currentLevel, state.currentCellIndex, true);
    }
  }

  /**
   * Draw the 4x4 grid of marching squares cases
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

      ctx.save();
      ctx.fillStyle = '#2a2a2a';
      ctx.fillRect(cellX, cellY, cellSize, cellSize);

      const isHighlighted = caseIndex === highlightedCase;
      ctx.strokeStyle = isHighlighted ? 'white' : '#ccc';
      ctx.lineWidth = isHighlighted ? 4 : 1;
      ctx.strokeRect(cellX, cellY, cellSize, cellSize);

      const cornerStates = getCaseCornerStates(caseIndex);
      const cornerRadius = 4;
      const cornerOffset = 10;

      // Draw polygon first so corners appear on top
      const polygon = casePolygons[caseIndex];
      if (polygon.length > 0) {
        ctx.beginPath();
        ctx.fillStyle = 'white';
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

      // Draw corners on top of polygon
      const corners = [
        { x: cellX + cornerOffset, y: cellY + cornerOffset, filled: cornerStates.tl },
        { x: cellX + cellSize - cornerOffset, y: cellY + cornerOffset, filled: cornerStates.tr },
        { x: cellX + cellSize - cornerOffset, y: cellY + cellSize - cornerOffset, filled: cornerStates.br },
        { x: cellX + cornerOffset, y: cellY + cellSize - cornerOffset, filled: cornerStates.bl },
      ];

      for (const corner of corners) {
        ctx.beginPath();
        ctx.arc(corner.x, corner.y, cornerRadius, 0, Math.PI * 2);
        if (corner.filled) {
          // Filled region: black circle outline, no fill
          ctx.strokeStyle = 'black';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        } else {
          // Unfilled region: white outline only, no fill
          ctx.strokeStyle = 'white';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }

      ctx.restore();
    }
  }

  /**
   * Draw a semi-transparent overlay over the case table, excluding the highlighted case
   */
  function drawCaseTableOverlay(ctx: CanvasRenderingContext2D, highlightedCase: number) {
    if (highlightedCase < 0) return; // No overlay if nothing highlighted

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

    // Calculate highlighted cell position
    const highlightRow = Math.floor(highlightedCase / 4);
    const highlightCol = highlightedCase % 4;
    const highlightX = startX + highlightCol * (cellSize + gap);
    const highlightY = startY + highlightRow * (cellSize + gap);

    ctx.save();
    ctx.fillStyle = 'rgba(26, 26, 26, 0.5)'; // #1a1a1a with 0.5 opacity

    // Create path covering entire canvas, then cut out highlighted cell
    ctx.beginPath();

    // Outer rectangle (entire canvas)
    ctx.rect(0, 0, canvasWidth, canvasHeight);

    // Inner rectangle (highlighted cell) - drawn counter-clockwise to create hole
    ctx.moveTo(highlightX, highlightY);
    ctx.lineTo(highlightX, highlightY + cellSize);
    ctx.lineTo(highlightX + cellSize, highlightY + cellSize);
    ctx.lineTo(highlightX + cellSize, highlightY);
    ctx.closePath();

    ctx.fill('evenodd');
    ctx.restore();
  }

  /**
   * Main draw function
   */
  function draw(state: AnimationState) {
    if (!leftCtx || !rightCtx) return;

    // Fill both canvases with dark gray background
    leftCtx.fillStyle = '#1a1a1a';
    leftCtx.fillRect(0, 0, canvasWidth, canvasHeight);
    rightCtx.fillStyle = '#1a1a1a';
    rightCtx.fillRect(0, 0, canvasWidth, canvasHeight);

    // ---- Left canvas ----
    drawHeatmapLayer(leftCtx);
    drawGrid(leftCtx);
    drawProcessedCells(leftCtx, state);
    drawCellHighlight(leftCtx, state.currentCellIndex);

    // ---- Right canvas ----
    drawCasesGrid(rightCtx, state.highlightedCaseIndex);
    drawCaseTableOverlay(rightCtx, state.highlightedCaseIndex);
  }

  // ================================================================
  // Event Handlers
  // ================================================================

  function handleVisibilityChange(isVisible: boolean) {
    if (!player) return;
    if (isVisible) {
      player.play();
    } else {
      player.pause();
    }
  }

  // ================================================================
  // Lifecycle
  // ================================================================

  onMount(async () => {
    if (leftCanvas) {
      leftCanvas2d.init(leftCanvas);
    }
    if (rightCanvas) {
      rightCanvas2d.init(rightCanvas);
    }

    // Load volcano data
    const volcanoData = await loadVolcanoData('/volcano.csv', blurSigma);
    heightmap = volcanoData.data;
    heightmapWidth = volcanoData.width;
    heightmapHeight = volcanoData.height;
    minHeight = volcanoData.minHeight;
    maxHeight = volcanoData.maxHeight;

    runInitialComputation();
    setupTimeline();
    isInitialized = true;

    draw(player.state);
  });

  onDestroy(() => {
    if (player) {
      player?.dispose();
    }
  });

  // ================================================================
  // Reactive Blocks
  // ================================================================

  $: if (figureIsActive !== undefined && isInitialized) {
    handleVisibilityChange($figureIsActive);
  }
</script>

<div class="figure-container">
  <DoubleFigure gap={20} bind:isActive={figureIsActive} backgroundVisible={false}>
    {#snippet title()}
      <h2 class="main-title">Generating Contours with Marching Squares</h2>
    {/snippet}

    {#snippet left()}
      <div class="panel">
        <h3 class="panel-title">Maunga Whau Volcano Topography</h3>
        <canvas
          bind:this={leftCanvas}
          width={canvasWidth}
          height={canvasHeight}
          style="width: {canvasWidth}px; height: {canvasHeight}px;"
        />
      </div>
    {/snippet}

    {#snippet right()}
      <div class="panel">
        <h3 class="panel-title">Marching Squares Case Table</h3>
        <canvas
          bind:this={rightCanvas}
          width={canvasWidth}
          height={canvasHeight}
          style="width: {canvasWidth}px; height: {canvasHeight}px;"
        />
      </div>
    {/snippet}

    {#snippet caption()}
      <strong>Marching Squares Algorithm.</strong> Left: Maunga Whau volcano elevation data
      rendered as a heatmap. The algorithm processes each cell from top-left to bottom-right,
      determining which of the 16 cases matches based on corner values above/below the threshold.
      Contour lines show elevation bands. Right: The 16 possible marching squares cases.
    {/snippet}
  </DoubleFigure>
</div>

<style>
  .figure-container {
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .main-title {
    font-size: 2rem;
    font-weight: 600;
    color: #e8e8e8;
    margin: 0 0 0.25rem 0;
    text-align: center;
  }

  .panel {
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .panel-title {
    font-size: 1.3rem;
    font-weight: 500;
    color: #e0e0e0;
    margin: 0 0 0.5rem 0;
    text-align: center;
  }
</style>
