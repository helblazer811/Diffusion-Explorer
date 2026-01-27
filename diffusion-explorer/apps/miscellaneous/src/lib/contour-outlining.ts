/**
 * Contour Outlining Utilities
 *
 * Provides functions to trace connected contour outlines from marching squares polygons.
 * Uses BFS/DFS graph traversal to find connected components and trace their boundaries.
 */

import { getCaseIndex, getAllCasePolygons, type Point } from './marching-squares';

// Re-export Point type for consumers
export type { Point } from './marching-squares';

/**
 * A cell with its marching squares polygon and grid position
 */
export interface CellData {
  row: number;
  col: number;
  caseIndex: number;
  polygon: Point[];
}

/**
 * A connected component of cells at a given threshold level
 */
export interface ContourComponent {
  cells: CellData[];
  level: number;
}

/**
 * Edge segment on a cell boundary
 */
export interface EdgeSegment {
  start: Point;
  end: Point;
  cellRow: number;
  cellCol: number;
}

/**
 * Computes marching squares data for all cells in a grid at a given threshold
 *
 * @param evalFn - Function to evaluate the value at grid coordinates
 * @param gridWidth - Number of cells horizontally
 * @param gridHeight - Number of cells vertically
 * @param threshold - Threshold value for the contour
 * @returns Array of CellData for cells that have non-empty polygons
 */
export function computeContourCells(
  evalFn: (col: number, row: number) => number,
  gridWidth: number,
  gridHeight: number,
  threshold: number
): CellData[] {
  const casePolygons = getAllCasePolygons();
  const cells: CellData[] = [];

  for (let row = 0; row < gridHeight; row++) {
    for (let col = 0; col < gridWidth; col++) {
      // Get corner values (top-left, top-right, bottom-right, bottom-left)
      const tl = evalFn(col, row);
      const tr = evalFn(col + 1, row);
      const br = evalFn(col + 1, row + 1);
      const bl = evalFn(col, row + 1);

      const caseIndex = getCaseIndex(tl, tr, br, bl, threshold);
      const polygon = casePolygons[caseIndex];

      // Only include cells with non-empty polygons
      if (polygon.length > 0) {
        cells.push({
          row,
          col,
          caseIndex,
          polygon: [...polygon],
        });
      }
    }
  }

  return cells;
}

/**
 * Creates a key for cell lookup
 */
function cellKey(row: number, col: number): string {
  return `${row},${col}`;
}

/**
 * Parses a cell key back to row, col
 */
function parseKey(key: string): [number, number] {
  const [row, col] = key.split(',').map(Number);
  return [row, col];
}

/**
 * Gets the 4-connected neighbors of a cell
 */
function getNeighbors(row: number, col: number, gridWidth: number, gridHeight: number): string[] {
  const neighbors: string[] = [];

  if (row > 0) neighbors.push(cellKey(row - 1, col)); // up
  if (row < gridHeight - 1) neighbors.push(cellKey(row + 1, col)); // down
  if (col > 0) neighbors.push(cellKey(row, col - 1)); // left
  if (col < gridWidth - 1) neighbors.push(cellKey(row, col + 1)); // right

  return neighbors;
}

/**
 * Finds connected components of filled cells using BFS
 *
 * @param cells - Array of cells with non-empty polygons
 * @param gridWidth - Grid width
 * @param gridHeight - Grid height
 * @param level - Threshold level index (for labeling)
 * @returns Array of connected components
 */
export function findConnectedComponents(
  cells: CellData[],
  gridWidth: number,
  gridHeight: number,
  level: number
): ContourComponent[] {
  // Build a set of filled cell keys and a map for quick lookup
  const filledSet = new Set<string>();
  const cellMap = new Map<string, CellData>();

  for (const cell of cells) {
    const key = cellKey(cell.row, cell.col);
    filledSet.add(key);
    cellMap.set(key, cell);
  }

  const visited = new Set<string>();
  const components: ContourComponent[] = [];

  // BFS to find connected components
  for (const startKey of filledSet) {
    if (visited.has(startKey)) continue;

    const component: CellData[] = [];
    const queue: string[] = [startKey];

    while (queue.length > 0) {
      const currentKey = queue.shift()!;
      if (visited.has(currentKey)) continue;
      visited.add(currentKey);

      const cell = cellMap.get(currentKey)!;
      component.push(cell);

      // Add unvisited filled neighbors
      const [row, col] = parseKey(currentKey);
      for (const neighborKey of getNeighbors(row, col, gridWidth, gridHeight)) {
        if (filledSet.has(neighborKey) && !visited.has(neighborKey)) {
          queue.push(neighborKey);
        }
      }
    }

    components.push({ cells: component, level });
  }

  return components;
}

/**
 * Extracts the boundary edges of a connected component
 * These are polygon edges that lie on the boundary between filled and unfilled cells
 *
 * @param component - Connected component of cells
 * @param gridWidth - Grid width
 * @param gridHeight - Grid height
 * @returns Array of edge segments forming the boundary
 */
export function extractBoundaryEdges(
  component: ContourComponent,
  gridWidth: number,
  gridHeight: number
): EdgeSegment[] {
  const filledSet = new Set<string>();
  for (const cell of component.cells) {
    filledSet.add(cellKey(cell.row, cell.col));
  }

  const edges: EdgeSegment[] = [];

  for (const cell of component.cells) {
    const { row, col, polygon } = cell;

    // For each edge of the polygon, check if it lies on a boundary
    for (let i = 0; i < polygon.length; i++) {
      const start = polygon[i];
      const end = polygon[(i + 1) % polygon.length];

      // Check if this edge is on a cell boundary (not interior)
      // An edge is on the boundary if it touches the edge of the cell
      // and the adjacent cell in that direction is not filled

      const isOnBoundary = isEdgeOnCellBoundary(start, end, row, col, filledSet, gridWidth, gridHeight);

      if (isOnBoundary) {
        edges.push({
          start: [col + start[0], row + start[1]],
          end: [col + end[0], row + end[1]],
          cellRow: row,
          cellCol: col,
        });
      }
    }
  }

  return edges;
}

/**
 * Checks if a polygon edge lies on the boundary of the filled region
 */
function isEdgeOnCellBoundary(
  start: Point,
  end: Point,
  row: number,
  col: number,
  filledSet: Set<string>,
  gridWidth: number,
  gridHeight: number
): boolean {
  // Check if edge is on the top edge of cell (y = 0)
  if (start[1] === 0 && end[1] === 0) {
    const neighborKey = cellKey(row - 1, col);
    return row === 0 || !filledSet.has(neighborKey);
  }

  // Check if edge is on the bottom edge of cell (y = 1)
  if (start[1] === 1 && end[1] === 1) {
    const neighborKey = cellKey(row + 1, col);
    return row === gridHeight - 1 || !filledSet.has(neighborKey);
  }

  // Check if edge is on the left edge of cell (x = 0)
  if (start[0] === 0 && end[0] === 0) {
    const neighborKey = cellKey(row, col - 1);
    return col === 0 || !filledSet.has(neighborKey);
  }

  // Check if edge is on the right edge of cell (x = 1)
  if (start[0] === 1 && end[0] === 1) {
    const neighborKey = cellKey(row, col + 1);
    return col === gridWidth - 1 || !filledSet.has(neighborKey);
  }

  // Interior edges (cutting through the cell) are always part of the contour line
  // These are edges that connect edge midpoints
  const isInteriorEdge =
    (start[0] === 0.5 || start[1] === 0.5 || start[0] === 0 || start[0] === 1 || start[1] === 0 || start[1] === 1) &&
    (end[0] === 0.5 || end[1] === 0.5 || end[0] === 0 || end[0] === 1 || end[1] === 0 || end[1] === 1);

  // If it's an edge that connects midpoints, it's the actual contour line
  if ((start[0] === 0.5 || start[1] === 0.5) && (end[0] === 0.5 || end[1] === 0.5)) {
    return true;
  }

  return isInteriorEdge;
}

/**
 * Traces contour lines by connecting edge midpoint segments across cells
 * Returns continuous polylines representing the contour at the given threshold
 *
 * @param cells - Array of cells with non-empty polygons
 * @param gridWidth - Grid width
 * @param gridHeight - Grid height
 * @returns Array of polylines (each polyline is an array of points in grid coordinates)
 */
export function traceContourLines(
  cells: CellData[],
  gridWidth: number,
  gridHeight: number
): Point[][] {
  // Extract all contour segments (edges between midpoints)
  const segments: Array<{ start: Point; end: Point }> = [];

  for (const cell of cells) {
    const { row, col, polygon } = cell;

    // Find edges that connect midpoints (these are the actual contour lines)
    for (let i = 0; i < polygon.length; i++) {
      const start = polygon[i];
      const end = polygon[(i + 1) % polygon.length];

      // Check if both points are on edges (midpoints have 0.5 in one coordinate)
      const startIsMidpoint = start[0] === 0.5 || start[1] === 0.5;
      const endIsMidpoint = end[0] === 0.5 || end[1] === 0.5;

      if (startIsMidpoint && endIsMidpoint) {
        // This is a contour segment - convert to grid coordinates
        segments.push({
          start: [col + start[0], row + start[1]],
          end: [col + end[0], row + end[1]],
        });
      }
    }
  }

  // Chain segments into continuous polylines
  return chainSegments(segments);
}

/**
 * Chains disconnected segments into continuous polylines
 */
export function chainSegments(segments: Array<{ start: Point; end: Point }>): Point[][] {
  if (segments.length === 0) return [];

  const polylines: Point[][] = [];
  const used = new Set<number>();
  const epsilon = 0.0001;

  function pointsEqual(a: Point, b: Point): boolean {
    return Math.abs(a[0] - b[0]) < epsilon && Math.abs(a[1] - b[1]) < epsilon;
  }

  function findConnectingSegment(point: Point, excludeIndex: number): number {
    for (let i = 0; i < segments.length; i++) {
      if (used.has(i) || i === excludeIndex) continue;
      if (pointsEqual(segments[i].start, point) || pointsEqual(segments[i].end, point)) {
        return i;
      }
    }
    return -1;
  }

  for (let startIdx = 0; startIdx < segments.length; startIdx++) {
    if (used.has(startIdx)) continue;

    const polyline: Point[] = [];
    used.add(startIdx);

    // Start with this segment
    polyline.push(segments[startIdx].start);
    polyline.push(segments[startIdx].end);

    // Extend forward from end
    let currentEnd = segments[startIdx].end;
    let nextIdx = findConnectingSegment(currentEnd, startIdx);

    while (nextIdx !== -1) {
      used.add(nextIdx);
      const seg = segments[nextIdx];

      if (pointsEqual(seg.start, currentEnd)) {
        polyline.push(seg.end);
        currentEnd = seg.end;
      } else {
        polyline.push(seg.start);
        currentEnd = seg.start;
      }

      nextIdx = findConnectingSegment(currentEnd, nextIdx);
    }

    // Extend backward from start
    let currentStart = segments[startIdx].start;
    let prevIdx = findConnectingSegment(currentStart, startIdx);

    while (prevIdx !== -1) {
      used.add(prevIdx);
      const seg = segments[prevIdx];

      if (pointsEqual(seg.end, currentStart)) {
        polyline.unshift(seg.start);
        currentStart = seg.start;
      } else {
        polyline.unshift(seg.end);
        currentStart = seg.end;
      }

      prevIdx = findConnectingSegment(currentStart, prevIdx);
    }

    polylines.push(polyline);
  }

  return polylines;
}

export interface DrawContourOptions {
  xScale: (x: number) => number;
  yScale: (y: number) => number;
  strokeColor?: string;
  lineWidth?: number;
}

/**
 * Draws contour lines on a canvas context
 *
 * @param ctx - Canvas 2D context
 * @param polylines - Array of polylines in grid coordinates
 * @param options - Drawing options including scales and styling
 */
export function drawContourLines(
  ctx: CanvasRenderingContext2D,
  polylines: Point[][],
  options: DrawContourOptions
): void {
  const { xScale, yScale, strokeColor = '#8B4513', lineWidth = 1.5 } = options;

  ctx.save();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const polyline of polylines) {
    if (polyline.length < 2) continue;

    ctx.beginPath();
    ctx.moveTo(xScale(polyline[0][0]), yScale(polyline[0][1]));

    for (let i = 1; i < polyline.length; i++) {
      ctx.lineTo(xScale(polyline[i][0]), yScale(polyline[i][1]));
    }

    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Draws a grid overlay for debugging/animation
 *
 * @param ctx - Canvas 2D context
 * @param gridWidth - Number of cells horizontally
 * @param gridHeight - Number of cells vertically
 * @param options - Drawing options including scales
 */
export function drawGrid(
  ctx: CanvasRenderingContext2D,
  gridWidth: number,
  gridHeight: number,
  options: { xScale: (x: number) => number; yScale: (y: number) => number; strokeColor?: string; lineWidth?: number }
): void {
  const { xScale, yScale, strokeColor = 'rgba(128, 128, 128, 0.3)', lineWidth = 0.5 } = options;

  ctx.save();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = lineWidth;

  // Vertical lines
  for (let col = 0; col <= gridWidth; col++) {
    ctx.beginPath();
    ctx.moveTo(xScale(col), yScale(0));
    ctx.lineTo(xScale(col), yScale(gridHeight));
    ctx.stroke();
  }

  // Horizontal lines
  for (let row = 0; row <= gridHeight; row++) {
    ctx.beginPath();
    ctx.moveTo(xScale(0), yScale(row));
    ctx.lineTo(xScale(gridWidth), yScale(row));
    ctx.stroke();
  }

  ctx.restore();
}
