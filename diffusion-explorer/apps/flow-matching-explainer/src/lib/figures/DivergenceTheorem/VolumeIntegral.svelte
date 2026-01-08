<!-- Volume integral visualization with grid subdivision inside the closed curve. -->

<script lang="ts">
  import { onDestroy } from "svelte";
  import {
    useCanvas2D,
    generateStreamlines,
    drawTrajectories,
    drawArrow,
    Katex,
    Timeline,
    computeAlphaTrail,
    drawMathjax,
    type VectorFieldFn
  } from "@diffusion-explorer/ui";
  import { drawClosedCurve, type CurveFn } from "./divergence_theorem";

  // ----------------------------------------------------------------
  // Props
  // ----------------------------------------------------------------

  // Curve and field functions from parent
  export let curveFn: CurveFn;
  export let vectorFieldFn: (x: number, y: number) => [number, number];

  // Layout
  export let width = 400;
  export let height = 350;

  // Grid parameters
  export let gridResolution = 2;
  export let gridTolerance = 0.001;

  // Surface styling
  export let surfaceOpacity = 0.97;
  export let surfaceFillColor = "#e0e0e0";
  export let surfaceStrokeColor = "#999";
  export let surfaceStrokeWidth = 2;

  // Label (drawn on canvas with rounded rectangle background)
  export let showLabel = true;
  export let labelText = "V";
  export let volumeLabelFontSize = 28;
  export let volumeLabelColor = "#f97316";
  export let volumeLabelStrokeColor = "white";
  export let volumeLabelStrokeWidth = 5;
  export let volumeLabelBgColor = "#fff7ed";
  export let volumeLabelBgPadding = 8;
  export let volumeLabelBgRadius = 6;
  export let volumeLabelBgStrokeColor = "#f97316";
  export let volumeLabelBgStrokeWidth = 2;

  // Equation above canvas
  export let showEquation = true;
  export let equationText = "\\int_V \\nabla \\cdot \\mathbf{F} \\, dV";

  // Grid styling
  export let gridColor = "#f97316";  // Orange
  export let gridWidth = 2;

  // Arrow styling
  export let arrowColor = "#f97316";  // Orange
  export let arrowPadding = 0.3;  // Fraction of cell to leave as padding

  // Streamline styling
  export let streamlineColor = "#3b82f6";
  export let streamlineWidth = 2.5;
  export let streamlineOpacity = 0.8;
  export let showStreamlines = true;
  export let gradientSubdivisions = 12;
  export let minPathLength = 1.5;
  export let segmentLength = 0.01;

  // Animation pulse settings
  export let pulseWidth = 0.20;
  export let pulsePauseWidth = 0.05;

  // Animation timing
  export let streamlineDuration = 8;
  export let playingByDefault = true;

  // Visibility
  export let isActive;

  // ----------------------------------------------------------------
  // Types
  // ----------------------------------------------------------------

  type GridSegment = {
    start: [number, number];
    end: [number, number];
  };

  type GridLine = {
    value: number;  // y-value for horizontal, x-value for vertical
    segments: GridSegment[];
  };

  type GridLines = {
    horizontal: GridLine[];
    vertical: GridLine[];
  };

  type GridCell = {
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
    center: [number, number];
    isBoundary: boolean;  // True if cell touches the grid boundary
  };

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------

  let canvas = null;
  const canvas2d = useCanvas2D(width, height);
  $: ctx = canvas && canvas2d.ctx;

  let isInitialized = false;
  let wasPlayingBeforeHidden = false;

  // Animation state
  type AnimationState = {
    streamlinePhase: number;  // 0-1 for pulse animation
  };

  let timeline: Timeline<AnimationState> | null = null;

  // Pre-computed data
  let surfaceSamples: { points: [number, number][]; thetas: number[] } | null = null;
  let boundingBox: { xMin: number; xMax: number; yMin: number; yMax: number } | null = null;
  let gridLines: GridLines | null = null;
  let gridCells: GridCell[] = [];
  let streamlines: number[][][] = [];
  let streamlineOffsets: number[] = [];

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  const domainMargin = 0.7;  // Match SurfaceIntegral for symmetry

  function toPixel(p: [number, number]): [number, number] {
    if (!boundingBox) return [0, 0];
    // Compute domain to include some margin around the bounding box
    const xMin = boundingBox.xMin - domainMargin;
    const xMax = boundingBox.xMax + domainMargin;
    const yMin = boundingBox.yMin - domainMargin;
    const yMax = boundingBox.yMax + domainMargin;

    return [
      ((p[0] - xMin) / (xMax - xMin)) * width,
      ((yMax - p[1]) / (yMax - yMin)) * height
    ];
  }

  function scaleLength(domainLen: number): number {
    if (!boundingBox) return 0;
    const domainWidth = (boundingBox.xMax - boundingBox.xMin) + 2 * domainMargin;
    return (domainLen / domainWidth) * width;
  }

  // ----------------------------------------------------------------
  // Grid Subdivision Algorithm
  // ----------------------------------------------------------------

  /**
   * Sample points along the surface curve.
   */
  function sampleSurfacePoints(numSamples: number = 360): { points: [number, number][]; thetas: number[] } {
    const points: [number, number][] = [];
    const thetas: number[] = [];
    const step = (2 * Math.PI) / numSamples;

    for (let i = 0; i < numSamples; i++) {
      const theta = i * step;
      points.push(curveFn(theta));
      thetas.push(theta);
    }

    return { points, thetas };
  }

  /**
   * Compute bounding box of the surface.
   */
  function computeBoundingBox(points: [number, number][]): { xMin: number; xMax: number; yMin: number; yMax: number } {
    let xMin = Infinity, xMax = -Infinity;
    let yMin = Infinity, yMax = -Infinity;

    for (const [x, y] of points) {
      xMin = Math.min(xMin, x);
      xMax = Math.max(xMax, x);
      yMin = Math.min(yMin, y);
      yMax = Math.max(yMax, y);
    }

    return { xMin, xMax, yMin, yMax };
  }

  /**
   * Binary search to refine intersection point.
   * Returns the coordinate value (x for horizontal lines, y for vertical lines) at intersection.
   */
  function binarySearchIntersection(
    thetaLow: number,
    thetaHigh: number,
    targetValue: number,
    isHorizontal: boolean,  // true: search for y=targetValue, false: x=targetValue
    tolerance: number
  ): number {
    const coordIndex = isHorizontal ? 1 : 0;  // y for horizontal, x for vertical
    const resultIndex = isHorizontal ? 0 : 1;  // x for horizontal, y for vertical

    let low = thetaLow;
    let high = thetaHigh;

    // Determine which direction the coordinate changes
    const valLow = curveFn(low)[coordIndex];
    const valHigh = curveFn(high)[coordIndex];

    while (high - low > tolerance) {
      const mid = (low + high) / 2;
      const valMid = curveFn(mid)[coordIndex];

      // Check if target is between low and mid
      if ((valLow <= targetValue && targetValue <= valMid) ||
          (valMid <= targetValue && targetValue <= valLow)) {
        high = mid;
      } else {
        low = mid;
      }
    }

    const midTheta = (low + high) / 2;
    return curveFn(midTheta)[resultIndex];
  }

  /**
   * Find all intersections of a horizontal or vertical line with the surface.
   */
  function findIntersections(
    lineValue: number,
    isHorizontal: boolean,
    tolerance: number
  ): number[] {
    if (!surfaceSamples) return [];

    const { points, thetas } = surfaceSamples;
    const coordIndex = isHorizontal ? 1 : 0;  // y for horizontal, x for vertical
    const intersections: number[] = [];

    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      const val1 = points[i][coordIndex];
      const val2 = points[j][coordIndex];

      // Check if the line crosses between these two samples
      if ((val1 <= lineValue && lineValue < val2) || (val2 <= lineValue && lineValue < val1)) {
        // Binary search to refine
        const intersection = binarySearchIntersection(
          thetas[i],
          thetas[j],
          lineValue,
          isHorizontal,
          tolerance
        );
        intersections.push(intersection);
      }
    }

    // Sort intersections
    intersections.sort((a, b) => a - b);
    return intersections;
  }

  /**
   * Compute all grid line segments clipped to the surface boundary.
   */
  function computeGridLines(): GridLines {
    if (!surfaceSamples || !boundingBox) {
      return { horizontal: [], vertical: [] };
    }

    const { xMin, xMax, yMin, yMax } = boundingBox;
    const horizontal: GridLine[] = [];
    const vertical: GridLine[] = [];

    // Compute grid spacing (use max dimension for square cells)
    const maxDim = Math.max(xMax - xMin, yMax - yMin);
    const step = maxDim / gridResolution;
    const xStep = step;
    const yStep = step;

    // Horizontal lines (constant y)
    for (let i = 1; i < gridResolution; i++) {
      const y = yMin + i * yStep;
      const xIntersections = findIntersections(y, true, gridTolerance);

      // Create segments from pairs of intersections
      const segments: GridSegment[] = [];
      for (let j = 0; j < xIntersections.length - 1; j += 2) {
        segments.push({
          start: [xIntersections[j], y],
          end: [xIntersections[j + 1], y]
        });
      }

      if (segments.length > 0) {
        horizontal.push({ value: y, segments });
      }
    }

    // Vertical lines (constant x)
    for (let i = 1; i < gridResolution; i++) {
      const x = xMin + i * xStep;
      const yIntersections = findIntersections(x, false, gridTolerance);

      // Create segments from pairs of intersections
      const segments: GridSegment[] = [];
      for (let j = 0; j < yIntersections.length - 1; j += 2) {
        segments.push({
          start: [x, yIntersections[j]],
          end: [x, yIntersections[j + 1]]
        });
      }

      if (segments.length > 0) {
        vertical.push({ value: x, segments });
      }
    }

    return { horizontal, vertical };
  }

  /**
   * Compute grid cells (rectangles) from grid lines.
   * Only includes cells that are fully inside the surface.
   */
  function computeGridCells(): GridCell[] {
    if (!boundingBox) return [];

    const { xMin, xMax, yMin, yMax } = boundingBox;
    // Use max dimension for square cells
    const maxDim = Math.max(xMax - xMin, yMax - yMin);
    const step = maxDim / gridResolution;
    const xStep = step;
    const yStep = step;

    const cells: GridCell[] = [];

    // For each potential cell
    for (let i = 0; i < gridResolution; i++) {
      for (let j = 0; j < gridResolution; j++) {
        const cellXMin = xMin + i * xStep;
        const cellXMax = xMin + (i + 1) * xStep;
        const cellYMin = yMin + j * yStep;
        const cellYMax = yMin + (j + 1) * yStep;
        const center: [number, number] = [(cellXMin + cellXMax) / 2, (cellYMin + cellYMax) / 2];

        // Check if any corner of the cell is outside the surface boundary
        const corners: [number, number][] = [
          [cellXMin, cellYMin],
          [cellXMax, cellYMin],
          [cellXMin, cellYMax],
          [cellXMax, cellYMax]
        ];
        const isBoundary = !corners.every(corner => isPointInside(corner));

        // Simple check: is center inside the surface?
        // Using winding number algorithm
        if (isPointInside(center)) {
          cells.push({
            xMin: cellXMin,
            xMax: cellXMax,
            yMin: cellYMin,
            yMax: cellYMax,
            center,
            isBoundary
          });
        }
      }
    }

    return cells;
  }

  /**
   * Check if a point is inside the closed curve using winding number.
   */
  function isPointInside(point: [number, number]): boolean {
    if (!surfaceSamples) return false;

    const { points } = surfaceSamples;
    const [px, py] = point;
    let windingNumber = 0;

    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      const [x1, y1] = points[i];
      const [x2, y2] = points[j];

      if (y1 <= py) {
        if (y2 > py) {
          // Upward crossing
          const isLeft = (x2 - x1) * (py - y1) - (px - x1) * (y2 - y1);
          if (isLeft > 0) windingNumber++;
        }
      } else {
        if (y2 <= py) {
          // Downward crossing
          const isLeft = (x2 - x1) * (py - y1) - (px - x1) * (y2 - y1);
          if (isLeft < 0) windingNumber--;
        }
      }
    }

    return windingNumber !== 0;
  }

  // ----------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------

  /**
   * Draw all grid line segments.
   */
  function drawGrid(
    ctx: CanvasRenderingContext2D,
    gridLines: GridLines,
    options: { strokeColor?: string; strokeWidth?: number } = {}
  ): void {
    const { strokeColor = gridColor, strokeWidth = gridWidth } = options;

    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    ctx.lineCap = "round";

    // Draw horizontal lines
    for (const line of gridLines.horizontal) {
      for (const segment of line.segments) {
        const [x1, y1] = toPixel(segment.start);
        const [x2, y2] = toPixel(segment.end);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    }

    // Draw vertical lines
    for (const line of gridLines.vertical) {
      for (const segment of line.segments) {
        const [x1, y1] = toPixel(segment.start);
        const [x2, y2] = toPixel(segment.end);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    }
  }

  /**
   * Draw arrows (up, down, left, right) from cell center toward edges.
   */
  function drawCellArrows(
    ctx: CanvasRenderingContext2D,
    cell: GridCell,
    options: { color?: string; padding?: number; headSize?: number; lineWidth?: number } = {}
  ): void {
    const {
      color = arrowColor,
      padding = arrowPadding,
      headSize = 4,
      lineWidth = 2
    } = options;

    const [cx, cy] = toPixel(cell.center);
    const cellWidth = cell.xMax - cell.xMin;
    const cellHeight = cell.yMax - cell.yMin;

    // Arrow length (from center to near edge, with padding)
    const arrowLenX = scaleLength(cellWidth / 2 * (1 - padding));
    const arrowLenY = scaleLength(cellHeight / 2 * (1 - padding));

    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";

    // Draw 4 arrows using imported drawArrow function
    const directions: Array<{ dx: number; dy: number; len: number }> = [
      { dx: 1, dy: 0, len: arrowLenX },   // Right
      { dx: -1, dy: 0, len: arrowLenX },  // Left
      { dx: 0, dy: -1, len: arrowLenY },  // Up (negative in canvas coords)
      { dx: 0, dy: 1, len: arrowLenY }    // Down
    ];

    for (const { dx, dy, len } of directions) {
      const endX = cx + dx * len;
      const endY = cy + dy * len;
      drawArrow(ctx, cx, cy, endX, endY, headSize);
    }
  }

  /**
   * Animation function (empty for now, just draws static grid).
   */
  function animateGrid(
    ctx: CanvasRenderingContext2D,
    gridLines: GridLines,
    progress: number,  // 0 to 1
    options: { strokeColor?: string; strokeWidth?: number } = {}
  ): void {
    // TODO: Implement progressive reveal from top-left to bottom-right
    // For now, just draw the full grid
    drawGrid(ctx, gridLines, options);
  }

  /**
   * Main draw function.
   */
  function draw(state: AnimationState): void {
    if (!ctx || !isInitialized) return;

    const { streamlinePhase } = state;

    ctx.clearRect(0, 0, width, height);

    // 1. Draw streamlines (behind everything) with pulse animation
    if (showStreamlines && streamlines.length > 0) {
      const baseOpacity = streamlineOpacity;
      const perSegmentAlphas: number[][] = streamlines.map((streamline, i) => {
        const numSegments = streamline.length - 1;
        const offset = streamlineOffsets[i] ?? 0;
        return computeAlphaTrail(numSegments, streamlinePhase, offset, pulseWidth, pulsePauseWidth, baseOpacity);
      });

      drawTrajectories(
        ctx,
        streamlines,
        0,
        {
          strokeWidth: streamlineWidth,
          color: streamlineColor,
          progressOpacity: baseOpacity,
          pointRadius: 0,
          showPreview: false,
          showHeadMarker: false,
          perSegmentAlphas,
          gradientSubdivisions
        }
      );
    }

    // 2. Draw surface fill (behind grid and arrows)
    drawClosedCurve(ctx, curveFn, toPixel, {
      fillColor: surfaceFillColor,
      fillOpacity: surfaceOpacity,
      strokeColor: surfaceStrokeColor,
      strokeWidth: surfaceStrokeWidth
    });

    // 3. Draw grid lines (above surface fill)
    if (gridLines) {
      animateGrid(ctx, gridLines, 1.0);
    }

    // 4. Draw arrows in each cell (above surface fill), skip boundary cells
    for (const cell of gridCells) {
      if (!cell.isBoundary) {
        drawCellArrows(ctx, cell);
      }
    }

    // 5. Draw volume label (V) with rounded rectangle background
    if (showLabel && boundingBox) {
      const centerX = (boundingBox.xMin + boundingBox.xMax) / 2;
      const centerY = (boundingBox.yMin + boundingBox.yMax) / 2;
      const [cx, cy] = toPixel([centerX, centerY]);

      // Estimate label size for background rectangle
      const labelWidth = volumeLabelFontSize * 0.8;
      const labelHeight = volumeLabelFontSize;

      // Draw rounded rectangle background
      const rectX = cx - labelWidth / 2 - volumeLabelBgPadding;
      const rectY = cy - labelHeight / 2 - volumeLabelBgPadding;
      const rectW = labelWidth + volumeLabelBgPadding * 2;
      const rectH = labelHeight + volumeLabelBgPadding * 2;

      ctx.fillStyle = volumeLabelBgColor;
      ctx.beginPath();
      ctx.roundRect(rectX, rectY, rectW, rectH, volumeLabelBgRadius);
      ctx.fill();
      ctx.strokeStyle = volumeLabelBgStrokeColor;
      ctx.lineWidth = volumeLabelBgStrokeWidth;
      ctx.stroke();

      // Draw label
      drawMathjax(ctx, labelText, cx, cy + labelHeight / 2, volumeLabelFontSize, 0, 0, { color: volumeLabelColor, stroke: volumeLabelStrokeColor, strokeWidth: volumeLabelStrokeWidth });
    }
  }

  // ----------------------------------------------------------------
  // Setup
  // ----------------------------------------------------------------

  function runInitialComputation() {
    if (!canvas) return;

    // Sample surface points
    surfaceSamples = sampleSurfacePoints(360);

    // Compute bounding box
    boundingBox = computeBoundingBox(surfaceSamples.points);

    // Compute grid lines
    gridLines = computeGridLines();

    // Compute grid cells
    gridCells = computeGridCells();

    // Generate streamlines
    const streamlineOptions = {
      domainMin: [boundingBox.xMin - domainMargin, boundingBox.yMin - domainMargin] as [number, number],
      domainMax: [boundingBox.xMax + domainMargin, boundingBox.yMax + domainMargin] as [number, number],
      density: 0.8,
      integrationDirection: 'both' as const,
      minlength: minPathLength,
      segmentLength
    };

    const raw = generateStreamlines(vectorFieldFn as VectorFieldFn, streamlineOptions);

    // Convert to pixel coordinates
    streamlines = raw.map(streamline =>
      streamline.map(([x, y]) => toPixel([x, y]))
    );

    // Offsets for animation (use 0 for synchronized animation)
    streamlineOffsets = streamlines.map(() => 0);
  }

  function setupTimeline() {
    timeline = new Timeline<AnimationState>();
    timeline.initialState = { streamlinePhase: 0 };
    timeline.duration = streamlineDuration;
    timeline.looping = true;

    timeline.add({
      name: "Streamlines",
      duration: 1,
      reduce(t: number) {
        return { streamlinePhase: t };
      }
    }, 0);

    timeline.onTick((_t, state) => {
      draw(state);
    });
  }

  function startAnimation() {
    if (timeline) timeline.play();
  }

  function stopAnimation() {
    if (timeline) timeline.pause();
  }

  // ----------------------------------------------------------------
  // Event Handlers
  // ----------------------------------------------------------------

  function handleVisibilityChange(active: boolean) {
    if (!timeline) return;
    if (!active && timeline.isPlaying) {
      wasPlayingBeforeHidden = true;
      stopAnimation();
    } else if (active && wasPlayingBeforeHidden) {
      wasPlayingBeforeHidden = false;
      startAnimation();
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

  // Initialize when canvas is ready
  $: if (!isInitialized && canvas && curveFn && vectorFieldFn) {
    runInitialComputation();
    setupTimeline();
    isInitialized = true;
    draw(timeline!.initialState);
    if (playingByDefault) startAnimation();
  }

  // Handle visibility changes
  $: if (isActive !== undefined && isInitialized) {
    handleVisibilityChange($isActive);
  }
</script>

<div class="volume-integral-wrapper">
  {#if showEquation}
    <div class="equation">
      <Katex math={equationText} displayMode={true} />
    </div>
  {/if}
  <div class="volume-integral-container">
    <canvas
      bind:this={canvas}
      use:canvas2d.bindCanvas
      style="width: 100%; height: auto; aspect-ratio: {width}/{height};"
    ></canvas>
  </div>
</div>

<style>
  .volume-integral-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
  }

  .equation {
    margin-bottom: 0.5em;
    text-align: center;
    color: #374151;
  }

  .volume-integral-container {
    width: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
    position: relative;
  }
</style>
